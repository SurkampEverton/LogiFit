import { db } from '@repo/db/client'
import { allocationRules, tenants } from '@repo/db/schema'
/**
 * `/app/financeiro/rateio/regras` — lista allocation_rules (Sprint 16 Faixa C).
 */
import { and, asc, eq, isNull } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../../lib/session'

export const dynamic = 'force-dynamic'

const KIND_LABELS: Record<string, { label: string; description: string }> = {
  fixed: { label: 'Fixo', description: 'Percentuais explícitos por company (soma=100)' },
  proportional: { label: 'Proporcional', description: 'Pesos relativos por company' },
  per_unit: { label: 'Por unidade', description: 'Distribui proporcional ao nº de units' },
  by_revenue: {
    label: 'Por receita',
    description: 'Snapshot do faturamento do mês anterior',
  },
  by_headcount: { label: 'Por headcount', description: 'Snapshot do número de colaboradores' },
  custom: { label: 'Customizado', description: 'JSON livre desenhado pelo admin' },
}

export default async function AllocationRulesPage() {
  const session = await requireFullSession('/app/financeiro/rateio/regras')
  const tenantId = session.logifit.tenantId

  // Carrega topology pra mostrar aviso se não é owned
  const [tenant] = await db
    .select({ topology: tenants.topology, mode: tenants.mode })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)

  const isOwned = tenant?.topology === 'owned'

  const rows = await db
    .select({
      id: allocationRules.id,
      name: allocationRules.name,
      kind: allocationRules.kind,
      distribution: allocationRules.distribution,
      description: allocationRules.description,
      active: allocationRules.active,
      createdAt: allocationRules.createdAt,
    })
    .from(allocationRules)
    .where(and(eq(allocationRules.tenantId, tenantId), isNull(allocationRules.archivedAt)))
    .orderBy(asc(allocationRules.name))

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Regras de rateio</h1>
        <span style={{ color: 'var(--ev-muted)' }}>{rows.length} ativas</span>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro" className="ev-btn ev-btn-ghost">
          ← Financeiro
        </Link>
        <Link href="/app/financeiro/intercompany" className="ev-btn ev-btn-ghost">
          Intercompany
        </Link>
        {isOwned && (
          <Link href="/app/financeiro/rateio/regras/new" className="ev-btn ev-btn-primary">
            + Nova regra
          </Link>
        )}
      </header>

      {!isOwned && (
        <div
          className="ev-alert ev-alert-warning"
          role="alert"
          style={{ padding: 'var(--ev-space-md)' }}
        >
          <strong>Rateio indisponível</strong> — este tenant tem topology{' '}
          <code>{tenant?.topology ?? '?'}</code>. Rateio + Intercompany só funcionam em{' '}
          <code>owned</code> (regra 25 — franquia opera CNPJs distintos sem vínculo financeiro
          corporativo).
        </div>
      )}

      <p style={{ color: 'var(--ev-muted)', marginTop: 0 }}>
        Regras de rateio distribuem o valor líquido de uma AP em múltiplas companies. Use no momento
        de aprovar a AP (botão "Aplicar rateio" no detalhe) ou crie automação Sprint 16+.
      </p>

      {rows.length === 0 && isOwned && (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p style={{ marginTop: 0 }}>
            Nenhuma regra cadastrada. Cadastre a primeira para começar a ratear contas entre
            filiais.
          </p>
          <Link href="/app/financeiro/rateio/regras/new" className="ev-btn ev-btn-primary">
            Criar primeira regra
          </Link>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 'var(--ev-space-md)',
        }}
      >
        {rows.map((rule) => {
          const meta = KIND_LABELS[rule.kind]!
          const dist = (rule.distribution as Array<Record<string, unknown>> | null) ?? []
          return (
            <Link
              key={rule.id}
              href={`/app/financeiro/rateio/regras/${rule.id}/simular`}
              className="ev-card"
              style={{
                padding: 'var(--ev-space-md)',
                textDecoration: 'none',
                color: 'inherit',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-sm)' }}>
                <strong style={{ fontSize: 'var(--ev-font-md)' }}>{rule.name}</strong>
                <span style={{ flex: 1 }} />
                <span className="ev-badge">{meta.label}</span>
              </div>
              <div style={{ fontSize: 'var(--ev-font-xs)', color: 'var(--ev-muted)' }}>
                {meta.description}
              </div>
              <div style={{ fontSize: 'var(--ev-font-sm)' }}>
                <strong>{dist.length}</strong> {dist.length === 1 ? 'company' : 'companies'}
              </div>
              {rule.description && (
                <p style={{ marginTop: 4, fontSize: 'var(--ev-font-sm)' }}>{rule.description}</p>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
