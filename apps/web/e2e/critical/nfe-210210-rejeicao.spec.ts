import { test } from '@playwright/test'

/**
 * critical/nfe-210210-rejeicao — emissão NF-e rejeitada com erro 210/210
 * (validação tributária) entra em fila de revisão sem corromper estado.
 * Bloqueia deploy prod se falhar (ADR 0090 §5).
 *
 * Cenário (Sprint 36 — Focus NFe):
 *   1. tenant tenta emitir NF-e produto (academia revenda de suplemento)
 *   2. Focus NFe retorna erro 210 (Erro Schema XML) OU 210 SEFAZ-rejeição
 *      (CNAE incompatível, CFOP errado, NCM inválido)
 *   3. wrapJob captura erro → invoice fica 'rejected' (não deleta linha)
 *   4. fila `fiscal_review_queue` ganha entry com (invoice_id, error_code,
 *      error_message, suggested_fix)
 *   5. UI mostra Toast critical + Banner persistente até resolver
 *   6. NF-e SEFAZ não foi efetivamente emitida (não há `protocolo_autorizacao`)
 *
 * Cobre ADR 0057 (NF-e manifestação) + ADR 0059 (ciclo fiscal Focus NFe).
 */
test.skip('NF-e rejeitada com 210/210 entra em fiscal_review_queue sem corromper estado', async () => {
  // implementação Sprint 36 (após Focus NFe adapter)
})
