# Threat Model STRIDE — Rate limit (Upstash Redis sliding window)

> **Stub** — Threat model esperado para o pipeline de rate limit (regra 36 + [ADR 0073](../decisions/0073-postura-seguranca-defesa-em-profundidade.md) camada 3). Implementado dentro de `wrapAction()` / `wrapApiHandler()` (regra 33). Limites canônicos em `packages/security/rate-limits.ts` (Sprint 00). Será expandido. Template-base em [`_template-stride.md`](_template-stride.md).

- **Feature:** Rate limit por `(tenant_id, user_id, ip, endpoint)` via Upstash Redis sliding window; gate dentro do wrapper de Server Action / API Route; lockout de login após 5 falhas/15min; lockout extra para ações sensíveis
- **Sprint:** 00 (pipeline base + limites canônicos) + sprints subsequentes (cada feature ajusta seu limite)
- **Data:** stub criado em 2026-04-26
- **ADR de referência:** [ADR 0073 — Postura de segurança defesa em profundidade](../decisions/0073-postura-seguranca-defesa-em-profundidade.md) (camada 3)

## Superfície de ataque (a expandir)

```
[Cliente HTTP/HTTPS]
        │
        │ 1. request com Cookie (session) + headers
        ▼
[Edge Vercel + Cloudflare WAF (camada 1 — DDoS protection)]
        │
        │ 2. WAF bloqueia ondas conhecidas
        ▼
[Server Action / API Route]
        │
        │ 3. wrapAction() / wrapApiHandler() resolve key
        ▼
[Upstash Redis sliding window]
        │
        ├── key = sha256(tenant_id || user_id || ip || endpoint)
        ├── window = 60s (default) — varia por endpoint
        ├── limit = 30 (default) — varia por endpoint
        ▼
[se excede → envelope { ok: false, error: 'RATE_LIMITED', retry_after } ]
[se não → handler executa]
```

**Trust boundaries críticos:**
1. Cliente → Edge (Cloudflare WAF + bot protection)
2. Edge → Server Action wrapper (resolução de identidade: cookie, JWT, IP do header)
3. Wrapper → Upstash Redis (token de API + região + TLS)
4. Wrapper → DB (após pass do gate, regular RLS)

## Análise STRIDE (a expandir conforme features sensíveis entram)

| Ameaça | Cenário-chave |
|---|---|
| **S**poofing | Atacante forja header `X-Forwarded-For` para fazer parecer ser de IP diferente e bypassar rate limit por IP — Vercel/Cloudflare normalizam; chave deve incluir `tenant_id + user_id` (autenticados) e usar IP só como fallback para anônimo |
| **T**ampering | Cliente manipula `Cookie` para se passar por outro user e queimar quota dele — JWT assinado + RLS captura; rate limit por user_id é alinhado, atacante só queima a própria quota |
| **R**epudiation | Atacante atinge rate limit várias vezes; sem audit, é impossível investigar padrão — chave + timestamp + outcome deve gravar em `audit_log` quando `RATE_LIMITED` (sem sobrecarregar Redis com payload completo) |
| **I**nformation disclosure | Resposta de rate limit revela existência de endpoint privado / user / tenant — envelope sempre genérico (`RATE_LIMITED` sem detalhe extra); 401 antes de rate limit para endpoints autenticados |
| **D**enial of service | **Vetor crítico** — atacante distribui requisições em IPs diferentes (botnet) para esgotar Upstash quota global do LogiFit; ou faz "rate limit poisoning" enviando requests legítimas com user_id alvo para queimar a quota da vítima e bloquear acesso real dela. Mitigação: WAF Cloudflare + cache de rate limit por IP em camada antes do user_id; limites diferenciados para anônimo (mais restritivo) vs autenticado |
| **E**levation of privilege | Atacante exploita TOCTOU entre check do limit e increment — janela onde 2 requests passam ao mesmo tempo; Upstash sliding window é atômico (LUA script) |

## Áreas críticas que o threat model expandido precisa cobrir

- **Rate limit poisoning** — atacante faz N requests com `user_id=victim` (mesmo sem ser autenticado como ela) para queimar quota e bloquear acesso real. Mitigação: chave de rate limit autenticado usa `user_id` apenas após JWT válido; pré-auth usa apenas `(ip, endpoint)`
- **Distributed brute force em login** (5/15min) — botnet de 1000 IPs pode tentar 1000 senhas; lockout por IP é insuficiente. Mitigação: lockout escalável por `(email, endpoint)` global + Turnstile (Cloudflare CAPTCHA) após 3 tentativas
- **Limites canônicos em código vs documentação** — `packages/security/rate-limits.ts` (Sprint 00) deve ser fonte única; mudanças geram nova versão + entrada em CHANGELOG; testes E2E validam limites
- **Endpoint de IA (Copilot, Camada 3 propose)** — rate limit específico (20/min/user) além da quota mensal de chamadas (regra 28); não confundir
- **Webhooks externos (Asaas, Focus NFe, Provider IA BYOK)** — chave HMAC + idempotência (regra 8) + rate limit baixo por origem (10/s) para evitar replay flood
- **Fallback Redis down** — Upstash indisponível: política open (passa todas as requests com warning Sentry) vs closed (bloqueia tudo). MVP fica open com `system_alerts critical`; admin decide se rebaixa a closed em incidente. Runbook [`upstash-down.md`](../runbooks/upstash-down.md)
- **Burst legítimo** — sprint que faz operação batch (envio de 200 mensagens régua) precisa de bypass via `bypassRateLimitForJob()` autenticado por job_id; nunca expor essa function ao LLM (regra 41)
- **Custo Upstash** — sliding window com janelas curtas + lookups frequentes consomem quota; monitorar e ajustar limites para evitar custo descontrolado em pico
- **Coordenação com lockout MFA** (regra 43) — gate `requireRecentMfa()` é separado do rate limit; ações sensíveis pedem ambos

## Riscos residuais (aceitos)

| Risco | Por que aceito | Compensação |
|---|---|---|
| Botnet distribuída suficientemente grande contorna rate limit por IP | LogiFit não é alvo prioritário no MVP; defesa é em profundidade (WAF + auth + RLS) | Cloudflare WAF nivel 1 + monitoramento Sentry de spike + lockout de email após N tentativas |
| Upstash Redis down durante 30min causa burst sem rate limit (modo open) | Modo closed bloquearia todos users — pior UX | `system_alerts critical` automático + decisão manual em runbook + WAF Cloudflare ainda ativo |

## Referências

- [ADR 0073 — Postura de segurança defesa em profundidade](../decisions/0073-postura-seguranca-defesa-em-profundidade.md) (camada 3)
- [Runbook upstash-down.md](../runbooks/upstash-down.md)
- [Runbook lockout-conta.md](../runbooks/lockout-conta.md)
- [Regra 33 — wrapAction wrapper](../rules.md)
- [Regra 36 — rate limit Upstash](../rules.md)
- [Regra 43 — MFA obrigatório / requireRecentMfa](../rules.md)
- [docs/compliance/dpo.md](../compliance/dpo.md) — Upstash sub-processor
