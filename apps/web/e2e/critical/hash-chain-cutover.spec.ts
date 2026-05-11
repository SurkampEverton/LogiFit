import { test } from '@playwright/test'

/**
 * critical/hash-chain-cutover — audit_log mantém continuidade do hash chain
 * mesmo após restart da app / failover do DB (regra 39).
 * Bloqueia deploy prod se falhar (ADR 0090 §5).
 *
 * Cenário:
 *   1. insere 100 linhas em audit_log de tenant T (várias actions)
 *   2. verifica via job de verificação semanal: previous_hash de cada linha
 *      bate com current_hash da linha anterior (mesmo tenant)
 *   3. simula cutover (drop conexões + reconecta)
 *   4. insere mais 100 linhas
 *   5. job de verificação roda novamente → continuidade preservada
 *   6. tenta INSERT com previous_hash forjado → trigger reject (constraint)
 *   7. system_alerts critical é criado se quebra detectada
 *
 * Cobre regra 39 (hash chain) + WORM anchor (Sprint 19+ — primeiro audit
 * `audit_log_anchor` em VPS independente).
 */
test.skip('audit_log preserva hash chain pós-cutover; INSERT forjado é rejeitado', async () => {
  // implementação Sprint 01a (após audit_log com trigger)
})
