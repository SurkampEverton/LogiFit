/**
 * `<StickyFooter>` — rodapé fixo no mobile para botões primários (regra 31 + ADR 0063).
 *
 * Mobile: position: sticky bottom-0 com safe-area-inset-bottom; sombra leve em
 *   cima pra separar do conteúdo scrollável.
 * Desktop (sm+): comporta-se como bloco normal (não sticky) com align direita.
 *
 * Usado tipicamente dentro de `<ResponsiveForm>` com `<button type="submit">`.
 * Em mobile garante que o CTA principal nunca fica fora da viewport.
 *
 * Em formulários 2-col (default ResponsiveForm), aplicar `className="lg:col-span-2"`
 * pra ocupar largura inteira no desktop.
 */
import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  className?: string
}

export function StickyFooter({ children, className }: Props) {
  return (
    <div
      className={['ev-sticky-footer', className].filter(Boolean).join(' ')}
      style={{
        // mobile sticky
        position: 'sticky',
        bottom: 0,
        background: 'var(--ev-surface)',
        borderTop: '1px solid var(--ev-border)',
        padding: 'var(--ev-space-3, 12px) var(--ev-space-4, 16px)',
        paddingBottom: 'calc(var(--ev-space-3, 12px) + env(safe-area-inset-bottom))',
        marginLeft: 'calc(-1 * var(--ev-space-4, 16px))',
        marginRight: 'calc(-1 * var(--ev-space-4, 16px))',
        zIndex: 10,
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: 'var(--ev-space-2, 8px)',
          justifyContent: 'flex-end',
          flexWrap: 'wrap',
        }}
      >
        {children}
      </div>
      <style>{`
        @media (min-width: 640px) {
          .ev-sticky-footer {
            position: static !important;
            background: transparent !important;
            border-top: none !important;
            padding: 0 !important;
            margin: 0 !important;
          }
        }
      `}</style>
    </div>
  )
}
