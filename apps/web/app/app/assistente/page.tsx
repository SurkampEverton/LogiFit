/**
 * `/app/assistente` — página dedicada do assistente IA (ADR 0075).
 *
 * Sprint 06 Faixa D: lista de conversas + sessão ativa minimal.
 * Sprint 06+: filtros, busca, share intra-tenant.
 */
import { db } from '@repo/db/client'
import { assistantSessions } from '@repo/db/schema'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { getTranslations } from 'next-intl/server'
import { requireFullSession } from '../../lib/session'

export const dynamic = 'force-dynamic'

export default async function AssistantPage() {
  const session = await requireFullSession('/app/assistente')
  const t = await getTranslations('assistant')

  const sessions = await db
    .select({
      id: assistantSessions.id,
      title: assistantSessions.title,
      persona: assistantSessions.persona,
      updatedAt: assistantSessions.updatedAt,
    })
    .from(assistantSessions)
    .where(
      and(
        eq(assistantSessions.tenantId, session.logifit.tenantId),
        eq(assistantSessions.userId, session.logifit.userId),
        isNull(assistantSessions.archivedAt),
      ),
    )
    .orderBy(desc(assistantSessions.updatedAt))
    .limit(50)

  return (
    <main style={{ padding: 'var(--ev-space-5)' }}>
      <header style={{ marginBottom: 'var(--ev-space-5)' }}>
        <h1 style={{ margin: 0, fontSize: 'var(--ev-text-2xl)' }}>{t('page.title')}</h1>
        <p style={{ margin: 'var(--ev-space-2) 0 0', color: 'var(--ev-text-muted)' }}>
          {t('page.subtitle')}
        </p>
      </header>

      {sessions.length === 0 ? (
        <div
          style={{
            padding: 'var(--ev-space-6)',
            textAlign: 'center',
            backgroundColor: 'var(--ev-surface-muted)',
            borderRadius: 12,
            color: 'var(--ev-text-muted)',
          }}
        >
          {t('page.empty')}
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 'var(--ev-space-2)' }}>
          {sessions.map((s) => (
            <li
              key={s.id}
              style={{
                padding: 'var(--ev-space-3)',
                border: '1px solid var(--ev-border)',
                borderRadius: 8,
                backgroundColor: 'var(--ev-surface)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--ev-space-3)' }}>
                <strong style={{ fontSize: 'var(--ev-text-sm)' }}>{s.title}</strong>
                <span style={{ fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
                  {t(`persona.${s.persona}`)}
                </span>
              </div>
              <div style={{ marginTop: 'var(--ev-space-1)', fontSize: 'var(--ev-text-xs)', color: 'var(--ev-text-muted)' }}>
                {new Date(s.updatedAt).toLocaleString('pt-BR')}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
