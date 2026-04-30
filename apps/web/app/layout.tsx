import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { headers } from 'next/headers'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import { Toaster } from '@repo/ui/messages'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'LogiFit',
  description: 'ERP SaaS B2B multi-tenant — Academia + Fisioterapia + Nutrição',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#D8DDDB' }, // design-token-exempt: Next.js Viewport.themeColor é lido antes do CSS carregar
    { media: '(prefers-color-scheme: dark)', color: '#1A252F' }, // design-token-exempt: idem
  ],
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [locale, messages, headerStore] = await Promise.all([
    getLocale(),
    getMessages(),
    headers(),
  ])
  const nonce = headerStore.get('x-nonce') ?? undefined

  return (
    <html lang={locale} className={inter.variable}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
          <Toaster nonce={nonce} />
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
