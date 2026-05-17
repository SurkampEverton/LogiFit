/**
 * `/app/rh/profissionais` — lista de contratos profissionais (Sprint 23 Faixa C).
 */
import { desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { persons, professionalContracts } from '@repo/db/schema'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, string> = {
  percent_faturamento: '% Faturamento',
  percent_recebido: '% Recebido',
  fixo_por_atendimento: 'R$ Fixo / Atendimento',
  tabela_por_servico: 'Tabela por serviço',
}

function formatBrl(cents: number | null): string {
  if (cents == null) return '—'
  return (Number(cents) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default async function ProfissionaisPage() {
  const session = await requireFullSession('/app/rh/profissionais')
  const tenantId = session.logifit.tenantId

  const rows = await db
    .select({
      id: professionalContracts.id,
      personId: professionalContracts.personId,
      personName: persons.name,
      serviceType: professionalContracts.serviceType,
      kind: professionalContracts.kind,
      base: professionalContracts.base,
      defaultPercent: professionalContracts.defaultPercent,
      defaultAmountCents: professionalContracts.defaultAmountCents,
      version: professionalContracts.version,
      effectiveFrom: professionalContracts.effectiveFrom,
      active: professionalContracts.active,
    })
    .from(professionalContracts)
    .leftJoin(persons, eq(persons.id, professionalContracts.personId))
    .where(eq(professionalContracts.tenantId, tenantId))
    .orderBy(desc(professionalContracts.createdAt))
    .limit(200)

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Profissionais + Contratos</h1>
        <span style={{ color: 'var(--ev-muted)' }}>{rows.length} contratos</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/rh" className="ev-btn ev-btn-ghost">
          ← RH
        </Link>
      </header>

      <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <p style={{ marginTop: 0, marginBottom: 0 }}>
          Cada contrato vincula <strong>person × company × service_type</strong>{' '}
          com versão imutável após approve. Gate ADR 0055 valida{' '}
          <code>professional_registrations</code> ativo coerente com o serviço
          (fisio→CREFITO, personal→CREF, nutri→CRN, medico→CRM).
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p style={{ marginTop: 0 }}>Nenhum contrato cadastrado.</p>
        </div>
      ) : (
        <table className="ev-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Profissional</th>
              <th>Serviço</th>
              <th>Tipo</th>
              <th>Base</th>
              <th>Default</th>
              <th>v</th>
              <th>Desde</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>{c.personName ?? '—'}</td>
                <td>{c.serviceType}</td>
                <td>{KIND_LABEL[c.kind] ?? c.kind}</td>
                <td style={{ fontSize: 'var(--ev-font-xs)' }}>{c.base}</td>
                <td>
                  {c.defaultPercent != null
                    ? `${Number(c.defaultPercent).toFixed(2)}%`
                    : formatBrl(c.defaultAmountCents)}
                </td>
                <td>{c.version}</td>
                <td style={{ fontSize: 'var(--ev-font-xs)' }}>{c.effectiveFrom}</td>
                <td>{c.active ? '✓ ativo' : '⊘ inativo'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
