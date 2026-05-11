import { test } from '@playwright/test'

/**
 * smoke/agenda-book — agendamento básico de sessão.
 * Bloqueia merge se falhar (ADR 0090 §6).
 *
 * Cenário (Sprint 03 — agenda universal):
 *   1. login recepção
 *   2. /app/agenda — clica slot livre (terça 10h)
 *   3. modal preenche member + profissional + duração
 *   4. submit → slot fica ocupado + Toast
 *   5. refresh → slot continua ocupado (RLS preserva)
 *
 * NÃO testa overbooking, no-show, troca de profissional (vão pra regression/).
 */
test.skip('recepção agenda sessão em slot livre e persiste no calendário', async () => {
  // implementação Sprint 03
})
