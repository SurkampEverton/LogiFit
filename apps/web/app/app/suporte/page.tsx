/**
 * `/app/suporte` — lista de tickets de suporte do tenant (Sprint 06 Faixa C).
 * Aberto via tool `report_issue` ou UI manual.
 */
import { db } from '@repo/db/client'
import { supportTickets } from '@repo/db/schema'
import { desc, eq } from 'drizzle-orm'
import { getTranslations } from 'next-intl/server'
import { requireFullSession } from '../../lib/session'

export const dynamic = 'force-dynamic'

export default async function SuportePage() {
  const session = await requireFullSession('/app/suporte')
  const t = await getTranslations('suporte')

  const tickets = await db
    .select({
      id: supportTickets.id,
      title: supportTickets.title,
      category: supportTickets.category,
      status: supportTickets.status,
      openedByAssistant: supportTickets.openedByAssistant,
      createdAt: supportTickets.createdAt,
    })
    .from(supportTickets)
    .where(eq(supportTickets.tenantId, session.logifit.tenantId))
    .orderBy(desc(supportTickets.createdAt))
    .limit(100)

  return (
    <main style={{ padding: 'var(--ev-space-5)', maxWidth: 980 }}>
      <header style={{ marginBottom: 'var(--ev-space-5)' }}>
        <h1 style={{ margin: 0, fontSize: 'var(--ev-text-2xl)' }}>{t('title')}</h1>
        <p style={{ margin: 'var(--ev-space-2) 0 0', color: 'var(--ev-text-muted)' }}>
          {t('subtitle')}
        </p>
      </header>

      {tickets.length === 0 ? (
        <div
          style={{
            padding: 'var(--ev-space-6)',
            textAlign: 'center',
            backgroundColor: 'var(--ev-surface-muted)',
            borderRadius: 12,
            color: 'var(--ev-text-muted)',
          }}
        >
          {t('empty')}
        </div>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'grid',
            gap: 'var(--ev-space-2)',
          }}
        >
          {tickets.map((tk) => (
            <li
              key={tk.id}
              style={{
                padding: 'var(--ev-space-3)',
                border: '1px solid var(--ev-border)',
                borderRadius: 8,
                backgroundColor: 'var(--ev-surface)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 'var(--ev-space-3)',
                }}
              >
                <strong style={{ fontSize: 'var(--ev-text-sm)' }}>{tk.title}</strong>
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: 9999,
                    fontSize: 'var(--ev-text-xs)',
                    backgroundColor:
                      tk.status === 'resolved'
                        ? 'var(--ev-success-bg, #d1fae5)'
                        : tk.status === 'open'
                          ? 'var(--ev-warning-bg, #fef3c7)'
                          : 'var(--ev-surface-muted)',
                    color:
                      tk.status === 'resolved'
                        ? 'var(--ev-success-text, #065f46)'
                        : tk.status === 'open'
                          ? 'var(--ev-warning-text, #78350f)'
                          : 'var(--ev-text)',
                  }}
                >
                  {t(`status.${tk.status}`)}
                </span>
              </div>
              <div
                style={{
                  marginTop: 'var(--ev-space-1)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 'var(--ev-text-xs)',
                  color: 'var(--ev-text-muted)',
                }}
              >
                <span>
                  {t(`category.${tk.category}`)}
                  {tk.openedByAssistant && ` · ${t('opened_by_assistant')}`}
                </span>
                <span>{new Date(tk.createdAt).toLocaleString('pt-BR')}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
