/**
 * Tradução do resultado do provider para as colunas de status persistidas
 * (`fiscal_emissions` e `fiscal_events` — mesmo enum, mesmo CHECK).
 *
 * Existe como função pura e testada porque a versão inline anterior tinha um
 * bug silencioso replicado em 7 sites de persistência: cada um fazia
 * `status === 'completed' ? 'completed' : 'queued'`, o que achatava `rejected`
 * (junto com o motivo) e `processing` em `queued`. Efeito prático: nota
 * rejeitada aparecia eternamente como "Na fila" e o operador ficava esperando
 * um documento fiscal que nunca viria — sem nenhum sinal de erro.
 *
 * Descoberto na primeira emissão real contra a Focus NFe (2026-07-20): a
 * rejeição `empresa_nao_habilitada` foi gravada como `queued`.
 */
import type { EmissionResult } from './provider'

export interface ProviderOutcomeColumns {
  status: EmissionResult['status']
  completedAt: Date | null
  rejectionReason: string | null
}

/**
 * O fallback textual não é cosmético: o CHECK `*_rejected_consistency` exige
 * `rejection_reason NOT NULL` quando o status é `rejected`, então provider que
 * rejeite sem mensagem derrubaria o INSERT inteiro.
 *
 * @param now injetável pra teste determinístico; default é o instante da chamada
 */
export function providerOutcome(
  result: { status: EmissionResult['status']; rejectionReason?: string | null },
  now: Date = new Date(),
): ProviderOutcomeColumns {
  return {
    status: result.status,
    completedAt: result.status === 'completed' ? now : null,
    rejectionReason:
      result.status === 'rejected'
        ? (result.rejectionReason ?? 'Rejeitada pelo provider sem motivo informado')
        : null,
  }
}
