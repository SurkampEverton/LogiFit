'use client'

/**
 * Tabs Senha (Sprint 02b3 ADR 0094) + Magic link (Sprint 26 ADR 0088).
 *
 * Sprint 02b3: padrão "Senha" pra novos cadastros proativos. Magic link fica
 * pra pacientes legacy sem identidade global ainda.
 */
import { useState } from 'react'
import { MagicLinkForm } from './magic-link-form'
import { PasswordLoginForm } from './password-form'

interface Props {
  tenantSlug: string
}

export function LoginTabs({ tenantSlug }: Props) {
  const [tab, setTab] = useState<'password' | 'magic-link'>('password')

  return (
    <>
      <nav
        style={{
          display: 'flex',
          gap: 'var(--ev-space-2)',
          marginBottom: 'var(--ev-space-md)',
          borderBottom: '1px solid var(--ev-border)',
        }}
      >
        <button
          type="button"
          onClick={() => setTab('password')}
          className="ev-btn ev-btn-ghost"
          style={{
            fontWeight: tab === 'password' ? 600 : 400,
            borderBottom:
              tab === 'password' ? '2px solid var(--ev-primary)' : '2px solid transparent',
            borderRadius: 0,
            paddingBottom: 'var(--ev-space-2)',
          }}
        >
          Senha
        </button>
        <button
          type="button"
          onClick={() => setTab('magic-link')}
          className="ev-btn ev-btn-ghost"
          style={{
            fontWeight: tab === 'magic-link' ? 600 : 400,
            borderBottom:
              tab === 'magic-link' ? '2px solid var(--ev-primary)' : '2px solid transparent',
            borderRadius: 0,
            paddingBottom: 'var(--ev-space-2)',
          }}
        >
          Link mágico (email)
        </button>
      </nav>

      {tab === 'password' ? <PasswordLoginForm /> : <MagicLinkForm tenantSlug={tenantSlug} />}
    </>
  )
}
