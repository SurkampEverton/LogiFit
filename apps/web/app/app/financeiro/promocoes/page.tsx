import { db } from '@repo/db/client'
import { promotions } from '@repo/db/schema'
/**
 * `/app/financeiro/promocoes` — lista cupons (Sprint 05 Faixa C).
 */
import { and, desc, eq, isNull } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, string> = {
  percent: '% desconto',
  fixed: 'R$ fixo',
  trial_days: 'Dias trial',
}

function formatValue(kind: string, value: number): string {
  if (kind === 'percent') return `${(value / 100).toFixed(2)}%`
  if (kind === 'fixed') return `R$ ${(value / 100).toFixed(2)}`
  if (kind === 'trial_days') return `${value} dia${value === 1 ? '' : 's'}`
  return String(value)
}

export default async function PromocoesPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>
}) {
  const session = await requireFullSession('/app/financeiro/promocoes')
  const params = await searchParams
  const includeArchived = params.archived === '1'

  const conditions = [eq(promotions.tenantId, session.logifit.tenantId)]
  if (!includeArchived) conditions.push(isNull(promotions.archivedAt))

  const rows = await db
    .select()
    .from(promotions)
    .where(and(...conditions))
    .orderBy(desc(promotions.createdAt))
    .limit(200)

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <nav className="text-sm">
        <Link href="/app/financeiro" className="text-[color:var(--ev-text-muted)] hover:underline">
          ← Voltar para Financeiro
        </Link>
      </nav>

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Promoções</h1>
          <p className="text-sm text-[color:var(--ev-text-muted)]">
            Cupons de desconto aplicáveis em invoices pendentes.
          </p>
        </div>
        <Link
          href="/app/financeiro/promocoes/new"
          className="rounded-md bg-[color:var(--ev-primary)] px-4 py-2 font-medium text-[color:var(--ev-primary-foreground)]"
          style={{ minHeight: 'var(--ev-touch-min, 44px)' }}
        >
          + Nova promoção
        </Link>
      </header>

      <div className="flex items-center gap-3 text-sm">
        <Link
          href={
            includeArchived ? '/app/financeiro/promocoes' : '/app/financeiro/promocoes?archived=1'
          }
          className="text-[color:var(--ev-primary)] hover:underline"
        >
          {includeArchived ? 'Ocultar arquivadas' : 'Mostrar arquivadas'}
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[color:var(--ev-border)] p-8 text-center">
          <p className="text-[color:var(--ev-text-muted)]">Nenhuma promoção cadastrada.</p>
          <Link
            href="/app/financeiro/promocoes/new"
            className="mt-3 inline-block font-medium text-[color:var(--ev-primary)]"
          >
            Cadastrar primeira →
          </Link>
        </div>
      ) : (
        <section className="rounded-xl border border-[color:var(--ev-border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[color:var(--ev-surface-muted)] text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Código</th>
                <th className="px-4 py-3 font-medium">Nome</th>
                <th className="px-4 py-3 font-medium">Tipo</th>
                <th className="px-4 py-3 font-medium">Valor</th>
                <th className="px-4 py-3 font-medium">Usos</th>
                <th className="px-4 py-3 font-medium">Validade</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-[color:var(--ev-border)]">
                  <td className="px-4 py-3 font-mono font-medium">{p.code}</td>
                  <td className="px-4 py-3">{p.name}</td>
                  <td className="px-4 py-3 text-[color:var(--ev-text-muted)]">
                    {KIND_LABEL[p.kind] ?? p.kind}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{formatValue(p.kind, p.value)}</td>
                  <td className="px-4 py-3 tabular-nums text-[color:var(--ev-text-muted)]">
                    {p.usesCount}
                    {p.maxUses !== null ? `/${p.maxUses}` : ''}
                  </td>
                  <td className="px-4 py-3 text-xs text-[color:var(--ev-text-muted)] tabular-nums">
                    {new Date(p.validFrom).toLocaleDateString('pt-BR')}
                    {p.validTo ? ` → ${new Date(p.validTo).toLocaleDateString('pt-BR')}` : ' → ∞'}
                  </td>
                  <td className="px-4 py-3">
                    {p.archivedAt ? (
                      <span className="text-[color:var(--ev-text-muted)]">Arquivada</span>
                    ) : p.active ? (
                      <span className="text-[color:var(--ev-success, #10b981)]">Ativa</span>
                    ) : (
                      <span className="text-[color:var(--ev-text-muted)]">Inativa</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
