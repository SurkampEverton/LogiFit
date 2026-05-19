'use client'

/**
 * Form 2-step cadastro proativo (Sprint 02b backbone — Path B).
 *
 * Step 1: phone + Turnstile → requestSmsCode (mock dev/Twilio prod)
 * Step 2: code + dados completos → verifySmsCode + signupPatient (STUB MVP)
 *
 * **Turnstile widget**: em dev usa token mock estático; em prod renderiza
 * o widget Cloudflare via `<script>` carregado no client (Sprint 02b2).
 *
 * **Dev mode**: requestSmsCode retorna `devOnlyCode` quando provider=mock —
 * banner mostra código direto pro dev testar sem SMS real.
 */
import { useState, useTransition } from 'react'
import { confirm } from '@repo/ui/messages'
import { requestSmsCode, signupPatient, verifySmsCode } from './actions'

interface Props {
  inviteToken: string | null
}

type Step = 'phone' | 'verify' | 'details' | 'done'

export function CadastroForm({ inviteToken }: Props) {
  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('+55')
  const [otpId, setOtpId] = useState<string | null>(null)
  const [devCode, setDevCode] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [cpf, setCpf] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false)
  const [enableMfa, setEnableMfa] = useState(false)
  const [pending, startTransition] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  const [stubResult, setStubResult] = useState<string | null>(null)
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [linkedTenants, setLinkedTenants] = useState<
    Array<{ tenantId: string; linkId: string; tenantName: string }>
  >([])

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setDevCode(null)
    startTransition(async () => {
      try {
        // Mock Turnstile token em dev — Sprint 02b2 substitui por widget real
        const captchaToken = 'mock-turnstile-token-dev'
        const r = (await requestSmsCode({ phone, captchaToken })) as {
          ok: true
          sent: boolean
          otpId: string
          devOnlyCode?: string
        }
        if (!r.sent) {
          setErr('Não foi possível enviar o código. Tente novamente.')
          return
        }
        setOtpId(r.otpId)
        if (r.devOnlyCode) setDevCode(r.devOnlyCode)
        setStep('verify')
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erro inesperado')
      }
    })
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    startTransition(async () => {
      try {
        await verifySmsCode({ phone, code })
        setStep('details')
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Código inválido')
      }
    })
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    setStubResult(null)
    if (!otpId) {
      setErr('OTP não verificado')
      return
    }
    if (!acceptedTerms || !acceptedPrivacy) {
      setErr('Aceite Termos e Política de Privacidade pra continuar')
      return
    }
    const ok = await confirm({
      title: 'Confirmar cadastro?',
      body: `Vamos criar sua conta LogiFit com o telefone ${phone} e email ${email}. Você poderá depois vincular a empresas parceiras quando autorizar.`,
      confirmLabel: 'Criar conta',
    })
    if (!ok) return
    startTransition(async () => {
      try {
        const r = (await signupPatient({
          name,
          cpf: cpf.replace(/\D/g, ''),
          phone,
          email,
          password,
          smsOtpId: otpId,
          acceptedTerms: true,
          acceptedPrivacy: true,
          enableMfa,
          locale: 'pt-BR',
          // Path A+B híbrido: passa token quando paciente veio de /i/[token]
          inviteToken: inviteToken ?? null,
        })) as
          | {
              ok: true
              passportGlobalId: string
              recoveryCodes: string[] | null
              linkedTenants: Array<{ tenantId: string; linkId: string; tenantName: string }>
              redirectUrl: string
              note?: string
            }
          | { ok: false; code: string; message: string }
        if (!r.ok) {
          // Erro de validação ou conflict — mostra warning
          setStubResult(`${r.code}: ${r.message}`)
          return
        }
        if (r.recoveryCodes) setRecoveryCodes(r.recoveryCodes)
        if (r.linkedTenants && r.linkedTenants.length > 0) {
          setLinkedTenants(r.linkedTenants)
        }
        setStep('done')
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erro inesperado')
      }
    })
  }

  if (step === 'phone') {
    return (
      <form onSubmit={handleRequestOtp} className="ev-portal-form">
        <label className="ev-portal-label" htmlFor="phone">
          Seu telefone celular (com DDD)
        </label>
        <input
          id="phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+5511999999999"
          pattern="\+[1-9][0-9]{6,14}"
          className="ev-portal-input"
          required
          disabled={pending}
        />
        <p className="ev-portal-muted" style={{ fontSize: 'var(--ev-text-xs)' }}>
          Você receberá um código de 6 dígitos por SMS. Válido por 5 minutos.
        </p>

        {/* Turnstile widget placeholder — Sprint 02b2 carrega script real */}
        <div
          style={{
            padding: 'var(--ev-space-2)',
            background: 'var(--ev-surface-muted)',
            borderRadius: 'var(--ev-radius-sm)',
            fontSize: 'var(--ev-text-xs)',
            color: 'var(--ev-text-muted)',
          }}
        >
          🤖 Captcha Turnstile — Sprint 02b2 carrega widget real (mock em dev)
        </div>

        {err ? (
          <p style={{ color: 'var(--ev-danger)', fontSize: 'var(--ev-text-sm)' }}>{err}</p>
        ) : null}

        <button type="submit" disabled={pending} className="ev-portal-button">
          {pending ? 'Enviando...' : 'Enviar código por SMS'}
        </button>
      </form>
    )
  }

  if (step === 'verify') {
    return (
      <form onSubmit={handleVerifyOtp} className="ev-portal-form">
        <p className="ev-portal-muted" style={{ fontSize: 'var(--ev-text-sm)' }}>
          Digite o código enviado para <strong>{phone}</strong>.
        </p>

        {devCode ? (
          <div
            style={{
              padding: 'var(--ev-space-2)',
              background: 'var(--ev-warning-soft, var(--ev-surface-muted))',
              borderLeft: '3px solid var(--ev-warning)',
              borderRadius: 'var(--ev-radius-sm)',
              fontSize: 'var(--ev-text-xs)',
            }}
          >
            <strong>🛠 Modo dev:</strong> SMS provider em mock — código:{' '}
            <code style={{ fontSize: 'var(--ev-text-sm)' }}>{devCode}</code>
          </div>
        ) : null}

        <label className="ev-portal-label" htmlFor="code">
          Código (6 dígitos)
        </label>
        <input
          id="code"
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          className="ev-portal-input"
          required
          disabled={pending}
          autoFocus
        />

        {err ? (
          <p style={{ color: 'var(--ev-danger)', fontSize: 'var(--ev-text-sm)' }}>{err}</p>
        ) : null}

        <button type="submit" disabled={pending || code.length !== 6} className="ev-portal-button">
          {pending ? 'Verificando...' : 'Verificar código'}
        </button>
        <button
          type="button"
          onClick={() => setStep('phone')}
          disabled={pending}
          className="ev-portal-button ev-portal-button--ghost"
        >
          ← Voltar
        </button>
      </form>
    )
  }

  if (step === 'details') {
    return (
      <form onSubmit={handleSignup} className="ev-portal-form">
        <p
          className="ev-portal-muted"
          style={{ fontSize: 'var(--ev-text-sm)', marginBottom: 'var(--ev-space-md)' }}
        >
          ✓ Telefone verificado: <strong>{phone}</strong>
        </p>

        <label className="ev-portal-label" htmlFor="name">
          Nome completo
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          minLength={2}
          maxLength={120}
          className="ev-portal-input"
          required
          disabled={pending}
        />

        <label className="ev-portal-label" htmlFor="cpf">
          CPF
        </label>
        <input
          id="cpf"
          type="text"
          value={cpf}
          onChange={(e) => setCpf(e.target.value)}
          placeholder="000.000.000-00"
          minLength={11}
          maxLength={14}
          className="ev-portal-input"
          required
          disabled={pending}
        />

        <label className="ev-portal-label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          maxLength={255}
          className="ev-portal-input"
          required
          disabled={pending}
        />

        <label className="ev-portal-label" htmlFor="password">
          Senha (mín 8 caracteres)
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          maxLength={128}
          className="ev-portal-input"
          required
          disabled={pending}
        />

        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 'var(--ev-space-2)',
            fontSize: 'var(--ev-text-sm)',
          }}
        >
          <input
            type="checkbox"
            checked={enableMfa}
            onChange={(e) => setEnableMfa(e.target.checked)}
            disabled={pending}
          />
          <span>Ativar autenticação em 2 fatores (TOTP) — recomendado</span>
        </label>

        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 'var(--ev-space-2)',
            fontSize: 'var(--ev-text-sm)',
          }}
        >
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            disabled={pending}
            required
          />
          <span>Li e aceito os Termos de Uso</span>
        </label>

        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 'var(--ev-space-2)',
            fontSize: 'var(--ev-text-sm)',
          }}
        >
          <input
            type="checkbox"
            checked={acceptedPrivacy}
            onChange={(e) => setAcceptedPrivacy(e.target.checked)}
            disabled={pending}
            required
          />
          <span>Li e aceito a Política de Privacidade (LGPD)</span>
        </label>

        {err ? (
          <p style={{ color: 'var(--ev-danger)', fontSize: 'var(--ev-text-sm)' }}>{err}</p>
        ) : null}

        {stubResult ? (
          <div
            style={{
              padding: 'var(--ev-space-2)',
              background: 'var(--ev-warning-soft, var(--ev-surface-muted))',
              borderLeft: '3px solid var(--ev-warning)',
              borderRadius: 'var(--ev-radius-sm)',
              fontSize: 'var(--ev-text-xs)',
            }}
          >
            <strong>🚧 Sprint 02b backbone:</strong> {stubResult}
            <br />
            Validação completa rodou (Turnstile + OTP). Persistência final pendente.
          </div>
        ) : null}

        <button
          type="submit"
          disabled={pending || !acceptedTerms || !acceptedPrivacy}
          className="ev-portal-button"
        >
          {pending ? 'Criando conta...' : 'Criar minha conta'}
        </button>
      </form>
    )
  }

  // step === 'done' — signup criou identity global (Sprint 02b2)
  return (
    <section className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
      <h2>✓ Conta criada!</h2>
      <p className="ev-portal-muted" style={{ fontSize: 'var(--ev-text-sm)' }}>
        Sua identidade global no LogiFit foi criada. Sprint 02b3 ativa o login em
        <code>/meu/login</code> resolvendo passport_global_identity_id.
      </p>

      {linkedTenants.length > 0 ? (
        <div
          style={{
            marginTop: 'var(--ev-space-md)',
            padding: 'var(--ev-space-md)',
            background: 'var(--ev-success-soft, var(--ev-surface-muted))',
            borderLeft: '4px solid var(--ev-success)',
            borderRadius: 'var(--ev-radius-sm)',
          }}
        >
          <h3 style={{ marginTop: 0 }}>🔗 Convite aceito automaticamente</h3>
          <p style={{ fontSize: 'var(--ev-text-sm)' }}>
            Path A+B híbrido detectou seu invite e vinculou sua conta a:
          </p>
          <ul style={{ marginTop: 'var(--ev-space-2)' }}>
            {linkedTenants.map((t) => (
              <li key={t.linkId}>
                <strong>{t.tenantName}</strong>{' '}
                <code style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
                  ({t.linkId.slice(0, 8)}…)
                </code>
              </li>
            ))}
          </ul>
          <p style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
            Após login, gerencie compartilhamento em <code>/meu/privacidade</code>.
          </p>
        </div>
      ) : null}

      {recoveryCodes && recoveryCodes.length > 0 ? (
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
            Você ativou MFA. Estes são os <strong>10 códigos one-time</strong> pra recuperar a
            conta se perder o celular. <strong>Cada código só funciona uma vez.</strong> Salve
            agora — não conseguiremos mostrá-los de novo.
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
        </div>
      ) : null}

      <p style={{ marginTop: 'var(--ev-space-md)', fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
        Próximo passo (Sprint 02b3): enviar email de confirmação + ativar /meu/login + wizard MFA TOTP.
      </p>
    </section>
  )
}
