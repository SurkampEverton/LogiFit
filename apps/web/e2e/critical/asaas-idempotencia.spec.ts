import { test } from '@playwright/test'

/**
 * critical/asaas-idempotencia — webhook Asaas replayed N vezes gera apenas 1
 * mutação no invoice (T7 idempotência, ADR 0090 §5).
 * Bloqueia deploy prod se falhar.
 *
 * Cenário:
 *   1. checkout cria invoice status='pending', stripe_event_id (Asaas externalId)='evt_123'
 *   2. webhook /api/webhooks/asaas chega com payment.confirmed, externalId='evt_123'
 *      → wrapApiHandler valida HMAC + checa webhooks_processed table → marca invoice='paid'
 *   3. mesmo webhook chega 3× mais (Asaas retry policy)
 *   4. invoice.status continua 'paid' (não vira 'paid_paid_paid')
 *   5. webhooks_processed tem 1 linha pra evt_123 (não 4)
 *   6. audit_log tem 1 entry de pagamento (não 4)
 *
 * Cobre ADR 0089 §error envelope + webhook handler em packages/errors/wrap-api-handler.ts.
 */
test.skip('webhook Asaas replayed 4× só marca invoice paid uma vez (idempotente)', async () => {
  // implementação Sprint 04 (após webhook table + replayWebhook helper)
})
