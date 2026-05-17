/**
 * `/app/fisio/convenios` — lista de planos + acordos (Sprint 22 Faixa C).
 */
import { and, asc, eq, sql } from 'drizzle-orm'
import Link from 'next/link'
import { db } from '@repo/db/client'
import {
  insuranceAgreements,
  insurancePlans,
  persons,
  companies,
} from '@repo/db/schema'
import { requireFullSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

export default async function ConveniosPage() {
  const session = await requireFullSession('/app/fisio/convenios')
  const tenantId = session.logifit.tenantId

  const plans = await db
    .select()
    .from(insurancePlans)
    .where(sql`tenant_id IS NULL OR tenant_id = ${tenantId}`)
    .orderBy(asc(insurancePlans.name))
    .limit(100)

  const agreements = await db
    .select({
      id: insuranceAgreements.id,
      planName: insurancePlans.name,
      ansCode: insurancePlans.ansCode,
      contractNumber: insuranceAgreements.contractNumber,
      paymentTermDays: insuranceAgreements.paymentTermDays,
      effectiveFrom: insuranceAgreements.effectiveFrom,
      active: insuranceAgreements.active,
      companyName: persons.name,
    })
    .from(insuranceAgreements)
    .leftJoin(insurancePlans, eq(insurancePlans.id, insuranceAgreements.planId))
    .leftJoin(companies, eq(companies.id, insuranceAgreements.companyId))
    .leftJoin(persons, eq(persons.id, companies.personId))
    .where(eq(insuranceAgreements.tenantId, tenantId))
    .orderBy(asc(insurancePlans.name))

  return (
    <div className="ev-stack" style={{ padding: 'var(--ev-space-lg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--ev-space-md)' }}>
        <h1 style={{ margin: 0 }}>Convênios TISS</h1>
        <span style={{ color: 'var(--ev-muted)' }}>
          TISS 4.01 · {plans.length} planos · {agreements.length} acordos
        </span>
        <span style={{ flex: 1 }} />
        <Link href="/app/fisio/autorizacoes" className="ev-btn ev-btn-ghost">
          🔑 Autorizações
        </Link>
        <Link href="/app/fisio/faturamento" className="ev-btn ev-btn-ghost">
          🧾 Faturamento
        </Link>
        <Link href="/app/fisio/glosas" className="ev-btn ev-btn-ghost">
          ⚠ Glosas
        </Link>
      </header>

      <div className="ev-card" style={{ padding: 'var(--ev-space-md)' }}>
        <p style={{ marginTop: 0, marginBottom: 0 }}>
          Padrão vigente <strong>TISS 4.01</strong> (Ofício-Circular ANS nº 1/2026).
          Validador proativo bloqueia envio com erros conhecidos antes da glosa.
          Pipeline de atualização semestral da terminologia TUSS (próxima janela:
          julho/2026).
        </p>
      </div>

      <h2>Planos cadastrados</h2>
      {plans.length === 0 ? (
        <p style={{ color: 'var(--ev-muted)' }}>Nenhum plano cadastrado.</p>
      ) : (
        <table className="ev-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Código ANS</th>
              <th>Escopo</th>
              <th>TISS</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td style={{ fontSize: 'var(--ev-font-xs)' }}>{p.ansCode ?? '—'}</td>
                <td style={{ fontSize: 'var(--ev-font-xs)' }}>
                  {p.tenantId == null ? '🌐 Global' : '🏠 Tenant'}
                </td>
                <td>{p.tissVersion}</td>
                <td>{p.active ? '✓' : '⊘'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Acordos comerciais</h2>
      {agreements.length === 0 ? (
        <div className="ev-card" style={{ padding: 'var(--ev-space-lg)' }}>
          <p style={{ marginTop: 0 }}>
            Nenhum acordo registrado. Adicione um para começar a faturar pelo TISS.
          </p>
        </div>
      ) : (
        <table className="ev-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Plano</th>
              <th>Company</th>
              <th>Contrato</th>
              <th>Prazo pagto</th>
              <th>Vigência</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {agreements.map((a) => (
              <tr key={a.id}>
                <td>{a.planName ?? '—'}</td>
                <td style={{ fontSize: 'var(--ev-font-xs)' }}>{a.companyName ?? '—'}</td>
                <td style={{ fontSize: 'var(--ev-font-xs)' }}>{a.contractNumber ?? '—'}</td>
                <td>{a.paymentTermDays}d</td>
                <td style={{ fontSize: 'var(--ev-font-xs)' }}>{a.effectiveFrom}</td>
                <td>{a.active ? '✓ ativo' : '⊘ inativo'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
