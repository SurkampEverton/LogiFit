/**
 * Layout autenticado — Sprint 00b Faixa A.
 *
 * Wraps `/app/*` em `<AppShell>` (Sprint 00b — overlay SideMenu + header).
 *
 * Server Component:
 *   - `requireFullSession()` → redirect /login se não autenticado
 *   - Consome `session.logifit.username` + `session.logifit.tenantName`
 *     (Sprint 00b Faixa A polish — vêm do customSession claims pra evitar
 *     query extra via pool logifit_app + RLS bloqueada sem app.tenant_id)
 *   - Carrega permissões do user (Faixa C: real has_permission lookup;
 *     Faixa A: passa vazio = todas visíveis)
 *   - Achata catálogo `nav` next-intl pra Record<string, string> serializável
 *     pro `<AppShell>` Client Component consumir.
 */
import { inferPersona } from '@repo/ai'
import { db } from '@repo/db/client'
import { tenantAssistantSettings } from '@repo/db/schema'
import { AppShell, AssistantFAB, MENU_MODULES, type Vertical } from '@repo/ui'
import { eq } from 'drizzle-orm'
import { getMessages } from 'next-intl/server'
import { headers as nextHeaders } from 'next/headers'
import type { ReactNode } from 'react'
import { requireFullSession } from '../lib/session'
import { CommandPalette } from './command-palette'

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

/** Achata `{ assistant: { fab: { open: 'X' } } }` em `{ 'assistant.fab.open': 'X' }`. */
function flattenSection(obj: unknown, prefix: string): Record<string, string> {
  const result: Record<string, string> = {}
  if (!obj || typeof obj !== 'object') return result
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = `${prefix}.${k}`
    if (typeof v === 'string') {
      result[key] = v
    } else if (v && typeof v === 'object') {
      Object.assign(result, flattenSection(v, key))
    }
  }
  return result
}

export default async function AppAreaLayout({ children }: { children: ReactNode }) {
  const session = await requireFullSession('/app')
  const claims = session.logifit

  // I18n: catálogo nav + assistant → Record<string,string> serializável
  const messages = (await getMessages()) as {
    nav: NavMessages
    assistant?: Record<string, unknown>
  }
  const labels = flattenLabels(messages.nav ?? {})
  const assistantLabels = flattenSection(messages.assistant ?? {}, 'assistant')

  // Path atual para destacar item ativo — header `x-pathname` setado pelo middleware
  const h = await nextHeaders()
  const currentPath = h.get('x-pathname') ?? ''

  // Sprint 00b Faixa A: verticals fixas (academia) — Sprint 04+ adiciona
  // coluna `tenants.verticals_active` real
  const activeVerticals: Vertical[] = ['academia']

  // Sprint 00b Faixa C — permissions reais via SQL function
  // `list_user_permissions()` (Sprint 01b D.6 infra) populadas em
  // session.logifit.permissions. AppShell filtra items por `has(key)`.
  const permissionKeys = claims.permissions

  // Sprint 00b Faixa D — Email do BetterAuth user (header avatar + footer)
  const userEmail = session.user.email ?? undefined

  // Persona default — inferida; Sprint 06+ Faixa D persiste em cookie + chip switcher
  const persona = inferPersona({ roles: claims.roles, isMember: false })
  // White-label — lê `tenant_assistant_settings.assistant_name` real do DB; fallback 'Copilot'
  const [settings] = await db
    .select({ assistantName: tenantAssistantSettings.assistantName })
    .from(tenantAssistantSettings)
    .where(eq(tenantAssistantSettings.tenantId, claims.tenantId))
    .limit(1)
  const assistantName = settings?.assistantName ?? 'Copilot'

  return (
    <AppShell
      userId={claims.userId}
      userName={claims.username}
      userEmail={userEmail}
      tenantId={claims.tenantId}
      tenantName={claims.tenantName}
      activeVerticals={activeVerticals}
      permissionKeys={permissionKeys}
      modules={MENU_MODULES}
      currentPath={currentPath}
      labels={labels}
    >
      {children}
      <CommandPalette />
      <AssistantFAB
        assistantName={assistantName}
        labels={assistantLabels}
        initialPersona={persona}
      />
    </AppShell>
  )
}
