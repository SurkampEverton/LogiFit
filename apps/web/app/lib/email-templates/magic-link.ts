/**
 * Templates de email — Magic link (Sprint 26 + Sprint 02b5+).
 *
 * **Importante:** clients de email (Outlook, Gmail, iOS Mail) NÃO suportam
 * CSS custom properties (`var(--ev-*)`). Cores e tipografia precisam ser
 * inline com valores literais.
 *
 * O lint `no-hardcoded-design-token` (regra 44) tem exceção pra esta pasta
 * — análoga à pasta `pdf/` (PDF renderer também não suporta custom properties).
 *
 * **Roadmap:** Sprint dedicado migra templates pra `packages/email/templates/*.tsx`
 * via `@react-email/components` (compila pra inline HTML com mesma limitação,
 * mas com DX melhor + i18n + componentes reusáveis).
 */

export interface MagicLinkTemplateInput {
  /** Slug do tenant (subdomínio) — vai no copy. */
  tenantSlug: string
  /** URL completa de verificação com token. */
  verifyUrl: string
}

export function renderMagicLinkHtml(input: MagicLinkTemplateInput): string {
  const slug = escapeHtml(input.tenantSlug)
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"></head>
<body style="font-family: system-ui, sans-serif; max-width: 560px; margin: 32px auto; color: #1a1a1a;">
  <h1 style="font-size: 20px;">Seu link de acesso</h1>
  <p>Olá! Você pediu um link de acesso ao portal <strong>${slug}.logifit.com.br</strong>.</p>
  <p style="margin: 24px 0;">
    <a href="${input.verifyUrl}" style="background:#2563eb;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">Entrar no portal</a>
  </p>
  <p style="color:#666;font-size:14px;">Este link expira em <strong>15 minutos</strong>. Se você não pediu este email, ignore.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <p style="color:#999;font-size:12px;">LogiFit — operador da plataforma. Dúvidas sobre privacidade: <a href="mailto:privacidade@logifit.com.br" style="color:#666;">privacidade@logifit.com.br</a></p>
</body>
</html>`
}

export function renderMagicLinkText(input: MagicLinkTemplateInput): string {
  return `Seu link de acesso ao portal ${input.tenantSlug}.logifit.com.br:

${input.verifyUrl}

Este link expira em 15 minutos. Se você não pediu este email, ignore.

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
