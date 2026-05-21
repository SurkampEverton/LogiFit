/**
 * `<ResponsiveForm>` — wrapper de form que adapta layout responsivo (regra 31 + ADR 0063).
 *
 * Desktop (lg+): grid 2-col (campos lado a lado quando couberem).
 * Mobile/tablet: stack 1-col.
 *
 * Componente "burro" — não controla state nem submit; só estrutura.
 * Caller passa `onSubmit` + children (fields).
 *
 * @example
 *   <ResponsiveForm onSubmit={handleSubmit}>
 *     <input name="name" />
 *     <input name="email" />
 *     <StickyFooter>
 *       <button type="submit">Salvar</button>
 *     </StickyFooter>
 *   </ResponsiveForm>
 */
import type { FormHTMLAttributes, ReactNode } from 'react'

interface Props extends Omit<FormHTMLAttributes<HTMLFormElement>, 'children'> {
  children: ReactNode
  /** `true` = 1 col em desktop também (caso campos longos). Default `false`. */
  singleColumn?: boolean
}

export function ResponsiveForm({ children, singleColumn = false, className, ...rest }: Props) {
  const gridClass = singleColumn
    ? 'grid grid-cols-1 gap-4'
    : 'grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-x-6'
  return (
    <form noValidate {...rest} className={[gridClass, className].filter(Boolean).join(' ')}>
      {children}
    </form>
  )
}
