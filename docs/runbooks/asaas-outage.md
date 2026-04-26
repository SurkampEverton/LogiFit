# Runbook — Asaas outage / webhook dead-letter

> **Stub** — runbook esperado para incidentes de provider Asaas (cobrança). Citado por regra 8 (idempotência webhook) e Sprint 04. Será expandido na Sprint 04 ou no primeiro incidente real.

- **Quando usar:** Asaas API retorna 5xx persistente (>15min); webhooks param de chegar; cobranças geradas mas não confirmadas; dead-letter queue acumula
- **Severidade típica:** p1 (afeta cobrança = receita) — escalar p0 se >2h
- **Tempo estimado:** 30min (mitigação) + variável (recuperação completa quando provider voltar)
- **Quem executa:** fundador / dev (PAM session se for ler dado financeiro de outros tenants para diagnose)
- **Última revisão:** 2026-04-25 (stub)

## Pré-requisitos

- [ ] Acesso ao status page do Asaas (https://status.asaas.com)
- [ ] Sentry filtro por `provider:asaas`
- [ ] Acesso ao painel Vercel (logs) + Supabase (tabelas `asaas_webhook_events`, `invoices`, `charges`)

## Passos (a expandir)

### Fase 1 — Diagnose (5min)

1. Verificar status page Asaas
2. Verificar Sentry para padrão de erros (`HTTP 502`, `timeout`, `ECONNRESET`)
3. Verificar dead-letter queue (DLQ) de webhook em `system_alerts category=webhook severity=warn|error`

### Fase 2 — Mitigação (15min)

1. **Não** desabilitar a integração (afeta cobrança nova) — pausar apenas envio de **novas** cobranças via feature flag PostHog `asaas_paused`
2. Comunicar tenants ativos via banner em `/app/financeiro` ("Asaas em manutenção — cobranças retomam em breve")
3. DLQ: garantir que `webhook_events` tem `external_id` unique (regra 8) — quando provider voltar, reprocessar em ordem

### Fase 3 — Recuperação (após Asaas voltar)

1. Reprocessar DLQ via job `process-asaas-dlq`
2. Reabilitar feature flag `asaas_paused`
3. Auditar idempotência: nenhuma cobrança duplicada (regra 8 + `external_id` unique)
4. Revisar `audit_log` para confirmar nada foi pulado

## Rollback

Se reprocessamento DLQ duplicar cobranças:
1. Identificar cobranças duplicadas (mesmo `external_id` aceito por bug)
2. Anular as duplicadas via Server Action `voidInvoice` (exige MFA recente — regra 43)
3. Comunicar tenants afetados
4. Abrir incidente em `security_incidents` (ADR 0067) se afeta dado financeiro de >5 tenants

## Monitoramento pós-execução

- [ ] Sentry sem erros `provider:asaas` por 1h
- [ ] DLQ `webhook_events status=pending` zerado
- [ ] Cobranças do dia sem duplicatas (query: `invoices group by external_id having count(*) > 1`)

## Em caso de falha

- Se outage >24h: avaliar fallback manual (Pix manual no admin) — cliente paga, registramos no AR
- Não há provider de cobrança alternativo em hot-standby no MVP — risco aceito pelo ADR 0001 (stack base)

## Histórico

| Data | Cenário | Resultado |
|---|---|---|
| (a preencher) | | |
