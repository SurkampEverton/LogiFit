import { test } from '@playwright/test'

/**
 * smoke/member-create — criar member (aluno/paciente) via UI.
 * Bloqueia merge se falhar (ADR 0090 §6).
 *
 * Cenário (Sprint 02 — CRM unificado):
 *   1. login recepção
 *   2. /app/members/new — preenche form (nome, email, telefone, CPF)
 *   3. submit → /app/members/{id} → Toast success
 *   4. SELECT count(*) FROM members WHERE tenant_id = current → +1
 *
 * Smoke valida só o caminho feliz; cenários de validação (T2 fast-check)
 * vivem em regression/.
 */
test.skip('recepção cria member com sucesso e vê toast de confirmação', async () => {
  // implementação Sprint 02
})
