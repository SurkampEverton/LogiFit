/**
 * Captcha provider — Cloudflare Turnstile (regra 35 + Sprint 00 dependency).
 *
 * Provider abstrato com mock em dev (sempre passa) e validação real em prod
 * via Cloudflare Turnstile siteverify endpoint.
 *
 * Uso típico (Server Action de cadastro proativo Sprint 02b):
 *   const ok = await verifyCaptcha({ token, remoteIp })
 *   if (!ok.valid) throw VALIDATION_ERROR
 *
 * **MVP**: mock provider quando `TURNSTILE_SECRET_KEY` não setado (dev/test/
 * storybook); produção requer secret configurado.
 *
 * Sprint 02b2: configurar Turnstile real (script no client + secret server-side
 * via Cloudflare dashboard) + remover mock em prod via gate de env.
 */

export interface CaptchaVerifyInput {
  /** Token retornado pelo widget Turnstile no client */
  token: string
  /** IP do cliente (X-Forwarded-For — opcional mas recomendado) */
  remoteIp?: string
}

export interface CaptchaVerifyResult {
  valid: boolean
  /** Provider que respondeu (turnstile/mock) */
  provider: 'turnstile' | 'mock'
  /** Action que o widget reportou (opcional — pra cross-check) */
  action?: string
  /** Erros do provider (pra logging — não expor ao caller) */
  errorCodes?: string[]
}

/**
 * Verifica token Turnstile.
 *
 * Estratégia:
 *   - Se `TURNSTILE_SECRET_KEY` não setado → mock (sempre valid em dev)
 *   - Se setado → POST pra Cloudflare siteverify
 *   - Em prod (`NODE_ENV=production`) com secret faltando → throw
 *     (config inválida; melhor falhar que aceitar mock em prod)
 *
 * @example
 *   const r = await verifyCaptcha({ token: formData.get('cf-turnstile-response') })
 *   if (!r.valid) throw ValidationError
 */
export async function verifyCaptcha(input: CaptchaVerifyInput): Promise<CaptchaVerifyResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[captcha] TURNSTILE_SECRET_KEY não setado em produção — config inválida',
      )
    }
    // Mock: dev/test/storybook — aceita qualquer token não-vazio
    return {
      valid: input.token.length > 0,
      provider: 'mock',
    }
  }

  // Real: Cloudflare Turnstile siteverify
  // Endpoint: https://challenges.cloudflare.com/turnstile/v0/siteverify
  // Note: usa fetch direto (não safeFetch) — endpoint é allowlist canônico
  // documentado nesta lib; safeFetch não cobre external providers de auth.
  const params = new URLSearchParams()
  params.set('secret', secret)
  params.set('response', input.token)
  if (input.remoteIp) params.set('remoteip', input.remoteIp)

  try {
    // safe-fetch-exempt: Cloudflare Turnstile siteverify é canônico do provider abstrato (este file); não passa por arbitrary URL do user
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: params,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
    const data = (await res.json()) as {
      success: boolean
      action?: string
      'error-codes'?: string[]
    }
    return {
      valid: data.success === true,
      provider: 'turnstile',
      action: data.action,
      errorCodes: data['error-codes'],
    }
  } catch (err) {
    return {
      valid: false,
      provider: 'turnstile',
      errorCodes: [
        err instanceof Error ? `fetch_error:${err.message}` : 'fetch_error:unknown',
      ],
    }
  }
}
