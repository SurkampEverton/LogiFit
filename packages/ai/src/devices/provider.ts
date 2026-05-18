/**
 * Device Hub provider abstrato — Sprint 32 Faixa B.1 (ADR 0049).
 *
 * Interface comum pra adapters de wearable/BLE/file_import. Cada provider
 * implementa:
 *   - authenticate(input) — inicia OAuth (cloud) ou pareamento (BLE)
 *   - completeAuth(code, state) — callback OAuth ou primeiro reading BLE
 *   - sync(connection, cursor?) — puxa novas leituras desde cursor
 *   - parseFile(buffer, format) — adapters file_import implementam isto
 *
 * **Mock provider** (`MockDeviceProvider`) sempre disponível pra dev/test.
 *
 * Sprint 32b: implementa Garmin/Oura reais com `safeFetch` (regra 37 ADR 0073)
 * + allowlist `connectapi.garmin.com` / `api.ouraring.com`.
 */

export type DeviceProviderName =
  | 'garmin'
  | 'oura'
  | 'fitbit'
  | 'apple_health'
  | 'google_health'
  | 'ble_scale_omron'
  | 'ble_scale_gtech'
  | 'file_import'
  | 'mock'

/**
 * Leitura normalizada FHIR-like Observation. Provider adapters convertem
 * payload bruto pra esse formato canônico.
 */
export interface NormalizedReading {
  observationCode: string // 'HR' | 'WEIGHT' | 'STEPS' | ...
  value: number
  unit: string
  measuredAt: string // ISO timestamp
  sourceDeviceId?: string | null
  quality?: 'high' | 'medium' | 'low' | 'estimated'
  metadata?: Record<string, unknown>
}

export interface SyncResult {
  /** Quantidade de leituras retornadas */
  readings: NormalizedReading[]
  /** Próximo cursor (para guardar em device_sync_cursors.cursor_payload) */
  nextCursor: Record<string, unknown> | null
  /** Indica se há mais páginas pra puxar (job pode chamar de novo) */
  hasMore: boolean
}

export interface DeviceProvider {
  readonly name: DeviceProviderName

  /**
   * Inicia OAuth (cloud) ou retorna instrução de pairing (BLE).
   * Caller persiste `state` em `device_connections.metadata` antes do redirect.
   */
  startAuth(input: {
    memberId: string
    redirectUri: string
  }): Promise<{ authUrl: string; state: string }>

  /**
   * Callback OAuth — troca code por tokens. Retorna refresh + access tokens.
   * Para BLE: chamado após primeira leitura (deviceSerial).
   */
  completeAuth(input: {
    code: string
    state: string
    redirectUri: string
  }): Promise<{
    accessToken: string
    refreshToken: string | null
    expiresAt: string
    externalUserId: string | null
    deviceLabel: string | null
  }>

  /**
   * Sync horário — puxa leituras desde o cursor + retorna próximo cursor.
   */
  sync(input: {
    connectionId: string
    accessToken: string
    cursor: Record<string, unknown> | null
    /** Tipos de observação a puxar (subset; default todos) */
    observationCodes?: string[]
  }): Promise<SyncResult>

  /**
   * Revoga tokens no provider (best-effort). Sempre marca connection revoked
   * mesmo se provider falha (paciente quer parar de sincronizar).
   */
  revoke(input: { accessToken: string }): Promise<void>
}

// ─── Mock provider (dev/test) ──────────────────────────────────────────────

/**
 * Mock determinístico que retorna leituras fake estruturadas. Útil pra
 * desenvolver UI sem credenciais reais.
 */
export class MockDeviceProvider implements DeviceProvider {
  readonly name: DeviceProviderName = 'mock'

  async startAuth(_input: { memberId: string; redirectUri: string }): Promise<{
    authUrl: string
    state: string
  }> {
    const state = `mock-state-${Date.now()}`
    return {
      authUrl: `https://mock-device-oauth.local/auth?state=${state}`,
      state,
    }
  }

  async completeAuth(_input: {
    code: string
    state: string
    redirectUri: string
  }): Promise<{
    accessToken: string
    refreshToken: string | null
    expiresAt: string
    externalUserId: string | null
    deviceLabel: string | null
  }> {
    return {
      accessToken: `mock-access-${Date.now()}`,
      refreshToken: `mock-refresh-${Date.now()}`,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24h
      externalUserId: 'mock-user-123',
      deviceLabel: 'Mock Device',
    }
  }

  async sync(input: {
    connectionId: string
    accessToken: string
    cursor: Record<string, unknown> | null
  }): Promise<SyncResult> {
    // Gera 7 dias × 3 leituras = 21 readings (HR_RESTING, WEIGHT, STEPS)
    const now = new Date()
    const readings: NormalizedReading[] = []
    for (let d = 6; d >= 0; d--) {
      const day = new Date(now)
      day.setUTCDate(day.getUTCDate() - d)
      day.setUTCHours(7, 0, 0, 0)
      readings.push(
        {
          observationCode: 'HR_RESTING',
          value: 60 + Math.round(Math.random() * 10),
          unit: 'bpm',
          measuredAt: day.toISOString(),
          quality: 'high',
        },
        {
          observationCode: 'WEIGHT',
          value: 78 + Math.random() * 2 - 1,
          unit: 'kg',
          measuredAt: new Date(day.getTime() + 60 * 60 * 1000).toISOString(),
          quality: 'high',
        },
        {
          observationCode: 'STEPS',
          value: 5000 + Math.round(Math.random() * 8000),
          unit: 'steps',
          measuredAt: new Date(day.getTime() + 22 * 60 * 60 * 1000).toISOString(),
          quality: 'high',
        },
      )
    }
    return {
      readings,
      nextCursor: { lastSyncedAt: now.toISOString() },
      hasMore: false,
    }
  }

  async revoke(_input: { accessToken: string }): Promise<void> {
    // no-op
  }
}

// ─── Resolver ──────────────────────────────────────────────────────────────

/**
 * Retorna provider conforme nome. Sprint 32b: switch real com GarminProvider,
 * OuraProvider, etc. MVP só Mock.
 */
export function resolveDeviceProvider(name: DeviceProviderName): DeviceProvider {
  // Sprint 32b: switch real
  void name
  return new MockDeviceProvider()
}
