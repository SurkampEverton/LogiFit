/**
 * soap.ts tests — Sprint 21 Faixa B.1.
 */
import { describe, expect, it } from 'vitest'
import {
  ALLOWED_MIMES_BY_KIND,
  generateStoragePath,
  hashEvolucaoContent,
  MAX_SIZE_BY_KIND,
  validateAttachmentUpload,
  validateSoapForLock,
} from './soap'

describe('validateSoapForLock', () => {
  it('SOAP com subjetivo significativo → OK', () => {
    const r = validateSoapForLock({ subjetivo: 'Paciente relata dor cervical com VAS 6/10' })
    expect(r.ok).toBe(true)
  })

  it('SOAP completamente vazio → falha', () => {
    const r = validateSoapForLock({})
    expect(r.ok).toBe(false)
  })

  it('SOAP com freeText vazio + campos curtos → falha', () => {
    const r = validateSoapForLock({ subjetivo: '...' }, '')
    expect(r.ok).toBe(false)
  })

  it('freeText alternativo aceito', () => {
    const r = validateSoapForLock({}, 'Member tolerou bem a manipulação cervical, sem dor pós')
    expect(r.ok).toBe(true)
  })

  it('trim consistente — espaços não contam', () => {
    const r = validateSoapForLock({ subjetivo: '          ' })
    expect(r.ok).toBe(false)
  })
})

describe('validateAttachmentUpload', () => {
  it('exame_imagem JPEG dentro do limite OK', () => {
    const r = validateAttachmentUpload({
      kind: 'exame_imagem',
      mimeType: 'image/jpeg',
      sizeBytes: 2_000_000,
      filename: 'raio-x-lateral.jpg',
    })
    expect(r.ok).toBe(true)
  })

  it('exame_imagem com MIME video rejeitado', () => {
    const r = validateAttachmentUpload({
      kind: 'exame_imagem',
      mimeType: 'video/mp4',
      sizeBytes: 100_000,
      filename: 'wrong.mp4',
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('MIME')
  })

  it('video_execucao > 50MB rejeitado', () => {
    const r = validateAttachmentUpload({
      kind: 'video_execucao',
      mimeType: 'video/mp4',
      sizeBytes: 60_000_000,
      filename: 'big.mp4',
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('50MB')
  })

  it('documento PDF dentro do limite OK', () => {
    const r = validateAttachmentUpload({
      kind: 'documento',
      mimeType: 'application/pdf',
      sizeBytes: 500_000,
      filename: 'laudo.pdf',
    })
    expect(r.ok).toBe(true)
  })

  it('documento PDF > 10MB rejeitado', () => {
    const r = validateAttachmentUpload({
      kind: 'documento',
      mimeType: 'application/pdf',
      sizeBytes: 11_000_000,
      filename: 'big.pdf',
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('MB')
  })

  it('arquivo vazio rejeitado', () => {
    const r = validateAttachmentUpload({
      kind: 'documento',
      mimeType: 'application/pdf',
      sizeBytes: 0,
      filename: 'empty.pdf',
    })
    expect(r.ok).toBe(false)
  })

  it('filename com path traversal rejeitado', () => {
    const r = validateAttachmentUpload({
      kind: 'documento',
      mimeType: 'application/pdf',
      sizeBytes: 1000,
      filename: '../etc/passwd',
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('Filename')
  })

  it('audio_anamnese mp3 OK', () => {
    const r = validateAttachmentUpload({
      kind: 'audio_anamnese',
      mimeType: 'audio/mpeg',
      sizeBytes: 5_000_000,
      filename: 'anamnese.mp3',
    })
    expect(r.ok).toBe(true)
  })

  it('foto_postural PNG OK', () => {
    const r = validateAttachmentUpload({
      kind: 'foto_postural',
      mimeType: 'image/png',
      sizeBytes: 1_500_000,
      filename: 'postura-frontal.png',
    })
    expect(r.ok).toBe(true)
  })

  it('foto_postural > 8MB rejeitado', () => {
    const r = validateAttachmentUpload({
      kind: 'foto_postural',
      mimeType: 'image/jpeg',
      sizeBytes: 9_000_000,
      filename: 'foto.jpg',
    })
    expect(r.ok).toBe(false)
  })

  it('todos kinds têm MIME mapping + size mapping', () => {
    const kinds: Array<keyof typeof ALLOWED_MIMES_BY_KIND> = [
      'exame_imagem',
      'video_execucao',
      'documento',
      'foto_postural',
      'audio_anamnese',
    ]
    for (const k of kinds) {
      expect(ALLOWED_MIMES_BY_KIND[k].length).toBeGreaterThan(0)
      expect(MAX_SIZE_BY_KIND[k]).toBeGreaterThan(0)
    }
  })
})

describe('hashEvolucaoContent', () => {
  const baseInput = {
    soap: { subjetivo: 'dor', objetivo: 'mobilidade reduzida' },
    freeText: 'Member tolerou bem',
    attachmentIds: ['att-1', 'att-2'],
    professionalUserId: 'user-x',
    signedAtIso: '2026-05-17T15:00:00.000Z',
  }

  it('determinístico (mesmo input = mesmo hash)', () => {
    expect(hashEvolucaoContent(baseInput)).toBe(hashEvolucaoContent(baseInput))
  })

  it('attachmentIds em ordem diferente → mesmo hash', () => {
    const h1 = hashEvolucaoContent({ ...baseInput, attachmentIds: ['att-1', 'att-2'] })
    const h2 = hashEvolucaoContent({ ...baseInput, attachmentIds: ['att-2', 'att-1'] })
    expect(h1).toBe(h2)
  })

  it('mudança em SOAP → hash diferente', () => {
    const h1 = hashEvolucaoContent(baseInput)
    const h2 = hashEvolucaoContent({
      ...baseInput,
      soap: { subjetivo: 'dor', objetivo: 'mobilidade plena' },
    })
    expect(h1).not.toBe(h2)
  })

  it('hash é hex sha256 (64 chars)', () => {
    expect(hashEvolucaoContent(baseInput)).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('generateStoragePath', () => {
  it('formato tenants/{t}/evolucoes/{e}/{hash12}-{filename}', () => {
    const p = generateStoragePath({
      tenantId: '00000000-0000-0000-0000-000000000001',
      evolucaoId: 'evol-123',
      filename: 'raio-x.jpg',
      contentHash: 'abc1234567890def',
    })
    expect(p).toBe(
      'tenants/00000000-0000-0000-0000-000000000001/evolucoes/evol-123/abc123456789-raio-x.jpg',
    )
  })

  it('filename com caracteres ruins sanitizado', () => {
    const p = generateStoragePath({
      tenantId: 't',
      evolucaoId: 'e',
      filename: 'file with spaces & special.pdf',
      contentHash: 'aaaaaaaaaaaa',
    })
    expect(p).toBe('tenants/t/evolucoes/e/aaaaaaaaaaaa-file_with_spaces___special.pdf')
  })
})
