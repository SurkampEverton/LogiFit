/**
 * Templates de email — Confirmação de email pós-signup (Sprint 02b4 fechamento +
 * Sprint 02b8 botão WhatsApp).
 *
 * **Importante:** cores hardcoded inline (clients de email não suportam CSS
 * custom properties) — exceção lint-custom `EMAIL_TEMPLATES_PATH`.
 *
 * **Botão WhatsApp (Sprint 02b8):** abaixo do CTA principal "Confirmar email",
 * o template oferece "Falar com a LogiFit no WhatsApp" — paciente sem invite
 * pode pedir vínculo manual com uma clínica via canal humano. Substitui Twilio
 * SMS no MVP early-stage (Twilio cobra R$ 5-7/mês + R$ 0,30 por SMS).
 *
 * Configuração via env var `NEXT_PUBLIC_LOGIFIT_WHATSAPP_NUMBER` (formato E.164
 * sem `+` nem espaços, ex: `5511999999999`). Se ausente, botão WhatsApp omitido.
 *
 * Sprint dedicado futuro migra pra `packages/email/templates/*.tsx` com
 * `@react-email/components` (DX + i18n + componentes reusáveis; mesma
 * limitação técnica — compila pra inline HTML).
 */

export interface EmailVerificationTemplateInput {
  /** Nome amigável do paciente (display name). */
  patientName: string
  /** URL completa de confirmação com token. */
  verifyUrl: string
}

/** Número WhatsApp da LogiFit (E.164 sem `+`). Configurável via env. */
function getLogifitWhatsappNumber(): string | null {
  const num = process.env.NEXT_PUBLIC_LOGIFIT_WHATSAPP_NUMBER
  if (!num || num.trim() === '') return null
  return num.replace(/\D/g, '')
}

/** Constrói URL `wa.me/<numero>?text=<msg pré-formatada>`. */
function buildWhatsappUrl(input: EmailVerificationTemplateInput): string | null {
  const num = getLogifitWhatsappNumber()
  if (!num) return null
  const msg = encodeURIComponent(
    `Olá! Sou ${input.patientName} e acabei de criar minha conta no LogiFit. Gostaria de me vincular a uma clínica/academia.`,
  )
  return `https://wa.me/${num}?text=${msg}`
}

export function renderEmailVerificationHtml(
  input: EmailVerificationTemplateInput,
): string {
  const name = escapeHtml(input.patientName.split(' ')[0] ?? input.patientName)
  const whatsappUrl = buildWhatsappUrl(input)

  const whatsappButtonHtml = whatsappUrl
    ? `<p style="margin: 16px 0;">
    <a href="${whatsappUrl}" style="background:#25D366;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;font-size:14px;">💬 Falar com a LogiFit no WhatsApp</a>
  </p>
  <p style="color:#666;font-size:13px;">Quer se vincular a uma clínica ou academia? Fale com a gente — ajudamos a configurar.</p>`
    : ''

  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"></head>
<body style="font-family: system-ui, sans-serif; max-width: 560px; margin: 32px auto; color: #1a1a1a;">
  <h1 style="font-size: 20px;">Olá, ${name}!</h1>
  <p>Bem-vindo ao LogiFit. Pra completar seu cadastro, <strong>confirme seu email</strong>:</p>
  <p style="margin: 24px 0;">
    <a href="${input.verifyUrl}" style="background:#2563eb;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">Confirmar meu email</a>
  </p>
  <p style="color:#666;font-size:14px;">Este link expira em <strong>24 horas</strong>. Se você não criou esta conta, ignore — sua conta não é ativada sem o clique.</p>
  ${whatsappButtonHtml ? '<hr style="border:none;border-top:1px solid #eee;margin:24px 0;">' : ''}
  ${whatsappButtonHtml}
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <p style="color:#999;font-size:12px;">LogiFit — operador da plataforma. Dúvidas sobre privacidade: <a href="mailto:privacidade@logifit.com.br" style="color:#666;">privacidade@logifit.com.br</a></p>
</body>
</html>`
}

export function renderEmailVerificationText(
  input: EmailVerificationTemplateInput,
): string {
  const whatsappUrl = buildWhatsappUrl(input)
  const whatsappBlock = whatsappUrl
    ? `

Quer se vincular a uma clínica ou academia? Fale com a LogiFit no WhatsApp:
${whatsappUrl}
`
    : ''

  return `Olá, ${input.patientName}!

Bem-vindo ao LogiFit. Pra completar seu cadastro, confirme seu email:

${input.verifyUrl}

Este link expira em 24 horas. Se você não criou esta conta, ignore — sua conta não é ativada sem o clique.${whatsappBlock}

LogiFit — operador da plataforma
Dúvidas sobre privacidade: privacidade@logifit.com.br`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
