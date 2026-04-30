/**
 * scanUpload — verificação de upload antes de aceitar (regra 38 + ADR 0073).
 *
 * Sprint 00: interface canônica + OwnScanProvider esqueleto. Implementação real
 * (Sprint 01a / Faixa 3) depende de:
 *   - `file-type` package (MIME via magic bytes)
 *   - @repo/storage adapter (MinIO real)
 *   - tabela `upload_scans` no schema (Sprint 01a)
 *   - Lint custom `no-unscanned-upload` (Faixa 4)
 *
 * Plugar ClamAvAdapter ou CloudmersiveAdapter via env var SCAN_PROVIDER no
 * futuro sem refactor — ScanProvider é a interface estável.
 */

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

/**
 * Provider zero-custo MVP — magic bytes + size cap + extension allowlist por
 * bucket + embed detection regex (PDF JS, Office macro). Sprint dono substitui
 * o stub abaixo por implementação real quando primeiro upload chegar.
 */
export const ownScanProvider: ScanProvider = {
  name: 'own',
  async scan(_input: ScanInput): Promise<ScanResult> {
    return {
      status: 'pending',
      reason: 'scan not implemented yet (Sprint 00 scaffolding)',
      scanProvider: 'own',
      scannedAt: new Date(),
    }
  },
}

export async function scanUpload(
  input: ScanInput,
  provider: ScanProvider = ownScanProvider,
): Promise<ScanResult> {
  return provider.scan(input)
}
