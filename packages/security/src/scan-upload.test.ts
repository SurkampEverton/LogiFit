import { describe, expect, it } from 'vitest'
import {
  detectEmbeddedThreats,
  detectMimeByMagicBytes,
  scanUpload,
} from './scan-upload'

// ─── Magic bytes ──────────────────────────────────────────────────────────

describe('detectMimeByMagicBytes', () => {
  it('detecta PDF', () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34])
    expect(detectMimeByMagicBytes(bytes)).toBe('application/pdf')
  })

  it('detecta PNG', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(detectMimeByMagicBytes(bytes)).toBe('image/png')
  })

  it('detecta JPEG', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
    expect(detectMimeByMagicBytes(bytes)).toBe('image/jpeg')
  })

  it('detecta GIF', () => {
    const bytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00])
    expect(detectMimeByMagicBytes(bytes)).toBe('image/gif')
  })

  it('detecta WebP', () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ])
    expect(detectMimeByMagicBytes(bytes)).toBe('image/webp')
  })

  it('detecta WAV', () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ])
    expect(detectMimeByMagicBytes(bytes)).toBe('audio/wav')
  })

  it('detecta MP3 com ID3v2', () => {
    const bytes = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00])
    expect(detectMimeByMagicBytes(bytes)).toBe('audio/mpeg')
  })

  it('detecta OGG', () => {
    const bytes = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00])
    expect(detectMimeByMagicBytes(bytes)).toBe('audio/ogg')
  })

  it('detecta MP4 (ftyp box)', () => {
    const bytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
    ])
    expect(detectMimeByMagicBytes(bytes)).toBe('video/mp4')
  })

  it('detecta ZIP (que cobre Office docx/xlsx/pptx)', () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    expect(detectMimeByMagicBytes(bytes)).toBe('application/zip')
  })

  it('retorna null para magic bytes desconhecidos', () => {
    const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef])
    expect(detectMimeByMagicBytes(bytes)).toBeNull()
  })

  it('retorna null para input muito curto', () => {
    expect(detectMimeByMagicBytes(new Uint8Array([0x25, 0x50]))).toBeNull()
  })
})

// ─── Embed detection ──────────────────────────────────────────────────────

describe('detectEmbeddedThreats', () => {
  it('flagra PDF com /JavaScript', () => {
    const raw = '%PDF-1.4\n/Type /Action /S /JavaScript /JS (app.alert("xss"))'
    const bytes = new TextEncoder().encode(raw)
    expect(detectEmbeddedThreats(bytes, 'application/pdf')).toContain('JavaScript')
  })

  it('flagra PDF com /OpenAction', () => {
    const raw = '%PDF-1.4\n/OpenAction << /S /Named /N /NextPage >>'
    const bytes = new TextEncoder().encode(raw)
    expect(detectEmbeddedThreats(bytes, 'application/pdf')).toContain('OpenAction')
  })

  it('flagra PDF com /Launch', () => {
    const raw = '%PDF-1.4\n/Type /Action /S /Launch /F (cmd.exe)'
    const bytes = new TextEncoder().encode(raw)
    expect(detectEmbeddedThreats(bytes, 'application/pdf')).toContain('Launch')
  })

  it('flagra Office com vbaProject.bin', () => {
    const raw = 'PK\x03\x04...word/vbaProject.bin...'
    const bytes = new TextEncoder().encode(raw)
    expect(detectEmbeddedThreats(bytes, 'application/zip')).toContain('vbaProject')
  })

  it('flagra Office com word/macros/', () => {
    const raw = 'PK\x03\x04...word/macros/foo...'
    const bytes = new TextEncoder().encode(raw)
    expect(detectEmbeddedThreats(bytes, 'application/zip')).toContain('macros')
  })

  it('PDF benigno sem ameaças retorna null', () => {
    const raw = '%PDF-1.4\n/Type /Catalog /Pages 2 0 R\n%%EOF'
    const bytes = new TextEncoder().encode(raw)
    expect(detectEmbeddedThreats(bytes, 'application/pdf')).toBeNull()
  })

  it('PNG não tem regex de embed (skip)', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    expect(detectEmbeddedThreats(bytes, 'image/png')).toBeNull()
  })
})

// ─── End-to-end pipeline scanUpload (ownScanProvider) ─────────────────────

const validPdf = (): Uint8Array => new TextEncoder().encode('%PDF-1.4\n%%EOF')
const validPng = (): Uint8Array =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])

describe('scanUpload (ownScanProvider) pipeline', () => {
  it('PDF válido em lab-documents → clean', async () => {
    const result = await scanUpload({
      bytes: validPdf(),
      declaredMime: 'application/pdf',
      filename: 'exame.pdf',
      bucket: 'lab-documents',
    })
    expect(result.status).toBe('clean')
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(result.detectedMime).toBe('application/pdf')
    expect(result.scanProvider).toBe('own')
  })

  it('PNG válido em exam-attachments → clean', async () => {
    const result = await scanUpload({
      bytes: validPng(),
      declaredMime: 'image/png',
      filename: 'laudo.png',
      bucket: 'exam-attachments',
    })
    expect(result.status).toBe('clean')
  })

  it('Arquivo gigante > maxBytes → rejected', async () => {
    const bytes = new Uint8Array(30 * 1024 * 1024) // 30MB
    bytes.set([0x25, 0x50, 0x44, 0x46])
    const result = await scanUpload({
      bytes,
      declaredMime: 'application/pdf',
      filename: 'big.pdf',
      bucket: 'lab-documents', // cap 20MB
    })
    expect(result.status).toBe('rejected')
    expect(result.reason).toContain('excede')
  })

  it('MIME declarado ≠ detectado → suspicious', async () => {
    const result = await scanUpload({
      bytes: validPng(),
      declaredMime: 'application/pdf', // mentindo
      filename: 'fake.pdf',
      bucket: 'lab-documents',
    })
    expect(result.status).toBe('suspicious')
    expect(result.reason).toContain('MIME declarado')
  })

  it('Magic bytes desconhecidos → suspicious', async () => {
    const result = await scanUpload({
      bytes: new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0x00, 0x00, 0x00]),
      declaredMime: 'application/octet-stream',
      filename: 'unknown.bin',
      bucket: 'lab-documents',
    })
    expect(result.status).toBe('suspicious')
    expect(result.reason).toContain('magic bytes')
  })

  it('Extensão fora do allowlist do bucket → rejected', async () => {
    const result = await scanUpload({
      bytes: validPdf(),
      declaredMime: 'application/pdf',
      filename: 'exame.txt', // certificados não aceita .pdf renomeado, mas vamos testar a regra
      bucket: 'certificados',
    })
    expect(result.status).toBe('rejected')
    expect(result.reason).toContain('extensão')
  })

  it('PDF com JavaScript embedado → suspicious', async () => {
    const malicious = new TextEncoder().encode(
      '%PDF-1.4\n/Type /Action /S /JavaScript /JS (app.alert("xss"))\n%%EOF',
    )
    const result = await scanUpload({
      bytes: malicious,
      declaredMime: 'application/pdf',
      filename: 'evil.pdf',
      bucket: 'lab-documents',
    })
    expect(result.status).toBe('suspicious')
    expect(result.reason).toContain('JavaScript')
  })

  it('Bucket desconhecido cai no DEFAULT_POLICY (mais restritivo)', async () => {
    const result = await scanUpload({
      bytes: validPdf(),
      declaredMime: 'application/pdf',
      filename: 'x.pdf',
      bucket: 'nao-existe',
    })
    // DEFAULT tem maxBytes 5MB mas allowedExtensions vazio → rejected
    expect(result.status).toBe('rejected')
  })

  it('image/jpg aceita como sinônimo de image/jpeg', async () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])
    const result = await scanUpload({
      bytes: jpg,
      declaredMime: 'image/jpg', // browser comum
      filename: 'foto.jpg',
      bucket: 'exam-attachments',
    })
    expect(result.status).toBe('clean')
  })
})
