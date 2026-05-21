/**
 * Templates do magic link de auth (Sprint 02b8).
 *
 * Mantido aqui em `packages/auth/src/email-templates/` em vez de
 * `apps/web/app/lib/email-templates/` pra evitar dep circular
 * (`@repo/auth → @app/web`).
 *
 * Cores hardcoded inline — clients de email não suportam CSS custom
 * properties; exceção lint `EMAIL_TEMPLATES_PATH` cobre este path.
 */

export interface MagicLinkTemplateInput {
  email: string
  url: string
}

export function renderMagicLinkAuthHtml(input: MagicLinkTemplateInput): string {
  const safeUrl = input.url.replace(/"/g, '&quot;')
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"></head>
<body style="font-family: system-ui, sans-serif; max-width: 560px; margin: 32px auto; color: #1a1a1a;">
  <h1 style="font-size: 20px;">Entrar no LogiFit</h1>
  <p>Você pediu um link de acesso pra <strong>${escapeHtml(input.email)}</strong>.</p>
  <p style="margin: 24px 0;">
    <a href="${safeUrl}" style="background:#2563eb;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">Entrar agora</a>
  </p>
  <p style="color:#666;font-size:14px;">Este link expira em <strong>15 minutos</strong>. Se você não pediu, ignore.</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <p style="color:#999;font-size:12px;">LogiFit — Dúvidas sobre privacidade: <a href="mailto:privacidade@logifit.com.br" style="color:#666;">privacidade@logifit.com.br</a></p>
</body>
</html>`
}

export function renderMagicLinkAuthText(input: MagicLinkTemplateInput): string {
  return `Entrar no LogiFit

Você pediu um link de acesso pra ${input.email}.

Clique pra entrar:
${input.url}

Este link expira em 15 minutos. Se você não pediu, ignore.

LogiFit
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
