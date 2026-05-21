/**
 * scanUpload — verificação de upload antes de aceitar (regra 38 + ADR 0073).
 *
 * **MVP zero-custo (Sprint 00):** sem deps externas.
 *   - Magic bytes inline (cobre PDF, JPG, PNG, GIF, WebP, MP4, ZIP/Office, WAV, MP3, OGG)
 *   - Allowlist de extensão por bucket
 *   - Size cap por bucket
 *   - Embed detection regex em raw (PDF JavaScript/OpenAction/Launch; Office vbaProject.bin/macros)
 *   - SHA-256 hash (lookup futuro em `known_malicious_hashes`)
 *
 * **Fase 2:** plugar `ClamAvAdapter` ou `CloudmersiveAdapter` via env
 * `SCAN_PROVIDER` — `ScanProvider` é a interface estável.
 *
 * **Persistência:** caller registra `ScanResult` em `upload_scans` schema
 * (Sprint 01a entrega o schema). Arquivo só vira `published` após `clean`.
 *
 * **Lint:** `no-unscanned-upload` (scripts/lint-custom.mjs) bloqueia código que
 * chama `storage.put()` sem antes passar por `scanUpload()`.
 */
import { createHash } from 'node:crypto'

export type ScanStatus = 'pending' | 'clean' | 'suspicious' | 'rejected' | 'error'

export interface ScanResult {
  status: ScanStatus
  reason?: string
  sha256?: string
  detectedMime?: string
  scanProvider: string
  scannedAt: Date
}

export interface ScanInput {
  bytes: Uint8Array
  declaredMime: string
  filename: string
  bucket: string
}

export interface ScanProvider {
  name: string
  scan(input: ScanInput): Promise<ScanResult>
}

interface BucketPolicy {
  allowedMimes: ReadonlyArray<string>
  allowedExtensions: ReadonlyArray<string>
  maxBytes: number
}

const MB = 1024 * 1024

// Políticas canônicas por bucket. Adicionar bucket novo aqui (e em packages/storage/src/buckets.ts).
const BUCKET_POLICIES: Readonly<Record<string, BucketPolicy>> = {
  'lab-documents': {
    allowedMimes: ['application/pdf'],
    allowedExtensions: ['pdf'],
    maxBytes: 20 * MB,
  },
  'fisio-evolucoes': {
    allowedMimes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
    allowedExtensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp'],
    maxBytes: 15 * MB,
  },
  'exam-attachments': {
    allowedMimes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
    allowedExtensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp'],
    maxBytes: 15 * MB,
  },
  exercises: {
    allowedMimes: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'],
    allowedExtensions: ['jpg', 'jpeg', 'png', 'webp', 'mp4'],
    maxBytes: 50 * MB,
  },
  certificados: {
    allowedMimes: ['application/pdf', 'image/jpeg', 'image/png'],
    allowedExtensions: ['pdf', 'jpg', 'jpeg', 'png'],
    maxBytes: 5 * MB,
  },
  'whatsapp-media': {
    allowedMimes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'audio/mpeg',
      'audio/ogg',
      'audio/wav',
      'video/mp4',
    ],
    allowedExtensions: ['jpg', 'jpeg', 'png', 'webp', 'mp3', 'ogg', 'wav', 'mp4'],
    maxBytes: 25 * MB,
  },
}

/**
 * Detecta MIME por magic bytes (primeiros bytes do arquivo). Sem deps externas
 * — cobre os formatos do MVP. Para formatos novos, plugar `file-type` lib.
 *
 * Retorna `null` se nenhum padrão conhecido bate (caller decide se rejeita).
 */
export function detectMimeByMagicBytes(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null

  // PDF: "%PDF-"
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return 'application/pdf'
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  // GIF: "GIF87a" ou "GIF89a"
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'image/gif'
  }
  // WebP: "RIFF" + 4 bytes + "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  // WAV: "RIFF" + 4 bytes + "WAVE"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  ) {
    return 'audio/wav'
  }
  // MP3 ID3v2: "ID3"  |  MPEG frame sync: FF Fx
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return 'audio/mpeg'
  }
  if (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0) {
    return 'audio/mpeg'
  }
  // OGG: "OggS"
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
    return 'audio/ogg'
  }
  // MP4 / ISO BMFF: 4 size bytes + "ftyp"
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return 'video/mp4'
  }
  // ZIP/Office: "PK\x03\x04" ou "PK\x05\x06" (empty) ou "PK\x07\x08" (spanned)
  if (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
  ) {
    return 'application/zip'
  }

  return null
}

/**
 * Verifica conteúdo malicioso embedado. Roda regex no raw (text decode best-effort
 * com truncate em 1MB pra não consumir RAM em vídeo grande).
 *
 * Sinais detectados:
 *  - PDF com `/JavaScript`, `/JS`, `/OpenAction`, `/Launch`, `/EmbeddedFile`
 *  - Office (zipped) com `vbaProject.bin` ou `macros/`
 *
 * Retorna razão se detectou, `null` se limpo.
 */
export function detectEmbeddedThreats(
  bytes: Uint8Array,
  detectedMime: string | null,
): string | null {
  const sample = bytes.slice(0, Math.min(bytes.length, MB))
  const raw = new TextDecoder('latin1', { fatal: false }).decode(sample)

  if (detectedMime === 'application/pdf') {
    if (/\/JavaScript\b/i.test(raw)) return 'PDF contém /JavaScript'
    if (/\/JS\b/i.test(raw)) return 'PDF contém /JS'
    if (/\/OpenAction\b/i.test(raw)) return 'PDF contém /OpenAction (auto-execute)'
    if (/\/Launch\b/i.test(raw)) return 'PDF contém /Launch (executa programa externo)'
    if (/\/EmbeddedFile\b/i.test(raw)) return 'PDF contém arquivo embedado'
  }

  if (detectedMime === 'application/zip') {
    // Office moderno = zip; pode trazer macros
    if (/vbaProject\.bin/i.test(raw)) return 'Office contém vbaProject.bin (macros VBA)'
    if (/word\/macros\//i.test(raw)) return 'Office contém word/macros/'
    if (/xl\/macros\//i.test(raw)) return 'Office contém xl/macros/'
    if (/ppt\/macros\//i.test(raw)) return 'Office contém ppt/macros/'
  }

  return null
}

function extensionFromFilename(filename: string): string {
  const idx = filename.lastIndexOf('.')
  if (idx < 0 || idx === filename.length - 1) return ''
  return filename.slice(idx + 1).toLowerCase()
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Provider MVP zero-custo. Pipeline:
 *   1. Size cap (rejected se exceder)
 *   2. Magic bytes (suspicious se MIME real ≠ declared, ou null)
 *   3. Extension allowlist (rejected se fora do bucket)
 *   4. MIME allowlist (rejected se fora do bucket)
 *   5. Embed detection (suspicious se PDF/Office com script/macro)
 *   6. SHA-256 calculated (caller pode consultar known_malicious_hashes futuro)
 */
export const ownScanProvider: ScanProvider = {
  name: 'own',
  async scan(input: ScanInput): Promise<ScanResult> {
    const scannedAt = new Date()
    const policy = BUCKET_POLICIES[input.bucket]

    // 0. Bucket desconhecido — fail-closed (allowlist explícita)
    if (!policy) {
      return {
        status: 'rejected',
        reason: `bucket "${input.bucket}" não está no catálogo (defina em BUCKET_POLICIES)`,
        scanProvider: 'own',
        scannedAt,
      }
    }

    // 1. Size cap
    if (input.bytes.byteLength > policy.maxBytes) {
      return {
        status: 'rejected',
        reason: `arquivo excede ${Math.round(policy.maxBytes / MB)}MB para bucket ${input.bucket}`,
        scanProvider: 'own',
        scannedAt,
      }
    }

    // 2. Magic bytes
    const detectedMime = detectMimeByMagicBytes(input.bytes)
    if (!detectedMime) {
      return {
        status: 'suspicious',
        reason: 'magic bytes não reconhecidos — formato desconhecido',
        sha256: sha256Hex(input.bytes),
        scanProvider: 'own',
        scannedAt,
      }
    }
    if (detectedMime !== input.declaredMime && !mimeMatchesFamily(detectedMime, input.declaredMime)) {
      return {
        status: 'suspicious',
        reason: `MIME declarado (${input.declaredMime}) ≠ detectado (${detectedMime})`,
        sha256: sha256Hex(input.bytes),
        detectedMime,
        scanProvider: 'own',
        scannedAt,
      }
    }

    // 3. Extension (allowlist obrigatória — vazia = bug de config)
    const ext = extensionFromFilename(input.filename)
    if (!policy.allowedExtensions.includes(ext)) {
      return {
        status: 'rejected',
        reason: `extensão .${ext || '(vazia)'} não permitida no bucket ${input.bucket}`,
        sha256: sha256Hex(input.bytes),
        detectedMime,
        scanProvider: 'own',
        scannedAt,
      }
    }

    // 4. MIME allowlist (allowlist obrigatória — vazia = bug de config)
    if (!policy.allowedMimes.includes(detectedMime)) {
      return {
        status: 'rejected',
        reason: `MIME ${detectedMime} não permitido no bucket ${input.bucket}`,
        sha256: sha256Hex(input.bytes),
        detectedMime,
        scanProvider: 'own',
        scannedAt,
      }
    }

    // 5. Embed detection
    const embedReason = detectEmbeddedThreats(input.bytes, detectedMime)
    if (embedReason) {
      return {
        status: 'suspicious',
        reason: embedReason,
        sha256: sha256Hex(input.bytes),
        detectedMime,
        scanProvider: 'own',
        scannedAt,
      }
    }

    // 6. Clean
    return {
      status: 'clean',
      sha256: sha256Hex(input.bytes),
      detectedMime,
      scanProvider: 'own',
      scannedAt,
    }
  },
}

/**
 * Aceita "image/jpg" como sinônimo de "image/jpeg" (cliente comum); aceita
 * `application/octet-stream` declarado quando magic bytes resolveram pra algo real.
 */
function mimeMatchesFamily(detected: string, declared: string): boolean {
  if (declared === 'application/octet-stream') return true
  if (detected === 'image/jpeg' && declared === 'image/jpg') return true
  return false
}

export async function scanUpload(
  input: ScanInput,
  provider: ScanProvider = ownScanProvider,
): Promise<ScanResult> {
  return provider.scan(input)
}

/** Exposto pra testes + para o lint `no-unscanned-upload` saber buckets válidos. */
export const SCAN_BUCKET_POLICIES = BUCKET_POLICIES
