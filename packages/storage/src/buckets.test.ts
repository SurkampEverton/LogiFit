import { describe, expect, it } from 'vitest'
import { BUCKETS, BUCKET_NAMES, physicalBucketName } from './buckets'

describe('buckets canônicos', () => {
  it('expõe os 6 buckets da regra 38', () => {
    expect(Object.values(BUCKETS).sort()).toEqual(
      [
        'certificados',
        'exam-attachments',
        'exercises',
        'fisio-evolucoes',
        'lab-documents',
        'whatsapp-media',
      ].sort(),
    )
    expect(BUCKET_NAMES.length).toBe(6)
  })
})

describe('physicalBucketName', () => {
  it('aplica prefixo simples', () => {
    expect(physicalBucketName('logifit-dev', 'lab-documents')).toBe('logifit-dev-lab-documents')
  })

  it('normaliza prefix terminando em -', () => {
    expect(physicalBucketName('logifit-dev-', 'lab-documents')).toBe('logifit-dev-lab-documents')
  })

  it('aceita prefix vazio (sem hífen)', () => {
    expect(physicalBucketName('', 'lab-documents')).toBe('lab-documents')
  })
})
