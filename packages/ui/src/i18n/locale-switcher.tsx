'use client'

/**
 * `<LocaleSwitcher>` — troca de idioma via cookie `NEXT_LOCALE` (ADR 0052 + regra 27).
 *
 * Consome `LOCALES` + `LOCALE_NAMES` dinamicamente de `@repo/i18n` — adicionar
 * locale futuro é só adicionar entrada em `LOCALE_NAMES`, zero edição aqui.
 *
 * UX:
 *   - Render como `<select>` nativo (mobile-friendly, sem dep de Radix)
 *   - `onChange` seta cookie via `document.cookie` + chama `router.refresh()`
 *     pra Server Components re-renderizarem no novo locale
 *   - Sem ID hard-coded — caller pode múltiplos por página
 *
 * `aria-label` obrigatório pra screen reader (sem label visível por design —
 * geralmente vai no header compacto).
 */
import { LOCALE_NAMES, LOCALES, type Locale } from '@repo/i18n'
import { useId, useTransition } from 'react'

interface Props {
  /** Locale atual (Server Component lê via `getLocale()` e passa). */
  currentLocale: Locale
  /** Label acessível obrigatório. Caller traduz via `t('locale_switcher.label')`. */
  ariaLabel: string
  /** Classe Tailwind opcional pra customizar densidade. */
  className?: string
}

const COOKIE_MAX_AGE_DAYS = 365

export function LocaleSwitcher({ currentLocale, ariaLabel, className }: Props) {
  const [pending, startTransition] = useTransition()
  const selectId = useId()

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value
    if (!(LOCALES as readonly string[]).includes(next)) return
    document.cookie = `NEXT_LOCALE=${next}; path=/; max-age=${COOKIE_MAX_AGE_DAYS * 24 * 60 * 60}; samesite=lax`
    // window.location.reload() em vez de router.refresh() pra evitar dep de next/navigation
    // em @repo/ui (mantém o package isolado de framework). Custo: refaz request inteira.
    startTransition(() => {
      window.location.reload()
    })
  }

  return (
    <select
      id={selectId}
      aria-label={ariaLabel}
      value={currentLocale}
      onChange={handleChange}
      disabled={pending}
      className={className}
      style={{
        background: 'var(--ev-surface)',
        color: 'var(--ev-text)',
        border: '1px solid var(--ev-border)',
        borderRadius: 'var(--ev-radius-sm, 6px)',
        padding: 'var(--ev-space-1, 4px) var(--ev-space-2, 8px)',
        minHeight: 'var(--ev-touch-min, 44px)',
        fontSize: 'var(--ev-text-sm, 14px)',
        cursor: pending ? 'wait' : 'pointer',
      }}
    >
      {LOCALES.map((locale) => (
        <option key={locale} value={locale}>
          {LOCALE_NAMES[locale]}
        </option>
      ))}
    </select>
  )
}
