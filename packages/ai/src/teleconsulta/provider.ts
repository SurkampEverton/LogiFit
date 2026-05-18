/**
 * Teleconsulta provider abstrato — Sprint 31 (ADR 0083 esperado).
 *
 * Interface comum pra providers de videoconferência. POC inicial vai testar
 * Daily.co (default), Whereby Embed e Jitsi (auto-hospedado). Twilio Video
 * fica como alternativa premium. Decisão final em ADR 0083 após POC sandbox.
 *
 * Provider implementa 3 operações:
 *   - createRoom(input) → { roomId, roomUrl, accessToken } pré-sessão
 *   - endRoom(roomId) → encerra + dispara webhook
 *   - generateAccessToken({roomId, participant, role}) → token JWT pra
 *     reentrada (paciente reconectou após queda)
 *
 * **Mock provider** (`MockTeleconsultaProvider`) sempre disponível pra dev/test.
 * Sprint 31b adiciona `DailyProvider` + `WherebyProvider`.
 *
 * **Webhook callback** vem em `/api/teleconsulta/webhook` (Sprint 31b);
 * provider dispara quando recording_ready, etc. Idempotente via `external_id`.
 */

export type TeleconsultaProviderName = 'daily' | 'whereby' | 'jitsi' | 'twilio' | 'mock'

export interface CreateRoomInput {
  /** ID interno LogiFit da sessão (UUID) */
  sessionId: string
  /** Nome legível pra ID do room no provider (geralmente lower-case alphanum) */
  roomSlug: string
  /** Duração máxima da sessão em minutos (provider pode encerrar automaticamente) */
  maxDurationMinutes: number
  /** Habilitar gravação (já consentido pelo paciente) */
  enableRecording: boolean
  /** Email do profissional pra notificações do provider */
  professionalEmail?: string
  /** Email do paciente */
  patientEmail?: string
}

export interface CreateRoomOutput {
  /** ID do room no provider (Daily.com slug, Whereby room name, etc) */
  roomId: string
  /** URL completa que o frontend usa pra embed */
  roomUrl: string
  /** Access token JWT (paciente + profissional usam o mesmo ou diferentes — provider-specific) */
  accessToken: string
  /** Expira em (ISO timestamp) — útil pra refresh */
  expiresAt: string
}

export interface GenerateTokenInput {
  roomId: string
  /** 'professional' | 'patient' (role afeta perms — gravar/silenciar) */
  participantRole: 'professional' | 'patient'
  /** Nome a exibir pra outros participantes */
  displayName: string
  /** Email opcional pra audit */
  email?: string
}

export interface TeleconsultaProvider {
  readonly name: TeleconsultaProviderName
  createRoom(input: CreateRoomInput): Promise<CreateRoomOutput>
  endRoom(roomId: string): Promise<void>
  generateAccessToken(input: GenerateTokenInput): Promise<{ token: string; expiresAt: string }>
}

// ─── Mock provider (dev/test) ──────────────────────────────────────────────

/**
 * Mock determinístico que retorna URLs/tokens fake mas estruturadamente válidos.
 * NÃO faz IO real. Sprint 31b: adicionar DailyProvider real.
 */
export class MockTeleconsultaProvider implements TeleconsultaProvider {
  readonly name: TeleconsultaProviderName = 'mock'

  async createRoom(input: CreateRoomInput): Promise<CreateRoomOutput> {
    const roomId = `mock-${input.roomSlug}-${input.sessionId.slice(0, 8)}`
    const expiresAt = new Date(Date.now() + input.maxDurationMinutes * 60 * 1000).toISOString()
    return {
      roomId,
      roomUrl: `https://mock-teleconsulta.local/room/${roomId}`,
      accessToken: `mock-token-${input.sessionId.slice(0, 8)}`,
      expiresAt,
    }
  }

  async endRoom(_roomId: string): Promise<void> {
    // no-op pra mock
  }

  async generateAccessToken(input: GenerateTokenInput): Promise<{
    token: string
    expiresAt: string
  }> {
    const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() // 4h
    return {
      token: `mock-token-${input.participantRole}-${input.roomId}`,
      expiresAt,
    }
  }
}

// ─── Resolver ──────────────────────────────────────────────────────────────

/**
 * Retorna provider conforme env / tenant settings.
 * Sprint 31b: usa `tenant_settings.teleconsulta_provider` quando configurado.
 *
 * MVP: sempre mock (até POC dos providers reais ser feito).
 */
export function resolveTeleconsultaProvider(
  preferredName?: TeleconsultaProviderName,
): TeleconsultaProvider {
  // Sprint 31b: switch real
  void preferredName
  return new MockTeleconsultaProvider()
}
