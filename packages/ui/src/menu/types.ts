/**
 * Tipos canônicos do SideMenu — Sprint 00b (ADR 0063).
 *
 * Cada `MenuItem` é uma folha clicável (`url`) OU agrupador (`children`).
 * `MenuModule` é a seção colapsável de topo (ex: "Pessoas", "Financeiro").
 *
 * Filtros aplicados na renderização (Sprint 00b Faixa C completa):
 *   - `requiredPermission` — só aparece se `has_permission(user_id, perm)` true
 *   - `requiredVertical` — só aparece se tenant tem vertical ativa
 *   - `requiredConsent` — só aparece se consent ativo (raro em menu)
 *   - `featureFlag` — só aparece se flag ON (dev/staging)
 *
 * Sprint 00b Faixa A: registry estático em `menu-items.ts`; sprints futuros
 * EDITAM o arquivo pra adicionar itens. API runtime `registerMenuItem()`
 * fica adiada (overhead pra dev solo — file edit já resolve).
 */

export type Vertical = 'academia' | 'fisio' | 'nutri'

export interface MenuItem {
  /** ID único do item (slug). Usado em `key` React + persistência localStorage. */
  id: string
  /** Chave i18n (`nav.{module}.{item}`) — regra 27. Nunca string literal. */
  labelKey: string
  /** Emoji ou caractere — Sprint 00b Faixa A usa emoji; Lucide vem em sprint próprio. */
  icon?: string
  /** URL Next.js — `null`/`undefined` = item é agrupador com `children`. */
  url?: string
  /** Permission key (`has_permission`) requerida. Null = visível a todos autenticados. */
  requiredPermission?: string
  /** Vertical do tenant requerida. Null = visível em qualquer vertical. */
  requiredVertical?: Vertical
  /** Consent purpose requerido. Raro em menu (mais comum em features). */
  requiredConsent?: string
  /** Feature flag PostHog. Null = visível sempre. */
  featureFlag?: string
  /** Badge opcional ("3 vencendo"). Render-time, vem de Server Component. */
  badge?: string
  /** Sub-itens (acordeão inline; sem drawer aninhado — spec Sprint 00b). */
  children?: MenuItem[]
}

export interface MenuModule {
  /** ID do módulo (ex: 'inicio', 'pessoas', 'financeiro'). */
  id: string
  /** Chave i18n (`nav.modules.{id}`). */
  labelKey: string
  /** Emoji do módulo. */
  icon?: string
  /** Ordem na lista (asc). Items dentro do módulo seguem ordem do array. */
  order: number
  /** Vertical requerida pro módulo inteiro (não item-a-item). */
  requiredVertical?: Vertical
  /** Itens do módulo. Módulo some se 0 items passam nos filtros. */
  items: MenuItem[]
}

/**
 * Contexto que o filter de visibilidade consome.
 * Sprint 00b Faixa A: stub (todos os flags `true`); Faixa C plugga `has_permission`.
 */
export interface MenuFilterContext {
  userId: string
  tenantId: string
  /** Verticals ativas no tenant (ex: ['academia'] ou ['academia', 'fisio']). */
  activeVerticals: Vertical[]
  /** Sprint 00b Faixa C: async lookup via has_permission RPC. Faixa A: sempre true. */
  hasPermission: (key: string) => boolean
  /** Consents ativos do user (Sprint 11+ popula). Faixa A: sempre true. */
  hasConsent: (purpose: string) => boolean
  /** Feature flags ativas (PostHog adiado — Sprint 00b Faixa A: vazio). */
  featureFlags: Set<string>
}
