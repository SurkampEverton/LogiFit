import { test } from '@playwright/test'

/**
 * critical/tiss-xsd-validation — guia TISS gerada passa em validador XSD ANS
 * 4.01 antes de submissão (Sprint 22 + ADR 0079).
 * Bloqueia deploy prod se falhar (ADR 0090 §5).
 *
 * Cenário:
 *   1. fisio cria guia SP/SADT pra paciente convênio Unimed
 *   2. handler `submitTissGuide` chama:
 *      a. zod schema (boundary regra 7) valida payload
 *      b. transformador TISS gera XML 4.01
 *      c. **validador XSD oficial ANS** roda contra XML — abort se erro
 *      d. submissão (manual ou SOAP, decisão Sprint 22)
 *   3. mocked TUSS code inválido → handler retorna `FISCAL_REJECTED` envelope
 *      com `validation_errors[]` listando código/path do erro XSD
 *   4. nenhuma submissão SOAP é feita (não há side-effect)
 *
 * Implementa ADR 0079 + "validador proativo XSD/regra de negócio" do MVP.
 */
test.skip('guia TISS com TUSS inválido falha validação XSD antes de submeter', async () => {
  // implementação Sprint 22 (após pipeline atualização semestral TUSS)
})
