/**
 * BetterAuth client-side instance (ADR 0092).
 *
 * Usado em Client Components ('use client') pra signIn/signOut/etc.
 * NÃO conecta no DB — só chama as rotas `/api/auth/*` montadas pelo handler
 * em `apps/web/app/api/auth/[...all]/route.ts`.
 *
 * Uso típico:
 *   'use client'
 *   import { authClient } from '@repo/auth/client'
 *
 *   async function onLogin(email: string) {
 *     const { error } = await authClient.signIn.magicLink({ email, callbackURL: '/app' })
 *     if (error) toast.error(error.message)
 *   }
 */
import { createAuthClient } from 'better-auth/react'
import { magicLinkClient, twoFactorClient } from 'better-auth/client/plugins'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

export const authClient = createAuthClient({
  baseURL: APP_URL,
  basePath: '/api/auth',
  plugins: [magicLinkClient(), twoFactorClient()],
})

// Re-export pra ergonomia
export const { signIn, signOut, signUp, useSession, getSession } = authClient
