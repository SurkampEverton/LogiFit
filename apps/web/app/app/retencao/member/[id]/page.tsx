import { db } from '@repo/db/client'
import {
  churnFeaturesSnapshot,
  churnInterventions,
  churnPredictions,
  members,
  persons,
  users,
} from '@repo/db/schema'
/**
 * `/app/retencao/member/[id]` — detalhe predição + fatores + intervenções (Sprint 19 Faixa C).
 */
import { and, desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireFullSession } from '../../../../lib/session'
import { AssignInterventionForm } from './assign-intervention-form'
import { CloseInterventionForm } from './close-intervention-form'
import { ScorePredictButton } from './score-predict-button'

export const dynamic = 'force-dynamic'

interface FactorPayload {
  factor: string
  weight: number
  narrative: string
}

function pct(v: string | number): string {
  return `${Math.round(Number(v) * 100)}%`
}

const ACTION_LABEL: Record<string, string> = {
  phone_call: '📞 Ligação',
  whatsapp_message: '💬 WhatsApp',
  free_pass: '🎫 Passe livre',
  discount_offer: '💸 Desconto',
  in_person_visit: '🚶 Visita presencial',
  manual: '✍️ Manual',
}

const OUTCOME_LABEL: Record<string, string> = {
  success: '✓ Sucesso (member ativo)',
  partial: '~ Parcial (engajou)',
  failed: '✗ Falhou',
  member_canceled_anyway: '⚠ Cancelou mesmo assim',
}

export default async function MemberRiskDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id: memberId } = await params
  const session = await requireFullSession(`/app/retencao/member/${memberId}`)
  const tenantId = session.logifit.tenantId

  const [member] = await db
    .select({ id: members.id, name: persons.name, email: persons.email })
    .from(members)
    .leftJoin(persons, eq(persons.id, members.personId))
    .where(and(eq(members.id, memberId), eq(members.tenantId, tenantId)))
    .limit(1)
  if (!member) notFound()

  const predictions = await db
    .select({
      id: churnPredictions.id,
      modelVersion: churnPredictions.modelVersion,
      prob30d: churnPredictions.prob30d,
      prob60d: churnPredictions.prob60d,
      prob90d: churnPredictions.prob90d,
      riskBand: churnPredictions.riskBand,
      topFactors: churnPredictions.topFactors,
      predictedAt: churnPredictions.predictedAt,
      validUntil: churnPredictions.validUntil,
      source: churnPredictions.source,
      latencyMs: churnPredictions.latencyMs,
      snapshotId: churnPredictions.snapshotId,
    })
    .from(churnPredictions)
    .where(and(eq(churnPredictions.memberId, memberId), eq(churnPredictions.tenantId, tenantId)))
    .orderBy(desc(churnPredictions.predictedAt))
    .limit(10)

  const latest = predictions[0]
  const factors = (latest?.topFactors as unknown as FactorPayload[]) ?? []

  const latestFeatures = latest
    ? await db
        .select({ features: churnFeaturesSnapshot.features })
        .from(churnFeaturesSnapshot)
        .where(eq(churnFeaturesSnapshot.id, latest.snapshotId))
        .limit(1)
        .then((r) => r[0]?.features as Record<string, unknown> | undefined)
    : undefined

  const interventions = await db
    .select({
      id: churnInterventions.id,
      action: churnInterventions.action,
      notes: churnInterventions.notes,
      assignedAt: churnInterventions.assignedAt,
      closedAt: churnInterventions.closedAt,
      outcome: churnInterventions.outcome,
      outcomeNotes: churnInterventions.outcomeNotes,
      assignedToUserId: churnInterventions.assignedToUserId,
    })
    .from(churnInterventions)
    .where(
      and(eq(churnInterventions.memberId, memberId), eq(churnInterventions.tenantId, tenantId)),
    )
    .orderBy(desc(churnInterventions.assignedAt))
    .limit(10)

  const teamUsers = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.tenantId, tenantId))
    .limit(20)

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>{member.name ?? '—'}</h1>
        <span style={{ color: 'var(--ev-muted)' }}>{member.email}</span>
        <span style={{ flex: 1 }} />
        <ScorePredictButton memberId={memberId} />
        <Link href="/app/retencao" className="ev-btn ev-btn-ghost">
          ← Retenção
        </Link>
      </header>

      {!latest ? (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p style={{ marginTop: 0 }}>
            Sem predição computada. Clique em "Calcular agora" pra rodar a Fase 1 (heurística + LLM
            quando habilitado).
          </p>
        </div>
      ) : (
        <>
          <section
            className="ev-card"
            style={{
              padding: 'var(--ev-space-md)',
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 'var(--ev-space-md)',
            }}
          >
            <div>
              <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                P(churn 30d)
              </div>
              <div
                style={{
                  fontSize: 'var(--ev-font-lg)',
                  fontWeight: 600,
                  color:
                    latest.riskBand === 'high'
                      ? 'var(--ev-danger, #b91c1c)'
                      : latest.riskBand === 'medium'
                        ? 'var(--ev-warning, #ca8a04)'
                        : 'var(--ev-success, #16a34a)',
                }}
              >
                {pct(latest.prob30d)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                P(churn 60d)
              </div>
              <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
                {pct(latest.prob60d)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                P(churn 90d)
              </div>
              <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
                {pct(latest.prob90d)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                Banda atual
              </div>
              <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
                {latest.riskBand}
              </div>
              <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                Fonte: {latest.source} · {latest.modelVersion}
              </div>
            </div>
          </section>

          <h2>Fatores principais</h2>
          <div
            className="ev-card"
            style={{
              padding: 'var(--ev-space-md)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {factors.length === 0 ? (
              <p style={{ marginTop: 0, color: 'var(--ev-muted)' }}>—</p>
            ) : (
              factors.map((f, i) => (
                <div key={i}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 8,
                      fontSize: 'var(--ev-font-sm)',
                      marginBottom: 2,
                    }}
                  >
                    <strong>{f.factor}</strong>
                    <span
                      style={{
                        fontSize: 'var(--ev-font-xs)',
                        color: f.weight < 0 ? 'var(--ev-success)' : 'var(--ev-danger)',
                      }}
                    >
                      {f.weight > 0 ? '+' : ''}
                      {(f.weight * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                    {f.narrative}
                  </div>
                </div>
              ))
            )}
          </div>

          {latestFeatures && (
            <details>
              <summary>Features completas (snapshot)</summary>
              <pre
                style={{
                  background: 'var(--ev-surface)',
                  padding: 8,
                  borderRadius: 'var(--ev-radius)',
                  fontSize: 'var(--ev-font-xs)',
                  overflowX: 'auto',
                }}
              >
                {JSON.stringify(latestFeatures, null, 2)}
              </pre>
            </details>
          )}

          <h2>Atribuir intervenção</h2>
          <AssignInterventionForm
            predictionId={latest.id}
            users={teamUsers.map((u) => ({ id: u.id, label: u.username }))}
          />
        </>
      )}

      <h2>Intervenções ({interventions.length})</h2>
      {interventions.length === 0 ? (
        <p style={{ color: 'var(--ev-muted)' }}>—</p>
      ) : (
        <table className="ev-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Ação</th>
              <th>Atribuída</th>
              <th>Encerrada</th>
              <th>Outcome</th>
              <th>Notas</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {interventions.map((i) => (
              <tr key={i.id}>
                <td>{ACTION_LABEL[i.action] ?? i.action}</td>
                <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                  {new Date(i.assignedAt).toLocaleString('pt-BR')}
                </td>
                <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                  {i.closedAt ? new Date(i.closedAt).toLocaleString('pt-BR') : '—'}
                </td>
                <td>{i.outcome ? (OUTCOME_LABEL[i.outcome] ?? i.outcome) : '—'}</td>
                <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                  {i.notes ?? ''}
                  {i.outcomeNotes && (
                    <div style={{ color: 'var(--ev-muted)' }}>→ {i.outcomeNotes}</div>
                  )}
                </td>
                <td>{!i.closedAt && <CloseInterventionForm interventionId={i.id} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {predictions.length > 1 && (
        <>
          <h2>Histórico de predições</h2>
          <table className="ev-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Quando</th>
                <th>P(30d)</th>
                <th>Banda</th>
                <th>Fonte</th>
                <th>Latência</th>
              </tr>
            </thead>
            <tbody>
              {predictions.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                    {new Date(p.predictedAt).toLocaleString('pt-BR')}
                  </td>
                  <td style={{ fontWeight: 600 }}>{pct(p.prob30d)}</td>
                  <td>{p.riskBand}</td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>{p.source}</td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>{p.latencyMs ?? '—'} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
