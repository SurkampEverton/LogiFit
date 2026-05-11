import { test } from '@playwright/test'

/**
 * smoke/global-search — pesquisa global via Command Palette (ADR 0062 + regra 30).
 * Bloqueia merge se falhar (ADR 0090 §6).
 *
 * Cenário:
 *   1. login fisio
 *   2. Ctrl+K abre Command Palette
 *   3. digita "João Silva"
 *   4. resultados aparecem agrupados por kind (member, agendamento, ...)
 *   5. resultado de OUTRO tenant ou OUTRA permission NÃO aparece (RLS + required_permission)
 *   6. click em resultado → navega pro URL correto
 *
 * Implementa regra 30 (módulo registrado em search_index via trigger).
 */
test.skip('Command Palette retorna resultados filtrados por RLS + permission', async () => {
  // implementação Sprint 02 (após search_index ativo)
})
