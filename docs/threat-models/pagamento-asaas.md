# Threat Model STRIDE — Pagamento via Asaas

> **v0.1-skeleton** — STRIDE obrigatório (regras 33, 36, 37 + [ADR 0073](../decisions/0073-postura-seguranca-defesa-em-profundidade.md)). Substância completa quando [Sprint 04](../sprints/04-geral-financeiro-asaas.md) implementar Asaas com webhook + idempotência.

- **Feature:** Cobrança recorrente via Asaas — boleto/Pix/cartão; webhook de confirmação; reconciliação financeira
- **Sprint:** [Sprint 04 — Financeiro Asaas](../sprints/04-geral-financeiro-asaas.md)
- **Data:** 2026-04-25 (skeleton)
- **Autor:** Fundador
- **Próxima revisão:** quando feature entrar em produção + a cada nova feature (BYOK Asaas por company, antecipação)

## Diagrama de fluxo de dados (a expandir Sprint 04)

```
[Tenant admin] → /app/financeiro → cria invoice
   ↓ (Server Action wrapAction)
[asaas.createCharge() via safeFetch (regra 37, allowedHosts)]
   ↓
[Asaas API (sub-processador)]
   ↓ (webhook)
[/api/webhooks/asaas — wrapApiHandler]
   ↓ (HMAC validation + idempotência via external_id)
[Postgres: invoices, payments — RLS]
   ↓
[Reconciliação financeira + audit_log + emit NFS-e via Focus NFe (Sprint 36)]
```

**Trust boundaries:**
1. Tenant admin → Server Action — auth + MFA recente <15min para alto-risco (regra 43)
2. Server Action → Asaas API — `safeFetch()` allowedHosts + timeout 30s + redirect manual (regra 37)
3. Asaas → webhook LogiFit — HMAC validation **obrigatória** (regra 33) + idempotência (regra 33 ADR 0071)
4. Webhook → DB — Drizzle param binding + RLS

## Análise STRIDE

| Ameaça | Cenário | Mitigação | Status |
|---|---|---|---|
| **S**poofing | Atacante envia webhook falso simulando pagamento Asaas | HMAC validation com secret do Asaas (`ASAAS_WEBHOOK_SECRET` em env, rotacionado anualmente) + IP allowlist do Asaas | 🟡 a implementar Sprint 04 |
| **T**ampering | Replay de webhook antigo | Idempotência por `external_id` Asaas; segundo INSERT com mesmo external_id é no-op | 🟡 a implementar |
| **T**ampering | Modificação de valor entre Asaas e LogiFit | HMAC cobre payload completo; mismatch = `INVALID_HMAC` envelope + audit critical | 🟡 a implementar |
| **R**epudiation | Tenant nega ter cobrado | `audit_log` hash chain (regra 39) + `payments` tabela append-only via INSERT trigger; correção via NF-e cancelamento (Sprint 36) com rastreabilidade | 🟡 a implementar |
| **R**epudiation | Paciente nega ter pago | Conciliar com extrato Asaas + comprovante PIX/boleto que o Asaas armazena; `payments.external_proof_url` mantido | 🟡 a implementar |
| **I**nformation disclosure | Vazamento de chave Asaas (`ASAAS_API_KEY`) | Vercel env encrypted + rotação anual (runbook rotate-secrets); BYOK por company cifrado em `asaas_keys.api_key` (KEK por tenant) | 🟢 padrão definido |
| **I**nformation disclosure | Log de payload Asaas vaza dado de cartão | Asaas é PCI-DSS compliant — LogiFit **não toca em PAN**; payloads logados são sanitizados (apenas `payment_method`, `last4`) | 🟡 lint anti-PCI |
| **D**enial of service | Webhook flood (atacante envia milhares de webhooks falsos) | Rate limit Upstash por IP origem + HMAC bloqueia em <10ms; alerta se >100 falsos/min | 🟡 a implementar |
| **D**enial of service | Asaas API down → cobranças não geram | Circuit breaker + retry exponencial + queue persistente; tenant tem grace period 24h em `payment_status` | 🟡 a implementar |
| **E**levation of privilege | Recepcionista cancela invoice de outro tenant | RLS multi-tenant + permission `invoice.cancel` apenas em `tenant_owner` ou `gerente_filial` (regra 6) + MFA recente (regra 43) | 🟡 a implementar |
| **E**levation of privilege | IA assistente Camada 3 chama `chargeBatch` | **BLOQUEADO** em MVP (regra 41 + ADR 0075) — `chargeBatch` é write proibido para IA | 🟢 política definida |

## Riscos residuais (aceitos)

| Risco | Por que aceito | Compensação |
|---|---|---|
| Asaas BR sofre incidente nacional | LogiFit não tem provider redundante (custo + complexidade) | Plano: avaliar Pagar.me ou Stripe BR como fallback se Asaas tiver downtime >4h em ano — Sprint pós-MVP |
| Latência de webhook Asaas (até 5min) | Inerente ao provider | UI mostra "aguardando confirmação" no member; reconciliação por job batch hourly |
| Member duplica pagamento (paga 2x mesmo invoice) | Asaas previne com idempotência server-side | Job de detecção de duplicata + estorno automático via `chargeRefund` (manual no MVP) |

## Plano de revisão

- Próxima revisão obrigatória: **antes de production launch** + a cada nova feature (BYOK Asaas, antecipação, split de pagamento)
- Revisar antes de:
  - [ ] Sprint 04 production launch
  - [ ] Adicionar BYOK Asaas por company
  - [ ] Adicionar Open Finance pagamentos (Sprint pós-MVP)
  - [ ] Mudança Asaas API (versão major)

## Referências

- [Sprint 04 — Financeiro Asaas](../sprints/04-geral-financeiro-asaas.md)
- [ADR 0073 — Postura segurança](../decisions/0073-postura-seguranca-defesa-em-profundidade.md)
- [ADR 0071 — Tratamento de erros e alertas](../decisions/0071-sistema-tratamento-erros-alertas-tempo-real.md)
- [Runbook rotate-secrets](../runbooks/rotate-secrets.md)
- Asaas API docs (não versionado em git por mudanças frequentes)
