/**
 * Espelhamento empresa → unidade (ADR 0106).
 *
 * Decisão do produto: **para o operador, unidade É a empresa.** Ele cadastra
 * uma empresa e espera que o sistema saiba onde ela fica — não quer gerenciar
 * um segundo nível.
 *
 * O nível continua existindo no schema porque 12 tabelas dependem dele, e duas
 * são de autorização (`user_roles.scope_unit_id`,
 * `user_permission_grants.scope_unit_id`). Colapsar de verdade quebraria o
 * escopo de permissão por unidade que o `multiempresa.md` define — por exemplo,
 * fisioterapeuta com acesso a duas unidades da mesma empresa.
 *
 * Então o nível fica invisível **enquanto for 1:1**: criar empresa cria a
 * unidade, editar o cadastro atualiza as duas. Empresa que ganhar uma segunda
 * unidade passa a gerenciá-las explicitamente, e este espelhamento sai do
 * caminho — por isso ele só age quando existe 0 ou 1 unidade.
 */
import { db } from '@repo/db/client'
import { companies, persons, units } from '@repo/db/schema'
import { type Address, normalizeAddress } from '@repo/types'
import { and, eq } from 'drizzle-orm'

/**
 * Garante que a company tenha uma unidade espelhando nome e endereço da pessoa.
 *
 * Não faz nada quando a company já tem 2+ unidades: aí ela saiu do caso 1:1 e
 * sobrescrever apagaria a gestão manual do operador.
 *
 * @returns o id da unidade espelhada, ou null quando não se aplica
 */
export async function syncCompanyUnit(tenantId: string, companyId: string): Promise<string | null> {
  const [company] = await db
    .select({
      id: companies.id,
      name: persons.name,
      displayName: persons.displayName,
      address: persons.address,
    })
    .from(companies)
    .innerJoin(persons, eq(persons.id, companies.personId))
    .where(and(eq(companies.id, companyId), eq(companies.tenantId, tenantId)))
    .limit(1)
  if (!company) return null

  const existing = await db
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.companyId, companyId), eq(units.tenantId, tenantId)))

  // 2+ unidades = operador gerencia manualmente; espelhar apagaria o trabalho dele.
  if (existing.length > 1) return null

  const unitName = company.displayName?.trim() || company.name
  const address = normalizeAddress(company.address as Address | null) ?? {}

  if (existing[0]) {
    await db
      .update(units)
      .set({ name: unitName, address, updatedAt: new Date() })
      .where(eq(units.id, existing[0].id))
    return existing[0].id
  }

  const [created] = await db
    .insert(units)
    .values({ tenantId, companyId, name: unitName, address })
    .returning({ id: units.id })
  return created?.id ?? null
}

/**
 * Espelha a unidade da company à qual esta pessoa pertence, se houver.
 *
 * Existe para que editar o cadastro pela tela de empresas — que salva em
 * `persons` — mantenha a unidade em dia sem o operador saber que ela existe.
 * Pessoa que não é company (aluno, fornecedor) não tem efeito nenhum.
 */
export async function syncUnitFromPerson(tenantId: string, personId: string): Promise<void> {
  const [company] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.personId, personId), eq(companies.tenantId, tenantId)))
    .limit(1)
  if (!company) return
  await syncCompanyUnit(tenantId, company.id)
}
