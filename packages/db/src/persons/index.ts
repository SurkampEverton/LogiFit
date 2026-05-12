/**
 * `@repo/db/persons` — utilitários puros sobre o cadastro central `persons`
 * (ADR 0047). Validações de documento PF/PJ canônicas, sem dependência de DB.
 *
 * Server Action / API Route que valida documento usa via:
 *   import { parseDocument } from '@repo/db/persons'
 */
export {
  detectKind,
  formatDocument,
  isValidCnpj,
  isValidCpf,
  normalizeDocument,
  parseDocument,
} from './document'
export type { ParseDocumentError, ParseDocumentResult, PersonKind } from './document'
