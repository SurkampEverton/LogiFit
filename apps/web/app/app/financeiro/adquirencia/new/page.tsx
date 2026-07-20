import { db } from '@repo/db/client'
import { bankAccounts, companies, persons } from '@repo/db/schema'
/**
 * `/app/financeiro/adquirencia/new` — formulário pra conectar maquininha (Sprint 18 Faixa C).
 */
import { and, asc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../../lib/session'
import { NewAcquirerConnectionForm } from './new-acquirer-connection-form'

export const dynamic = 'force-dynamic'

export default async function NewAdquirenciaPage() {
  const session = await requireFullSession('/app/financeiro/adquirencia/new')
  const tenantId = session.logifit.tenantId

  const companiesRows = await db
    .select({ id: companies.id, name: persons.name })
    .from(companies)
    .leftJoin(persons, eq(persons.id, companies.personId))
    .where(eq(companies.tenantId, tenantId))
    .orderBy(asc(persons.name))

  const bankAccountsRows = await db
    .select({
      id: bankAccounts.id,
      nickname: bankAccounts.nickname,
      bankName: bankAccounts.bankName,
    })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.tenantId, tenantId)))

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)', maxWidth: 720 }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Nova maquininha</h1>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro/adquirencia" className="ev-btn ev-btn-ghost">
          ← Voltar
        </Link>
      </header>

      <div
        className="ev-card"
        style={{ padding: 'var(--ev-space-md)', background: 'var(--ev-info-soft, #eff6ff)' }}
      >
        <strong>MVP — provider mock no Sprint 18a:</strong> Adapters reais
        (Cielo/Stone/Rede/GetNet/PagSeguro) entram no Sprint 18b após POC com credentials sandbox.
        Use <code>mock</code> + sandbox=true para gerar vendas determinísticas que exercitam toda a
        pipeline (sync → conciliação → antecipação). ADR 0039.
      </div>

      <NewAcquirerConnectionForm
        companies={companiesRows.map((c) => ({ id: c.id, name: c.name ?? '—' }))}
        bankAccounts={bankAccountsRows.map((b) => ({
          id: b.id,
          name: b.nickname ?? b.bankName,
        }))}
      />
    </div>
  )
}
