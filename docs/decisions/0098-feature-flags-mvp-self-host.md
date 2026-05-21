# ADR 0098 — Feature flags MVP: tabela própria self-host + helper + cache 60s

- **Status:** Accepted
- **Date:** 2026-05-21

## Context

Sprint 02b4 fechamento listou `passport_signup_v1` como pendência — gate pra habilitar/desabilitar cadastro proativo do paciente (`/cadastro` Path B) sem precisar redeploy.

Mais amplamente, MVP tem 10+ features que se beneficiariam de flag controlável:
- `passport_signup_v1` (cadastro proativo)
- `genui_v1` (Generative UI Sprint 28)
- `device_hub_v1` (Sprint 32)
- `diario_v1` (Sprint 31 diário alimentar)
- `teleconsulta_v1` (Sprint 31 vídeo)
- `churn_v1` (IA churn Sprint 19)
- `treinos_v1` / `avaliacoes_v1` (Sprint 11/12)
- `fisio_prontuario_v1` (Sprint 20)
- `adquirencia_v1` (Sprint 18)
- `portal_member_v1` (Sprint 26)

Sprint 06 (Copilot) já mencionou "feature flag PostHog" mas [ADR 0091](0091-self-host-total-oracle-sp.md) dropou PostHog do MVP (avaliação pós-MVP quando houver dor real de funil). Resta gap arquitetural.

3 opções avaliadas:

**(A) Env vars no `.env.local` + redeploy**
- Pro: zero código novo; já existe `FEATURE_PASSPORT_SIGNUP_V1=true` style
- Con: toda mudança = redeploy do app (Next.js standalone); sem auditoria de quem mudou + quando; sem rollback fácil

**(B) GrowthBook self-host (container Coolify)**
- Pro: features completas — percentage rollout, A/B testing, targeting por user attributes, audit log nativo, UI admin pronta
- Con: container novo + DB próprio (Mongo/Postgres); SDK adicional (~80KB); complexidade desproporcional pro MVP (regra 46 — ADR justificativa pesada); LaunchDarkly/Flagsmith similares descartadas mesma razão

**(C) Tabela própria `feature_flags` + helper + cache 60s**
- Pro: zero infra nova; Postgres já existe; SQL trivial; cache in-memory sub-millisecond pós-warmup; audit via `audit_log` (regra 5); hot-toggle via UPDATE (Sprint 02b7+ adiciona UI admin); evolução natural pra percentage rollout via `metadata jsonb`
- Con: sem A/B testing nativo (não é objetivo MVP); cache 60s cria janela de "flag toggled mas server velho" (aceitável)

## Decision

**Opção C — tabela própria self-host + helper + cache 60s.** Decisão pragmática MVP. GrowthBook (B) fica como opção de evolução quando complexidade real demandar (rollout gradual + A/B testing + targeting).

### Schema canônico

```sql
CREATE TABLE feature_flags (
  key text PRIMARY KEY,           -- slug do flag: 'passport_signup_v1', 'genui_v1', etc
  name text NOT NULL,             -- nome amigável: "Cadastro proativo do paciente"
  description text,               -- explicação curta do que liga/desliga
  enabled boolean NOT NULL DEFAULT false,
  enabled_at timestamptz,         -- quando virou true (audit)
  /** Reservado pra evolução Sprint 02b7+:
   *  - rollout_percentage: number (0-100) — % de tráfego
   *  - tenant_overrides: { [tenantId]: boolean }
   *  - cohort: jsonb — segmentos por plano/criação/etc
   */
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

**Sem `tenant_id` + sem RLS** — flags são globais. Override per-tenant fica em `metadata.tenant_overrides` no MVP; Sprint 02b7+ pode promover pra tabela separada se volume crescer.

**Policy:** GRANT-only (auth table sem RLS). Apenas `super_admin` UPDATE via UI admin futuro (Sprint 02b7+). MVP altera via SQL direto / seed.

### Helper canônico

`apps/web/app/lib/feature-flags.ts`:

```ts
export async function isFeatureEnabled(key: string): Promise<boolean>
```

- Cache in-memory `Map<key, {enabled, fetchedAt}>` com TTL 60s
- Default false se flag não existe no DB (fail-closed)
- Sem dependência de Redis (cache process-local; cada server tem seu próprio — aceitável pro MVP single-instance)
- Sprint 02b7+ pode promover pra Redis pub/sub pra invalidar cache em todos servers quando UI admin alterar flag

### Uso típico

```ts
// Server Action / Route handler
import { isFeatureEnabled } from '@/app/lib/feature-flags'

export async function signupPatient(input) {
  if (!(await isFeatureEnabled('passport_signup_v1'))) {
    throw new ApiException({
      code: 'FORBIDDEN',
      message: 'Cadastro proativo ainda não está habilitado. Acesse via convite da clínica/academia.',
      request_id: '',
    })
  }
  // resto da lógica
}
```

### Audit / governança

- Toda mudança em `feature_flags` futuro UI admin grava em `audit_log` (regra 5) com `action='feature_flag.toggled'` + `actor_user_id`
- MVP altera via SQL direto (super_admin só) — sem audit automático mas trail no journal Postgres

### O que NÃO é decisão MVP

- **A/B testing** — comparar variantes de UI/feature por cohort. Fica pra B (GrowthBook) quando precisar
- **Percentage rollout** — 10% → 50% → 100%. Pode ser hack via `metadata.rollout_percentage` + helper checa `crypto.createHash('sha256').update(userId).digest()` % 100, mas sem MVP
- **Targeting por user attributes** — "habilitar só pra tenants Pro" — pode usar `metadata.tenant_overrides` mas sem UI MVP
- **Kill switch automático** — desligar flag se métrica de erro X aumentar. Fora do escopo

## Consequences

### Positivas

- **Zero infra nova** — Postgres já existe; sem container/dep externa
- **Hot-toggle** sem redeploy — UPDATE feature_flags SET enabled = true
- **Trail SQL nativo** — Postgres journal preserva mudanças
- **Evolução natural** — metadata jsonb cobre rollout/overrides quando necessário
- **MVP simples** — ~50 linhas de código novo (schema + helper)
- **Sub-ms latência pós-warmup** — cache process-local 60s TTL

### Negativas

- **Cache TTL 60s** — flag toggled = ~60s pra propagar pra todos requests
- **Sem audit automático MVP** — UI admin futuro adiciona via wrapAction `audit_log`
- **Cache process-local** — multi-server deploy precisa Redis pub/sub no futuro
- **Sem rollout gradual** — só on/off MVP

### Não-objetivos

- Não vamos integrar GrowthBook/LaunchDarkly/Flagsmith no MVP
- Não vamos fazer A/B testing (escopo separado pós-MVP)
- Não vamos suportar feature flags client-side (toda lógica server-side gate)

## Implementação MVP (este sprint)

1. **Migration** `0048_feature_flags.sql` — CREATE TABLE + index PK
2. **Policy** `0060_feature_flags.sql` — GRANT SELECT/UPDATE pra logifit_app
3. **Schema Drizzle** `packages/db/src/schema/feature-flags.ts`
4. **Seed inicial** — 10 flags canônicas em `enabled=false` (passport_signup_v1, genui_v1, etc)
5. **Helper** `apps/web/app/lib/feature-flags.ts` com `isFeatureEnabled(key)`
6. **Gate em `signupPatient`** — primeiro caller
7. **Tests unitários** — cache 60s + fail-closed + force refresh
8. **Spinoff Sprint 02b7+:** UI admin `/app/super-admin/feature-flags` + audit_log integration + Redis pub/sub multi-server

## Referências

- [ADR 0091 — Self-host total](0091-self-host-total-oracle-sp.md) — contexto stack self-host
- [ADR 0067 — DPO Governança LGPD](0067-dpo-governanca-compliance-lgpd.md) — regra 5 audit_log retenção 5a
- Sprint 02b4 fechamento — item `passport_signup_v1` pendente (este ADR fecha)
- Sprint 06 Copilot — referência original a "feature flag PostHog" (dropada via ADR 0091)
