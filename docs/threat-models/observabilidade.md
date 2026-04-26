# Threat Model STRIDE — Observabilidade (Sentry + PostHog + Logtail/Axiom)

> **Stub** — Threat model esperado para o pipeline de observabilidade (Sentry para erros, PostHog para produto/eventos, Logtail/Axiom para logs estruturados). Sub-processors declarados em [`docs/compliance/dpo.md`](../compliance/dpo.md). Será expandido conforme cada provider for ativado em produção. Template-base em [`_template-stride.md`](_template-stride.md).

- **Feature:** Pipeline de observabilidade — captura de exceções (Sentry), eventos de produto/feature flags (PostHog), logs estruturados de aplicação (Logtail ou Axiom)
- **Sprint:** 00 (setup base) + sprints subsequentes (instrumentação por módulo)
- **Data:** stub criado em 2026-04-26
- **ADR de referência:** [ADR 0073 — Postura de segurança defesa em profundidade](../decisions/0073-postura-seguranca-defesa-em-profundidade.md) (camada 9 — observabilidade)

## Superfície de ataque (a expandir)

```
[Server Action / API Route / Job]
        │
        ├── throw Error → wrapAction() captura → Sentry.captureException(err, { tenant_id, user_id })
        ├── analytics → PostHog.capture('event_name', { properties }) com filter de PII
        └── logger.info({ tenant_id, ... }) → Logtail/Axiom via transport HTTPS

[Sentry] (ingest US/EU regional) ────► dashboards LogiFit
[PostHog] (cloud BR ou self-hosted)──► funis, feature flags, sessões
[Logtail/Axiom] (cloud) ─────────────► busca + retenção 30-90d
```

**Trust boundaries críticos:**
1. App LogiFit → Sentry/PostHog/Logtail (HTTPS + DSN/API key + DPA)
2. Sentry agent client-side (browser) — pode capturar DOM/breadcrumbs com PII
3. Logger middleware — sanitização opcional pode falhar silenciosamente
4. PostHog identifica user via `distinctId` — vinculação a `user_id`/`member_id`

## Análise STRIDE (a expandir antes de feature crítica entrar em "doing")

| Ameaça | Cenário-chave |
|---|---|
| **S**poofing | Token Sentry/PostHog/Logtail vaza em commit público — atacante envia dados poisoning os dashboards |
| **T**ampering | Atacante manipula PostHog feature flag local (cookie editável) — bypassa gates de feature; flag de gate de segurança (ex: MFA) **não** deve viver em PostHog |
| **R**epudiation | Logs de aplicação não sanitizados gravam ações sensíveis; provider sofre breach e LogiFit não tem cópia local — perde rastro forense |
| **I**nformation disclosure | **Vetor crítico** — PII (CPF, email, prontuário, prompt IA) entra em Sentry breadcrumb / PostHog event / Logtail log e fica retida em provider externo sem DPA suficiente; cross-border (Sentry US) viola LGPD se sub-processor não tem DPA |
| **D**enial of service | Provider de logs cai — app LogiFit não pode ficar bloqueante; observabilidade é fire-and-forget com circuit breaker |
| **E**levation of privilege | Acesso ao dashboard Sentry/PostHog dá visão cross-tenant — restringir login (SSO + MFA) + rotação de membros do time + audit de acessos |

## Áreas críticas que o threat model expandido precisa cobrir

- **PII redaction obrigatória no boundary** — `beforeSend` hook em Sentry SDK + `sanitize` middleware no logger; lista de campos proibidos (`cpf`, `email`, `password`, `token`, `prompt`, `evolution_text`, `lab_value`) com regex de fallback
- **Logs de IA (prompt + output)** — **NUNCA** vão pra Sentry/Logtail; ficam em `ai_audit_log` interno (regra 28) com retenção CFM 2.454 (1a quente + 5a cold). Sentry breadcrumb de `wrapAction(askCopilot)` deve conter só metadata (model, tokens, latency), não conteúdo
- **PostHog distinctId** — usar `member_id`/`user_id` hash, não CPF/email; opt-out automático para roles `dpo` e `super_admin` (não rastrear ações administrativas em produto)
- **Retenção e expurgo** — Sentry 90d default (ajustável), PostHog 7a default (ajustar para 1a alinhado a regra 34), Logtail 30d default. Documentar por provider em `dpo.md`
- **Cross-border** — Sentry com região EU configurável; PostHog cloud BR ou self-hosted Hetzner UE; Logtail/Axiom EU. Decisão por provider em ADR ou em `dpo.md` sub-processors
- **Vazamento de DSN** — Sentry/PostHog DSN são públicos por design (client-side), mas server-side DSN tem ingest token separado; rotação trimestral
- **Controle de acesso ao dashboard** — SSO obrigatório, MFA obrigatório, allowlist de IPs corporativos, audit interno trimestral de quem teve acesso
- **Source maps em produção** — Sentry exige source maps; upload via CI com auth, nunca expor source map público (regra 35 + ADR 0073)

## Riscos residuais (aceitos)

| Risco | Por que aceito | Compensação |
|---|---|---|
| Provider externo sofre breach e amostra de logs vaza | LogiFit não controla infra Sentry/PostHog/Logtail | DPA + criptografia em trânsito + redação PII no envio + auditoria DPO trimestral dos campos enviados |

## Referências

- [ADR 0073 — Postura de segurança defesa em profundidade](../decisions/0073-postura-seguranca-defesa-em-profundidade.md)
- [docs/compliance/dpo.md](../compliance/dpo.md) — sub-processors declarados
- [Regra 5 — audit_log append-only](../rules.md) (logs de aplicação NÃO substituem audit)
- [Regra 28 — ai_audit_log](../rules.md) (logs de IA são separados, NUNCA em Sentry)
