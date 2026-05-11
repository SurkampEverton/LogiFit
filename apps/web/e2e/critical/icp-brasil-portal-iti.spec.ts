import { test } from '@playwright/test'

/**
 * critical/icp-brasil-portal-iti — assinatura ICP-Brasil de prontuário médico
 * via portal ITI valida cert + grava em signed_documents (Sprint 20).
 * Bloqueia deploy prod se falhar (ADR 0090 §5).
 *
 * Cenário (medico CRM apenas — gate `signEvolution` regra 41 ai-blocked):
 *   1. médico abre evolução pronta pra assinar
 *   2. UI dispara fluxo Portal ITI assinador (provider abstrato — ADR 0041)
 *   3. MSW intercepta callback do portal com payload simulado (cert válido A3)
 *   4. signed_documents recebe linha com (doc_hash, signature_b64, cert_serial,
 *      cert_cpf, cert_chain, signed_at, valid_until)
 *   5. validação OCSP roda → cert revogado → REJECTED + audit_log marca tentativa
 *   6. caso happy path: doc_hash bate com hash do conteúdo (no rebind allowed)
 *
 * Cobre Lei 13.787/2018 + CFM 2.299/2021 + ADR 0041.
 */
test.skip('Portal ITI assina evolução médica, valida cert OCSP, grava signed_documents', async () => {
  // implementação Sprint 20 (após signature_policies + provider Portal ITI)
})
