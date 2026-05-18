/**
 * `/app/vigilancia/limpeza` — registro de limpeza (Sprint 25 Faixa C).
 */
import { and, asc, desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { cleaningChecklists, cleaningLogs, persons, users } from '@repo/db/schema'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

export default async function LimpezaPage() {
  const session = await requireFullSession('/app/vigilancia/limpeza')
  const tenantId = session.logifit.tenantId

  const checklists = await db
    .select({
      id: cleaningChecklists.id,
      name: cleaningChecklists.name,
      frequencyDays: cleaningChecklists.frequencyDays,
      active: cleaningChecklists.active,
    })
    .from(cleaningChecklists)
    .where(and(eq(cleaningChecklists.tenantId, tenantId), eq(cleaningChecklists.active, true)))
    .orderBy(asc(cleaningChecklists.name))

  const recentLogs = await db
    .select({
      id: cleaningLogs.id,
      checklistName: cleaningChecklists.name,
      performedAt: cleaningLogs.performedAt,
      completionPct: cleaningLogs.completionPct,
      isComplete: cleaningLogs.isComplete,
      observations: cleaningLogs.observations,
      performedByName: persons.name,
    })
    .from(cleaningLogs)
    .leftJoin(cleaningChecklists, eq(cleaningChecklists.id, cleaningLogs.checklistId))
    .leftJoin(users, eq(users.id, cleaningLogs.performedByUserId))
    .leftJoin(persons, eq(persons.id, users.personId))
    .where(eq(cleaningLogs.tenantId, tenantId))
    .orderBy(desc(cleaningLogs.performedAt))
    .limit(50)

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Limpeza</h1>
        <span style={{ color: 'var(--ev-muted)' }}>{recentLogs.length} logs recentes</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/vigilancia" className="ev-btn ev-btn-ghost">
          ← Vigilância
        </Link>
        <Link href="/app/vigilancia/limpeza/checklists" className="ev-btn ev-btn-ghost">
          ⚙️ Checklists
        </Link>
      </header>

      <h2>Checklists ativos</h2>
      {checklists.length === 0 ? (
        <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
          <p style={{ marginTop: 0 }}>
            Nenhum checklist cadastrado. Configure templates por ambiente (sala
            fisio, vestiário, recepção) com itens obrigatórios e opcionais.
          </p>
        </div>
      ) : (
        <table className="ev-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Frequência</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {checklists.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.frequencyDays}d</td>
                <td>{c.active ? '✓ ativo' : '⊘ inativo'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Histórico de logs</h2>
      {recentLogs.length === 0 ? (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p style={{ marginTop: 0 }}>Nenhum log de limpeza registrado.</p>
        </div>
      ) : (
        <table className="ev-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Checklist</th>
              <th>Quando</th>
              <th>Por</th>
              <th>Completude</th>
              <th>Status</th>
              <th>Observações</th>
            </tr>
          </thead>
          <tbody>
            {recentLogs.map((l) => (
              <tr key={l.id}>
                <td>{l.checklistName ?? '—'}</td>
                <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                  {new Date(l.performedAt).toLocaleString('pt-BR')}
                </td>
                <td style={{ fontSize: 'var(--ev-font-xs)' }}>{l.performedByName ?? '—'}</td>
                <td>{l.completionPct ?? 0}%</td>
                <td>
                  {l.isComplete ? (
                    <span className="ev-badge" style={{ background: 'var(--ev-success-soft, #dcfce7)' }}>
                      ✓ Completo
                    </span>
                  ) : (
                    <span className="ev-badge" style={{ background: 'var(--ev-warning-soft, #fef9c3)' }}>
                      ⚠ Incompleto
                    </span>
                  )}
                </td>
                <td style={{ fontSize: 'var(--ev-font-xs)' }}>{l.observations ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
