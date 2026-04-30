/**
 * replayWebhook (T7 idempotência ADR 0090) — replay payload de webhook com
 * HMAC válido. Sprint 04+ usa pra Asaas/Focus NFe; Sprint 13 pra Twilio/Gupshup.
 *
 * Sprint 00: contrato. Implementação real depende de:
 *   - Schema `webhook_events` com `provider`/`external_id`/`processed_at`
 *   - Secrets HMAC por provider em env
 *   - Endpoint `/api/webhooks/{provider}` real (Sprint 04 Asaas é o primeiro)
 */
export type WebhookProvider = 'asaas' | 'focus-nfe' | 'twilio' | 'gupshup' | 'pluggy'

export interface ReplayWebhookOptions {
  provider: WebhookProvider
  externalId: string
  payload: Record<string, unknown>
  /** URL completa ou path; default usa baseURL do Playwright config. */
  url?: string
  /** Override do secret HMAC; default lê de env por provider. */
  secret?: string
}

export async function replayWebhook(_options: ReplayWebhookOptions): Promise<Response> {
  throw new Error('replayWebhook() not implemented yet — Sprint 04 (primeiro webhook real)')
}
