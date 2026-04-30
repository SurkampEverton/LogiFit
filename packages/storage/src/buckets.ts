/**
 * Buckets canônicos do LogiFit (regra 38 + ADR 0091).
 *
 * Sprint 00 Faixa 1: nomes lógicos. O bootstrap concreto aplica
 * `MINIO_BUCKET_PREFIX` (ex: `logifit-dev-` em dev, `logifit-prod-` em prod via
 * Coolify) — produz buckets físicos como `logifit-dev-lab-documents`.
 *
 * Adicionar bucket novo aqui é fonte única de verdade: bootstrap, factory,
 * lints (`no-unscanned-upload` Faixa 4) e testes consomem `BUCKETS`/`BucketName`.
 *
 * Critérios para entrar no catálogo:
 *  - Domínio clínico/operacional do MVP (ver módulos em docs/modulos.md)
 *  - Política de retenção bem-definida (regra 34)
 *  - Conteúdo isolável por tenant via prefixo de chave (tenant-key.ts)
 */

export const BUCKETS = {
  /** PDFs de resultado de exames laboratoriais (Sprint 11+). */
  LAB_DOCUMENTS: 'lab-documents',
  /** Anexos de evolução de fisioterapia (Sprint 20). */
  FISIO_EVOLUCOES: 'fisio-evolucoes',
  /** Anexos diversos vinculados a exames (imagens, laudos). */
  EXAM_ATTACHMENTS: 'exam-attachments',
  /** Mídia de exercícios (vídeos curtos, fotos demonstrativas). */
  EXERCISES: 'exercises',
  /** Certificados emitidos (atestado, declaração, carteirinha). */
  CERTIFICADOS: 'certificados',
  /** Mídia recebida via WhatsApp inbound (Sprint 12+). */
  WHATSAPP_MEDIA: 'whatsapp-media',
} as const

export type BucketName = (typeof BUCKETS)[keyof typeof BUCKETS]

/** Lista materializada para iteração no bootstrap e validações. */
export const BUCKET_NAMES: ReadonlyArray<BucketName> = Object.values(BUCKETS)

/**
 * Aplica o prefixo lógico (ambiente) ao nome do bucket. Mantém função pura
 * para o bootstrap, factory e testes derivarem o nome físico do mesmo lugar.
 */
export function physicalBucketName(prefix: string, name: BucketName): string {
  const trimmed = prefix.replace(/-+$/, '')
  return trimmed.length > 0 ? `${trimmed}-${name}` : name
}
