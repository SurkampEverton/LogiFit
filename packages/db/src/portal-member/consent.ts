/**
 * Consent helpers — Sprint 26 Faixa B.1.
 *
 * Catalog canônico de finalidades intra-tenant (`member_consents.purpose`).
 * Decide qual impacto desligar consent tem (mostrado no UI antes de salvar —
 * Direito VII LGPD art. 18).
 */

export type ConsentPurpose =
  | 'marketing'
  | 'cross_module_share'
  | 'analytics_anon'
  | 'photo_use'
  | 'whatsapp_promotional'

export interface ConsentPurposeMeta {
  key: ConsentPurpose
  labelPt: string
  /** Texto exato do impacto quando desligado — Direito VII. */
  impactWhenRevokedPt: string
  /** True = essential pra função core; revogação pode degradar UX mas não bloqueia. */
  essential: boolean
  /** Renovação requerida em N meses (LGPD recomenda 12m). NULL = nunca expira. */
  renewalMonths: number | null
}

export const CONSENT_CATALOG: Record<ConsentPurpose, ConsentPurposeMeta> = {
  marketing: {
    key: 'marketing',
    labelPt: 'Receber novidades, promoções e dicas por email',
    impactWhenRevokedPt:
      'Você deixará de receber emails promocionais. Comunicações operacionais (cobrança, agendamentos) continuam.',
    essential: false,
    renewalMonths: 12,
  },
  cross_module_share: {
    key: 'cross_module_share',
    labelPt: 'Compartilhar dados entre serviços (Academia ↔ Fisio ↔ Nutri) do mesmo estabelecimento',
    impactWhenRevokedPt:
      'O fisioterapeuta não verá seus dados de treino da academia, e vice-versa. Cada profissional verá apenas o que registrar.',
    essential: false,
    renewalMonths: 12,
  },
  analytics_anon: {
    key: 'analytics_anon',
    labelPt: 'Uso anônimo dos meus dados para estatísticas agregadas',
    impactWhenRevokedPt:
      'Seus dados não entrarão em métricas agregadas (ex: "média de IMC dos alunos"). Não afeta seu uso pessoal.',
    essential: false,
    renewalMonths: null,
  },
  photo_use: {
    key: 'photo_use',
    labelPt: 'Uso de fotos minhas em material institucional do estabelecimento',
    impactWhenRevokedPt:
      'Fotos suas não serão usadas em redes sociais nem materiais de marketing do estabelecimento.',
    essential: false,
    renewalMonths: 24,
  },
  whatsapp_promotional: {
    key: 'whatsapp_promotional',
    labelPt: 'Receber WhatsApp com promoções e dicas',
    impactWhenRevokedPt:
      'Você deixará de receber WhatsApps promocionais. Lembretes de agendamento e cobranças continuam.',
    essential: false,
    renewalMonths: 12,
  },
}

// ─── Renewal detection ─────────────────────────────────────────────────

export interface ConsentRecord {
  purpose: ConsentPurpose
  grantedAt: string // ISO
  revokedAt: string | null
}

export type RenewalStatus = 'active' | 'expiring_soon' | 'expired' | 'revoked'

export interface RenewalCheck {
  purpose: ConsentPurpose
  status: RenewalStatus
  daysUntilExpiry: number | null
}

/**
 * Avalia se cada consent ativo precisa renovação.
 *   - revoked → status='revoked'
 *   - sem renewalMonths → 'active' sempre
 *   - >30d até expiry → 'active'
 *   - ≤30d e >0 → 'expiring_soon'
 *   - ≤0 → 'expired'
 */
export function checkRenewalStatus(
  consents: ConsentRecord[],
  now: Date = new Date(),
): RenewalCheck[] {
  return consents.map((c) => {
    if (c.revokedAt) {
      return { purpose: c.purpose, status: 'revoked', daysUntilExpiry: null }
    }
    const meta = CONSENT_CATALOG[c.purpose]
    if (!meta || meta.renewalMonths === null) {
      return { purpose: c.purpose, status: 'active', daysUntilExpiry: null }
    }
    const grantedMs = new Date(c.grantedAt).getTime()
    const expiryMs = grantedMs + meta.renewalMonths * 30 * 24 * 60 * 60 * 1000
    const daysUntilExpiry = Math.round((expiryMs - now.getTime()) / (24 * 60 * 60 * 1000))
    let status: RenewalStatus = 'active'
    if (daysUntilExpiry <= 0) status = 'expired'
    else if (daysUntilExpiry <= 30) status = 'expiring_soon'
    return { purpose: c.purpose, status, daysUntilExpiry }
  })
}

/**
 * Lista consents que precisam de atenção (expiring_soon | expired).
 */
export function pickConsentsNeedingRenewal(checks: RenewalCheck[]): RenewalCheck[] {
  return checks.filter((c) => c.status === 'expiring_soon' || c.status === 'expired')
}
