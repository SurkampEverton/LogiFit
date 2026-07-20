# ADR 0103 — user_invites (convite de staff — débito de schema do Sprint 01b)

- **Status:** Proposed
- **Date:** 2026-07-19
- **Sprint:** 01c (débito #6 da auditoria do Sprint 36b — ver roadmap "Débitos de schema")

## Context

O Sprint 01b prometeu o schema de convite de staff ("Sprint 01b tem o schema; aqui fica a UI" — sprint doc 36), mas a tabela nunca nasceu. Sem ela, o admin não consegue convidar o **contador externo** (ADR 0061) — o portal `/app/contador` existe mas nenhum contador consegue entrar. O mesmo mecanismo serve, no futuro, pra convidar qualquer staff (recepção, gerente, profissionais).

## Decision

**Tabela `user_invites`** (`packages/db/src/schema/user-invites.ts`):

- `tenant_id` + RLS; `email`, `name` sugerido, `role_key` (MVP: só `'contador_externo'` — CHECK; expandir exige revisão do fluxo de MFA por role), `invited_by_user_id`
- **Token nunca armazenado em claro**: `token_hash` sha256; o token (32 bytes hex) só existe na URL do email
- `expires_at` (7 dias), `accepted_at`, `revoked_at` — estados mutuamente exclusivos via CHECK; unique parcial por (tenant, email) enquanto pendente (sem convite duplicado ativo)

**Fluxo de criação** (`/app/settings/contador`, gate `fiscal.admin`):
1. SA `createContadorInvite({email, name})` gera token, grava hash, envia email via `@repo/email` (`sendTransactional` — Brevo prod / Mailhog dev) com link `/convite/{token}`.
2. Lista + revogação na mesma tela (`revoked_at` — token revogado não aceita).

**Fluxo de aceite** (público, pré-auth):
1. `/convite/[token]` valida o token (hash + expiry + não usado/revogado) server-side e mostra form (nome, CPF opcional).
2. `POST /api/invites/accept` provisiona **na mesma transação**: `auth_user` (se o email ainda não existe) → `persons` (PF) → `users` → `user_tenants` → `user_roles` com a role global `contador_externo` → marca `accepted_at`.
3. Provisioning usa `withElevatedContext` (mesmo mecanismo do signup wizard — é onboarding de usuário pré-auth; o lint futuro `no-elevated-context-abuse` deve permitir este arquivo junto com o signup).
4. Sem criação de sessão no aceite: usuário é direcionado pro `/login` e entra por magic link normal — o aceite nunca vira vetor de session fixation.

**Idempotência/segurança:** aceite de token já usado/expirado/revogado → erro genérico único (não vaza qual caso); rate limit da rota segue padrão regra 36 (fase 2 — wrapApiHandler); email já registrado no tenant → erro claro "usuário já existe".

## Alternatives considered

- **Convite cria sessão direto no aceite** — rejeitado: aceitar via link de email e sair logado é o clássico vetor de fixation/interceptação; o custo de 1 magic link a mais é baixo.
- **Token em claro no banco** — rejeitado: leak de dump = contas criáveis; hash sha256 segue o padrão dos recovery codes.
- **Reusar member_auth_tokens (portal paciente)** — rejeitado: semântica diferente (staff × member), role assignment e tenant binding distintos.

## Consequences

- Portal do contador finalmente acessível por contador real; base pronta pra convites de outros roles (basta ampliar o CHECK + UI, revisando MFA da role convidada — regra 43).
- `contador_externo` tem `requires_mfa` conforme catálogo de roles; o primeiro login já cai no setup wizard de MFA existente.
- Fase 2: rate limit na rota de aceite + expiração automática via cron + i18n do email.
