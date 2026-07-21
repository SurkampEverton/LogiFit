import { db } from '@repo/db/client'
import { aiCommitteeDecisions, aiCommitteeMembers, aiCommittees, persons } from '@repo/db/schema'
/**
 * `/app/settings/compliance/comite-ia` — gestão do Comitê de IA
 * (Sprint 01b fechamento — CFM 2.454/2026 + regra 28).
 *
 * Cliente que ativa feature IA classe SaMD II+ precisa cadastrar Comitê
 * interno + ata. Feature flag IA clínica verifica `ai_committees.status='active'`
 * antes de liberar (regra 28).
 *
 * MVP Sprint 01b: lista comitê + members + decisões. Sprint 06+ adiciona
 * upload de ata em PDF (MinIO) + assinatura digital + workflow de aprovação.
 */
import { and, desc, eq } from 'drizzle-orm'
import { requireFullSession } from '../../../../lib/session'

export const dynamic = 'force-dynamic'

const ROLE_LABEL: Record<string, string> = {
  coordenador: 'Coordenador',
  medico: 'Médico (CRM)',
  enfermeiro: 'Enfermeiro (COREN)',
  fisio: 'Fisioterapeuta (CREFITO)',
  nutri: 'Nutricionista (CRN)',
  ti: 'TI/Dados',
  dpo: 'DPO',
  juridico: 'Jurídico',
  paciente: 'Representante de paciente',
}

const STATUS_LABEL: Record<string, string> = {
  draft: '📝 Rascunho',
  active: '✓ Ativo',
  suspended: '⏸ Suspenso',
}

const STATUS_COLOR: Record<string, string> = {
  draft: 'var(--ev-warning, #f59e0b)',
  active: 'var(--ev-success, #10b981)',
  suspended: 'var(--ev-danger)',
}

export default async function ComiteIaPage() {
  const session = await requireFullSession('/app/settings/compliance/comite-ia')
  const tenantId = session.logifit.tenantId

  const committees = await db
    .select()
    .from(aiCommittees)
    .where(eq(aiCommittees.tenantId, tenantId))
    .orderBy(desc(aiCommittees.createdAt))

  const activeCommittee = committees.find((c) => c.status === 'active') ?? committees[0]

  const [members, decisions] = activeCommittee
    ? await Promise.all([
        db
          .select({
            id: aiCommitteeMembers.id,
            role: aiCommitteeMembers.role,
            startedAt: aiCommitteeMembers.startedAt,
            endedAt: aiCommitteeMembers.endedAt,
            personName: persons.name,
          })
          .from(aiCommitteeMembers)
          .innerJoin(persons, eq(persons.id, aiCommitteeMembers.personId))
          .where(
            and(
              eq(aiCommitteeMembers.committeeId, activeCommittee.id),
              eq(aiCommitteeMembers.tenantId, tenantId),
            ),
          )
          .orderBy(aiCommitteeMembers.role),
        db
          .select()
          .from(aiCommitteeDecisions)
          .where(
            and(
              eq(aiCommitteeDecisions.committeeId, activeCommittee.id),
              eq(aiCommitteeDecisions.tenantId, tenantId),
            ),
          )
          .orderBy(desc(aiCommitteeDecisions.decidedAt))
          .limit(20),
      ])
    : [[], []]

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Comitê de IA</h1>
        <p className="text-sm text-[color:var(--ev-text-muted)]">
          Resolução CFM 2.454/2026 + regra 28 LogiFit. Comitê interno obrigatório pra features IA
          classe SaMD II+. Ata + composição mínima + decisões documentadas.
        </p>
      </header>

      {!activeCommittee ? (
        <div className="rounded-xl border border-[color:var(--ev-warning, #f59e0b)] p-6 space-y-3">
          <p className="font-semibold">⚠ Comitê de IA não cadastrado</p>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            Sem Comitê ativo, features de IA classe SaMD II+ (chat clínico, sugestão diagnóstica,
            etc) ficam bloqueadas. Cadastre Comitê + ata.
          </p>
          <p className="text-xs text-[color:var(--ev-text-muted)]">
            <strong>Composição mínima recomendada</strong> (LogiFit best practice): Coordenador + 1
            profissional regulado (médico/fisio/nutri/enf) + 1 TI/Dados + 1 representante paciente.
          </p>
          <p className="text-xs text-[color:var(--ev-text-muted)]">
            Sprint 06+: form de cadastro + upload de ata em PDF.
          </p>
        </div>
      ) : (
        <>
          <section className="rounded-xl border border-[color:var(--ev-border)] p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">{activeCommittee.name}</h2>
                {activeCommittee.chartedAt && (
                  <p className="text-xs text-[color:var(--ev-text-muted)] tabular-nums">
                    Ata: {new Date(activeCommittee.chartedAt).toLocaleDateString('pt-BR')}
                  </p>
                )}
              </div>
              <span
                className="text-sm font-medium"
                style={{ color: STATUS_COLOR[activeCommittee.status] ?? 'var(--ev-text)' }}
              >
                {STATUS_LABEL[activeCommittee.status] ?? activeCommittee.status}
              </span>
            </div>
            {activeCommittee.chartUrl && (
              <p className="text-xs">
                <a
                  href={activeCommittee.chartUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[color:var(--ev-primary)] hover:underline"
                >
                  📄 Ver ata de constituição
                </a>
              </p>
            )}
          </section>

          <section className="rounded-xl border border-[color:var(--ev-border)] p-5 space-y-3">
            <h2 className="font-semibold">👥 Composição</h2>
            {members.length === 0 ? (
              <p className="text-sm text-[color:var(--ev-text-muted)]">Sem members cadastrados.</p>
            ) : (
              <ul className="divide-y divide-[color:var(--ev-border)] text-sm">
                {members
                  .filter((m) => !m.endedAt)
                  .map((m) => (
                    <li key={m.id} className="py-2 flex items-center justify-between gap-3">
                      <span className="font-medium">{m.personName}</span>
                      <span className="text-xs text-[color:var(--ev-text-muted)]">
                        {ROLE_LABEL[m.role] ?? m.role}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-[color:var(--ev-border)] p-5 space-y-3">
            <h2 className="font-semibold">📋 Decisões recentes ({decisions.length})</h2>
            {decisions.length === 0 ? (
              <p className="text-sm text-[color:var(--ev-text-muted)]">
                Nenhuma decisão registrada ainda.
              </p>
            ) : (
              <ul className="space-y-3 text-sm">
                {decisions.map((d) => (
                  <li
                    key={d.id}
                    className="border-l-2 border-[color:var(--ev-border)] pl-3 space-y-1"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">{d.subject}</span>
                      <span className="text-xs text-[color:var(--ev-text-muted)] tabular-nums">
                        {new Date(d.decidedAt).toLocaleDateString('pt-BR')}
                      </span>
                    </div>
                    <p className="text-xs">
                      <strong className="uppercase tracking-wide">{d.decision}:</strong>{' '}
                      {d.rationale}
                    </p>
                    {d.minuteUrl && (
                      <a
                        href={d.minuteUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-[color:var(--ev-primary)] hover:underline"
                      >
                        Ver ata
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <section className="rounded-xl border border-dashed border-[color:var(--ev-border)] p-6 text-sm text-[color:var(--ev-text-muted)]">
        <p>
          <strong>Sprint 06+:</strong> form de cadastro · upload de ata (MinIO) · workflow de
          votação de decisões · hash chain sha256 das atas · gate de feature flag IA clínica
          verificando `ai_committees.status='active'` antes de liberar.
        </p>
      </section>
    </div>
  )
}
