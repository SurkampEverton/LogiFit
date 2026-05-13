/**
 * Single source of truth pro schema do banco (regra 3 + ADR 0004).
 *
 * `drizzle-kit generate` lê este re-export pra produzir migrations em
 * `packages/db/migrations/*.sql`.
 *
 * Convenção: cada agrupamento de tabelas em arquivo próprio
 * (`persons.ts`, `identity.ts`, `cnpj-cache.ts`, `better-auth.ts`,
 * `auth-attempts.ts`, ...), e este index reexporta tudo.
 *
 * **Por que auth schemas ficam em `@repo/db`** (não em `@repo/auth`):
 * `@repo/auth` consome `@repo/db` (precisa de adapter Drizzle + acesso
 * às tabelas). Inverter dependência criaria ciclo. Schemas são SQL state;
 * config + helpers de auth vivem em `@repo/auth`.
 */
export * from './persons'
export * from './cnpj-cache'
export * from './identity'

// Sprint 01a Faixa B — BetterAuth (ADR 0092) + LogiFit auth_attempts/auth_lockouts
export * from './better-auth'
export * from './auth-attempts'

// Sprint 01a Faixa C — RBAC com scope + recovery codes MFA (regra 43)
export * from './rbac'

// Sprint 01a Faixa F — audit_log + system_alerts (regras 5+34+39 + ADR 0071)
export * from './audit'

// Sprint 01b Faixa A — professional_registrations (ADR 0055) + franchise (ADR 0007) + consents (regra 29)
export * from './professional-registrations'
export * from './franchise'
export * from './consents'

// Sprint 01b Faixa B — passaporte cross-tenant (regra 42 + ADR 0077)
export * from './passport'

// Sprint 02 Faixa A — CRM unificado: members + member_events + member_notes + member_tags (ADR 0011 esperado)
export * from './members'

// Sprint 03 Faixa A — Agenda universal: resources + recurring_slots + appointments + waitlist (ADR 0012 esperado)
export * from './agenda'

// Sprint 04 Faixa A — Financeiro Asaas: plans + contracts + invoices + payments + asaas_keys + webhook_events (ADR 0013 + 0014 esperados)
export * from './financeiro'

// Sprint 05 Faixa A — Ofertas comerciais: promotions + plan_items + appointment_credits + referrals (ADR 0020 esperado)
export * from './ofertas'

// Sprint 06 Faixa A — IA arquitetura: providers + models + task_routing + tenant_usage + audit_log + assistant_sessions/messages + action_proposals + tools_registry (ADR 0064 + 0075)
export * from './ai'

// Sprint 06 Faixa B — RAG (documents/chunks) + cache semântico + member_insights + support_tickets (ADR 0064 + ADR 0070 esqueleto)
export * from './ai-rag'

// Sprint 07 — Cross-alert dispatcher (esqueleto): alert_subscribers (vazio MVP, popula Fase 2)
export * from './alerts'

// Sprint 08 Faixa A — Academia controle de acesso: devices + secrets + events + blocks (ADR 0017+0018 esperados)
export * from './acesso'

// Sprint 01b fechamento — Compliance: ai_committees (CFM 2.454) + privileged_sessions (PAM) + data_subject_requests (LGPD art. 18)
export * from './compliance'
