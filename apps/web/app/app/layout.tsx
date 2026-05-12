import { db } from '@repo/db/client'
import { tenants, users } from '@repo/db/schema'
import { AppShell, MENU_MODULES, type Vertical } from '@repo/ui'
/**
 * Layout autenticado — Sprint 00b Faixa A.
 *
 * Wraps `/app/*` em `<AppShell>` (Sprint 00b — overlay SideMenu + header).
 *
 * Server Component:
 *   - `requireFullSession()` → redirect /login se não autenticado
 *   - Carrega user.username + tenant.name (Drizzle)
 *   - Carrega permissões do user (Faixa C: real has_permission lookup;
 *     Faixa A: passa vazio = todas visíveis)
 *   - Achata catálogo `nav` next-intl pra Record<string, string> serializável
 *     pro `<AppShell>` Client Component consumir.
 */
import { eq } from 'drizzle-orm'
import { getMessages } from 'next-intl/server'
import { headers as nextHeaders } from 'next/headers'
import type { ReactNode } from 'react'
import { requireFullSession } from '../lib/session'

export const dynamic = 'force-dynamic'

interface NavMessages {
  [key: string]: string | NavMessages
}

/** Achata `{ a: { b: 'x' } }` em `{ 'nav.a.b': 'x' }`. */
function flattenLabels(obj: NavMessages, prefix = 'nav'): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj)) {
    const key = `${prefix}.${k}`
    if (typeof v === 'string') {
      result[key] = v
    } else if (v && typeof v === 'object') {
      Object.assign(result, flattenLabels(v as NavMessages, key))
    }
  }
  return result
}

export default async function AppAreaLayout({ children }: { children: ReactNode }) {
  const session = await requireFullSession('/app')
  const claims = session.logifit

  // User + tenant metadata pro header
  const [userRow] = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.id, claims.userId))
    .limit(1)
  const [tenantRow] = await db
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, claims.tenantId))
    .limit(1)

  // I18n: catálogo nav → Record<string,string> serializável
  const messages = (await getMessages()) as { nav: NavMessages }
  const labels = flattenLabels(messages.nav ?? {})

  // Path atual para destacar item ativo (Sprint 00b Faixa A simplificado —
  // header x-pathname enviado pelo middleware; fallback: vazio)
  const h = await nextHeaders()
  const currentPath = h.get('x-pathname') ?? ''

  // Sprint 00b Faixa A: verticals fixas (academia) — Sprint 04+ adiciona
  // coluna `tenants.verticals_active` real
  const activeVerticals: Vertical[] = ['academia']

  // Sprint 00b Faixa A: permissionKeys vazio = "todas visíveis"
  // (AppShell logic: size === 0 || has(k)).
  // Faixa C: lookup async via has_permission RPC para popular set real.
  const permissionKeys: string[] = []

  return (
    <AppShell
      userId={claims.userId}
      userName={userRow?.username ?? '—'}
      tenantId={claims.tenantId}
      tenantName={tenantRow?.name ?? '—'}
      activeVerticals={activeVerticals}
      permissionKeys={permissionKeys}
      modules={MENU_MODULES}
      currentPath={currentPath}
      labels={labels}
    >
      {children}
    </AppShell>
  )
}
