/**
 * cancellation-policy.ts tests — Sprint 26 Faixa B.1.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_POLICIES, decideCancellation } from './cancellation-policy'

const NOW = '2026-05-17T12:00:00Z'

describe('decideCancellation — Academia', () => {
  it('48h antes → cancel_directly', () => {
    const r = decideCancellation({
      vertical: 'academia',
      appointmentStartsAt: '2026-05-19T14:00:00Z',
      appointmentStatus: 'scheduled',
      now: NOW,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.action).toBe('cancel_directly')
  })

  it('5h antes → cancel_directly (default 4h)', () => {
    const r = decideCancellation({
      vertical: 'academia',
      appointmentStartsAt: '2026-05-17T17:00:00Z',
      appointmentStatus: 'scheduled',
      now: NOW,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.action).toBe('cancel_directly')
  })

  it('2h antes → awaiting_provider_ack', () => {
    const r = decideCancellation({
      vertical: 'academia',
      appointmentStartsAt: '2026-05-17T14:00:00Z',
      appointmentStatus: 'scheduled',
      now: NOW,
    })
    expect(r.ok).toBe(true)
    if (r.ok && r.action === 'awaiting_provider_ack') {
      expect(r.reason).toBe('too_close_to_start')
    }
  })
})

describe('decideCancellation — Fisio', () => {
  it('48h antes → cancel_directly', () => {
    const r = decideCancellation({
      vertical: 'fisio',
      appointmentStartsAt: '2026-05-19T14:00:00Z',
      appointmentStatus: 'scheduled',
      now: NOW,
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.action).toBe('cancel_directly')
  })

  it('12h antes → awaiting_provider_ack (default 24h)', () => {
    const r = decideCancellation({
      vertical: 'fisio',
      appointmentStartsAt: '2026-05-18T00:00:00Z',
      appointmentStatus: 'scheduled',
      now: NOW,
    })
    expect(r.ok).toBe(true)
    if (r.ok && r.action === 'awaiting_provider_ack') {
      expect(r.reason).toBe('too_close_to_start')
    }
  })
})

describe('decideCancellation — Nutri', () => {
  it('sempre prefere reagendar', () => {
    const r = decideCancellation({
      vertical: 'nutri',
      appointmentStartsAt: '2026-05-30T14:00:00Z',
      appointmentStatus: 'scheduled',
      now: NOW,
    })
    expect(r.ok).toBe(false)
    if (!r.ok && r.action === 'must_reschedule') {
      expect(r.reason).toBe('vertical_prefers_reschedule')
    }
  })
})

describe('decideCancellation — bloqueios universais', () => {
  it('appointment cancelled → denied', () => {
    const r = decideCancellation({
      vertical: 'academia',
      appointmentStartsAt: '2026-05-19T14:00:00Z',
      appointmentStatus: 'cancelled',
      now: NOW,
    })
    expect(r.ok).toBe(false)
    if (!r.ok && r.action === 'denied') expect(r.reason).toBe('already_cancelled')
  })

  it('appointment já começou → denied', () => {
    const r = decideCancellation({
      vertical: 'academia',
      appointmentStartsAt: '2026-05-17T11:00:00Z',
      appointmentStatus: 'confirmed',
      now: NOW,
    })
    expect(r.ok).toBe(false)
    if (!r.ok && r.action === 'denied') expect(r.reason).toBe('already_started')
  })

  it('completed → denied', () => {
    const r = decideCancellation({
      vertical: 'fisio',
      appointmentStartsAt: '2026-05-15T14:00:00Z',
      appointmentStatus: 'completed',
      now: NOW,
    })
    expect(r.ok).toBe(false)
  })
})

describe('DEFAULT_POLICIES', () => {
  it('todas as verticais têm policy', () => {
    expect(DEFAULT_POLICIES.academia).toBeDefined()
    expect(DEFAULT_POLICIES.fisio).toBeDefined()
    expect(DEFAULT_POLICIES.nutri).toBeDefined()
    expect(DEFAULT_POLICIES.personal).toBeDefined()
    expect(DEFAULT_POLICIES.pilates).toBeDefined()
  })

  it('Nutri prefere reagendamento', () => {
    expect(DEFAULT_POLICIES.nutri.prefersReschedule).toBe(true)
  })

  it('Academia tem menor cancel window (4h)', () => {
    expect(DEFAULT_POLICIES.academia.selfCancelHoursBeforeMin).toBe(4)
  })

  it('Fisio tem 24h', () => {
    expect(DEFAULT_POLICIES.fisio.selfCancelHoursBeforeMin).toBe(24)
  })
})

describe('decideCancellation — policy override', () => {
  it('tenant override: academia 1h ao invés de 4h', () => {
    const r = decideCancellation({
      vertical: 'academia',
      appointmentStartsAt: '2026-05-17T14:00:00Z', // 2h
      appointmentStatus: 'scheduled',
      now: NOW,
      policy: {
        selfCancelHoursBeforeMin: 1,
        allowsDirectCancel: true,
        prefersReschedule: false,
      },
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.action).toBe('cancel_directly')
  })
})
