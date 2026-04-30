import { getTranslations } from 'next-intl/server'

export default async function SecurityPage() {
  const t = await getTranslations('security')

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-base text-[color:var(--ev-text-muted)]">{t('intro')}</p>
      </header>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">{t('contact')}</h2>
        <p className="text-base">
          <a
            href="mailto:security@logifit.com.br"
            className="text-[color:var(--ev-primary)] hover:underline"
          >
            security@logifit.com.br
          </a>
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">{t('policy')}</h2>
        <p className="text-base">{t('policy_text')}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-xl font-semibold">{t('scope')}</h2>
        <p className="text-base">{t('scope_text')}</p>
      </section>

      <section id="hall-da-fama" className="space-y-2">
        <h2 className="text-xl font-semibold">{t('hall_of_fame')}</h2>
        <p className="text-base text-[color:var(--ev-text-muted)]">{t('hall_empty')}</p>
      </section>
    </main>
  )
}
