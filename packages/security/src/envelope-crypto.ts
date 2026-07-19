/**
 * Envelope encryption — Sprint 04 Faixa B (regra 35 defense-in-depth).
 *
 * Cifra dados sensíveis (asaas_keys.api_key, futuras chaves Focus NFe, etc)
 * com AES-256-GCM. Chave-mestre em env `LOGIFIT_DATA_KEY` (32 bytes base64),
 * gerada por `openssl rand -base64 32` no setup do tenant.
 *
 * **Formato armazenado**: `enc:v1:{base64 iv (12 bytes)}:{base64 ciphertext+tag}`.
 * Prefixo `enc:v1:` marca versão pra rotação futura (v2 trocaria algoritmo).
 *
 * Sprint 04+ Faixa C: chave-mestre por tenant em KMS externo (AWS KMS, Cloud KMS).
 * MVP usa chave única do app — risco menor pra escala atual (10 tenants beta).
 *
 * Nunca log valor cifrado nem chave. Toda função usa `node:crypto` (síncrono),
 * Edge runtime não suportado.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // AES-GCM padrão recomendado
const TAG_LENGTH = 16 // 128 bits
const KEY_LENGTH = 32 // 256 bits

function getKey(): Buffer {
  const raw = process.env.LOGIFIT_DATA_KEY
  if (!raw) {
    throw new Error(
      'envelope-crypto: LOGIFIT_DATA_KEY não definido — gere via `openssl rand -base64 32`',
    )
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `envelope-crypto: LOGIFIT_DATA_KEY deve ter 32 bytes base64 (atual ${key.length})`,
    )
  }
  return key
}

/**
 * Cifra texto plano em formato `enc:v1:{iv}:{ciphertext_with_tag}`.
 */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) return ''
  const key = getKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const payload = Buffer.concat([ciphertext, tag])
  return `enc:v1:${iv.toString('base64')}:${payload.toString('base64')}`
}

/**
 * Decifra formato `enc:v1:...`. Lança se shape inválido ou tag não bate (tampering).
 */
export function decryptSecret(encrypted: string): string {
  if (!encrypted) return ''
  // Compatibilidade: se não tem prefix enc:, assume plain text (legado pré-Faixa B)
  if (!encrypted.startsWith('enc:v1:')) return encrypted

  const parts = encrypted.split(':')
  if (parts.length !== 4) {
    throw new Error('envelope-crypto: formato inválido — esperado enc:v1:iv:ciphertext')
  }
  const iv = Buffer.from(parts[2] ?? '', 'base64')
  const payload = Buffer.from(parts[3] ?? '', 'base64')
  if (iv.length !== IV_LENGTH) {
    throw new Error('envelope-crypto: IV length inválido')
  }
  if (payload.length < TAG_LENGTH + 1) {
    throw new Error('envelope-crypto: payload muito pequeno')
  }
  const tag = payload.subarray(payload.length - TAG_LENGTH)
  const ciphertext = payload.subarray(0, payload.length - TAG_LENGTH)
  const key = getKey()
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  try {
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return plain.toString('utf8')
  } catch {
    throw new Error('envelope-crypto: decrypt failed — chave errada ou ciphertext corrompido')
  }
}

/**
 * Helper: gera chave base64 nova pra usar em LOGIFIT_DATA_KEY.
 * NÃO usar em prod — só pra setup local/teste.
 */
export function generateMasterKey(): string {
  return randomBytes(KEY_LENGTH).toString('base64')
}

// ─── Formato columnar (Sprint 36b) ──────────────────────────────────────────
// `fiscal_provider_credentials` armazena GCM em 3 colunas separadas
// (encrypted + nonce + tag) em vez do formato inline `enc:v1:...`. Mesmo
// algoritmo e mesma LOGIFIT_DATA_KEY — só o layout de storage difere.

export interface SecretParts {
  /** Ciphertext base64 (sem tag) */
  encrypted: string
  /** IV/nonce GCM base64 (12 bytes) */
  nonce: string
  /** Auth tag GCM base64 (16 bytes) */
  tag: string
}

/**
 * Cifra pra formato columnar (3 colunas). Usado por `fiscal_provider_credentials`.
 */
export function encryptSecretParts(plaintext: string): SecretParts {
  const key = getKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    encrypted: ciphertext.toString('base64'),
    nonce: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  }
}

/**
 * Decifra formato columnar. Lança se tag não bate (tampering) ou chave errada.
 */
export function decryptSecretParts(parts: SecretParts): string {
  const iv = Buffer.from(parts.nonce, 'base64')
  if (iv.length !== IV_LENGTH) {
    throw new Error('envelope-crypto: nonce length inválido')
  }
  const tag = Buffer.from(parts.tag, 'base64')
  if (tag.length !== TAG_LENGTH) {
    throw new Error('envelope-crypto: tag length inválido')
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv)
  decipher.setAuthTag(tag)
  try {
    const plain = Buffer.concat([
      decipher.update(Buffer.from(parts.encrypted, 'base64')),
      decipher.final(),
    ])
    return plain.toString('utf8')
  } catch {
    throw new Error('envelope-crypto: decrypt failed — chave errada ou ciphertext corrompido')
  }
}
