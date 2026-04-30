import { getTranslations } from 'next-intl/server'

export default async function Home() {
  const t = await getTranslations('common')

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">{t('app.title')}</h1>
      <p className="max-w-prose text-center text-base text-[color:var(--ev-text-muted)]">
        {t('app.tagline')}
      </p>
      <p className="text-sm text-[color:var(--ev-text-subtle)]">
        {t('app.environment')}
      </p>
    </main>
  )
}
