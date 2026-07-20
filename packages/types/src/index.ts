/**
 * `@repo/types` — schemas Zod e contratos compartilhados entre packages e app.
 *
 * Só entra aqui o que é usado por mais de um consumidor. Tipo de um módulo só
 * mora no módulo.
 */
export {
  ADDRESS_FIELDS,
  type Address,
  addressSchema,
  isAddressFiscallyComplete,
  normalizeAddress,
} from './address'
