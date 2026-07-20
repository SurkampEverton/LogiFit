'use client'

import { confirm } from '@repo/ui/messages'
/**
 * /meu/perfil — regenerar recovery codes (Sprint 02b4 — passport_global).
 *
 * Botão único. Ao clicar, confirma + chama `regenerateRecoveryCodes` SA
 * (requireMfa) + exibe codes plain inline (única chance — paciente salva).
 */
import { useState, useTransition } from 'react'
import { regenerateRecoveryCodes } from './passport-actions'

export function RegenerateRecoveryCodesButton() {
  const [pending, startTransition] = useTransition()
  const [codes, setCodes] = useState<string[]>([])
  const [err, setErr] = useState<string | null>(null)

  async function handleClick() {
    setErr(null)
    const ok = await confirm({
      title: 'Gerar novos códigos de recuperação?',
      body: 'Os 10 códigos atuais serão invalidados. Salve os novos imediatamente — não conseguiremos mostrar de novo.',
      confirmLabel: 'Gerar novos',
      danger: true,
    })
    if (!ok) return
    startTransition(async () => {
      try {
        const r = (await regenerateRecoveryCodes()) as
          | { ok: true; recoveryCodes: string[]; note?: string }
          | { ok: false; error?: { code?: string; message?: string } }
        if ('ok' in r && !r.ok) {
          if (r.error?.code === 'MFA_RECENT_REQUIRED') {
            setErr('Verificação MFA expirou (>15min) — faça login de novo pra regenerar códigos')
            return
          }
          setErr(r.error?.message ?? 'Falha ao regenerar códigos')
          return
        }
        setCodes(r.recoveryCodes)
      } catch (e) {
        const code = (e as { code?: string }).code
        if (code === 'MFA_RECENT_REQUIRED') {
          setErr('Verificação MFA expirou (>15min) — faça login de novo')
          return
        }
        setErr(e instanceof Error ? e.message : 'Erro inesperado')
      }
    })
  }

  function copyAll() {
    void navigator.clipboard?.writeText(codes.join('\n'))
  }

  if (codes.length > 0) {
    return (
      <div
        style={{
          padding: 'var(--ev-space-md)',
          background: 'var(--ev-warning-soft, var(--ev-surface-muted))',
          borderLeft: '4px solid var(--ev-warning)',
          borderRadius: 'var(--ev-radius-sm)',
        }}
      >
        <h3 style={{ marginTop: 0 }}>⚠ Novos códigos de recuperação</h3>
        <p style={{ fontSize: 'var(--ev-text-sm)' }}>
          Cada código só funciona <strong>uma vez</strong>. Códigos antigos foram invalidados. Salve
          agora — não conseguiremos mostrar de novo.
        </p>
        <pre
          style={{
            fontFamily: 'monospace',
            fontSize: 'var(--ev-text-sm)',
            padding: 'var(--ev-space-2)',
            background: 'var(--ev-surface)',
            borderRadius: 'var(--ev-radius-sm)',
            overflow: 'auto',
          }}
        >
          {codes.join('\n')}
        </pre>
        <button
          type="button"
          onClick={copyAll}
          className="ev-portal-button ev-portal-button--ghost"
          style={{ marginTop: 'var(--ev-space-2)' }}
        >
          Copiar todos
        </button>
        <button
          type="button"
          onClick={() => setCodes([])}
          className="ev-portal-button"
          style={{ marginTop: 'var(--ev-space-2)', marginLeft: 'var(--ev-space-2)' }}
        >
          Já salvei
        </button>
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="ev-portal-button ev-portal-button--ghost"
      >
        {pending ? 'Gerando...' : 'Regenerar códigos de recuperação'}
      </button>
      {err ? (
        <p style={{ color: 'var(--ev-danger)', fontSize: 'var(--ev-text-sm)' }}>{err}</p>
      ) : null}
    </>
  )
}
