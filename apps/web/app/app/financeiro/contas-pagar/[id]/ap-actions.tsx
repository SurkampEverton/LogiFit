'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { approveAP, cancelAP, registerManualPayment, rejectAP, submitForApproval } from '../actions'

interface Props {
  apId: string
  status: string
}

function parseBrlToCents(value: string): number {
  const cleaned = value
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
  const num = Number(cleaned)
  if (!Number.isFinite(num) || num <= 0) return 0
  return Math.round(num * 100)
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function APActions({ apId, status }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [showReject, setShowReject] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [showApprove, setShowApprove] = useState(false)
  const [approveComment, setApproveComment] = useState('')
  const [showPay, setShowPay] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payDate, setPayDate] = useState(todayISO())
  const [payMethod, setPayMethod] = useState<
    'pix' | 'ted' | 'doc' | 'boleto' | 'cash' | 'credit_card' | 'manual_other'
  >('pix')
  const [payReference, setPayReference] = useState('')

  function refreshPage() {
    router.refresh()
  }

  function handleSubmit() {
    setError(null)
    startTransition(async () => {
      const r = await submitForApproval({ apId })
      if (!r.ok) setError(r.error.message)
      else refreshPage()
    })
  }

  function handleApprove() {
    setError(null)
    startTransition(async () => {
      const r = await approveAP({ apId, comment: approveComment || undefined })
      if (!r.ok) setError(r.error.message)
      else {
        setShowApprove(false)
        setApproveComment('')
        refreshPage()
      }
    })
  }

  function handleReject() {
    setError(null)
    if (rejectReason.length < 5) {
      setError('Motivo deve ter pelo menos 5 caracteres')
      return
    }
    startTransition(async () => {
      const r = await rejectAP({ apId, reason: rejectReason })
      if (!r.ok) setError(r.error.message)
      else {
        setShowReject(false)
        refreshPage()
      }
    })
  }

  function handleCancel() {
    setError(null)
    startTransition(async () => {
      const r = await cancelAP({ apId })
      if (!r.ok) setError(r.error.message)
      else refreshPage()
    })
  }

  function handlePay() {
    setError(null)
    const cents = parseBrlToCents(payAmount)
    if (cents <= 0) {
      setError('Valor inválido')
      return
    }
    startTransition(async () => {
      const r = await registerManualPayment({
        apId,
        amountCents: cents,
        paidAt: payDate,
        method: payMethod,
        reference: payReference || undefined,
      })
      if (!r.ok) setError(r.error.message)
      else {
        setShowPay(false)
        setPayAmount('')
        setPayReference('')
        refreshPage()
      }
    })
  }

  return (
    <section
      className="ev-card"
      style={{
        padding: 'var(--ev-space-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--ev-space-sm)',
      }}
    >
      <h3 style={{ margin: 0 }}>Ações</h3>
      <div style={{ display: 'flex', gap: 'var(--ev-space-sm)', flexWrap: 'wrap' }}>
        {status === 'draft' && (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={pending}
            className="ev-btn ev-btn-primary"
          >
            Submeter à aprovação
          </button>
        )}
        {status === 'pending_approval' && (
          <>
            <button
              type="button"
              onClick={() => setShowApprove((v) => !v)}
              disabled={pending}
              className="ev-btn ev-btn-primary"
            >
              Aprovar
            </button>
            <button
              type="button"
              onClick={() => setShowReject((v) => !v)}
              disabled={pending}
              className="ev-btn"
              style={{
                backgroundColor: 'var(--ev-danger-bg, #fee2e2)',
                color: 'var(--ev-danger, #dc2626)',
              }}
            >
              Rejeitar
            </button>
          </>
        )}
        {(status === 'approved' || status === 'scheduled') && (
          <button
            type="button"
            onClick={() => setShowPay((v) => !v)}
            disabled={pending}
            className="ev-btn ev-btn-primary"
          >
            Registrar pagamento
          </button>
        )}
        {['draft', 'pending_approval', 'approved', 'scheduled'].includes(status) && (
          <button
            type="button"
            onClick={handleCancel}
            disabled={pending}
            className="ev-btn ev-btn-ghost"
          >
            Cancelar AP
          </button>
        )}
      </div>

      {showApprove && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--ev-space-sm)',
            padding: 'var(--ev-space-sm)',
            backgroundColor: 'var(--ev-success-bg, #dcfce7)',
            borderRadius: 'var(--ev-radius)',
          }}
        >
          <label>
            Comentário (opcional)
            <textarea
              value={approveComment}
              onChange={(e) => setApproveComment(e.target.value)}
              rows={2}
              className="ev-input"
              maxLength={2000}
            />
          </label>
          <div style={{ display: 'flex', gap: 'var(--ev-space-sm)' }}>
            <button
              type="button"
              onClick={handleApprove}
              disabled={pending}
              className="ev-btn ev-btn-primary"
            >
              Confirmar aprovação
            </button>
            <button
              type="button"
              onClick={() => setShowApprove(false)}
              disabled={pending}
              className="ev-btn ev-btn-ghost"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {showReject && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--ev-space-sm)',
            padding: 'var(--ev-space-sm)',
            backgroundColor: 'var(--ev-danger-bg, #fee2e2)',
            borderRadius: 'var(--ev-radius)',
          }}
        >
          <label>
            Motivo da rejeição (mínimo 5 caracteres)
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={2}
              className="ev-input"
              minLength={5}
              maxLength={2000}
              required
            />
          </label>
          <div style={{ display: 'flex', gap: 'var(--ev-space-sm)' }}>
            <button
              type="button"
              onClick={handleReject}
              disabled={pending || rejectReason.length < 5}
              className="ev-btn"
              style={{
                backgroundColor: 'var(--ev-danger, #dc2626)',
                // design-token-exempt: branco puro pra contraste sobre danger
                color: '#fff',
              }}
            >
              Confirmar rejeição
            </button>
            <button
              type="button"
              onClick={() => setShowReject(false)}
              disabled={pending}
              className="ev-btn ev-btn-ghost"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {showPay && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--ev-space-sm)',
            padding: 'var(--ev-space-sm)',
            backgroundColor: 'var(--ev-info-bg, #dbeafe)',
            borderRadius: 'var(--ev-radius)',
          }}
        >
          <div style={{ display: 'flex', gap: 'var(--ev-space-sm)', flexWrap: 'wrap' }}>
            <label
              style={{ flex: 1, minWidth: 140, display: 'flex', flexDirection: 'column', gap: 4 }}
            >
              <span>Valor pago (R$)</span>
              <input
                type="text"
                inputMode="decimal"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                className="ev-input"
                placeholder="0,00"
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>Data</span>
              <input
                type="date"
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
                className="ev-input"
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>Método</span>
              <select
                value={payMethod}
                onChange={(e) =>
                  setPayMethod(
                    e.target.value as
                      | 'pix'
                      | 'ted'
                      | 'doc'
                      | 'boleto'
                      | 'cash'
                      | 'credit_card'
                      | 'manual_other',
                  )
                }
                className="ev-input"
              >
                <option value="pix">PIX</option>
                <option value="ted">TED</option>
                <option value="doc">DOC</option>
                <option value="boleto">Boleto</option>
                <option value="cash">Dinheiro</option>
                <option value="credit_card">Cartão</option>
                <option value="manual_other">Outro</option>
              </select>
            </label>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>Referência / comprovante (opcional)</span>
            <input
              type="text"
              value={payReference}
              onChange={(e) => setPayReference(e.target.value)}
              className="ev-input"
              maxLength={120}
              placeholder="ID transação, nº comprovante"
            />
          </label>
          <div style={{ display: 'flex', gap: 'var(--ev-space-sm)' }}>
            <button
              type="button"
              onClick={handlePay}
              disabled={pending}
              className="ev-btn ev-btn-primary"
            >
              Registrar pagamento
            </button>
            <button
              type="button"
              onClick={() => setShowPay(false)}
              disabled={pending}
              className="ev-btn ev-btn-ghost"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="ev-alert ev-alert-danger" role="alert">
          {error}
        </div>
      )}
    </section>
  )
}
