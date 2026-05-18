/* eslint-disable */
/**
 * Service Worker — Sprint 26 Faixa C (26b).
 *
 * Estratégia mínima MVP:
 *   - install: pre-cache do shell (/meu, /meu/login, manifest, ícones)
 *   - fetch GET HTML/manifest: network-first + offline fallback no shell
 *   - fetch GET assets estáticos: cache-first
 *   - fetch demais (POST/PUT/DELETE + API): pass-through (sempre online)
 *
 * Sprint 26c: push notifications de incidentes cross-tenant + alertas cross-prescription
 *  (PushManager + Notification API), background sync pra retomar uploads
 *  pendentes, periodic-sync pra QR rotation off-app.
 */

const CACHE_NAME = 'lf-portal-v1'
const SHELL_URLS = [
  '/meu',
  '/meu/login',
  '/manifest.webmanifest',
  '/meu/icon-192.png',
  '/meu/icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_URLS).catch(() => {
        /* não falha install se algum asset ausente em dev */
      })
    }),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  // Não interceptar API routes — sempre online
  if (url.pathname.startsWith('/api/')) return

  // Não interceptar fora do escopo /meu
  if (!url.pathname.startsWith('/meu') && url.pathname !== '/manifest.webmanifest') return

  // Network-first com fallback ao cache (mantém UI freshness)
  event.respondWith(
    fetch(req)
      .then((res) => {
        // Atualiza cache em background
        const resClone = res.clone()
        caches.open(CACHE_NAME).then((cache) => {
          if (res.ok) cache.put(req, resClone).catch(() => {})
        })
        return res
      })
      .catch(() => caches.match(req).then((cached) => cached ?? caches.match('/meu'))),
  )
})
