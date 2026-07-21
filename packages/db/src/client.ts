import { AsyncLocalStorage } from 'node:async_hooks'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool, type PoolClient } from 'pg'

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not set — copie .env.example para .env.local e preencha')
}

/**
 * Roteamento de conexão por request (ADR 0107).
 *
 * A RLS depende de `set_config('app.tenant_id', ...)` valer na MESMA conexão
 * que executa a query. O Drizzle sobre um Pool pega uma conexão qualquer por
 * query — o contexto setado por `withSessionContext` numa conexão nunca era
 * visto pelas queries, e a RLS ficou inerte no app inteiro (descoberto em
 * 2026-07-20 pelos vazamentos entre tenants).
 *
 * `runWithDbClient` guarda a conexão contextualizada em AsyncLocalStorage e o
 * `RoutedPool` desvia TODA chamada do `db` global para ela enquanto o callback
 * roda. Handlers existentes ganham RLS sem mudar de assinatura.
 */
const dbClientStorage = new AsyncLocalStorage<PoolClient>()

/**
 * Proxy que neutraliza `release()`: dentro do contexto, quem devolve a conexão
 * ao pool é o dono do contexto (`withSessionContext`), nunca um trecho interno
 * — senão a conexão voltaria ao pool com SET ROLE/configs ainda ativos e outra
 * request a reusaria com o tenant errado.
 */
const scopedWrappers = new WeakMap<PoolClient, PoolClient>()
function wrapScopedClient(client: PoolClient): PoolClient {
  const cached = scopedWrappers.get(client)
  if (cached) return cached
  const proxy = new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === 'release') return () => undefined
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  scopedWrappers.set(client, proxy)
  return proxy
}

/**
 * Serializa queries concorrentes na conexão contextualizada: um PoolClient não
 * executa em paralelo, e o enfileiramento interno do pg está deprecado (some
 * no pg@9). `Promise.all` dentro de um contexto é padrão comum nos handlers.
 */
const clientQueues = new WeakMap<PoolClient, Promise<unknown>>()
function enqueueOnClient<T>(client: PoolClient, op: () => Promise<T>): Promise<T> {
  const prev = clientQueues.get(client) ?? Promise.resolve()
  const next = prev.then(op, op)
  clientQueues.set(
    client,
    next.catch(() => undefined),
  )
  return next
}

class RoutedPool extends Pool {
  // why: as sobrecargas de tipos do pg tornam o repasse tipado impraticável —
  // os argumentos passam intactos pra PoolClient.query/Pool.query.
  override query(...args: any[]): any {
    const scoped = dbClientStorage.getStore()
    if (scoped) {
      // Estilo callback (raro; drizzle usa promise) não passa pela fila
      if (typeof args[args.length - 1] === 'function') {
        return (scoped.query as (...a: any[]) => any)(...args)
      }
      return enqueueOnClient(scoped, () => (scoped.query as (...a: any[]) => any)(...args))
    }
    return (super.query as (...a: any[]) => any)(...args)
  }

  // why: idem — e o caminho de transação do Drizzle chama `connect()`; dentro
  // do contexto ele DEVE receber a mesma conexão (BEGIN/COMMIT no client certo).
  override connect(...args: any[]): any {
    const scoped = dbClientStorage.getStore()
    if (scoped) {
      const wrapped = wrapScopedClient(scoped)
      const cb = args[0]
      if (typeof cb === 'function') {
        cb(null, wrapped, () => undefined)
        return undefined
      }
      return Promise.resolve(wrapped)
    }
    return (super.connect as (...a: any[]) => any)(...args)
  }
}

declare global {
  var __dbPool: Pool | undefined
}

// HMR pode ter guardado um Pool antigo sem roteamento — não reaproveitar nesse
// caso. Tipado como Pool pra preservar as sobrecargas genéricas de query<T>()
// pros chamadores (o override dinâmico as apagaria).
const pool: Pool =
  globalThis.__dbPool instanceof RoutedPool
    ? globalThis.__dbPool
    : new RoutedPool({ connectionString: DATABASE_URL })

if (process.env.NODE_ENV !== 'production') {
  globalThis.__dbPool = pool
}

/**
 * Executa `fn` com todas as chamadas do `db` global roteadas pra `client`.
 *
 * O chamador é responsável por preparar o client (SET ROLE + set_config) antes
 * e por limpar (RESET ROLE, configs vazios) e liberar depois — ver
 * `withSessionContext` em apps/web.
 */
export function runWithDbClient<T>(client: PoolClient, fn: () => Promise<T>): Promise<T> {
  // O await PRECISA acontecer dentro do escopo do ALS: se fn devolve um query
  // builder do Drizzle (thenable preguiçoso) sem await, a execução dispararia
  // só quando o CHAMADOR desse await — já fora do contexto — e a query cairia
  // no pool sem escopo, sem nenhum erro. O wrapper async subscreve o thenable
  // ainda dentro do escopo, garantindo a conexão certa em qualquer forma de fn.
  return dbClientStorage.run(client, async () => await fn())
}

export { pool }
export const db = drizzle(pool)
