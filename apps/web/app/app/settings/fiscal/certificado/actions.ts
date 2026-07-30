'use server'

/**
 * Server Actions — certificado digital A1 por company (Sprint 41a.2, ADR 0108).
 *
 * Fecha a ponte que faltava: a tabela `company_certificates` existe desde o
 * Sprint 17 e o leitor de `.pfx` desde o 41a, mas nada permitia cadastrar.
 *
 * **O arquivo é write-only.** Entra, é validado, cifrado e gravado; nunca sai.
 * `listCompanyCertificates` devolve só metadados (titular, CNPJ, validade,
 * status) — o `.pfx` e a senha não atravessam o envelope de retorno em hipótese
 * alguma.
 *
 * **Gate duplo (regra 43):** `fiscal.admin` + MFA recente de 15 min, porque o
 * certificado é a chave que autoriza emitir nota em nome do cliente. Quem troca
 * o certificado passa a assinar por ele.
 */

import { db } from '@repo/db/client'
import { companies, companyCertificates, persons } from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { CertificateRejectedError, validateCertificateUpload } from '@repo/fiscal'
import { encryptSecret } from '@repo/security'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { encodePfxForStorage } from '../../../../lib/fiscal-certificate'
import { requirePermission } from '../../../../lib/permissions'
import { wrapServerAction } from '../../../../lib/wrap-action'

const UploadSchema = z.object({
  companyId: z.string().uuid(),
  /** Conteúdo do `.pfx` em base64 — o form lê o arquivo no client. */
  pfxBase64: z.string().min(1).max(120_000),
  /** Senha de exportação do certificado. Nunca persistida em claro. */
  password: z.string().min(1).max(256),
})

export interface CertificateSummary {
  id: string
  subjectCn: string
  cnpj: string | null
  issuer: string | null
  expiresAt: Date
  status: string
  uploadedAt: Date
  lastUsedAt: Date | null
  /** Negativo quando já venceu. Alimenta o aviso na tela. */
  daysUntilExpiry: number
}

/**
 * Cadastra (ou substitui) o certificado A1 da company.
 *
 * A validação roda **antes** de cifrar: senha errada, CNPJ de outra empresa,
 * arquivo vencido ou exportado sem chave privada são recusados com mensagem que
 * diz o que fazer. Cada um desses só apareceria na primeira emissão se passasse
 * daqui — que é o pior momento para descobrir.
 */
export const uploadCompanyCertificate = wrapServerAction(
  {
    module: 'fiscal',
    // Casa com HIGH_RISK_ACTIONS: o wrapper exige MFA recente por este nome.
    action: 'uploadCompanyCertificate',
    resourceType: 'company_certificates',
  },
  async (input: z.infer<typeof UploadSchema>, { session, setAuditResource }) => {
    await requirePermission(session.logifit.userId, 'fiscal.admin')
    const parsed = UploadSchema.parse(input)

    const company = await loadCompanyCnpj(session.logifit.tenantId, parsed.companyId)

    let certificate: ReturnType<typeof validateCertificateUpload>
    try {
      certificate = validateCertificateUpload({
        pfx: Buffer.from(parsed.pfxBase64, 'base64'),
        password: parsed.password,
        expectedCnpj: company.cnpj,
        now: new Date(),
      })
    } catch (e) {
      if (e instanceof CertificateRejectedError) {
        // A mensagem do domínio já é acionável; traduzir para "erro ao validar
        // certificado" perderia justamente o que o operador precisa saber.
        throw new ApiException({
          code: 'VALIDATION_ERROR',
          message: e.message,
          request_id: '',
          details: { rejection: e.rejection },
        })
      }
      throw e
    }

    // Substituição, não acúmulo: uma company assina com um certificado por vez.
    // O anterior vira `replaced` em vez de sumir — o histórico responde "com
    // qual certificado esta nota foi assinada?" numa auditoria.
    const [inserted] = await db.transaction(async (tx) => {
      await tx
        .update(companyCertificates)
        .set({ status: 'replaced', revokedAt: new Date() })
        .where(
          and(
            eq(companyCertificates.tenantId, session.logifit.tenantId),
            eq(companyCertificates.companyId, parsed.companyId),
            eq(companyCertificates.status, 'active'),
          ),
        )

      return await tx
        .insert(companyCertificates)
        .values({
          tenantId: session.logifit.tenantId,
          companyId: parsed.companyId,
          kind: 'a1',
          subjectCn: certificate.subjectCn,
          subjectCnpj: certificate.cnpj,
          issuer: certificate.issuer,
          serialNumber: certificate.serialNumber,
          encryptedPfx: encodePfxForStorage(encryptSecret(parsed.pfxBase64)),
          encryptedPassword: encryptSecret(parsed.password),
          validFrom: certificate.notBefore,
          expiresAt: certificate.notAfter,
          status: 'active',
          uploadedByUserId: session.logifit.userId,
        })
        .returning({ id: companyCertificates.id })
    })

    // Rastreia em audit_log qual certificado passou a valer (regra 5 + 39).
    if (inserted) setAuditResource(inserted.id, { subjectCnpj: certificate.cnpj })

    // Retorno sem nada de sensível — só o que a tela precisa confirmar.
    return {
      subjectCn: certificate.subjectCn,
      cnpj: certificate.cnpj,
      expiresAt: certificate.notAfter,
    }
  },
)

/** Metadados dos certificados da company. Nunca devolve arquivo nem senha. */
export const listCompanyCertificates = wrapServerAction(
  { module: 'fiscal', action: 'certificate.list' },
  async (input: { companyId: string }, { session }) => {
    const { companyId } = z.object({ companyId: z.string().uuid() }).parse(input)
    await requirePermission(session.logifit.userId, 'fiscal.read')

    const rows = await db
      .select({
        id: companyCertificates.id,
        subjectCn: companyCertificates.subjectCn,
        cnpj: companyCertificates.subjectCnpj,
        issuer: companyCertificates.issuer,
        expiresAt: companyCertificates.expiresAt,
        status: companyCertificates.status,
        uploadedAt: companyCertificates.uploadedAt,
        lastUsedAt: companyCertificates.lastUsedAt,
      })
      .from(companyCertificates)
      .where(
        and(
          eq(companyCertificates.tenantId, session.logifit.tenantId),
          eq(companyCertificates.companyId, companyId),
        ),
      )
      .orderBy(desc(companyCertificates.uploadedAt))
      .limit(20)

    const now = Date.now()
    const MS_PER_DAY = 24 * 60 * 60 * 1000
    return rows.map(
      (r): CertificateSummary => ({
        ...r,
        subjectCn: r.subjectCn ?? '',
        daysUntilExpiry: Math.floor((r.expiresAt.getTime() - now) / MS_PER_DAY),
      }),
    )
  },
)

/**
 * Revoga o certificado ativo.
 *
 * Sem `DELETE`: a linha vira `revoked` e permanece. Apagar quebraria a
 * rastreabilidade de qual material assinou cada nota já emitida — e nota
 * assinada não deixa de existir porque o certificado saiu do ar.
 */
export const revokeCompanyCertificate = wrapServerAction(
  {
    module: 'fiscal',
    action: 'revokeCompanyCertificate',
    resourceType: 'company_certificates',
  },
  async (input: { certificateId: string }, { session }) => {
    const { certificateId } = z.object({ certificateId: z.string().uuid() }).parse(input)
    await requirePermission(session.logifit.userId, 'fiscal.admin')

    const updated = await db
      .update(companyCertificates)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(
        and(
          eq(companyCertificates.id, certificateId),
          eq(companyCertificates.tenantId, session.logifit.tenantId),
          eq(companyCertificates.status, 'active'),
        ),
      )
      .returning({ id: companyCertificates.id })

    if (updated.length === 0) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Certificado não encontrado ou já revogado.',
        request_id: '',
      })
    }
    return { revoked: true }
  },
)

/**
 * CNPJ da company, para conferir contra o titular do certificado.
 *
 * O CNPJ vive em `persons` e não em `companies` (regra 22, ADR 0047 — cadastro
 * central), daí o join.
 */
async function loadCompanyCnpj(tenantId: string, companyId: string): Promise<{ cnpj: string }> {
  const [row] = await db
    .select({ cnpj: persons.document })
    .from(companies)
    .innerJoin(persons, eq(companies.personId, persons.id))
    .where(and(eq(companies.id, companyId), eq(companies.tenantId, tenantId)))
    .limit(1)

  if (!row?.cnpj) {
    throw new ApiException({
      code: 'VALIDATION_ERROR',
      message:
        'Esta empresa não tem CNPJ cadastrado — sem ele não há como conferir se o certificado pertence a ela. Complete o cadastro em Configurações → Empresas.',
      request_id: '',
    })
  }
  return { cnpj: row.cnpj }
}
