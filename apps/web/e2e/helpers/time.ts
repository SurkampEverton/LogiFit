import type { Page } from '@playwright/test'

/**
 * Congela o relógio em horário ISO 8601 (ADR 0090 §8 anti-flakiness).
 * Obrigatório em todo teste com data — proibido `new Date()` ad-hoc.
 *
 * Uso: await freezeAt(page, '2026-04-27T10:00:00-03:00')
 */
export async function freezeAt(page: Page, isoTime: string): Promise<void> {
  const time = new Date(isoTime).getTime()
  if (Number.isNaN(time)) throw new Error(`freezeAt: data inválida "${isoTime}"`)
  await page.clock.install({ time })
}
