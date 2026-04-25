# Threat Model STRIDE — Login + sessão + MFA

> **v0.1-skeleton** — STRIDE obrigatório (regras 35-43 + [ADR 0073](../decisions/0073-postura-seguranca-defesa-em-profundidade.md)). Substância completa quando [Sprint 01a](../sprints/01a-identidade-e-topology.md) implementar fluxos de auth e MFA.

- **Feature:** Login + sessão (Supabase Auth → BetterAuth/Lucia pós-19b) + MFA TOTP/WebAuthn + magic link + recovery codes
- **Sprint:** 01a (auth base) + Sprint dedicado MFA (a definir, regra 43)
- **Data:** 2026-04-25 (skeleton)
- **Autor:** Fundador
- **Próxima revisão:** quando feature entrar em produção (semestral depois)

## Diagrama de fluxo de dados (a expandir)

```
[Cliente browser]
   ↓ (TLS 1.3 + HSTS preload)
[Cloudflare WAF + Turnstile (em /login após 5 falhas)]
   ↓
[Edge Vercel + middleware Next.js (extrai subdomain → tenant)]
   ↓ (cookie httpOnly samesite=lax)
[Server Action /actions/auth.* (wrapAction)]
   ↓ (rate limit Upstash por IP+email)
[Supabase Auth — MVP] / [BetterAuth — pós-19b]
   ↓
[JWT custom claims: tenant_id, scopes[], group_ids[], topology, mfa]
   ↓
[Postgres: user_sessions, mfa_devices, recovery_codes — RLS]
```

**Trust boundaries:**
1. Browser → Edge (DDoS, brute-force) — Cloudflare WAF + rate limit (regras 36, ADR 0073 camada 1)
2. Edge → Server Action (CSRF, replay) — cookie samesite + double-submit token + rate limit
3. Server Action → DB (SQL injection) — Drizzle param binding (regra 3)
4. Server Action → Supabase Auth/BetterAuth (provider compromise) — rotação de secrets anual (runbook `rotate-secrets.md`)

## Análise STRIDE

| Ameaça | Cenário | Mitigação | Status |
|---|---|---|---|
| **S**poofing | Atacante usa magic link interceptado de outro user | TTL 15min + binding por `user_agent` + IP + audit; magic link inválida sessões antigas após uso | 🟡 a implementar Sprint 01a |
| **S**poofing | Phishing rouba credencial + 2FA TOTP via fake site | WebAuthn (passkey) priorizado em UI; TOTP é fallback; aviso "logifit.com.br/login não pede sua senha em outro lugar" | 🟡 a implementar |
| **T**ampering | Atacante modifica JWT no cookie | Cookie httpOnly + signed (HS256/RS256 com `JWT_SECRET`) + verificação a cada request; rotação anual do secret | 🟡 a implementar |
| **R**epudiation | User nega ter feito login | `user_sessions` + `audit_log` (hash chain regra 39) com IP, user_agent, tenant, timestamp, MFA method | 🟡 a implementar |
| **I**nformation disclosure | Vazamento de hash de senha | bcrypt cost 12 + secret pepper em env var; nunca logar; rate limit em /login expõe info mínima ("credencial inválida" sem distinguir email vs senha) | 🟡 a implementar |
| **I**nformation disclosure | Vazamento de TOTP secret | Cifrado com KEK por tenant (AES-256-GCM); decifrado apenas em Server Action transient | 🟡 a implementar |
| **D**enial of service | Atacante bombardeia /login com email de vítima | Rate limit Upstash por (IP, email): 5 falhas/15min → lockout 30min + Turnstile (regra 36) | 🟡 a implementar |
| **D**enial of service | Lockout em massa (atacante bloqueia N users válidos) | Lockout só de IP do atacante; user válido tenta de outro IP funciona; UI dá orientação clara | 🟡 a implementar |
| **E**levation of privilege | Magic link de role baixa permite escalar | JWT claims fixos no momento do login; mudança de role exige re-login + audit | 🟡 a implementar |
| **E**levation of privilege | Profissional ou admin sem MFA acessa funções críticas | `roles.requires_mfa=true` enforced no middleware; alto-risco exige `requireRecentMfa()` <15min (regra 43) | 🟡 a implementar |

## Riscos residuais (aceitos)

| Risco | Por que aceito | Compensação |
|---|---|---|
| User reusa senha de outro site comprometido | Não controlamos higiene de senha do user | rate limit + WebAuthn fortemente recomendado + breach detection (haveibeenpwned API opcional) |
| Magic link encaminhado por engano em email familiar | TTL 15min limita janela | banner explicativo no email + revogação 1-clique se uso suspeito |
| Endpoint Supabase Auth (MVP) cai | SLA Supabase Pro 99.9%; pós-19b BetterAuth próprio | runbook fallback + status page + cache de sessão grace 5min |

## Plano de revisão

- Próxima revisão obrigatória: **antes de production launch (Sprint 01a + MFA)** + semestral
- Revisar antes de:
  - [ ] Migração Sprint 19b (Supabase Auth → BetterAuth/Lucia)
  - [ ] Adicionar novo método MFA (SMS, biometria)
  - [ ] Mudança regulatória (Resolução ANPD MFA)
  - [ ] Incidente de segurança em login

## Referências

- [ADR 0073 — Postura segurança defesa em profundidade](../decisions/0073-postura-seguranca-defesa-em-profundidade.md)
- [regra 43 — MFA obrigatório em rules.md](../rules.md)
- [Sprint 01a — Identidade e topology](../sprints/01a-identidade-e-topology.md)
- [Runbook rotate-secrets](../runbooks/rotate-secrets.md)
- [Runbook mfa-bypass-emergencial](../runbooks/mfa-bypass-emergencial.md)
- [Runbook lockout-conta](../runbooks/lockout-conta.md)
- [OWASP ASVS V2 (Authentication)](https://owasp.org/www-project-application-security-verification-standard/)
