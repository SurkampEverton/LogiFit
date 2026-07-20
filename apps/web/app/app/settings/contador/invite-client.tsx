'use client'

/**
 * Form + lista de convites de contador — Sprint 01c (ADR 0103).
 */
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createContadorInvite, revokeContadorInvite } from './actions'

interface InviteRow {
  id: string
  email: string
  name: string | null
  expiresAt: string
  acceptedAt: string | null
  revokedAt: string | null
  createdAt: string
}

function statusOf(row: InviteRow): { label: string; cls: string } {
  if (row.acceptedAt) return { label: 'Aceito', cls: 'ev-badge-success' }
  if (row.revokedAt) return { label: 'Revogado', cls: 'ev-badge-danger' }
  if (new Date(row.expiresAt) < new Date()) return { label: 'Expirado', cls: 'ev-badge-warning' }
  return { label: 'Pendente', cls: 'ev-badge-primary' }
}

export function InviteManager({ invites }: { invites: InviteRow[] }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault()
    setPending('create')
    setError(null)
    setInfo(null)
    try {
      const r = await createContadorInvite({
        email: email.trim(),
        name: name.trim() || undefined,
      })
      if (!r.ok) throw new Error('error' in r ? String(r.error.message ?? 'Erro') : 'Erro')
      setInfo(`Convite enviado pra ${r.data.email} (expira em 7 dias).`)
      setEmail('')
      setName('')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao enviar convite')
    } finally {
      setPending(null)
    }
  }

  async function handleRevoke(id: string) {
    setPending(id)
    setError(null)
    try {
      const r = await revokeContadorInvite({ id })
      if (!r.ok) throw new Error('error' in r ? String(r.error.message ?? 'Erro') : 'Erro')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao revogar')
    } finally {
      setPending(null)
    }
  }

  return (
    <>
      <section className="ev-card">
        <h2 style={{ marginTop: 0, fontSize: 'var(--ev-text-lg)' }}>Convidar contador</h2>
        <form
          onSubmit={handleCreate}
          className="ev-row"
          style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <div className="ev-stack-sm" style={{ minWidth: '16rem' }}>
            <label htmlFor="invite-email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="invite-email"
              type="email"
              className="ev-input"
              placeholder="contador@escritorio.com.br"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="ev-stack-sm" style={{ minWidth: '14rem' }}>
            <label htmlFor="invite-name" className="text-sm font-medium">
              Nome (opcional)
            </label>
            <input
              id="invite-name"
              className="ev-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="ev-btn ev-btn-primary"
            disabled={pending !== null || !email}
          >
            {pending === 'create' ? 'Enviando…' : '✉️ Enviar convite'}
          </button>
        </form>
        {info && (
          <p className="text-sm" style={{ marginTop: 'var(--ev-space-sm)' }}>
            {info}
          </p>
        )}
        {error && (
          <p
            className="text-xs"
            role="alert"
            style={{ marginTop: 'var(--ev-space-sm)', color: 'var(--ev-danger, #dc2626)' }}
          >
            {error}
          </p>
        )}
      </section>

      <section className="ev-card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="ev-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Nome</th>
              <th>Status</th>
              <th>Expira</th>
              <th>Criado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {invites.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', color: 'var(--ev-text-muted)' }}>
                  Nenhum convite ainda.
                </td>
              </tr>
            ) : (
              invites.map((row) => {
                const status = statusOf(row)
                const isPendente = status.label === 'Pendente'
                return (
                  <tr key={row.id}>
                    <td>{row.email}</td>
                    <td>{row.name ?? '—'}</td>
                    <td>
                      <span className={`ev-badge ${status.cls}`}>{status.label}</span>
                    </td>
                    <td className="num">{new Date(row.expiresAt).toLocaleDateString('pt-BR')}</td>
                    <td className="num">{new Date(row.createdAt).toLocaleDateString('pt-BR')}</td>
                    <td>
                      {isPendente && (
                        <button
                          type="button"
                          className="ev-btn ev-btn-ghost ev-btn-sm"
                          disabled={pending !== null}
                          onClick={() => void handleRevoke(row.id)}
                        >
                          {pending === row.id ? '…' : 'Revogar'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </section>
    </>
  )
}
