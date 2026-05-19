# ADR 0094 — Passport global sessions: schema pra sessões de paciente sem member_session

- **Status:** Accepted
- **Date:** 2026-05-19

## Context

ADR 0093 (commit `65dea90`) criou `passport_global_identities` — identidade global do paciente SEM tenant_id, permitindo cadastro proativo `/cadastro` (Path B) antes de qualquer vínculo clínico. Schema materializado no Sprint 02b2 partial (commit `1ed8ef3`).

`signupPatient` real (Sprint 02b2) cria a identidade global mas **não cria session** — paciente termina o signup logado em nada. ADR 0093 §"Auth flow Path B completo" delegou pra Sprint 02b3 a parte de session, mas deixou aberta a pergunta: **onde mora a session de paciente com identidade global mas sem member em tenant nenhum?**

Schema atual de `member_sessions` (Sprint 26 ADR 0088) tem:

```sql
member_sessions:
  id uuid PK
  tenant_id uuid NOT NULL     ← exige tenant
  member_id uuid NOT NULL     ← exige member
  refresh_token_hash text NOT NULL
  expires_at timestamptz NOT NULL
  revoked_at timestamptz
  ...
```

Paciente que fez signup proativo (Path B puro, sem invite anexo) **não tem `tenant_id` nem `member_id`** — só `passport_global_identity_id`. `member_sessions` não acomoda.

Cenários reais que exigem decisão:

1. **Signup proativo puro** — paciente cria conta `/cadastro` sem invite. Pós-signup, fica logado pra fluxo de "minha conta global" (perfil + privacidade + procurar empresas). Não tem tenant_id.
2. **Signup proativo + Path A+B híbrido** — paciente vem de `/i/<token>` → `/cadastro?invite=<token>`. signupPatient cria identity + aceita invite (Sprint 02b3 — commit `a0ad676`). Tem 1 tenant linkado. Session deveria refletir isso.
3. **Login direto via `/meu/login`** — paciente existente (que pode ter N tenants linkados via passport) digita email+password. Onde mora a session?
4. **Tenant switching** — paciente vinculado a 3 empresas (Academia X + Fisio Y + Nutri Z) navega entre os contextos. Session global persiste; "tenant atual" é claim derivado.

## Decision

**Criar tabela `passport_global_sessions` dedicada** (opção A das 3 avaliadas) com cookie separado `lf_passport_session`. Paciente que tem `passport_global_identity_id` usa este schema; pacientes legacy (sem identity global ainda) continuam em `member_sessions` durante a transição.

### Schema canônico

```sql
CREATE TABLE passport_global_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passport_global_identity_id uuid NOT NULL
    REFERENCES passport_global_identities(id) ON DELETE CASCADE,

  -- Refresh token (hash SHA-256 do plain — cookie armazena plain)
  refresh_token_hash text NOT NULL UNIQUE,

  -- TTL — default 30d
  expires_at timestamptz NOT NULL,

  -- Audit/metadata
  device_label text,  -- User-Agent simplificado pelo client ou middleware
  ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),

  -- Lifecycle
  revoked_at timestamptz,
  revoked_reason text,  -- 'user_logout' | 'admin_revoke' | 'password_change' | 'mfa_change' | 'session_rotation'

  -- MFA gate (Sprint 02b3 wizard TOTP completo)
  -- Quando paciente tem TOTP ativo, primeira request da session marca este timestamp.
  -- requireRecentMfa() pro paciente (sem high-risk action staff — MFA aqui é
  -- pra ações próprias sensíveis: trocar email/senha/recovery codes).
  mfa_verified_at timestamptz
);

CREATE INDEX passport_global_sessions_identity_idx
  ON passport_global_sessions (passport_global_identity_id, created_at DESC);
CREATE INDEX passport_global_sessions_active_idx
  ON passport_global_sessions (passport_global_identity_id, expires_at DESC)
  WHERE revoked_at IS NULL;
CREATE INDEX passport_global_sessions_cleanup_idx
  ON passport_global_sessions (expires_at)
  WHERE revoked_at IS NULL;
```

### Cookie

- **Nome:** `lf_passport_session` (distinto de `lf_member_session` Sprint 26 ADR 0088)
- **Path:** `/meu` (mesmo path do member portal — não vaza pra `/app/*` staff)
- **httpOnly + Secure + SameSite=Lax** (mesmo padrão)
- **MaxAge:** 30 dias

### Middleware de resolução

Helper `getActiveSession()` em `apps/web/app/lib/passport-session.ts` (Sprint 02b3):

```typescript
// Tenta passport_global_sessions PRIMEIRO; fallback member_sessions (legacy)
const passportSession = await getPassportSession()
if (passportSession) return { kind: 'passport', ...passportSession }
const memberSession = await getMemberSession()
if (memberSession) return { kind: 'member', ...memberSession }
return null
```

Server Actions do portal aceitam ambos via discriminated union. Lint custom Sprint 02b3+ pode forçar nova ação a aceitar `kind: 'passport'` (default forward-looking).

### `requirePassportSession()` separado de `requireMemberSession()`

```typescript
export interface PassportSessionClaims {
  passportGlobalId: string
  sessionId: string
  /** Tenants linkados via patient_company_links (lookup runtime) */
  linkedTenants?: Array<{ tenantId: string; companyId: string }>
  /** Tenant atual ativo no UI (cookie `lf_passport_active_tenant` opcional) */
  activeTenantId?: string
  mfaVerifiedAt?: Date
}

export async function requirePassportSession(returnTo: string): Promise<PassportSessionClaims>
```

`withPassportContext()` seta:
- `app.passport_global_id` na connection (ativa RLS self em `passport_global_identities` policy 0057)
- `app.tenant_id` + `app.member_id` quando `activeTenantId` presente (resolve persons espelho via FK + setting derivado)

### Migration path entre member_sessions e passport_global_sessions

**Fase 1 (Sprint 02b3 — esta ADR ativa):**
- Novos signups proativos via `/cadastro` criam `passport_global_sessions`
- Magic link Sprint 26 continua criando `member_sessions` (legacy)
- `getActiveSession()` tenta ambos (passport first, member fallback)

**Fase 2 (Sprint 02b4 — opcional):**
- Magic link Sprint 26 promove paciente sem identity global → cria `passport_global_identities` minimal (nome + email + phone + signup_path='reactive_invite_then_passport') + cria session passport
- `member_sessions` deprecated pra signups novos

**Fase 3 (pós-MVP — meses depois):**
- Backfill: pra cada paciente em `member_sessions` ainda sem identity global, cria identity minimal via job
- `member_sessions` mantido só pra audit (queries históricas) com `frozen_at` timestamp
- Lint custom bloqueia INSERT novo em `member_sessions`

### RLS de `passport_global_sessions`

- Acesso bypass por Server Action interna (`getPassportSession()` valida hash + lookup direto sem RLS):
  - `RLS DISABLED` ou GRANT direct ao `logifit_app` sem policy
  - Mesma estratégia de `member_sessions` (Sprint 26 ADR 0088)
- Audit row INSERT/UPDATE só via Server Action (sem UI direta pra paciente listar sessões — futuro Sprint 02b4 adiciona `/meu/perfil/sessoes`)

### `mfa_verified_at` — quando exigir

Paciente Path B com `passport_global_identities.mfa_enrolled_at` setado:
- Login fresh sempre exige TOTP (passa pela tela TOTP no login flow)
- Pós-TOTP, marca `passport_global_sessions.mfa_verified_at = now()`
- Ações de alto risco do paciente (trocar email/senha/recovery codes/desativar conta) exigem `requireRecentPassportMfa()` (< 15min como staff regra 43)
- Action diária regular não exige re-MFA (UX razoável)

## Consequences

### Positivas

- **Separação clara** — staff usa `users` + BetterAuth + `auth_sessions`; member portal antigo usa `member_sessions`; identity global usa `passport_global_sessions`. Cada concern em tabela própria
- **RLS limpo** — `passport_global_identities` (policy 0057) usa `app.passport_global_id` que é setado por `requirePassportSession` direto
- **Migration gradual** — coexistência das 2 tabelas permite rollout sem quebrar pacientes existentes
- **Audit forense** — colunas dedicadas (device_label, ip, revoked_reason, mfa_verified_at) sem misturar staff audit
- **Cookie separado** — debug fácil (qual session ativa olhando DevTools), sem ambiguidade
- **MFA bem encaixado** — `mfa_verified_at` na session paciente sem precisar do conceito staff `mfaAt` (BetterAuth claim)

### Negativas (mitigadas)

- **2 tabelas de session pro member portal** — mitigado por `getActiveSession()` que abstrai resolução; UI nunca decide qual usar
- **Migration eventual de `member_sessions`** — mitigado por Fase 2/3 graduais (não bloqueia MVP)
- **Cookie name confusion** — mitigado por escolha distinta `lf_passport_session` + path `/meu` compartilhado (mesmo escopo browser)
- **Lookup duplo no middleware** — 2 queries quando cookie passport ausente (passport check + member fallback). Mitigado: cookie name resolve cedo (sem cookie passport, pula direto pro member)

### Cuidados de implementação

- **Token plain → hash SHA-256**: mesmo padrão member_sessions (ADR 0088). NUNCA grava plain
- **Refresh rotation**: Sprint 02b4 opcional — atualmente refresh long-lived 30d sem rotation
- **session.activeTenantId** persistido via cookie separado `lf_passport_active_tenant` quando paciente está vinculado a >1 tenant (UX picker no header `/meu`)
- **`mfa_verified_at` reset on password change**: trigger ou Server Action garante revogação ao trocar senha (forçar re-login + re-MFA)
- **session_rotation reason**: usado quando paciente troca senha sem logout — sessões antigas revogadas com reason='session_rotation'
- **Cleanup cron**: job daily expira sessões >30d (paralelo ao `expire-passport-signup-otps` — Sprint 02b4)

## Alternativas rejeitadas

### Opção B — `member_sessions` ganha coluna `passport_global_identity_id` nullable

Adicionar coluna nullable em `member_sessions`; quando setada, indica que session é de paciente com identity global. Em casos sem tenant linked, `tenant_id`/`member_id` ficam NULL.

**Rejeitada porque:**

- Refactor de `member_sessions.tenant_id` NOT NULL pra nullable é cascading (regra 1 + 4 RLS dependem de tenant_id)
- Schema fica ambíguo (tenant_id NULL + member_id NULL + passport_global_identity_id setado = session "flutuante")
- Indexes existentes assumem tenant_id NOT NULL — quebram queries por tenant
- Sprint 26 ADR 0088 fez schema apostando em NOT NULL — mexer agora gera dívida técnica
- Risk alto de RLS bypass quando `tenant_id IS NULL` — fail-closed exige adaptação de 13+ policies

### Opção C — `member_sessions` bifurcado por NULL discriminator + view

Mesma ideia da opção B mas usa CASE WHEN policies pra RLS e views pra mascarar:

**Rejeitada porque:**

- Complexidade explosiva — RLS policies condicionais em production são caverna de bugs
- Performance: índices conditional em colunas nullable adicionam IO overhead
- View `v_passport_only_sessions` adiciona indireção sem ganho real
- Sprint 26 não previu este caso — não vale forçar agora

### Opção D — Sem session separada, BetterAuth global pra paciente

Criar instância BetterAuth standalone com adapter Drizzle apontando pra `passport_global_identities` como entity.

**Rejeitada porque:**

- BetterAuth schema esperado é diferente do nosso (auth_user/auth_session/etc internas). Adapter customizado vira manutenção
- ADR 0093 §"Opção D rejeitada" já documentou: BetterAuth não tem campos LogiFit (CPF, signup_path, ripd_version)
- Mistura concerns: staff em BetterAuth + paciente em outro BetterAuth no mesmo monorepo gera confusão de debug
- Sprint 01a Faixa B decidiu BetterAuth pra staff — manter simétrico não vale a complexidade

## Escopo de impacto Sprint 02b3 completo

Esta ADR habilita:

1. **Migration 0045** — `passport_global_sessions` + indexes
2. **Schema Drizzle** — `packages/db/src/schema/passport-session.ts`
3. **RLS/GRANT policy** — `packages/db/src/policies/0058_passport_global_sessions.sql` (sem RLS — same as member_sessions Sprint 26)
4. **Helper `passport-session.ts`** — `apps/web/app/lib/` com `getPassportSession`/`requirePassportSession`/`setPassportCookie`/`withPassportContext`
5. **`getActiveSession()`** orchestrator que tenta passport first, member fallback
6. **Server Action `loginPassport({email, password, totp?})`** em `apps/web/app/meu/login/actions.ts`:
   - SELECT `passport_global_identities` por `lower(email)` + `verifyPassword`
   - Se `mfa_enrolled_at` setado, exige `totp` no input + valida
   - Cria `passport_global_sessions` + seta cookie
7. **UI `/meu/login`** com Form email+password + opcional input TOTP quando MFA ativo
8. **`signupPatient` ativa cria session automática** pós-signup (chama internamente `loginPassport` ou cria session direto)
9. **`requirePassportMfa()`** helper análogo a staff `requireRecentMfa()`
10. **Cron `expire-passport-global-sessions`** daily cleanup (paralelo aos OTPs)

## Related

- [ADR 0088 — Portal Member magic link auth](0088-portal-member-magic-link-auth.md) — `member_sessions` schema referência; este ADR ESTENDE pra identidade global
- [ADR 0093 — Passport global identities](0093-passport-global-identities.md) — define `passport_global_identities`; este ADR resolve "onde mora a session"
- [ADR 0092 — BetterAuth vs Lucia](0092-betterauth-vs-lucia.md) — staff usa BetterAuth; passport global tem auth próprio
- [ADR 0073 — Defesa em profundidade](0073-postura-seguranca-defesa-em-profundidade.md) — cookie httpOnly+Secure+SameSite + token hash SHA-256
- [Regra 43 — MFA obrigatório](../rules.md) — staff `requireRecentMfa()` referência pra `requirePassportMfa()`
- [Sprint 02b3 — CRM fechamento Path B](../sprints/02-geral-crm-pessoas.md) — implementa esta ADR
