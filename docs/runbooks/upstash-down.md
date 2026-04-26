# Runbook — Upstash Redis down (rate limit fail-open vs closed)

> **Stub** — runbook esperado para incidentes do provider Upstash Redis usado pelo rate limit (regra 36). Será expandido no primeiro incidente real ou na Sprint 00 quando rate limit for instrumentado.

- **Quando usar:** Upstash Redis indisponível (>5min); latência >500ms persistente; chave `(tenant_id, user_id, ip, endpoint)` retorna erro
- **Severidade típica:** p1 (sistema vulnerável a brute force / abuse enquanto down) — p0 se rate limit fail-open
- **Tempo estimado:** 15min (decisão fail-open vs fail-closed) + variável
- **Quem executa:** fundador / dev
- **Última revisão:** 2026-04-25 (stub)

## Decisão crítica antes de qualquer coisa

**Fail-open ou fail-closed?**

- **Fail-open** (rate limit some, requests passam) → sistema vulnerável a brute force em `/login`, abuse de IA, scraping. **Inaceitável** para `/login` (regra 36 lockout 5/15min é defesa primária contra credential stuffing).
- **Fail-closed** (rate limit retorna `RATE_LIMITED` em tudo) → sistema indisponível para todos os tenants legítimos. **Inaceitável** se Upstash fica down >5min.

**Política LogiFit (a confirmar na Sprint 00):**
- `/login` + `/signup` + endpoints de write: **fail-closed** (preferência por DoS over brute force)
- Endpoints read: **fail-open** com `RATE_LIMITED` log apenas (visibilidade sem bloqueio)
- Webhook inbound: **fail-open** (idempotência via `external_id` mitiga abuso — regra 8)

## Pré-requisitos

- [ ] Acesso ao painel Upstash (https://console.upstash.com)
- [ ] Sentry filtro por `service:rate-limit` ou `error:UPSTASH_*`
- [ ] Conhecimento do fallback configurado em `packages/security/rate-limit.ts`

## Passos (a expandir)

### Fase 1 — Diagnose (5min)

1. Verificar status Upstash + status page
2. Verificar Sentry para padrão de erros
3. Verificar latência atual via `/app/super-admin/database` (ADR 0072)

### Fase 2 — Decisão fail-open vs fail-closed (10min)

1. Se outage <5min: aguardar (Upstash costuma recuperar)
2. Se outage 5-30min: ativar fallback in-memory por endpoint (sliding window por instância Vercel — não-distribuído mas reduz superfície)
3. Se outage >30min: alternar política conforme tabela acima via feature flag PostHog `rate_limit_fallback`

### Fase 3 — Recuperação

1. Quando Upstash voltar, desativar fallback
2. Auditar logs de tentativa de brute force durante a janela: query `audit_log` por `action='login.failed' actor_user_id IS NULL group by ip having count(*) > 50`
3. Bloquear IPs suspeitos manualmente (se aplicável)

## Rollback

Não aplicável — runbook é defensivo, não destrutivo.

## Monitoramento pós-execução

- [ ] Latência rate limit volta ao baseline (<50ms p95)
- [ ] Sentry zerado por 1h
- [ ] `audit_log` sem padrões anômalos de login.failed

## Em caso de falha

- Considerar provider alternativo (Vercel KV via Edge Config como hot-standby — investigar)
- Se outage >2h, considerar mitigação Cloudflare Bot Fight Mode (camada 1 ADR 0073) elevada

## Histórico

| Data | Cenário | Resultado |
|---|---|---|
| (a preencher) | | |
