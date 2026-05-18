'use client'

import { useState } from 'react'
import { requestMagicLink } from '../actions'

interface Props {
  tenantSlug: string
}

export function MagicLinkForm({ tenantSlug }: Props) {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      // Anti-enumeration: sempre marca como enviado mesmo se backend não enviou
      await requestMagicLink({ email, tenantSlug })
      setSent(true)
    } finally {
      setSubmitting(false)
    }
  }

  if (sent) {
    return (
      <div className="ev-portal-callout">
        <h2 className="ev-portal-h2">Link enviado</h2>
        <p>
          Se este email está cadastrado, você receberá um link de acesso em instantes. Verifique sua
          caixa de entrada e spam.
        </p>
        <p className="ev-portal-muted">O link expira em 15 minutos.</p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="ev-portal-form">
      <label htmlFor="email" className="ev-portal-label">
        Email
      </label>
      <input
        id="email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="ev-portal-input"
        autoComplete="email"
        placeholder="seu@email.com"
      />
      <button type="submit" disabled={submitting} className="ev-portal-button">
        {submitting ? 'Enviando...' : 'Enviar link de acesso'}
      </button>
    </form>
  )
}
