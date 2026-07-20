'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { cancelAR, markARIssued, registerARReceived } from '../actions'

interface Props {
  arId: string
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

export function ARActions({ arId, status }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [showReceive, setShowReceive] = useState(false)
  const [recvAmount, setRecvAmount] = useState('')
  const [recvDate, setRecvDate] = useState(todayISO())
  const [recvMethod, setRecvMethod] = useState<
    'pix' | 'ted' | 'doc' | 'boleto' | 'cash' | 'credit_card' | 'manual_other'
  >('pix')
  const [recvReference, setRecvReference] = useState('')

  function refresh() {
    router.refresh()
  }

  function handleIssue() {
    setError(null)
    startTransition(async () => {
      const r = await markARIssued({ arId })
      if (!r.ok) setError(r.error.message)
      else refresh()
    })
  }

  function handleReceive() {
    setError(null)
    const cents = parseBrlToCents(recvAmount)
    if (cents <= 0) {
      setError('Valor inválido')
      return
    }
    startTransition(async () => {
      const r = await registerARReceived({
        arId,
        amountCents: cents,
        paidAt: recvDate,
        method: recvMethod,
        reference: recvReference || undefined,
      })
      if (!r.ok) setError(r.error.message)
      else {
        setShowReceive(false)
        setRecvAmount('')
        setRecvReference('')
        refresh()
      }
    })
  }

  function handleCancel() {
    setError(null)
    startTransition(async () => {
      const r = await cancelAR({ arId })
      if (!r.ok) setError(r.error.message)
      else refresh()
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
            onClick={handleIssue}
            disabled={pending}
            className="ev-btn ev-btn-primary"
          >
            Marcar como emitida
          </button>
        )}
        {['draft', 'issued', 'overdue'].includes(status) && (
          <>
            <button
              type="button"
              onClick={() => setShowReceive((v) => !v)}
              disabled={pending}
              className="ev-btn ev-btn-primary"
            >
              Registrar recebimento
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={pending}
              className="ev-btn ev-btn-ghost"
            >
              Cancelar
            </button>
          </>
        )}
      </div>

      {showReceive && (
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
          <div style={{ display: 'flex', gap: 'var(--ev-space-sm)', flexWrap: 'wrap' }}>
            <label
              style={{ flex: 1, minWidth: 140, display: 'flex', flexDirection: 'column', gap: 4 }}
            >
              <span>Valor (R$)</span>
              <input
                type="text"
                inputMode="decimal"
                value={recvAmount}
                onChange={(e) => setRecvAmount(e.target.value)}
                className="ev-input"
                placeholder="0,00"
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>Data</span>
              <input
                type="date"
                value={recvDate}
                onChange={(e) => setRecvDate(e.target.value)}
                className="ev-input"
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>Método</span>
              <select
                value={recvMethod}
                onChange={(e) =>
                  setRecvMethod(
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
            <span>Referência (opcional)</span>
            <input
              type="text"
              value={recvReference}
              onChange={(e) => setRecvReference(e.target.value)}
              className="ev-input"
              maxLength={120}
            />
          </label>
          <div style={{ display: 'flex', gap: 'var(--ev-space-sm)' }}>
            <button
              type="button"
              onClick={handleReceive}
              disabled={pending}
              className="ev-btn ev-btn-primary"
            >
              Confirmar recebimento
            </button>
            <button
              type="button"
              onClick={() => setShowReceive(false)}
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
