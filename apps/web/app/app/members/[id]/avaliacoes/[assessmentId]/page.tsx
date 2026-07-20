import { db } from '@repo/db/client'
import {
  assessmentCalculations,
  assessmentMeasurements,
  assessmentTypes,
  assessments,
  members,
  persons,
} from '@repo/db/schema'
/**
 * `/app/members/[id]/avaliacoes/[assessmentId]` — detalhe da avaliação
 * (Sprint 12 Faixa C).
 *
 * Mostra measurements + calculations derivados (IMC + classificação,
 * Pollock %, TMB Mifflin, RCQ) + notes.
 */
import { and, asc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireFullSession } from '../../../../../lib/session'

export const dynamic = 'force-dynamic'

const CALC_LABELS: Record<string, string> = {
  imc: 'IMC',
  pct_gordura_pollock7: '% Gordura (Pollock 7)',
  pct_gordura_jackson_pollock: '% Gordura (J-P)',
  massa_magra_kg: 'Massa magra',
  tmb_mifflin: 'TMB (Mifflin-St Jeor)',
  tmb_harris_benedict: 'TMB (Harris-Benedict)',
  tmb_katch_mcardle: 'TMB (Katch-McArdle)',
  rcq: 'Relação cintura-quadril',
}

const CALC_UNITS: Record<string, string> = {
  imc: 'kg/m²',
  pct_gordura_pollock7: '%',
  pct_gordura_jackson_pollock: '%',
  massa_magra_kg: 'kg',
  tmb_mifflin: 'kcal/dia',
  tmb_harris_benedict: 'kcal/dia',
  tmb_katch_mcardle: 'kcal/dia',
  rcq: '',
}

const CLASS_SEVERITY: Record<string, 'info' | 'warning' | 'danger'> = {
  normal: 'info',
  saudavel: 'info',
  atletico: 'info',
  baixo: 'info',
  baixo_peso: 'warning',
  sobrepeso: 'warning',
  moderado: 'warning',
  obesidade_i: 'danger',
  obesidade_ii: 'danger',
  obesidade_iii: 'danger',
  obesidade: 'danger',
  alto: 'danger',
}

const SEVERITY_COLOR: Record<string, string> = {
  info: 'var(--ev-success, #22c55e)',
  warning: 'var(--ev-warning, #eab308)',
  danger: 'var(--ev-danger, #ef4444)',
}

interface FieldDef {
  key: string
  label: string
  kind: string
  unit?: string
}

export default async function AssessmentDetailPage({
  params,
}: {
  params: Promise<{ id: string; assessmentId: string }>
}) {
  const { id, assessmentId } = await params
  const session = await requireFullSession(`/app/members/${id}/avaliacoes/${assessmentId}`)
  const tenantId = session.logifit.tenantId

  const [a] = await db
    .select({
      id: assessments.id,
      memberId: assessments.memberId,
      performedAt: assessments.performedAt,
      notes: assessments.notes,
      softDeletedAt: assessments.softDeletedAt,
      memberName: persons.name,
      typeName: assessmentTypes.name,
      typeCategory: assessmentTypes.category,
      typeFields: assessmentTypes.fields,
      typeClinicalRef: assessmentTypes.clinicalReference,
      typeVersion: assessments.typeVersion,
    })
    .from(assessments)
    .leftJoin(members, eq(members.id, assessments.memberId))
    .leftJoin(persons, eq(persons.id, members.personId))
    .leftJoin(assessmentTypes, eq(assessmentTypes.id, assessments.assessmentTypeId))
    .where(
      and(
        eq(assessments.id, assessmentId),
        eq(assessments.tenantId, tenantId),
        eq(assessments.memberId, id),
      ),
    )
    .limit(1)
  if (!a) notFound()

  const measurements = await db
    .select({
      fieldKey: assessmentMeasurements.fieldKey,
      valueNum: assessmentMeasurements.valueNum,
      valueText: assessmentMeasurements.valueText,
      valueEnum: assessmentMeasurements.valueEnum,
      source: assessmentMeasurements.source,
    })
    .from(assessmentMeasurements)
    .where(eq(assessmentMeasurements.assessmentId, assessmentId))
    .orderBy(asc(assessmentMeasurements.fieldKey))

  const calculations = await db
    .select({
      calcKey: assessmentCalculations.calcKey,
      value: assessmentCalculations.value,
      classification: assessmentCalculations.classification,
    })
    .from(assessmentCalculations)
    .where(eq(assessmentCalculations.assessmentId, assessmentId))

  const fieldDefs = (a.typeFields as FieldDef[]) ?? []
  const fieldByKey = new Map(fieldDefs.map((f) => [f.key, f]))

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <header className="space-y-1">
        <Link
          href={`/app/members/${id}/avaliacoes`}
          className="text-sm text-[color:var(--ev-text-muted)] hover:underline"
        >
          ← Voltar pras avaliações
        </Link>
        <div className="flex items-end justify-between gap-2 flex-wrap">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              {a.typeName ?? '(tipo removido)'}
            </h1>
            <p className="text-sm text-[color:var(--ev-text-muted)]">
              {a.memberName} ·{' '}
              {new Date(a.performedAt).toLocaleString('pt-BR', {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
              {' · '}v{a.typeVersion}
            </p>
          </div>
          {a.softDeletedAt && (
            <span
              className="rounded-full px-2 py-0.5 text-xs"
              style={{
                backgroundColor: 'var(--ev-warning-bg, #fef3c7)',
                color: 'var(--ev-warning, #92400e)',
              }}
            >
              Apagada em {new Date(a.softDeletedAt).toLocaleDateString('pt-BR')}
            </span>
          )}
        </div>
        {a.typeClinicalRef && (
          <p className="text-xs italic text-[color:var(--ev-text-muted)]">
            Referência: {a.typeClinicalRef}
          </p>
        )}
      </header>

      {calculations.length > 0 && (
        <section className="rounded-xl border border-[color:var(--ev-border)] p-6 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--ev-text-muted)]">
            Cálculos derivados
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {calculations.map((c) => {
              const severity = c.classification && CLASS_SEVERITY[c.classification]
              return (
                <div
                  key={c.calcKey}
                  className="rounded-md border border-[color:var(--ev-border)] bg-[color:var(--ev-bg)] p-3"
                >
                  <div className="text-xs text-[color:var(--ev-text-muted)] uppercase">
                    {CALC_LABELS[c.calcKey] ?? c.calcKey}
                  </div>
                  <div className="text-2xl font-semibold tabular-nums mt-1">
                    {Number(c.value).toLocaleString('pt-BR', {
                      maximumFractionDigits: 2,
                    })}
                    <span className="text-xs font-normal text-[color:var(--ev-text-muted)] ml-1">
                      {CALC_UNITS[c.calcKey] ?? ''}
                    </span>
                  </div>
                  {c.classification && (
                    <div
                      className="text-xs font-medium mt-1"
                      style={{
                        color: severity ? SEVERITY_COLOR[severity] : 'var(--ev-text-muted)',
                      }}
                    >
                      {c.classification}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-[color:var(--ev-border)] p-6 space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--ev-text-muted)]">
          Medidas ({measurements.length})
        </h2>
        {measurements.length === 0 ? (
          <p className="text-sm text-[color:var(--ev-text-muted)] italic">
            Sem medidas registradas.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-[color:var(--ev-text-muted)] uppercase">
                <th className="text-left py-1">Campo</th>
                <th className="text-left py-1">Valor</th>
                <th className="text-left py-1">Origem</th>
              </tr>
            </thead>
            <tbody>
              {measurements.map((m) => {
                const def = fieldByKey.get(m.fieldKey)
                const value = m.valueNum !== null ? m.valueNum : (m.valueEnum ?? m.valueText ?? '—')
                return (
                  <tr key={m.fieldKey} className="border-t border-[color:var(--ev-border)]">
                    <td className="py-2">
                      {def?.label ?? m.fieldKey}
                      {def?.unit && (
                        <span className="text-[color:var(--ev-text-muted)] text-xs ml-1">
                          ({def.unit})
                        </span>
                      )}
                    </td>
                    <td className="py-2 tabular-nums font-medium">{value}</td>
                    <td className="py-2 text-xs text-[color:var(--ev-text-muted)]">{m.source}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      {a.notes && (
        <section className="rounded-xl border border-[color:var(--ev-border)] p-6 space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[color:var(--ev-text-muted)]">
            Notas
          </h2>
          <p className="text-sm whitespace-pre-wrap">{a.notes}</p>
        </section>
      )}
    </main>
  )
}
