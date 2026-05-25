import { SIMPLES_RBT12_CEILING_CENTS } from '@repo/ai'
/**
 * Cross-alert teto Simples — Sprint 37b (regra 33 + ADR 0071).
 *
 * Dispara `system_alerts` quando RBT12 da apuração se aproxima do teto do
 * Simples Nacional (R$ 4.8M/ano em 2026). Threshold conservador: 87% (R$ 4.176k)
 * vira warning; 95% (R$ 4.56M) vira critical — operador tem ~10 meses pra
 * planejar migração pra Lucro Presumido (regra 26 fiscal).
 *
 * **Fingerprint estável** `simples_ceiling:{companyId}` permite ring buffer 20
 * occurrences sem duplicar alerts a cada apuração mensal. UPSERT incrementa
 * `occurrence_count` + atualiza `last_seen_at`.
 *
 * **Best-effort**: falha NÃO propaga pra Server Action principal (aggregate
 * já registrou). Loga warning estruturado via pino.
 */
import { pool } from '@repo/db/client'

/** 87% do teto = R$ 4.176.000. Warning antecipado. */
const WARNING_THRESHOLD = Math.floor(SIMPLES_RBT12_CEILING_CENTS * 0.87)
/** 95% do teto = R$ 4.560.000. Critical — migração obrigatória mês seguinte. */
const CRITICAL_THRESHOLD = Math.floor(SIMPLES_RBT12_CEILING_CENTS * 0.95)

export async function dispatchSimplesCeilingAlert(input: {
  tenantId: string
  companyId: string
  rbt12Cents: number
  yearMonth: string
}): Promise<void> {
  const { tenantId, companyId, rbt12Cents, yearMonth } = input

  // RBT12 abaixo do threshold de warning — nada a fazer
  if (rbt12Cents < WARNING_THRESHOLD) return

  const severity = rbt12Cents >= CRITICAL_THRESHOLD ? 'critical' : 'warning'
  const retentionDays = severity === 'critical' ? 1825 : 90 // 5a critical, 90d warning
  const percentOfCeiling = Math.round((rbt12Cents / SIMPLES_RBT12_CEILING_CENTS) * 100)

  const fingerprint = `simples_ceiling:${companyId}`
  const title =
    severity === 'critical'
      ? 'RBT12 do Simples >= 95% do teto — migração obrigatória'
      : 'RBT12 do Simples >= 87% do teto — planeje migração'
  const baseLine =
    `Apuração ${yearMonth}: RBT12 = R$ ${(rbt12Cents / 100).toFixed(2)} ` +
    `(${percentOfCeiling}% do teto R$ ${(SIMPLES_RBT12_CEILING_CENTS / 100).toFixed(2)}). `
  const followUp =
    severity === 'critical'
      ? 'Excedeu margem de segurança. Consulte contador agora pra migração antecipada pra Lucro Presumido — desenquadramento automático no mês seguinte se RBT12 ultrapassar o teto.'
      : 'Ritmo atual leva a estouro em ~3-4 meses. Inicie conversa com contador pra avaliar Lucro Presumido em 2027.'
  const description = `${baseLine}${followUp}`

  try {
    await pool.query(
      `INSERT INTO system_alerts (
         tenant_id, severity, category, fingerprint, title, description,
         first_seen_at, last_seen_at, occurrence_count, retention_days
       ) VALUES (
         $1::uuid, $2, 'fiscal', $3, $4, $5,
         now(), now(), 1, $6
       )
       ON CONFLICT (tenant_id, fingerprint) DO UPDATE SET
         last_seen_at = now(),
         occurrence_count = system_alerts.occurrence_count + 1,
         severity = EXCLUDED.severity,
         description = EXCLUDED.description,
         retention_days = EXCLUDED.retention_days,
         updated_at = now()`,
      [tenantId, severity, fingerprint, title, description, retentionDays],
    )
  } catch (err) {
    // Best-effort: log warning, não propaga (SA principal continua sucesso)
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'simples_ceiling_alert_dispatch_failed',
        tenantId: tenantId.slice(0, 8),
        companyId: companyId.slice(0, 8),
        severity,
        error: err instanceof Error ? err.message : 'unknown',
      }),
    )
  }
}
