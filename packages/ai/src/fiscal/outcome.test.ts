import { describe, expect, it } from 'vitest'
import { providerOutcome } from './outcome'

const NOW = new Date('2026-07-20T11:49:13.000Z')

describe('providerOutcome', () => {
  it('preserva rejected com o motivo do provider (o bug de 2026-07-20)', () => {
    expect(
      providerOutcome(
        {
          status: 'rejected',
          rejectionReason:
            '[empresa_nao_habilitada] É necessário configurar o usuário e senha desta empresa neste município.',
        },
        NOW,
      ),
    ).toEqual({
      status: 'rejected',
      completedAt: null,
      rejectionReason:
        '[empresa_nao_habilitada] É necessário configurar o usuário e senha desta empresa neste município.',
    })
  })

  it('rejected sem mensagem ganha fallback — CHECK exige rejection_reason NOT NULL', () => {
    const out = providerOutcome({ status: 'rejected' }, NOW)
    expect(out.status).toBe('rejected')
    expect(out.rejectionReason).toBeTruthy()
  })

  it('processing não é achatado em queued', () => {
    expect(providerOutcome({ status: 'processing' }, NOW).status).toBe('processing')
  })

  it('completed carimba completedAt e não grava motivo', () => {
    expect(providerOutcome({ status: 'completed' }, NOW)).toEqual({
      status: 'completed',
      completedAt: NOW,
      rejectionReason: null,
    })
  })

  it('queued não carimba completedAt', () => {
    expect(providerOutcome({ status: 'queued' }, NOW)).toEqual({
      status: 'queued',
      completedAt: null,
      rejectionReason: null,
    })
  })

  it('motivo residual de tentativa anterior não vaza pra status não-rejeitado', () => {
    const out = providerOutcome({ status: 'completed', rejectionReason: 'erro antigo' }, NOW)
    expect(out.rejectionReason).toBeNull()
  })
})
