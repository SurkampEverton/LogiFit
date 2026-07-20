import { db } from '@repo/db/client'
/**
 * `/app/vigilancia` — hub vigilância sanitária (Sprint 25 Faixa C).
 */
import { sql } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../lib/session'

export const dynamic = 'force-dynamic'

export default async function VigilanciaHubPage() {
  const session = await requireFullSession('/app/vigilancia')
  const tenantId = session.logifit.tenantId

  const [k] = (
    await db.execute(sql`
      SELECT
        (SELECT COUNT(*)::int FROM equipment WHERE tenant_id = ${tenantId} AND status != 'decommissioned') AS equipment_count,
        (SELECT COUNT(*)::int FROM equipment_maintenance WHERE tenant_id = ${tenantId} AND status = 'scheduled' AND planned_for < NOW()::date) AS overdue_count,
        (SELECT COUNT(*)::int FROM equipment_maintenance WHERE tenant_id = ${tenantId} AND status = 'scheduled' AND planned_for BETWEEN NOW()::date AND (NOW() + INTERVAL '7 days')::date) AS d7_count,
        (SELECT COUNT(*)::int FROM cleaning_logs WHERE tenant_id = ${tenantId} AND performed_at > NOW() - INTERVAL '24 hours') AS cleaning_24h,
        (SELECT COUNT(DISTINCT equipment_id)::int FROM equipment_usage_log WHERE tenant_id = ${tenantId} AND used_at > NOW() - INTERVAL '7 days') AS equips_used_7d
    `)
  ).rows as Array<{
    equipment_count: number
    overdue_count: number
    d7_count: number
    cleaning_24h: number
    equips_used_7d: number
  }>
  const kpi = k ?? {
    equipment_count: 0,
    overdue_count: 0,
    d7_count: 0,
    cleaning_24h: 0,
    equips_used_7d: 0,
  }

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Vigilância Sanitária</h1>
        <span style={{ color: 'var(--ev-muted)' }}>ANVISA + CNES + Limpeza · Sprint 25a</span>
      </header>

      <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <p style={{ marginTop: 0, marginBottom: 0 }}>
          Cadastro de equipamentos regulados (ANVISA RDC 657/2022) + rastreabilidade clínica +
          cronograma de manutenção/calibração + checklist de limpeza diária. Sprint 25b integra
          Datasus CNES + fluxo NF-e remessa/retorno (ADR 0059) + bucket Storage para certificados.
        </p>
      </div>

      <section
        className="ev-card"
        style={{
          padding: 'var(--ev-space-md)',
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 'var(--ev-space-md)',
        }}
      >
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Equipamentos ativos
          </div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>
            {kpi.equipment_count}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Manutenções vencidas
          </div>
          <div
            style={{
              fontSize: 'var(--ev-font-lg)',
              fontWeight: 600,
              color: kpi.overdue_count > 0 ? 'var(--ev-danger, #b91c1c)' : undefined,
            }}
          >
            {kpi.overdue_count}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Próximas 7 dias
          </div>
          <div
            style={{
              fontSize: 'var(--ev-font-lg)',
              fontWeight: 600,
              color: kpi.d7_count > 0 ? 'var(--ev-warning, #ca8a04)' : undefined,
            }}
          >
            {kpi.d7_count}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Limpezas 24h
          </div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>{kpi.cleaning_24h}</div>
        </div>
        <div>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Equips usados 7d
          </div>
          <div style={{ fontSize: 'var(--ev-font-lg)', fontWeight: 600 }}>{kpi.equips_used_7d}</div>
        </div>
      </section>

      <nav
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 'var(--ev-space-md)',
        }}
      >
        <Link
          href="/app/vigilancia/equipamentos"
          className="ev-card"
          style={{ padding: 'var(--ev-space-md)' }}
        >
          <strong>🩺 Equipamentos</strong>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Catálogo + cronograma de manutenção
          </div>
        </Link>
        <Link
          href="/app/vigilancia/limpeza"
          className="ev-card"
          style={{ padding: 'var(--ev-space-md)' }}
        >
          <strong>🧼 Limpeza</strong>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Checklists + logs diários
          </div>
        </Link>
        <Link
          href="/app/vigilancia/relatorios"
          className="ev-card"
          style={{ padding: 'var(--ev-space-md)' }}
        >
          <strong>📋 Relatórios</strong>
          <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
            Exportação para fiscalização
          </div>
        </Link>
      </nav>
    </div>
  )
}
