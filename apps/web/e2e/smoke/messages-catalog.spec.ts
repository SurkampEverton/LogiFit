import { test } from '@playwright/test'

/**
 * smoke/messages-catalog — catálogo de mensagens fechado da regra 45 funciona
 * (Toast/Banner/AlertDialog/ConfirmDialog/PromptDialog/FormError).
 * Bloqueia merge se falhar (ADR 0090 §6).
 *
 * Cenário:
 *   1. navegar pra /styleguide#mensagens (página pós-Sprint 00)
 *   2. cada um dos 6 tipos renderiza com tokens "Equilíbrio Vital"
 *   3. aria-live correto em Toast (status vs alert por severity)
 *   4. focus trap em AlertDialog/ConfirmDialog/PromptDialog
 *   5. Toaster CSP-safe — nonce no <script> dentro do componente Sonner
 *
 * Cobre regra 45 + ADR 0089 + ADR 0073 (CSP nonce).
 */
test.skip('catálogo de mensagens renderiza 6 tipos com a11y + CSP nonce', async () => {
  // styleguide ainda não existe — Sprint 00b cria; teste fica skip até lá
})
