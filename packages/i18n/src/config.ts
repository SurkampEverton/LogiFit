/**
 * i18n canonical config (ADR 0052).
 *
 * Adicionar locale futuro = adicionar 1 linha em LOCALES + LOCALE_NAMES,
 * criar diretório apps/web/src/messages/{locale}/ e atualizar CHECK
 * constraint de persons.preferred_locale (ADR 0052 §Persistência).
 * Sem ALTER TYPE — usa CHECK constraint, não enum SQL.
 */

export const LOCALES = ['pt-BR', 'en-US', 'es-419'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'pt-BR'

/**
 * Cadeia de fallback genérica (qualquer locale → en-US → pt-BR).
 * Usada quando uma chave não tem tradução no locale ativo.
 */
export const FALLBACK_CHAIN: readonly Locale[] = ['en-US', 'pt-BR']

/**
 * Nome nativo de cada locale — <LocaleSwitcher> consome dinamicamente.
 * Adicionar locale = adicionar entrada aqui, sem editar componente.
 */
export const LOCALE_NAMES: Record<Locale, string> = {
  'pt-BR': 'Português',
  'en-US': 'English',
  'es-419': 'Español',
}

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}
