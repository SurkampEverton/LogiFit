/**
 * `/app/financeiro/bancos/new` — adicionar conta bancária (Sprint 17 Faixa C).
 */
import { asc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import { companies, persons } from '@repo/db/schema'
import { requireFullSession } from '../../../../lib/session'
import { NewBankAccountForm } from './new-bank-account-form'

export const dynamic = 'force-dynamic'

export default async function NewBankAccountPage() {
  const session = await requireFullSession('/app/financeiro/bancos/new')
  const tenantId = session.logifit.tenantId

  const companyList = await db
    .select({ id: companies.id, name: persons.name })
    .from(companies)
    .leftJoin(persons, eq(persons.id, companies.personId))
    .where(eq(companies.tenantId, tenantId))
    .orderBy(asc(persons.name))

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Adicionar conta bancária</h1>
        <span style={{ flex: 1 }} />
        <Link href="/app/financeiro/bancos" className="ev-btn ev-btn-ghost">
          ← Bancos
        </Link>
      </header>

      <p style={{ color: 'var(--ev-muted)', marginTop: 0 }}>
        Conta cadastrada manualmente. <strong>Open Finance</strong> (sync automático via Pluggy/Belvo)
        chega no Sprint 17b após POC do provider (ADR 0037). Por enquanto, importe extrato via{' '}
        <strong>OFX</strong> (botão "Importar OFX" no extrato da conta).
      </p>

      {companyList.length === 0 ? (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p>Cadastre uma company antes de adicionar conta bancária.</p>
        </div>
      ) : (
        <NewBankAccountForm
          companies={companyList.map((c) => ({ id: c.id, name: c.name ?? '(sem nome)' }))}
        />
      )}
    </div>
  )
}
