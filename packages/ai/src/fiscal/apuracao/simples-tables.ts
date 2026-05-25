/**
 * Tabelas Simples Nacional vigentes — Sprint 37a (ADR 0100).
 *
 * Espelho do seed `fiscal_simples_brackets` em migration 0050. Mantemos
 * cópia hardcoded em TS pra:
 *   - Cálculos sem ida ao DB em libs puras (testes unit não dependem de PG)
 *   - Fallback determinístico se tabela DB ficar fora de sincronia
 *
 * Atualização anual (Sprint 37c): job admin LogiFit edita ESTE arquivo +
 * migration data nova `<NNNN>_simples_2027.sql` na mesma sprint. CI valida
 * que ambos batem via teste de integração.
 */
import type { SimplesBracket } from './types'

/**
 * Anexo III — serviços comuns (academia, clínica geral, consultoria).
 * Vigente desde 2018; LC 123/2006 + LC 155/2016.
 */
export const SIMPLES_ANEXO_III_2026: ReadonlyArray<SimplesBracket> = [
  {
    anexo: 'III',
    bracket: 1,
    rbt12FromCents: 0,
    rbt12ToCents: 18_000_000,
    aliquotaNominalBp: 600,
    parcelaDeduzirCents: 0,
    validFrom: '2026-01-01',
    validTo: null,
  },
  {
    anexo: 'III',
    bracket: 2,
    rbt12FromCents: 18_000_000,
    rbt12ToCents: 36_000_000,
    aliquotaNominalBp: 1120,
    parcelaDeduzirCents: 998_400,
    validFrom: '2026-01-01',
    validTo: null,
  },
  {
    anexo: 'III',
    bracket: 3,
    rbt12FromCents: 36_000_000,
    rbt12ToCents: 72_000_000,
    aliquotaNominalBp: 1350,
    parcelaDeduzirCents: 1_825_200,
    validFrom: '2026-01-01',
    validTo: null,
  },
  {
    anexo: 'III',
    bracket: 4,
    rbt12FromCents: 72_000_000,
    rbt12ToCents: 180_000_000,
    aliquotaNominalBp: 1600,
    parcelaDeduzirCents: 3_625_200,
    validFrom: '2026-01-01',
    validTo: null,
  },
  {
    anexo: 'III',
    bracket: 5,
    rbt12FromCents: 180_000_000,
    rbt12ToCents: 360_000_000,
    aliquotaNominalBp: 2100,
    parcelaDeduzirCents: 12_345_200,
    validFrom: '2026-01-01',
    validTo: null,
  },
  {
    anexo: 'III',
    bracket: 6,
    rbt12FromCents: 360_000_000,
    rbt12ToCents: 480_000_000,
    aliquotaNominalBp: 3300,
    parcelaDeduzirCents: 55_870_000,
    validFrom: '2026-01-01',
    validTo: null,
  },
]

/**
 * Anexo V — serviços intelectuais quando Fator R < 28%.
 */
export const SIMPLES_ANEXO_V_2026: ReadonlyArray<SimplesBracket> = [
  {
    anexo: 'V',
    bracket: 1,
    rbt12FromCents: 0,
    rbt12ToCents: 18_000_000,
    aliquotaNominalBp: 1550,
    parcelaDeduzirCents: 0,
    validFrom: '2026-01-01',
    validTo: null,
  },
  {
    anexo: 'V',
    bracket: 2,
    rbt12FromCents: 18_000_000,
    rbt12ToCents: 36_000_000,
    aliquotaNominalBp: 1800,
    parcelaDeduzirCents: 450_000,
    validFrom: '2026-01-01',
    validTo: null,
  },
  {
    anexo: 'V',
    bracket: 3,
    rbt12FromCents: 36_000_000,
    rbt12ToCents: 72_000_000,
    aliquotaNominalBp: 1900,
    parcelaDeduzirCents: 990_000,
    validFrom: '2026-01-01',
    validTo: null,
  },
  {
    anexo: 'V',
    bracket: 4,
    rbt12FromCents: 72_000_000,
    rbt12ToCents: 180_000_000,
    aliquotaNominalBp: 2050,
    parcelaDeduzirCents: 2_070_000,
    validFrom: '2026-01-01',
    validTo: null,
  },
  {
    anexo: 'V',
    bracket: 5,
    rbt12FromCents: 180_000_000,
    rbt12ToCents: 360_000_000,
    aliquotaNominalBp: 2300,
    parcelaDeduzirCents: 6_570_000,
    validFrom: '2026-01-01',
    validTo: null,
  },
  {
    anexo: 'V',
    bracket: 6,
    rbt12FromCents: 360_000_000,
    rbt12ToCents: 480_000_000,
    aliquotaNominalBp: 3050,
    parcelaDeduzirCents: 33_530_000,
    validFrom: '2026-01-01',
    validTo: null,
  },
]

/** Teto receita 12m do Simples (>R$ 4.8M força migração pra Presumido/Real). */
export const SIMPLES_RBT12_CEILING_CENTS = 480_000_000

/**
 * Acha o bracket vigente pro RBT12 + competência informada.
 *
 * @returns bracket ou null se RBT12 estourou o teto Simples (>R$ 4.8M)
 */
export function findSimplesBracket(
  anexo: 'III' | 'V',
  rbt12Cents: number,
  competenciaIso: string,
): SimplesBracket | null {
  const tables = anexo === 'III' ? SIMPLES_ANEXO_III_2026 : SIMPLES_ANEXO_V_2026
  // Lookup pelo vigente em `competenciaIso`
  for (const b of tables) {
    const fromOk = b.validFrom <= competenciaIso
    const toOk = b.validTo === null || competenciaIso < b.validTo
    if (!fromOk || !toOk) continue

    const rbtFromOk = rbt12Cents >= b.rbt12FromCents
    const rbtToOk = b.rbt12ToCents === null || rbt12Cents < b.rbt12ToCents
    if (rbtFromOk && rbtToOk) return b
  }
  return null
}

// ─── Lucro Presumido — alíquotas-base de presunção ────────────────────────
/**
 * Base de presunção por atividade (Lei 9.430/1996):
 *   - 8%  — venda de mercadorias e produtos (revenda)
 *   - 12% — serviços hospitalares (regra geral saúde)
 *   - 16% — receita de transporte de cargas (e gás natural)
 *   - 32% — serviços em geral (consultoria, advocacia, profissionais)
 *
 * Sobre a base presumida incidem:
 *   - IRPJ 15% + adicional 10% sobre excedente R$ 60.000/trimestre
 *   - CSLL 9% sobre base de 12% serviços / 32% genérico
 *   - PIS 0.65% + COFINS 3% sobre receita bruta (cumulativo)
 */
export const LUCRO_PRESUMIDO_ATIVIDADE = {
  REVENDA: { presunaoIrpjBp: 800, presuncaoCsllBp: 1200 },
  SERVICO_SAUDE: { presunaoIrpjBp: 1200, presuncaoCsllBp: 1200 }, // serviços hospitalares
  SERVICO_GERAL: { presunaoIrpjBp: 3200, presuncaoCsllBp: 3200 },
  TRANSPORTE_CARGAS: { presunaoIrpjBp: 1600, presuncaoCsllBp: 1200 },
} as const

export const LUCRO_PRESUMIDO_IRPJ_RATE_BP = 1500 // 15%
export const LUCRO_PRESUMIDO_IRPJ_ADICIONAL_RATE_BP = 1000 // +10% sobre excedente
export const LUCRO_PRESUMIDO_CSLL_RATE_BP = 900 // 9%
export const LUCRO_PRESUMIDO_PIS_RATE_BP = 65 // 0.65% cumulativo
export const LUCRO_PRESUMIDO_COFINS_RATE_BP = 300 // 3% cumulativo

// ─── MEI — valores fixos 2026 ────────────────────────────────────────────
/** R$ 71,50/mês — atividade Serviços (ISS) */
export const MEI_VALOR_SERVICO_CENTS = 7_150
/** R$ 67,50/mês — atividade Comércio/Indústria (ICMS) */
export const MEI_VALOR_COMERCIO_CENTS = 6_750
/** R$ 72,50/mês — atividade ambas (Comércio + Serviços) */
export const MEI_VALOR_AMBOS_CENTS = 7_250
/** Teto receita 12m MEI 2026 — R$ 81.000 */
export const MEI_RBT12_CEILING_CENTS = 8_100_000
