/**
 * `/app/settings/fiscal/certificado` — cadastro do certificado A1 (Sprint 41a.2).
 *
 * Fecha a ponte do ADR 0108: a tabela `company_certificates` existe desde o
 * Sprint 17 e o leitor de `.pfx` desde o 41a, mas não havia como cadastrar. Sem
 * esta tela, a emissão própria não sai do papel — nenhuma nota é assinada sem
 * certificado.
 */
import { db } from '@repo/db/client'
import { companies, companyCertificates, persons } from '@repo/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import Link from 'next/link'
import { requireFullSession } from '../../../../lib/session'
import {
  type CertificateCompanyOption,
  CertificateForm,
  type CertificateRow,
} from './certificate-form'

export const dynamic = 'force-dynamic'

const MS_PER_DAY = 24 * 60 * 60 * 1000

function formatCnpj(digits: string | null): string | null {
  if (!digits || digits.length !== 14) return digits
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

export default async function CertificadoPage() {
  const session = await requireFullSession('/app/settings/fiscal/certificado')
  const tenantId = session.logifit.tenantId

  // Razão social e CNPJ vivem em `persons`, não em `companies` — cadastro
  // central (ADR 0047, regra 22). `companies` só guarda o que é da PJ operacional.
  const companyRows = await db
    .select({ id: companies.id, name: persons.name, cnpj: persons.document })
    .from(companies)
    .innerJoin(persons, eq(companies.personId, persons.id))
    .where(eq(companies.tenantId, tenantId))
    .orderBy(persons.name)

  const options: CertificateCompanyOption[] = companyRows.map((c) => ({
    id: c.id,
    name: c.name,
    cnpjLabel: formatCnpj(c.cnpj),
  }))

  const primaryCompanyId = options[0]?.id

  const certRows = primaryCompanyId
    ? await db
        .select({
          id: companyCertificates.id,
          subjectCn: companyCertificates.subjectCn,
          cnpj: companyCertificates.subjectCnpj,
          issuer: companyCertificates.issuer,
          expiresAt: companyCertificates.expiresAt,
          status: companyCertificates.status,
        })
        .from(companyCertificates)
        .where(
          and(
            eq(companyCertificates.tenantId, tenantId),
            eq(companyCertificates.companyId, primaryCompanyId),
          ),
        )
        .orderBy(desc(companyCertificates.uploadedAt))
        .limit(20)
    : []

  const now = Date.now()
  const certificates: CertificateRow[] = certRows.map((c) => ({
    id: c.id,
    subjectCn: c.subjectCn ?? '',
    cnpj: formatCnpj(c.cnpj),
    issuer: c.issuer,
    expiresAtLabel: c.expiresAt.toLocaleDateString('pt-BR'),
    status: c.status,
    daysUntilExpiry: Math.floor((c.expiresAt.getTime() - now) / MS_PER_DAY),
  }))

  return (
    <main className="flex flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-col gap-1">
        <Link href="/app/settings/fiscal" className="text-sm text-[var(--ev-text-muted)]">
          ← Configurações fiscais
        </Link>
        <h1 className="text-xl font-semibold">Certificado digital A1</h1>
        <p className="text-sm text-[var(--ev-text-muted)]">
          É com este certificado que o LogiFit assina as notas fiscais em nome da empresa. Sem ele
          não há emissão.
        </p>
      </header>

      {options.length === 0 ? (
        <p className="ev-banner ev-banner--info">
          Cadastre uma empresa em Configurações → Empresas antes de subir o certificado.
        </p>
      ) : (
        <CertificateForm companies={options} certificates={certificates} />
      )}
    </main>
  )
}
