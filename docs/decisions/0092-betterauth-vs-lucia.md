---
slug: betterauth-vs-lucia
status: accepted
date: 2026-05-12
---

# ADR 0092 — BetterAuth como camada de autenticação (vs Lucia)

## Contexto

Sprint 01a precisa de auth funcional com requisitos firmes:

- **Magic link via email** (Sprint 01a critério de aceite)
- **OAuth Google** (Sprint 01a — opcional MVP, ativável depois)
- **TOTP nativo** (regra 43 — MFA obrigatório pra roles `medico`, `fisio`, `nutri`, `personal`, `enfermeiro`, `tenant_owner`, `dpo`, `super_admin`)
- **WebAuthn nativo** (regra 43 — passkeys obrigatórios pra mesmos roles)
- **Recovery codes** (Sprint 01a — 10 one-time codes ao habilitar MFA)
- **Cookie httpOnly próprio** com JWT (soberania perpétua #2 — ADR 0091)
- **Lockout 5 falhas/15min + 30min cooldown** (ADR 0073 camada 2)
- **Sessions table com revoke por dispositivo** (`/meu/sessoes`)
- **Postgres** como único storage (sem KV externo)
- **Next.js 15 App Router** + Server Actions
- **Multi-tenant via subdomain** (ADR 0065 — `{slug}.logifit.com.br`)

`@supabase/auth-helpers-nextjs` foi explicitamente proibido (lock-in que quebraria portabilidade — embora ADR 0091 elimine a fase Supabase, mantemos a regra como precaução perpétua: regra de soberania #2).

## Decisão

**BetterAuth** ([better-auth.com](https://better-auth.com)) — biblioteca de auth open-source, Postgres nativo, framework-agnóstica.

Pacote `packages/auth/` envelopa BetterAuth + extensões LogiFit:
- Schema dele (`user`, `session`, `account`, `verification`, `twoFactor`) coexiste com nossa `users` table (Sprint 01a) via FK `users.auth_user_id → user.id`
- Plugin `magicLink` ativo
- Plugin `twoFactor` (TOTP + WebAuthn + recovery codes)
- Plugin `customSession` injeta `tenant_id` + `topology` + `mfa_at` no token
- Adapter Drizzle (oficial) — schema mantém regra 3 (Drizzle source of truth)

`auth_attempts` + `auth_lockouts` são tabelas LogiFit **separadas** do schema BetterAuth — implementam regra brasileira de lockout (Receita Federal exige rastro de tentativas; BetterAuth tem rate limit mas não persiste em DB com nosso shape).

## Alternativas consideradas

### Lucia (lucia-auth.com)

- ✅ Postgres adapter nativo
- ✅ Cookie httpOnly built-in
- ✅ Mais "library" que "framework" — controle total
- ✅ Bundle menor (~10KB vs ~50KB BetterAuth)
- ❌ **TOTP requer lib externa** (`@oslojs/otp` + boilerplate ~80 linhas)
- ❌ **WebAuthn requer lib externa** (`@simplewebauthn/server` + boilerplate ~150 linhas)
- ❌ **Magic link requer implementação manual** (token + email + verificação — ~120 linhas)
- ❌ **OAuth Google requer Arctic** (lib companion) + boilerplate
- ❌ **Recovery codes não tem helper** — implementar do zero

Soma boilerplate Lucia pra atingir paridade: ~500-700 linhas TS de plumbing que precisaríamos manter + testar. Cada uma é potencial vulnerabilidade.

### Auth.js v5 / NextAuth

- ✅ Plug-and-play em Next.js
- ❌ **JWT-only por design** — cookie de sessão não é revogável server-side sem DB lookup adicional
- ❌ **Multi-tenant via subdomain mal suportado** (requer customização pesada em `callbacks.jwt`)
- ❌ **TOTP via plugin community** (não oficial — risco de abandono)
- ❌ **Schema rígido** — adaptadores genéricos não permitem extensão limpa (`account` table não tem campos LogiFit)
- ❌ Adapter Drizzle existe mas é minimalista

### Lucia + tudo manual

Descartado por custo de manutenção. Sprint 01a é a primeira de 21 — economizar 500 linhas de auth aqui paga em todas as sprints futuras.

### Manter Supabase Auth (status quo)

- ❌ **Proibido pela ADR 0091** (self-host total Oracle SP — sem Supabase)

## Consequências

### Positivas

- **Sprint 01a** entrega magic link + TOTP + WebAuthn + lockout em 1 faixa só (estimativa: 3 dias contra 7 dias com Lucia)
- **Schema previsível**: BetterAuth tem migrations conhecidas em `auth_*` namespace; nossas tabelas (`auth_attempts`, `auth_lockouts`, `users` com `auth_user_id` FK) ficam isoladas
- **Cookie httpOnly + JWT custom claims** suportado via `customSession` plugin sem hack
- **Adapter Drizzle oficial** — regra 3 (Drizzle source) preservada
- **Recovery codes + WebAuthn passkeys** out-of-the-box
- **Active community** (final 2024 → 2025) — manutenção ativa
- **Migração para Lucia futura é trivial** se BetterAuth virar abandonware: cookie httpOnly + JWT são padrão; trocar é DB migration + reescrita de ~200 linhas de wrapper

### Negativas

- **Bundle pesado** (~50KB minified server-side) — não impacta cold start porque é server-only
- **Lock-in moderado**: BetterAuth gera schemas com nomes próprios (`user` singular, `session`, `account`, `verification`) — não é nossa convenção (LogiFit usa plural `users`). Mitigamos: nossa `users` table fica separada com FK → `user.id` BetterAuth. Aceitamos coexistência.
- **Lib relativamente nova** (~1 ano de mercado em 2026-05) vs Lucia (3+ anos). Aceito porque o tradeoff de produtividade vale; revisão da decisão é parte do critério de tabela `signature_policies` de ADRs (anual).
- **Algumas features são plugins externos** (`organization`, `admin`) que ainda não usamos — risco se virarem premium futuramente. Mitigação: forkamos os plugins necessários no MVP se ficar comercial.

### Decisões derivadas

1. **`users.auth_user_id`** (já no schema da Faixa A) aponta pra `user.id` do BetterAuth (não pra Supabase Auth — supersedendo nota em ADR 0078 sobre Supabase Auth Hook).
2. **JWT claims customizados** vão via plugin `customSession` no BetterAuth — não há "Auth Hook" como no Supabase. Faixa B implementa.
3. **`auth_attempts` + `auth_lockouts`** são tabelas LogiFit-owned (não BetterAuth) — implementam regra ADR 0073 camada 2 com particionamento mensal (regra 34) + retention 30 dias.
4. **Cookie name** `logifit_session` (sobrescreve default `better-auth.session`).
5. **JWT_SECRET** vem de env `AUTH_SECRET` (não `BETTER_AUTH_SECRET`) — rotação trimestral via runbook `rotate-secrets.md`.

## Status

**Accepted** — 2026-05-12.

## Referências

- [Sprint 01a — Identidade e Topology](../sprints/01a-identidade-e-topology.md)
- [ADR 0073 — Postura de segurança defesa em profundidade](0073-postura-seguranca-defesa-em-profundidade.md) (camada 2 — auth lockout)
- [ADR 0091 — Self-host total Oracle SP](0091-self-host-total-oracle-sp.md) (soberania perpétua #2 — auth próprio)
- [Regra 43](../rules.md) — MFA obrigatório roles profissionais
- [BetterAuth docs](https://better-auth.com)
- [Lucia (alternativa rejeitada)](https://lucia-auth.com)
