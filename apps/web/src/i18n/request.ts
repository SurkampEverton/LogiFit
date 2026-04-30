import { getRequestConfig } from 'next-intl/server'
import { cookies, headers } from 'next/headers'
import { DEFAULT_LOCALE, isLocale, type Locale } from '@repo/i18n/config'

const NAMESPACES = ['common', 'auth', 'errors', 'security', 'messages'] as const

async function resolveLocale(): Promise<Locale> {
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value
  if (cookieLocale && isLocale(cookieLocale)) return cookieLocale

  const acceptLanguage = (await headers()).get('accept-language') ?? ''
  for (const part of acceptLanguage.split(',')) {
    const tag = part.split(';')[0]?.trim()
    if (tag && isLocale(tag)) return tag
  }

  return DEFAULT_LOCALE
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale()
  const entries = await Promise.all(
    NAMESPACES.map(
      async (ns) =>
        [ns, (await import(`../messages/${locale}/${ns}.json`)).default] as const,
    ),
  )
  return { locale, messages: Object.fromEntries(entries) }
})
