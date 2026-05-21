/**
 * Templates de email — Invite de passaporte cross-tenant (Sprint 02b8).
 *
 * Empresa (clínica/academia) envia convite pra paciente vincular-se aos
 * módulos clínicos da empresa. Email tem 2 CTAs:
 *
 *   1. **Aceitar invite** (azul, primário) — leva pra `/i/<token>`
 *   2. **Falar com a clínica no WhatsApp** (verde, secundário) — abre
 *      `wa.me/<tenant-whatsapp>` se a empresa configurou seu próprio
 *      WhatsApp em `tenant_branding` (Sprint 02b8 expansion)
 *
 * **Sender** (ADR 0097 categoria 'tenant'): `from: "<tenant.name> via LogiFit"
 * <no-reply@logifit.com.br>`, `Reply-To: tenant.contact_email`. Sprint 02b9+
 * com domínio próprio do tenant verificado vira `from: <invite@clinica.com.br>`.
 *
 * Cores hardcoded inline — clients de email não suportam CSS var. Exceção
 * lint EMAIL_TEMPLATES_PATH.
 */

export interface PassportInviteTemplateInput {
  /** Nome amigável do paciente (display name de persons.name). */
  patientName: string
  /** Nome da clínica/academia que está enviando o invite (tenants.name). */
  tenantName: string
  /** Módulos clínicos solicitados (ex: ['fisioterapia', 'nutricao']). */
  modules: string[]
  /** URL completa de aceite (ex: https://app.logifit.com.br/i/<token>). */
  inviteUrl: string
  /** Telefone WhatsApp da clínica em formato E.164 sem `+` (ex: '5511987654321'). Opcional. */
  tenantWhatsapp?: string | null
}

const MODULE_LABELS: Record<string, string> = {
  academia: 'Academia',
  personal_training: 'Personal Training',
  fisioterapia: 'Fisioterapia',
  nutricao: 'Nutrição',
  pilates: 'Pilates',
}

function labelModules(modules: string[]): string {
  if (modules.length === 0) return 'nossos serviços'
  const labels = modules.map((m) => MODULE_LABELS[m] ?? m)
  if (labels.length === 1) return labels[0]!
  if (labels.length === 2) return `${labels[0]} e ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')} e ${labels.at(-1)}`
}

function buildTenantWhatsappUrl(input: PassportInviteTemplateInput): string | null {
  const num = input.tenantWhatsapp?.replace(/\D/g, '')
  if (!num) return null
  const msg = encodeURIComponent(
    `Olá! Sou ${input.patientName}, recebi um convite da ${input.tenantName} no LogiFit. Gostaria de tirar uma dúvida antes de aceitar.`,
  )
  return `https://wa.me/${num}?text=${msg}`
}

export function renderPassportInviteHtml(input: PassportInviteTemplateInput): string {
  const name = escapeHtml(input.patientName.split(' ')[0] ?? input.patientName)
  const tenant = escapeHtml(input.tenantName)
  const modulesText = escapeHtml(labelModules(input.modules))
  const whatsappUrl = buildTenantWhatsappUrl(input)

  const whatsappBlockHtml = whatsappUrl
    ? `<p style="margin: 16px 0;">
    <a href="${whatsappUrl}" style="background:#25D366;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;font-size:14px;">💬 Falar com ${tenant} no WhatsApp</a>
  </p>
  <p style="color:#666;font-size:13px;">Quer tirar dúvidas antes de aceitar? Fale direto com a clínica no WhatsApp.</p>`
    : ''

  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"></head>
<body style="font-family: system-ui, sans-serif; max-width: 560px; margin: 32px auto; color: #1a1a1a;">
  <h1 style="font-size: 20px;">Olá, ${name}!</h1>
  <p><strong>${tenant}</strong> te convidou pra vincular sua conta LogiFit pra <strong>${modulesText}</strong>.</p>
  <p style="color:#444;font-size:14px;">Ao aceitar, a clínica passa a ver seus dados clínicos dos módulos autorizados. Você pode revisar quais dados libera, módulo a módulo, ANTES de aceitar.</p>
  <p style="margin: 24px 0;">
    <a href="${input.inviteUrl}" style="background:#2563eb;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">Revisar e aceitar convite</a>
  </p>
  <p style="color:#666;font-size:14px;">Se você não conhece a <strong>${tenant}</strong> ou não pediu este convite, ignore — sem clique, nada é compartilhado.</p>
  ${whatsappBlockHtml ? '<hr style="border:none;border-top:1px solid #eee;margin:24px 0;">' : ''}
  ${whatsappBlockHtml}
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <p style="color:#999;font-size:12px;">LogiFit — plataforma operadora. <strong>${tenant}</strong> é controlador dos dados clínicos vinculados. Dúvidas: <a href="mailto:privacidade@logifit.com.br" style="color:#666;">privacidade@logifit.com.br</a></p>
</body>
</html>`
}

export function renderPassportInviteText(input: PassportInviteTemplateInput): string {
  const modulesText = labelModules(input.modules)
  const whatsappUrl = buildTenantWhatsappUrl(input)
  const whatsappBlock = whatsappUrl
    ? `

Quer tirar dúvidas antes de aceitar? Fale com ${input.tenantName} no WhatsApp:
${whatsappUrl}
`
    : ''

  return `Olá, ${input.patientName}!

${input.tenantName} te convidou pra vincular sua conta LogiFit pra ${modulesText}.

Ao aceitar, a clínica passa a ver seus dados clínicos dos módulos autorizados. Você pode revisar quais dados libera, módulo a módulo, ANTES de aceitar.

Revisar e aceitar convite:
${input.inviteUrl}

Se você não conhece a ${input.tenantName} ou não pediu este convite, ignore — sem clique, nada é compartilhado.${whatsappBlock}

LogiFit — plataforma operadora. ${input.tenantName} é controlador dos dados clínicos vinculados.
Dúvidas: privacidade@logifit.com.br`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
