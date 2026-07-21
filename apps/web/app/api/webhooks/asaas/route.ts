/**
 * POST /api/webhooks/asaas — Sprint 04 Faixa B.
 *
 * Recebe eventos webhook do Asaas:
 *   - PAYMENT_CREATED, PAYMENT_RECEIVED, PAYMENT_OVERDUE, PAYMENT_REFUNDED,
 *     PAYMENT_DELETED, etc.
 *
 * **Idempotência**: `webhook_events.(source, external_id)` UNIQUE — segunda
 * chamada com mesmo `event.id` retorna 200 sem reprocessar.
 *
 * **HMAC validation**: Asaas envia `asaas-access-token` header (auth token
 * fixo configurado no painel Asaas). MVP valida o token contra env
 * `ASAAS_WEBHOOK_TOKEN`. Sprint 04+ pode adicionar HMAC SHA-256 signed
 * payload se Asaas suportar (não suporta por default em 2026).
 *
 * **Processing**: depois de gravar webhook_event como received, faz lookup
 * de `invoice` via `asaas_id` + atualiza status + cria `payment` row.
 * Tudo em transação. Falhas log no `webhook_events.error` pra retry manual.
 *
 * **Envelope ADR 0071**: retorna 200 mesmo em erro de processamento — Asaas
 * não deve retry se nosso processor tem bug. Erros vão em system_alerts
 * (Sprint 04+ Faixa C plugga).
 */
import { db, pool } from '@repo/db/client'
import { invoices, payments } from '@repo/db/schema'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const WEBHOOK_TOKEN = process.env.ASAAS_WEBHOOK_TOKEN

interface AsaasPayment {
  id: string
  status: string // RECEIVED, CONFIRMED, OVERDUE, REFUNDED, DELETED
  value: number // R$ (não centavos)
  netValue?: number
  paymentDate?: string // ISO date string
  billingType?: string // BOLETO, PIX, CREDIT_CARD, UNDEFINED
  externalReference?: string // pode ser nosso invoice_id
}

interface AsaasWebhookPayload {
  id?: string // event id (idempotency key)
  event: string
  dateCreated?: string
  payment?: AsaasPayment
}

/**
 * Comparação time-safe pra token (evita timing attacks).
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

function asaasMethodToInternal(billingType?: string): 'boleto' | 'pix' | 'credit_card' {
  if (billingType === 'PIX') return 'pix'
  if (billingType === 'CREDIT_CARD') return 'credit_card'
  return 'boleto' // default — BOLETO ou UNDEFINED
}

export async function POST(request: Request) {
  // ─── 1. Auth token (Asaas envia asaas-access-token header) ────────────
  if (!WEBHOOK_TOKEN) {
    console.error(
      JSON.stringify({
        level: 'error',
        module: 'webhook.asaas',
        error: 'ASAAS_WEBHOOK_TOKEN not configured',
      }),
    )
    // Retorna 200 — não bloquear webhook por config error (Asaas re-tentaria)
    return NextResponse.json({ ok: true }, { status: 200 })
  }
  const headerToken = request.headers.get('asaas-access-token') ?? ''
  if (!timingSafeEqual(headerToken, WEBHOOK_TOKEN)) {
    console.warn(JSON.stringify({ level: 'warn', module: 'webhook.asaas', error: 'invalid token' }))
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  // ─── 2. Parse payload ─────────────────────────────────────────────────
  let payload: AsaasWebhookPayload
  try {
    payload = (await request.json()) as AsaasWebhookPayload
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }

  const eventId = payload.id ?? `${payload.event}:${payload.payment?.id ?? 'unknown'}`

  // ─── 3. Idempotência: tentar INSERT webhook_event (UNIQUE source+external_id) ──
  // INSERT direto via pg (bypassa RLS de tenant — webhook_events não tem RLS).
  let webhookEventInserted = false
  let webhookRowId: string | null = null
  try {
    const insertRes = await pool.query<{ id: string }>(
      `INSERT INTO webhook_events (source, external_id, payload)
       VALUES ('asaas', $1, $2::jsonb)
       ON CONFLICT (source, external_id) DO NOTHING
       RETURNING id`,
      [eventId, JSON.stringify(payload)],
    )
    if (insertRes.rows.length > 0) {
      webhookEventInserted = true
      webhookRowId = insertRes.rows[0]?.id ?? null
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(
      JSON.stringify({
        level: 'error',
        module: 'webhook.asaas',
        stage: 'insert_event',
        error: message,
      }),
    )
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  if (!webhookEventInserted) {
    // Mesmo event já recebido — retorna 200 (Asaas considera processado)
    console.log(
      JSON.stringify({
        level: 'info',
        module: 'webhook.asaas',
        stage: 'duplicate',
        event_id: eventId,
      }),
    )
    return NextResponse.json({ ok: true, duplicate: true }, { status: 200 })
  }

  // ─── 4. Process event ─────────────────────────────────────────────────
  const event = payload.event
  const asaasPay = payload.payment
  let processError: string | null = null

  try {
    if (!asaasPay?.id) {
      processError = 'payload.payment.id missing'
    } else if (
      event === 'PAYMENT_RECEIVED' ||
      event === 'PAYMENT_CONFIRMED' ||
      event === 'PAYMENT_RECEIVED_IN_CASH'
    ) {
      // tenant-scope-exempt: webhook de sistema autenticado por assinatura;
      // a invoice e resolvida por asaas_id (identificador global do provedor,
      // nao input de usuario) e o tenant vem da linha encontrada.
      // Marca invoice como paid + cria payment row
      const [invoice] = await db
        .select({
          id: invoices.id,
          tenantId: invoices.tenantId,
          amountCents: invoices.amountCents,
        })
        .from(invoices)
        .where(eq(invoices.asaasId, asaasPay.id))
        .limit(1)

      if (!invoice) {
        processError = `invoice not found for asaas_id=${asaasPay.id}`
      } else {
        const amountCents = Math.round((asaasPay.netValue ?? asaasPay.value) * 100)
        const paidAt = asaasPay.paymentDate ? new Date(asaasPay.paymentDate) : new Date()

        await db.transaction(async (tx) => {
          await tx
            .update(invoices)
            .set({ status: 'paid', paidAt, updatedAt: new Date() })
            .where(eq(invoices.id, invoice.id))
          await tx.insert(payments).values({
            tenantId: invoice.tenantId,
            invoiceId: invoice.id,
            amountCents,
            method: asaasMethodToInternal(asaasPay.billingType),
            paidAt,
            asaasId: asaasPay.id,
            rawPayload: payload as unknown as Record<string, unknown>,
          })
        })
      }
      // tenant-scope-exempt: webhook do Asaas, sem sessao — a invoice e resolvida
      // pelo asaas_id, identificador do provider unico globalmente, gerado por nos
      // na criacao da cobranca. Nao ha input de usuario aqui: um tenant nao tem
      // como forjar o asaas_id de outro.
    } else if (event === 'PAYMENT_OVERDUE') {
      await db
        .update(invoices)
        .set({ status: 'overdue', updatedAt: new Date() })
        .where(eq(invoices.asaasId, asaasPay.id))
      // tenant-scope-exempt: resolvido pelo asaas_id (id do provider, unico global)
    } else if (event === 'PAYMENT_REFUNDED') {
      await db
        .update(invoices)
        .set({ status: 'refunded', updatedAt: new Date() })
        .where(eq(invoices.asaasId, asaasPay.id))
      // tenant-scope-exempt: resolvido pelo asaas_id (id do provider, unico global)
    } else if (event === 'PAYMENT_DELETED') {
      await db
        .update(invoices)
        .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
        .where(eq(invoices.asaasId, asaasPay.id))
    } else {
      // Event não tratado — registra no log mas não erro
      console.log(
        JSON.stringify({
          level: 'info',
          module: 'webhook.asaas',
          stage: 'unhandled_event',
          event,
        }),
      )
    }
  } catch (err) {
    processError = err instanceof Error ? err.message : String(err)
  }

  // ─── 5. Marca processed_at + error opcional ──────────────────────────
  if (webhookRowId) {
    await pool
      .query(`UPDATE webhook_events SET processed_at = now(), error = $1 WHERE id = $2`, [
        processError,
        webhookRowId,
      ])
      .catch(() => {
        /* swallow — webhook_event update falhou, mas ack pro Asaas */
      })
  }

  if (processError) {
    console.error(
      JSON.stringify({
        level: 'error',
        module: 'webhook.asaas',
        stage: 'process',
        event,
        event_id: eventId,
        error: processError,
      }),
    )
  } else {
    console.log(
      JSON.stringify({
        level: 'info',
        module: 'webhook.asaas',
        stage: 'processed',
        event,
        event_id: eventId,
      }),
    )
  }

  // Sempre 200 — não pedir retry do Asaas em erro de processamento
  return NextResponse.json({ ok: true, processed: !processError })
}
