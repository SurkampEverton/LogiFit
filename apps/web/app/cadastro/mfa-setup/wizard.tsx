'use client'

/**
 * MFA TOTP setup wizard — 3 steps (Sprint 02b3 ADR 0094).
 *
 * Step 1 "init": clica botão "Começar setup" → enrollTotp gera secret + URI
 * Step 2 "scan": mostra QR code (placeholder texto) + secret manual + input código
 *   - Sub-step "verify": confirmTotp valida + retorna recovery codes
 * Step 3 "done": mostra recovery codes + redirect /meu
 *
 * Sprint 02b4 pode adicionar render QR real via lib client-side (qrcode.js
 * standalone ~10KB) — atualmente mostra URI como texto pra cópia manual.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { confirm } from '@repo/ui/messages'
import { cancelTotpEnroll, confirmTotp, enrollTotp } from './actions'

type Step = 'init' | 'scan' | 'done'

export function MfaSetupWizard() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('init')
  const [secret, setSecret] = useState('')
  const [uri, setUri] = useState('')
  const [code, setCode] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function handleStart() {
    setErr(null)
    startTransition(async () => {
      try {
        const r = (await enrollTotp()) as
          | { ok: true; secret: string; uri: string; note?: string }
          | { ok: false; error?: { message?: string } }
        if ('ok' in r && !r.ok) {
          setErr(r.error?.message ?? 'Falha ao iniciar setup')
          return
        }
        setSecret(r.secret)
        setUri(r.uri)
        setStep('scan')
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erro inesperado')
      }
    })
  }

  function handleConfirm(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    startTransition(async () => {
      try {
        const r = (await confirmTotp({ code })) as
          | { ok: true; recoveryCodes: string[]; note?: string }
          | { ok: false; error?: { message?: string } }
        if ('ok' in r && !r.ok) {
          setErr(r.error?.message ?? 'Código TOTP inválido')
          return
        }
        setRecoveryCodes(r.recoveryCodes)
        setStep('done')
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erro inesperado')
      }
    })
  }

  async function handleCancel() {
    const ok = await confirm({
      title: 'Cancelar setup MFA?',
      body: 'Você pode ativar autenticação em 2 fatores depois em /meu/perfil/mfa. Sem MFA, ações sensíveis (trocar senha, exportar dados) podem exigir verificação adicional.',
      confirmLabel: 'Sim, cancelar',
      cancelLabel: 'Continuar setup',
      danger: true,
    })
    if (!ok) return
    startTransition(async () => {
      try {
        await cancelTotpEnroll()
        router.push('/meu')
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erro ao cancelar')
      }
    })
  }

  if (step === 'init') {
    return (
      <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <h2 style={{ marginTop: 0 }}>Por que ativar MFA?</h2>
        <ul style={{ fontSize: 'var(--ev-text-sm)' }}>
          <li>Protege contra acesso não-autorizado se sua senha vazar</li>
          <li>Exigido pra ações sensíveis (trocar senha/email, exportar dados LGPD)</li>
          <li>Você recebe 10 códigos de recuperação caso perca o celular</li>
        </ul>

        {err ? (
          <p style={{ color: 'var(--ev-danger)', fontSize: 'var(--ev-text-sm)' }}>{err}</p>
        ) : null}

        <div style={{ display: 'flex', gap: 'var(--ev-space-2)', marginTop: 'var(--ev-space-md)' }}>
          <button
            type="button"
            onClick={handleStart}
            disabled={pending}
            className="ev-portal-button"
          >
            {pending ? 'Gerando...' : 'Começar setup'}
          </button>
          <button
            type="button"
            onClick={() => router.push('/meu')}
            disabled={pending}
            className="ev-portal-button ev-portal-button--ghost"
          >
            Pular por agora
          </button>
        </div>
      </section>
    )
  }

  if (step === 'scan') {
    return (
      <form onSubmit={handleConfirm} className="ev-portal-form">
        <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <h2 style={{ marginTop: 0 }}>1. Adicione no seu app authenticator</h2>
          <p style={{ fontSize: 'var(--ev-text-sm)' }}>
            Abra Google Authenticator (ou Authy, 1Password, etc) e adicione uma nova conta.
          </p>

          <div
            style={{
              marginTop: 'var(--ev-space-md)',
              padding: 'var(--ev-space-md)',
              background: 'var(--ev-surface-muted)',
              borderRadius: 'var(--ev-radius-sm)',
            }}
          >
            <p style={{ marginTop: 0, fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
              📱 Opção 1 — Escaneie o QR code do URI abaixo (use um gerador QR ou app que
              aceite otpauth://):
            </p>
            <pre
              style={{
                fontFamily: 'monospace',
                fontSize: 'var(--ev-text-xs)',
                padding: 'var(--ev-space-2)',
                background: 'var(--ev-surface)',
                borderRadius: 'var(--ev-radius-sm)',
                overflow: 'auto',
                wordBreak: 'break-all',
                whiteSpace: 'pre-wrap',
              }}
            >
              {uri}
            </pre>
            <p style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)', marginTop: 'var(--ev-space-md)' }}>
              ⌨️ Opção 2 — Digite o secret manualmente no app:
            </p>
            <pre
              style={{
                fontFamily: 'monospace',
                fontSize: 'var(--ev-text-sm)',
                padding: 'var(--ev-space-2)',
                background: 'var(--ev-surface)',
                borderRadius: 'var(--ev-radius-sm)',
                letterSpacing: '0.1em',
              }}
            >
              {secret.match(/.{1,4}/g)?.join(' ')}
            </pre>
            <p style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
              🛠 Sprint 02b4 renderiza QR code visual (lib qrcode.js). Por enquanto: copie o
              URI/secret pra app que aceite manual entry.
            </p>
          </div>
        </section>

        <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <h2 style={{ marginTop: 0 }}>2. Digite o código do app</h2>
          <p style={{ fontSize: 'var(--ev-text-sm)', color: 'var(--ev-text-muted)' }}>
            Seu app mostra um código de 6 dígitos que muda a cada 30 segundos.
          </p>

          <label className="ev-portal-label" htmlFor="totp-code">
            Código TOTP
          </label>
          <input
            id="totp-code"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            className="ev-portal-input"
            required
            autoFocus
          />

          {err ? (
            <p style={{ color: 'var(--ev-danger)', fontSize: 'var(--ev-text-sm)' }}>{err}</p>
          ) : null}

          <div style={{ display: 'flex', gap: 'var(--ev-space-2)', marginTop: 'var(--ev-space-md)' }}>
            <button
              type="submit"
              disabled={pending || code.length !== 6}
              className="ev-portal-button"
            >
              {pending ? 'Verificando...' : 'Ativar MFA'}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={pending}
              className="ev-portal-button ev-portal-button--ghost"
            >
              Cancelar
            </button>
          </div>
        </section>
      </form>
    )
  }

  // step === 'done'
  return (
    <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
      <h2 style={{ marginTop: 0 }}>✓ MFA ativado!</h2>
      <p style={{ fontSize: 'var(--ev-text-sm)' }}>
        Agora seu login pedirá o código de 6 dígitos do app authenticator.
      </p>

      <div
        style={{
          marginTop: 'var(--ev-space-md)',
          padding: 'var(--ev-space-md)',
          background: 'var(--ev-warning-soft, var(--ev-surface-muted))',
          borderLeft: '4px solid var(--ev-warning)',
          borderRadius: 'var(--ev-radius-sm)',
        }}
      >
        <h3 style={{ marginTop: 0 }}>⚠ Salve seus códigos de recuperação</h3>
        <p style={{ fontSize: 'var(--ev-text-sm)' }}>
          Cada código só funciona <strong>uma vez</strong>. Use se perder o celular —
          sem eles, recuperar a conta exige verificação manual com o suporte LogiFit.
          <br />
          <strong>Salve agora — não conseguiremos mostrá-los de novo.</strong>
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
          {recoveryCodes.join('\n')}
        </pre>
        <button
          type="button"
          onClick={() => {
            const text = recoveryCodes.join('\n')
            void navigator.clipboard?.writeText(text)
          }}
          className="ev-portal-button ev-portal-button--ghost"
          style={{ marginTop: 'var(--ev-space-2)' }}
        >
          Copiar todos
        </button>
      </div>

      <div style={{ marginTop: 'var(--ev-space-md)' }}>
        <button
          type="button"
          onClick={() => router.push('/meu')}
          className="ev-portal-button"
        >
          Salvei → ir para minha conta
        </button>
      </div>
    </section>
  )
}
