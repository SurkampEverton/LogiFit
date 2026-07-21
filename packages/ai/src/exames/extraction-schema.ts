/**
 * Schema Zod do output estruturado de extração IA de exames — Sprint 33.
 *
 * IA recebe texto OCR + prompt + retorna JSON validado por esse schema.
 * Caller (Server Action) chama `parseExtractionJson(raw)` antes de persistir
 * em `exam_extractions.structured_data jsonb`.
 *
 * **Strict mode**: campos não-listados rejeitados; força LLM seguir o contrato.
 */
import { z } from 'zod'

export const ExamAnalyteSchema = z
  .object({
    /** Code interno (mapeia pra lab_analytes Sprint 30) — ex: 'glicose_jejum' */
    code: z.string().min(2).max(60),
    /** Nome legível do analito como aparece no laudo */
    label: z.string().min(2).max(120),
    /** Valor numérico extraído */
    value: z.number().finite(),
    /** Unidade (mg/dL, ng/mL, etc.) */
    unit: z.string().min(1).max(20),
    /** Faixa de referência sugerida pelo próprio laudo (texto livre) */
    referenceHint: z.string().max(120).optional().nullable(),
    /** Match com lab_analytes.id quando IA conseguiu mapear */
    labAnalyteIdMatch: z.string().uuid().optional().nullable(),
    /** Match confiança (0-1) */
    matchConfidence: z.number().min(0).max(1).optional().nullable(),
  })
  .strict()

export const ExamExtractionSchema = z
  .object({
    /** Tipo detectado: 'hemograma' | 'perfil_lipidico' | 'bioquimica' | 'hormonal' | ... */
    examType: z.string().min(2).max(60),
    laboratory: z.string().min(2).max(120).optional().nullable(),
    /** Data de coleta (ISO) */
    collectedAt: z.string().datetime().optional().nullable(),
    /** Lista de analitos extraídos */
    analytes: z.array(ExamAnalyteSchema).min(1).max(100),
    /** Confiança geral da extração (média ou min dos analytes) */
    overallConfidence: z.number().min(0).max(1).optional().nullable(),
    /** Notas adicionais detectadas (em jejum, pós-prandial, etc.) */
    notes: z.string().max(500).optional().nullable(),
  })
  .strict()

export type ExamExtractionParsed = z.infer<typeof ExamExtractionSchema>
export type ExamAnalyteParsed = z.infer<typeof ExamAnalyteSchema>

/**
 * Valida + retorna objeto tipado. Lança ZodError se inválido.
 */
export function parseExtractionJson(raw: unknown): ExamExtractionParsed {
  return ExamExtractionSchema.parse(raw)
}

/**
 * Validação não-throw. Retorna result discriminado.
 */
export function safeParseExtractionJson(
  raw: unknown,
): { ok: true; data: ExamExtractionParsed } | { ok: false; issues: string[] } {
  const r = ExamExtractionSchema.safeParse(raw)
  if (r.success) return { ok: true, data: r.data }
  return {
    ok: false,
    issues: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
  }
}
