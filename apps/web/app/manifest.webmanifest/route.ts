/**
 * PWA manifest dinâmico para `/meu/*` — Sprint 26 Faixa C (26b).
 *
 * Servido via Route Handler em `/manifest.webmanifest` (next.config.ts não tem
 * config dinâmico). Apontado pelo layout do portal com `<link rel="manifest">`.
 *
 * Sprint 26c: per-tenant theme_color via lookup `tenant_settings.brand_color`
 * (multi-tenant ADR 0065 — cada subdomínio terá manifest customizado).
 */
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export function GET() {
  const manifest = {
    name: 'LogiFit · Meu Portal',
    short_name: 'LogiFit',
    description: 'Sua academia, fisio e nutri no celular.',
    start_url: '/meu',
    scope: '/meu',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#D8DDDB',
    theme_color: '#3498DB',
    lang: 'pt-BR',
    dir: 'ltr',
    categories: ['health', 'fitness', 'lifestyle'],
    icons: [
      {
        src: '/meu/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any maskable',
      },
      {
        src: '/meu/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable',
      },
    ],
    shortcuts: [
      {
        name: 'Agenda',
        short_name: 'Agenda',
        url: '/meu/agenda',
        description: 'Próximos agendamentos',
      },
      {
        name: 'Treino',
        short_name: 'Treino',
        url: '/meu/treino',
        description: 'Ficha atual',
      },
      {
        name: 'QR',
        short_name: 'QR',
        url: '/meu/qr',
        description: 'QR de acesso',
      },
    ],
    prefer_related_applications: false,
  }

  return NextResponse.json(manifest, {
    status: 200,
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
