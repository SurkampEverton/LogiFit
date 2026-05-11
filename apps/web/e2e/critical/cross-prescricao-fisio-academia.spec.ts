import { test } from '@playwright/test'

/**
 * critical/cross-prescricao-fisio-academia — cross-alert lesão Fisio →
 * adaptação automática do treino Academia (Sprint 27).
 * Bloqueia deploy prod se falhar (ADR 0090 §5).
 *
 * Cenário:
 *   1. Paciente P tem patient_link_modules ativo em (Clínica F, fisioterapia)
 *      e (Academia A, academia)
 *   2. Fisio de F registra evolução SOAP com restrição "evitar leg press 90°"
 *      (CID-11 M22.4 condromalácia patelar)
 *   3. cross-alert dispatcher (regra 30 search + Sprint 09 engagement) detecta
 *      restrição clínica → publica evento `clinic.restriction.added`
 *   4. Academia A recebe evento → marca treino atual de P como `needs_review`
 *   5. Personal de A entra no treino → vê banner "ajustar baseado em restrição
 *      clínica de fisio (resumido, não bruto)"
 *   6. resumo cross-tenant é PAYLOAD AGREGADO (não traz CID original)
 *
 * Cobre regra 42 §"cross-tenant entrega resumido, não bruto".
 */
test.skip('restrição fisio dispara cross-alert + adapta treino academia sem vazar diagnóstico', async () => {
  // implementação Sprint 27 (após cross-alert dispatcher)
})
