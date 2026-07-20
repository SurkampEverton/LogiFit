/**
 * Endereço brasileiro — schema canônico do monorepo.
 *
 * Existe porque o mesmo shape estava definido em três lugares (`@repo/cnpj`,
 * as Server Actions de pessoas e a tela de empresas), cada um com validação
 * ligeiramente diferente. Duas colunas do banco guardam esse jsonb —
 * `persons.address` e `units.address` — e sem schema comum nada impedia que
 * uma passasse a gravar `{rua, num}` e a outra `{logradouro, numero}`.
 *
 * Todos os campos são opcionais: endereço parcial é comum (cadastro em
 * andamento, PJ sem complemento) e barrar isso travaria fluxo legítimo. Quem
 * exige endereço completo — o cadastro de empresa na Focus NFe, por exemplo —
 * valida o que precisa no seu próprio boundary.
 *
 * Aceita `null` além de `undefined` porque providers externos (BrasilAPI,
 * ReceitaWS) devolvem `null` para campo ausente.
 */
import { z } from 'zod'

export const addressSchema = z.object({
  cep: z.string().trim().max(9).nullish(),
  logradouro: z.string().trim().max(200).nullish(),
  numero: z.string().trim().max(20).nullish(),
  complemento: z.string().trim().max(100).nullish(),
  bairro: z.string().trim().max(100).nullish(),
  cidade: z.string().trim().max(100).nullish(),
  uf: z.string().trim().length(2).nullish(),
})

export type Address = z.infer<typeof addressSchema>

/** Campos na ordem em que se lê um endereço — para UI e formatação. */
export const ADDRESS_FIELDS = [
  'cep',
  'logradouro',
  'numero',
  'complemento',
  'bairro',
  'cidade',
  'uf',
] as const satisfies ReadonlyArray<keyof Address>

/**
 * Remove campos vazios e devolve `null` quando não sobrou nada.
 *
 * O `null` é deliberado: gravar `{}` ou `{cep: ''}` tornaria "não informado"
 * indistinguível de "informado vazio", e a UI perde a capacidade de sinalizar
 * cadastro incompleto — que é justamente o que trava o cadastro fiscal.
 */
export function normalizeAddress(input: Address | null | undefined): Address | null {
  if (!input) return null
  const entries = Object.entries(input).filter(([, v]) => typeof v === 'string' && v.trim() !== '')
  if (entries.length === 0) return null
  return Object.fromEntries(entries.map(([k, v]) => [k, (v as string).trim()])) as Address
}

/** `true` quando tem o mínimo que emissão fiscal exige (logradouro + cidade + UF). */
export function isAddressFiscallyComplete(input: Address | null | undefined): boolean {
  const a = normalizeAddress(input)
  return Boolean(a?.logradouro && a?.numero && a?.cidade && a?.uf)
}
