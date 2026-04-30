import type { ReactNode } from 'react'

/**
 * FormError — erro inline sob input (regra 45 + ADR 0089). NUNCA usar
 * isolado — sempre linkado via `aria-describedby` ao input que valida.
 *
 * Exemplo:
 *   <input aria-describedby="email-error" aria-invalid={!!error} />
 *   <FormError id="email-error">{error}</FormError>
 */
interface FormErrorProps {
  id: string
  children: ReactNode
}

export function FormError({ id, children }: FormErrorProps) {
  if (!children) return null
  return (
    <p
      id={id}
      role="alert"
      style={{
        color: 'var(--ev-danger)',
        fontSize: 'var(--ev-text-sm)',
        marginTop: 'var(--ev-space-1)',
      }}
    >
      {children}
    </p>
  )
}
