/**
 * Templates de email — change_email flow (Sprint 02b5).
 *
 * 2 emails enviados na troca de email do paciente:
 *
 * 1. **Confirmação** (pro email NOVO) — paciente clica pra ativar troca
 * 2. **Notificação** (pro email ANTIGO) — alerta de segurança "email
 *    foi alterado pra X; se não foi você, contate suporte"
 *
 * Cores hardcoded inline (clients de email não suportam CSS var) —
 * exceção lint EMAIL_TEMPLATES_PATH.
 */

export interface EmailChangeConfirmationInput {
  patientName: string
  newEmail: string
  confirmUrl: string
}

export function renderEmailChangeConfirmationHtml(input: EmailChangeConfirmationInput): string {
  const name = escapeHtml(input.patientName.split(' ')[0] ?? input.patientName)
  const newEmail = escapeHtml(input.newEmail)
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"></head>
<body style="font-family: system-ui, sans-serif; max-width: 560px; margin: 32px auto; color: #1a1a1a;">
  <h1 style="font-size: 20px;">Confirme seu novo email</h1>
  <p>Olá, ${name}! Você solicitou trocar o email da sua conta LogiFit pra <strong>${newEmail}</strong>.</p>
  <p style="margin: 24px 0;">
    <a href="${input.confirmUrl}" style="background:#2563eb;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">Confirmar troca de email</a>
  </p>
  <p style="color:#666;font-size:14px;">Este link expira em <strong>24 horas</strong>. Se você não solicitou esta troca, ignore — o email atual da sua conta continua válido.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <p style="color:#999;font-size:12px;">LogiFit — operador da plataforma. Dúvidas sobre privacidade: <a href="mailto:privacidade@logifit.com.br" style="color:#666;">privacidade@logifit.com.br</a></p>
</body>
</html>`
}

export function renderEmailChangeConfirmationText(input: EmailChangeConfirmationInput): string {
  return `Olá, ${input.patientName}!

Você solicitou trocar o email da sua conta LogiFit pra ${input.newEmail}.

Clique pra confirmar:
${input.confirmUrl}

Este link expira em 24 horas. Se você não solicitou esta troca, ignore — o email atual da sua conta continua válido.

LogiFit — operador da plataforma
Dúvidas sobre privacidade: privacidade@logifit.com.br`
}

// ─── Notification ao email ANTIGO ────────────────────────────────────────

export interface EmailChangeNotificationInput {
  patientName: string
  newEmail: string
}

export function renderEmailChangeNotificationHtml(input: EmailChangeNotificationInput): string {
  const name = escapeHtml(input.patientName.split(' ')[0] ?? input.patientName)
  const newEmail = escapeHtml(input.newEmail)
  // Mascara o new_email pra preservar privacidade caso este email seja
  // compartilhado: u***@example.com em vez do email completo
  const masked = maskEmail(newEmail)
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"></head>
<body style="font-family: system-ui, sans-serif; max-width: 560px; margin: 32px auto; color: #1a1a1a;">
  <h1 style="font-size: 20px;">⚠ Email da sua conta foi alterado</h1>
  <p>Olá, ${name}! Avisamos que o email da sua conta LogiFit foi <strong>alterado</strong> para <strong>${masked}</strong>.</p>
  <p style="color:#666;font-size:14px;">Próximos emails serão enviados pro novo endereço. Este email atual não receberá mais mensagens sobre sua conta.</p>
  <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:4px;margin:24px 0;">
    <p style="margin:0;color:#1a1a1a;font-size:14px;">
      <strong>Não foi você?</strong> Entre em contato imediatamente:
      <a href="mailto:privacidade@logifit.com.br" style="color:#2563eb;">privacidade@logifit.com.br</a>
    </p>
  </div>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <p style="color:#999;font-size:12px;">LogiFit — operador da plataforma. Dúvidas sobre privacidade: <a href="mailto:privacidade@logifit.com.br" style="color:#666;">privacidade@logifit.com.br</a></p>
</body>
</html>`
}

export function renderEmailChangeNotificationText(input: EmailChangeNotificationInput): string {
  const masked = maskEmail(input.newEmail)
  return `⚠ Email da sua conta foi alterado

Olá, ${input.patientName}!

Avisamos que o email da sua conta LogiFit foi alterado para ${masked}.

Próximos emails serão enviados pro novo endereço. Este email atual não receberá mais mensagens sobre sua conta.

⚠ Não foi você? Entre em contato imediatamente:
privacidade@logifit.com.br

LogiFit — operador da plataforma`
}

/**
 * Mascara email pra preservar privacidade. `joao.silva@example.com` → `j***@example.com`.
 */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return email
  const first = local[0] ?? '*'
  return `${first}***@${domain}`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
