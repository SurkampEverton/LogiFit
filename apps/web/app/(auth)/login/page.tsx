import { getTranslations } from 'next-intl/server'
import { LoginForm } from './login-form'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; error?: string }>
}) {
  const t = await getTranslations('auth')
  const params = await searchParams

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <header className="mb-8 space-y-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">{t('signin.title')}</h1>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          {/* TODO: i18n key 'signin.subtitle' — Faixa B fechamento adiciona ao catálogo */}
          Entre com seu email — enviamos um link mágico de acesso.
        </p>
      </header>

      <LoginForm returnTo={params.returnTo} initialError={params.error} />
    </main>
  )
}
