/**
 * `sendTransactional` top-level — wrapper conveniente sobre `resolveEmailProvider()`.
 *
 * Uso típico em Server Action / cron:
 *   import { sendTransactional } from '@repo/email'
 *
 *   await sendTransactional({
 *     to: identity.email,
 *     subject: t('email.signup.confirmation.subject'),
 *     htmlBody: render(<SignupConfirmation token={token} />),
 *     category: 'platform',
 *   })
 */

import { resolveEmailProvider } from './resolve-provider'
import type { SendTransactionalInput, SendTransactionalResult } from './types'

export async function sendTransactional(
  input: SendTransactionalInput,
): Promise<SendTransactionalResult> {
  const provider = resolveEmailProvider()
  return provider.sendTransactional(input)
}
