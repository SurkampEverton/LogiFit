# ADR 0093 — Passport global identities: schema pra paciente sem tenant clínico

- **Status:** Accepted
- **Date:** 2026-05-19

## Context

Sprint 02b backbone (Path B cadastro proativo `/cadastro`) entregou OTP SMS + Turnstile providers funcionais mas **`signupPatient` real ficou bloqueado** porque o schema atual de `persons` exige `tenant_id NOT NULL` (RLS raiz Sprint 01a) — não há lugar pra hospedar identidade de paciente que ainda não tem vínculo clínico com nenhum tenant.

Cenários reais que exigem identidade global pré-tenant:

1. **Path B cadastro proativo** — paciente vai em `app.logifit.com.br/cadastro`, cria conta antes de receber qualquer invite (ADR 0077 + regra 42 §2 paths).
2. **Path A→B híbrido** — paciente recebe invite mas não tem conta ainda; clica `/i/[token]` → vai pra `/cadastro?invite=<token>` → cria conta + auto-vincula.
3. **Identidade portável** — paciente sai de tenant X mas mantém histórico cross-tenant via `patient_company_links` (ADR 0077). O passport_passport_id global precisa existir como entidade autorizada (não só uuid solto).
4. **Auth + MFA do paciente** — `password_hash`, `mfa_totp_secret`, recovery codes precisam viver em algum lugar. Não cabem em `members` (tenant-scoped) nem em `users` (staff scope com BetterAuth).

Sem solução pra esse problema, o backbone Path B é fake — sem schema, `signupPatient` retorna `{ok:false, code:'SCHEMA_PENDING'}` permanentemente.

## Decision

**Criar tabela `passport_global_identities` separada como pivot global** (opção C da avaliação) — paciente vive como entidade independente de qualquer tenant. Quando aceita invite ou inicia vínculo clínico, é criado um `persons` espelhado no tenant emissor com FK opcional pra `passport_global_identities`.

### Schema canônico

```sql
CREATE TABLE passport_global_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- alias do passport_passport_id usado em patient_company_links

  -- ─── Identidade ──────────────────────────────────────────────
  name text NOT NULL,
  -- CPF normalizado (só dígitos) — UNIQUE pra evitar contas duplicadas
  cpf_normalized text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  phone text NOT NULL,  -- E.164 (+5511999999999)
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  birth_date date,
  sex text,  -- 'male'/'female'/'other'/null

  -- ─── Auth (BetterAuth pattern — ADR 0092) ──────────────────
  password_hash text NOT NULL,  -- BetterAuth gera (Argon2id)
  password_changed_at timestamptz,

  -- MFA (opt-in pós-signup via wizard Sprint 02b2)
  mfa_enrolled_at timestamptz,
  mfa_totp_secret_encrypted text,  -- AES-256-GCM via LOGIFIT_DATA_KEY ADR 0073
  recovery_codes_encrypted text,    -- jsonb de N codes cifrado

  -- ─── LGPD aceite (regra 29 + ADR 0054) ─────────────────────
  accepted_terms_at timestamptz NOT NULL,
  terms_version text NOT NULL,
  accepted_privacy_at timestamptz NOT NULL,
  privacy_version text NOT NULL,
  ripd_version_signup text NOT NULL,  -- v1.0-passport-signup

  -- ─── Audit ───────────────────────────────────────────────────
  signup_path text NOT NULL,  -- 'proactive' | 'reactive_invite' | 'proactive_then_invite'
  signup_ip text,
  signup_user_agent text,
  signup_otp_id uuid REFERENCES passport_signup_otps(id),  -- traceability

  -- ─── Lifecycle ───────────────────────────────────────────────
  last_login_at timestamptz,
  deactivated_at timestamptz,
  deactivated_reason text,  -- 'user_request' | 'lgpd_erasure' | 'fraud' | ...

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX passport_global_email_normalized_idx
  ON passport_global_identities (lower(email));
CREATE INDEX passport_global_phone_idx
  ON passport_global_identities (phone);
CREATE INDEX passport_global_active_idx
  ON passport_global_identities (created_at DESC)
  WHERE deactivated_at IS NULL;
```

### Bridge com `persons` (tenant-scoped)

Quando paciente aceita invite ou inicia vínculo clínico:

1. Existe `passport_global_identities` (criado em `/cadastro` ou `acceptPatientInvite` Sprint 02 Path A).
2. Server Action `acceptPatientInvite` cria `persons` no tenant emissor (já faz).
3. **Nova coluna nullable** `persons.passport_global_identity_id uuid REFERENCES passport_global_identities(id)` (migration nova).
4. Daí em diante, `patient_company_links.passport_passport_id` = `passport_global_identities.id` (não mais UUID solto).

`persons` espelhado contém **apenas dados que aquele tenant precisa ver** (name + contact basic). MFA, password, recovery codes ficam no global — paciente loga em `/meu/login` com email global, não com email tenant-scoped.

### RLS de `passport_global_identities`

- Sem `tenant_id` — RLS por tenant não se aplica.
- **Visibilidade:** paciente vê apenas seu próprio (`id = current_setting('app.passport_global_id', true)::uuid`).
- **Insert:** Server Action de signup roda como `logifit_app` (sem session — pré-auth).
- **Update:** paciente atualiza própria conta via member portal (`/meu/perfil`); staff jamais acessa direto (LGPD — dados de identidade global são do paciente).
- **DPO acesso:** via permission especial `dpo.passport_read_audit` quando paciente exerce art. 18 LGPD (portabilidade/exclusão).

### Auth flow Path B completo (Sprint 02b2 ativará)

```
/cadastro → CadastroForm
  Step phone:    requestSmsCode (Turnstile + Twilio)
  Step verify:   verifySmsCode (constant-time hash)
  Step details:  signupPatient(
                   name, cpf, email, password, phone,
                   smsOtpId, acceptedTerms, acceptedPrivacy, enableMfa
                 )
                 │
                 ├─ Re-valida OTP (anti-replay)
                 ├─ Hash password (BetterAuth Argon2id)
                 ├─ Resolve passport_global_identities por cpf+email
                 │   ├─ Já existe → CONFLICT (já tem conta, redireciona /meu/login)
                 │   └─ Não existe → INSERT passport_global_identities
                 ├─ Marca email_verified_at = NULL (envia email de confirmação Sprint 02b2)
                 ├─ Marca phone_verified_at = now (OTP já validou)
                 ├─ Se enableMfa → wizard TOTP (Sprint 02b2)
                 ├─ Se invite_token presente → linka via acceptPatientInvite (Path A+B híbrido)
                 └─ Cria member_session no global scope (cookie próprio /meu)
```

### Lookup de paciente cross-tenant

Sprint 02 Path A já tem `patient_company_links.passport_passport_id`. Após esta ADR aplicada:

- `passport_global_identities.id` = `patient_company_links.passport_passport_id` (mesmo UUID)
- `persons.passport_global_identity_id` (nova coluna) = `passport_global_identities.id` quando paciente tem identidade global
- Staff vê paciente normalmente via `persons` no tenant; member portal valida login contra `passport_global_identities`

## Consequences

### Positivas

- **Identidade portável** — paciente troca de empresa sem perder histórico ou ter que criar nova conta
- **Auth centralizado** — uma senha + MFA + recovery codes que valem em todas as empresas parceiras (UX similar a Google/Apple SSO)
- **LGPD limpo** — dados de identidade global são do paciente (não do tenant); art. 18 V (portabilidade) e VI (exclusão) ficam triviais — paciente exclui própria conta global; tenants mantêm apenas espelho `persons` com nome/contato
- **RLS de `persons` intacta** — não precisa refactor (opção B rejeitada). `persons.tenant_id NOT NULL` continua válido — espelho sempre é tenant-scoped
- **CPF unique global** — automaticamente previne duplicação de conta no LogiFit inteiro
- **Schema clean** — entidade nova com purpose claro; sem hacks de "system tenant" (opção A rejeitada)

### Negativas (mitigadas)

- **Migration 0043** — nova tabela + ALTER `persons` ADD COLUMN `passport_global_identity_id`. Risco baixo — coluna nullable, RLS não muda
- **Auth 2 lugares** — BetterAuth pra staff em `users` table + passport_global_identities pra paciente. Decidir Sprint 01a sub se BetterAuth suporta multi-entity ou se member portal usa Lucia/custom. Mitigado: ADR 0092 já decidiu BetterAuth pra staff; passport pode usar mesmo Argon2id helper isoladamente
- **CPF normalizado UNIQUE** — paciente que troca CPF (raro mas existe — mudança de documento) precisa flow de migração. Sprint 02b2 trata via Server Action `migrateGlobalCpf` requer DPO MFA
- **Lookup performance** — query `WHERE cpf_normalized = $1` precisa scan ou index; já incluído no schema
- **Recovery flow** — se paciente esquece senha + perde MFA, precisa flow de recuperação que valida outra forma (email + SMS + KYC). Sprint 02b2 detalhar

### Cuidados de implementação

- **CPF storage**: somente `cpf_normalized` (só dígitos) — nunca formatado. Validação Zod no boundary
- **Email case**: armazena lowercase; UNIQUE index em `lower(email)` previne `User@x.com` vs `user@x.com`
- **Password**: BetterAuth Argon2id (ADR 0092) — NUNCA SHA256 ou bcrypt
- **MFA secret**: AES-256-GCM via `LOGIFIT_DATA_KEY` (ADR 0073). Chave separada do dado
- **Recovery codes**: 8-10 one-time codes; cifrados em jsonb; cada uso marca consumed
- **Audit**: toda mudança de email/password/MFA grava em tabela própria `passport_global_audit_log` (Sprint 02b2 cria)

## Alternativas rejeitadas

### Opção A — Tenant pivot fixo `system-passport-pivot`

Criar um tenant especial com UUID conhecido em seed; todo paciente sem vínculo clínico é cadastrado como `persons` nesse tenant.

**Rejeitada porque:**

- Semanticamente estranho — paciente vira "membro do tenant LogiFit", o que ele não é
- RLS por tenant continua valendo no pivot — outras queries por tenant_id podem vazar dados se mal configuradas
- Migração quando paciente aceita primeiro vínculo vira MOVE/COPY de row (caro + risk de inconsistência)
- Não escala — tabela `persons` do pivot vira tabela quente com milhões de rows
- Difícil distinguir paciente "real do LogiFit" vs "paciente de tenant clínico"

### Opção B — `persons.tenant_id` nullable + RLS adaptado

Tornar `persons.tenant_id` nullable; quando NULL, paciente é global; senão é tenant-scoped.

**Rejeitada porque:**

- **REFACTOR ENORME** — todas RLS policies em `persons` precisam de CASE WHEN tenant_id IS NULL... bypass
- Lints custom `cross-tenant-read-must-log` etc precisam reconhecer NULL como pré-auth
- JOINs `INNER JOIN persons ON ... WHERE persons.tenant_id = $1` precisam virar LEFT JOIN com filtro adaptado
- Risk alto de bugs latentes em queries existentes que assumem NOT NULL
- Drizzle types ficam mais complexos (Person | PersonGlobal)
- Sprint 01a/01b/02 fizeram 4 schemas/12 RLS assumindo NOT NULL — refactor quebra muito

### Opção D — Auth-only sem tabela própria (BetterAuth global)

Usar uma instância BetterAuth standalone pra identidades de paciente (separada da staff).

**Rejeitada porque:**

- BetterAuth não tem campos LogiFit específicos (CPF, ripd_version, signup_path)
- Adicionar campos via extension table não escapa do problema — ainda precisa schema próprio
- Sobre-engineering — temos uma tabela só pra users staff; uma só pra paciente é simétrico
- BetterAuth de staff e passport global ficam confusos pra debug (qual sessão?)

## Escopo de impacto Sprint 02b2

Esta ADR habilita:

1. **Migration 0043** — `passport_global_identities` + ALTER `persons` ADD `passport_global_identity_id`
2. **Schema Drizzle** — `packages/db/src/schema/passport-identity.ts`
3. **RLS policy** — `packages/db/src/policies/0057_passport_global_identities.sql`
4. **Server Action `signupPatient`** real (substitui stub atual)
5. **Recovery codes generator** em `packages/security/src/recovery-codes.ts`
6. **MFA setup wizard** UI em `/cadastro/mfa` (TOTP enroll + recovery codes display)
7. **Member portal `requireMemberSession`** atualizado pra resolver `passport_global_identity_id` quando session do paciente vem de Path B
8. **DPO exports** — função SQL `dpo_export_passport_identity(passport_id)` LGPD art. 18 V

## Related

- [ADR 0077 — Passaporte do paciente (vínculo cross-tenant)](0077-passaporte-paciente-vinculo-cross-tenant.md) — define `patient_company_links` e `passport_passport_id` (passa a ser FK pra esta tabela)
- [ADR 0073 — Defesa em profundidade](0073-postura-seguranca-defesa-em-profundidade.md) — AES-256-GCM com `LOGIFIT_DATA_KEY` pra MFA secret + recovery codes
- [ADR 0088 — Portal Member magic link auth](0088-portal-member-magic-link-auth.md) — fluxo de login que após Sprint 02b2 troca cookie pra sessão atrelada a `passport_global_identity_id`
- [ADR 0092 — BetterAuth vs Lucia](0092-betterauth-vs-lucia.md) — staff usa BetterAuth Argon2id; passport global reusa o helper de hash (mas tabela própria)
- [Regra 42 — Passaporte cross-tenant](../rules.md) — `has_cross_tenant_access` SQL function recebe `passport_id` que após esta ADR aponta pra esta tabela
- [Sprint 02 — CRM Pessoas](../sprints/02-geral-crm-pessoas.md) — Sprint 02b2 implementa esta ADR
