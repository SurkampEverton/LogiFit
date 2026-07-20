import { db } from '@repo/db/client'
import { equipment, equipmentMaintenance } from '@repo/db/schema'
/**
 * `/app/vigilancia/equipamentos` — lista de equipamentos (Sprint 25 Faixa C).
 */
import { and, asc, eq, sql } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const STATUS_BADGE: Record<string, { label: string; bg: string }> = {
  active: { label: '✓ Ativo', bg: 'var(--ev-success-soft, #dcfce7)' },
  maintenance: { label: '🔧 Manutenção', bg: 'var(--ev-warning-soft, #fef9c3)' },
  decommissioned: { label: '⊘ Baixado', bg: 'var(--ev-muted-soft, #f3f4f6)' },
}

const KIND_LABEL: Record<string, string> = {
  ultrassom: 'Ultrassom',
  tens: 'TENS',
  laser: 'Laser',
  crioterapia: 'Crioterapia',
  eletroestimulacao: 'Eletroestimulação',
  esteira: 'Esteira',
  bicicleta: 'Bicicleta',
  balanca_bioimpedancia: 'Bioimpedância',
  pressao_arterial: 'PA',
  glicosimetro: 'Glicosímetro',
  oximetro: 'Oxímetro',
  outro: 'Outro',
}

export default async function EquipamentosListPage() {
  const session = await requireFullSession('/app/vigilancia/equipamentos')
  const tenantId = session.logifit.tenantId

  const rows = await db
    .select({
      id: equipment.id,
      kind: equipment.kind,
      manufacturer: equipment.manufacturer,
      model: equipment.model,
      serialNumber: equipment.serialNumber,
      anvisaRegistration: equipment.anvisaRegistration,
      acquiredAt: equipment.acquiredAt,
      status: equipment.status,
      lastMaintenanceAt: equipment.lastMaintenanceAt,
      lastCalibrationAt: equipment.lastCalibrationAt,
      maintenanceIntervalDays: equipment.maintenanceIntervalDays,
      calibrationIntervalDays: equipment.calibrationIntervalDays,
      nextMaintenance: sql<string | null>`
        (SELECT MIN(planned_for)::text FROM ${equipmentMaintenance}
         WHERE equipment_id = ${equipment.id} AND status = 'scheduled')`,
    })
    .from(equipment)
    .where(and(eq(equipment.tenantId, tenantId), sql`${equipment.status} != 'decommissioned'`))
    .orderBy(asc(equipment.kind), asc(equipment.manufacturer), asc(equipment.model))
    .limit(500)

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Equipamentos</h1>
        <span style={{ color: 'var(--ev-muted)' }}>{rows.length} ativos</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/vigilancia" className="ev-btn ev-btn-ghost">
          ← Vigilância
        </Link>
        <Link href="/app/vigilancia/equipamentos/new" className="ev-btn ev-btn-primary">
          + Novo equipamento
        </Link>
      </header>

      {rows.length === 0 ? (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p style={{ marginTop: 0 }}>
            Nenhum equipamento cadastrado. Adicione equipamentos regulados ANVISA (ultrassom, TENS,
            laser, crioterapia, bioimpedância, etc).
          </p>
        </div>
      ) : (
        <table className="ev-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Fabricante</th>
              <th>Modelo</th>
              <th>Serial</th>
              <th>ANVISA</th>
              <th>Adquirido</th>
              <th>Última manut.</th>
              <th>Última calibr.</th>
              <th>Próxima</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const st = STATUS_BADGE[e.status] ?? { label: e.status, bg: 'var(--ev-surface)' }
              return (
                <tr key={e.id}>
                  <td>{KIND_LABEL[e.kind] ?? e.kind}</td>
                  <td>{e.manufacturer}</td>
                  <td>{e.model}</td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                    <code>{e.serialNumber}</code>
                  </td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>{e.anvisaRegistration ?? '—'}</td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>{e.acquiredAt}</td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>{e.lastMaintenanceAt ?? '—'}</td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>{e.lastCalibrationAt ?? '—'}</td>
                  <td style={{ fontSize: 'var(--ev-font-xs)' }}>{e.nextMaintenance ?? '—'}</td>
                  <td>
                    <span className="ev-badge" style={{ background: st.bg }}>
                      {st.label}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
