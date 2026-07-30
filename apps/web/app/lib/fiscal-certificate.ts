/**
 * Carregamento do certificado A1 para assinatura — Sprint 41a.2 (ADR 0108).
 *
 * O caminho inverso do cadastro: lê a linha ativa de `company_certificates`,
 * decifra e devolve o certificado pronto para `signXml()`.
 *
 * **A chave privada nunca sai do servidor.** `ParsedCertificate.privateKey` é um
 * `SecretPem`, que redige em log, JSON e inspetor do Node — mas a garantia real
 * é esta função nunca ser chamada de client component nem o retorno atravessar
 * o envelope de uma Server Action. Só a camada de emissão consome.
 *
 * A decifra fica aqui, na aplicação, e não em `@repo/fiscal`: mesmo padrão do
 * `resolveFiscalProvider`, que mantém o package puro e concentra o acesso ao
 * segredo em quem já tem sessão e RLS aplicados.
 */

import { db } from '@repo/db/client'
import { companyCertificates } from '@repo/db/schema'
import { ApiException } from '@repo/errors'
import { type ParsedCertificate, parsePkcs12 } from '@repo/fiscal'
import { decryptSecret } from '@repo/security'
import { and, eq } from 'drizzle-orm'

/**
 * Formato de armazenamento do `.pfx`.
 *
 * O schema do Sprint 17 declarou `encrypted_pfx bytea` + `encrypted_password
 * text`, mas nunca chegou a ser escrito — a tabela nasceu para a recepção de
 * NF-e (ADR 0038), que lê certificado por outro caminho. A convenção fica
 * definida aqui:
 *
 *   - senha  → envelope inline `enc:v1:…` direto na coluna `text`
 *   - `.pfx` → o **mesmo** envelope, sobre o base64 dos bytes, gravado como
 *     UTF-8 na coluna `bytea`
 *
 * Inline e não columnar (`encryptSecretParts`, do Sprint 36b) porque aqui não há
 * ganho em espalhar nonce e tag por colunas: o envelope é autodescritivo, já
 * carrega a versão para rotação, e o binário precisaria de base64 de qualquer
 * forma.
 */
export function encodePfxForStorage(envelope: string): Buffer {
  return Buffer.from(envelope, 'utf8')
}

function decodePfxFromStorage(stored: Buffer): Buffer {
  return Buffer.from(decryptSecret(stored.toString('utf8')), 'base64')
}

/** Certificado + metadados de rastreio, para gravar em `audit_log`. */
export interface LoadedCertificate {
  certificate: ParsedCertificate
  certificateId: string
  expiresAt: Date
}

/**
 * Carrega o certificado ativo da company.
 *
 * @throws ApiException `VALIDATION_ERROR` quando não há certificado, com a
 * mensagem que diz onde cadastrar — regra 47: abortar antes de qualquer chamada
 * externa, com erro acionável, nunca emitir sem assinar.
 */
export async function loadCompanyCertificate(
  tenantId: string,
  companyId: string,
  now: Date,
): Promise<LoadedCertificate> {
  const [row] = await db
    .select()
    .from(companyCertificates)
    .where(
      and(
        eq(companyCertificates.tenantId, tenantId),
        eq(companyCertificates.companyId, companyId),
        eq(companyCertificates.status, 'active'),
      ),
    )
    .limit(1)

  if (!row) {
    throw new ApiException({
      code: 'VALIDATION_ERROR',
      message:
        'Esta empresa não tem certificado digital A1 cadastrado. Cadastre em Configurações → Fiscal → Certificado antes de emitir.',
      request_id: '',
    })
  }

  // Expiração é checada aqui e não só no cadastro: o certificado vence com o
  // sistema parado, e o alerta de 30/15/7 dias pode ter sido ignorado.
  if (row.expiresAt <= now) {
    throw new ApiException({
      code: 'VALIDATION_ERROR',
      message: `O certificado digital desta empresa venceu em ${row.expiresAt.toLocaleDateString('pt-BR')}. Renove na sua Autoridade Certificadora e faça o upload do novo antes de emitir.`,
      request_id: '',
    })
  }

  return {
    certificate: parsePkcs12(
      decodePfxFromStorage(row.encryptedPfx),
      decryptSecret(row.encryptedPassword),
    ),
    certificateId: row.id,
    expiresAt: row.expiresAt,
  }
}
