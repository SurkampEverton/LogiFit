'use server'

/**
 * Server Actions Pipeline Exames Laboratoriais — Sprint 33 Faixa B.2 (ADR 0050).
 *
 * Caller é staff (profissional). Member portal usa actions próprias em
 * `/meu/exames/actions.ts` (separação clara).
 *
 * Actions:
 *   - uploadExamDocument({memberId, storagePath, originalFilename, mimeType,
 *       fileSizeBytes?, sensitivity?, source='professional_upload'})
 *     → cria exam_documents status='uploaded' + dispara processExam async
 *   - processExam({examDocumentId}) — interno, chamado pelo job:
 *     1. Roda OCR (Sprint 15 abstrato) → grava raw_text + structured_data
 *     2. Compara analytes vs reference_ranges → detectPatterns + followUpSuggestions
 *     3. Classifica output draft via classifier → bloqueia se houver termo proibido
 *     4. Atualiza status='pending_review'
 *   - submitExamReview({examDocumentId, reviewedAnalytes, acceptedPatterns,
 *       acceptedHypotheses, observations})
 *     → cria exam_review_edits por campo editado + exam_interpretations_final +
 *       lab_results por analito + status='published'
 *   - listPendingExams({limit}) — fila do tenant
 *   - getExamDetail({examDocumentId}) — detalhe completo (PDF + extracted + draft)
 *   - markSensitive({examDocumentId, sensitivity})
 *   - rejectExam({examDocumentId, reason})
 *
 * **MVP**: processExam usa stub determinístico (sem chamar LLM real). Sprint 33b
 *   conecta `resolveModelForTask('extraction')` Vertex AI Gemini + `safeFetch`
 *   no OCR provider (regra 37).
 */

import { db } from '@repo/db/client'
import {
  examDocuments,
  examExtractions,
  examInterpretationsDraft,
  examInterpretationsFinal,
  examReviewEdits,
  labAnalytes,
  labReferenceRanges,
  labResults,
  members,
  persons,
  tenantExamAiSettings,
} from '@repo/db/schema'
import {
  classifyInterpretationFields,
  compareWithRanges,
  detectPatterns,
  getFollowUpSuggestions,
  parseExtractionJson,
  type ExamAnalyteParsed,
  type ExamesPatientContext as PatientContext,
  type ExamesReferenceRangeInput as ReferenceRangeInput,
} from '@repo/ai'
import { ageYearsAt } from '@repo/db/nutri'
import { ApiException } from '@repo/errors'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { wrapServerAction } from '../../lib/wrap-action'

const UploadExamSchema = z.object({
  memberId: z.string().uuid(),
  storagePath: z.string().min(2).max(500),
  originalFilename: z.string().min(2).max(200),
  mimeType: z.string().min(2).max(80),
  fileSizeBytes: z.number().int().min(1).max(50_000_000).optional().nullable(),
  sensitivity: z.enum(['normal', 'high']).default('normal'),
  source: z
    .enum(['professional_upload', 'patient_portal', 'patient_whatsapp', 'lab_integration_future'])
    .default('professional_upload'),
  sourceRef: z.string().uuid().optional().nullable(),
})

const ProcessExamSchema = z.object({
  examDocumentId: z.string().uuid(),
})

const ReviewedAnalyteSchema = z.object({
  code: z.string().min(2).max(60),
  value: z.number().finite(),
  unit: z.string().min(1).max(20),
  /** Mapeamento pra lab_analytes.id (caller resolve antes de enviar) */
  labAnalyteId: z.string().uuid(),
  /** True se profissional editou o valor da extração */
  edited: z.boolean().default(false),
  /** Profissional pode marcar pra ignorar */
  ignored: z.boolean().default(false),
})

const SubmitReviewSchema = z.object({
  examDocumentId: z.string().uuid(),
  reviewedAnalytes: z.array(ReviewedAnalyteSchema).min(1).max(100),
  acceptedPatterns: z.array(z.string().max(80)).default([]),
  acceptedHypotheses: z.array(z.string().max(500)).default([]),
  rejectedHypotheses: z.array(z.string().max(500)).default([]),
  observations: z.string().max(2000).optional().nullable(),
})

const ListPendingSchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(50),
    sensitivityFilter: z.enum(['normal', 'high']).optional().nullable(),
  })
  .optional()

const GetDetailSchema = z.object({
  examDocumentId: z.string().uuid(),
})

const MarkSensitiveSchema = z.object({
  examDocumentId: z.string().uuid(),
  sensitivity: z.enum(['normal', 'high']),
})

const RejectSchema = z.object({
  examDocumentId: z.string().uuid(),
  reason: z.string().min(2).max(500),
})

// ─── Helper: stub OCR + extraction ──────────────────────────────────────
/**
 * Stub determinístico de OCR + extração IA. Sprint 33b conecta:
 *   - OCR via packages/ai/ocr/ (provider abstrato ADR 0035)
 *   - Extração via resolveModelForTask('extraction') Vertex AI Gemini
 *
 * MVP retorna 5 analitos canônicos (hemograma básico + lipidograma básico)
 * com valores semi-aleatórios pra demonstrar UI sem dependência externa.
 */
function stubOcrAndExtraction(): {
  rawText: string
  structuredData: {
    examType: string
    laboratory: string
    collectedAt: string
    analytes: ExamAnalyteParsed[]
    overallConfidence: number
  }
} {
  return {
    rawText: '[STUB OCR — Sprint 33b conecta provider real]\nHemograma + Lipidograma\nLaboratório Exemplo SA',
    structuredData: {
      examType: 'perfil_metabolico',
      laboratory: 'Laboratório Exemplo SA',
      collectedAt: new Date().toISOString(),
      overallConfidence: 0.92,
      analytes: [
        {
          code: 'glicose_jejum',
          label: 'Glicose em jejum',
          value: 102,
          unit: 'mg/dL',
          referenceHint: '70-99 mg/dL',
          labAnalyteIdMatch: null,
          matchConfidence: 0.95,
        },
        {
          code: 'hba1c',
          label: 'Hemoglobina glicada',
          value: 5.8,
          unit: '%',
          referenceHint: '< 5.7%',
          labAnalyteIdMatch: null,
          matchConfidence: 0.93,
        },
        {
          code: 'colesterol_total',
          label: 'Colesterol total',
          value: 215,
          unit: 'mg/dL',
          referenceHint: '< 190',
          labAnalyteIdMatch: null,
          matchConfidence: 0.97,
        },
        {
          code: 'hdl',
          label: 'HDL',
          value: 38,
          unit: 'mg/dL',
          referenceHint: '> 40',
          labAnalyteIdMatch: null,
          matchConfidence: 0.96,
        },
        {
          code: 'triglicerides',
          label: 'Triglicérides',
          value: 180,
          unit: 'mg/dL',
          referenceHint: '< 150',
          labAnalyteIdMatch: null,
          matchConfidence: 0.94,
        },
      ],
    },
  }
}

// ─── uploadExamDocument ─────────────────────────────────────────────────

export const uploadExamDocument = wrapServerAction(
  {
    module: 'exames',
    action: 'document.upload',
    resourceType: 'exam_documents',
  },
  async (input: z.infer<typeof UploadExamSchema>, { session, setAuditResource }) => {
    const parsed = UploadExamSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Valida member do tenant
    const m = await db
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.id, parsed.memberId), eq(members.tenantId, tenantId)))
      .limit(1)
    if (m.length === 0) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Member não encontrado',
        request_id: '',
      })
    }

    const [row] = await db
      .insert(examDocuments)
      .values({
        tenantId,
        memberId: parsed.memberId,
        source: parsed.source,
        uploadedByUserId: session.user.id,
        sourceRef: parsed.sourceRef ?? null,
        storagePath: parsed.storagePath,
        originalFilename: parsed.originalFilename,
        mimeType: parsed.mimeType,
        fileSizeBytes: parsed.fileSizeBytes ?? null,
        sensitivity: parsed.sensitivity,
        status: 'uploaded',
      })
      .returning({ id: examDocuments.id })

    setAuditResource(row!.id, {
      member_id: parsed.memberId,
      source: parsed.source,
      sensitivity: parsed.sensitivity,
    })

    return { ok: true as const, id: row!.id }
  },
)

// ─── processExam (interno; chamado pelo job) ────────────────────────────

export const processExam = wrapServerAction(
  {
    module: 'exames',
    action: 'document.process',
    resourceType: 'exam_documents',
  },
  async (input: z.infer<typeof ProcessExamSchema>, { session, setAuditResource }) => {
    const parsed = ProcessExamSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Carrega doc + member context
    const [doc] = await db
      .select({
        id: examDocuments.id,
        memberId: examDocuments.memberId,
        status: examDocuments.status,
      })
      .from(examDocuments)
      .where(and(eq(examDocuments.id, parsed.examDocumentId), eq(examDocuments.tenantId, tenantId)))
      .limit(1)
    if (!doc) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Exam document não encontrado',
        request_id: '',
      })
    }
    if (doc.status !== 'uploaded') {
      throw new ApiException({
        code: 'CONFLICT',
        message: `Exam document já está em status ${doc.status}`,
        request_id: '',
      })
    }

    // Marca processing
    await db
      .update(examDocuments)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(examDocuments.id, doc.id))

    // 1. OCR + Extração (stub MVP)
    const { rawText, structuredData } = stubOcrAndExtraction()
    const parsedJson = parseExtractionJson(structuredData)

    await db.insert(examExtractions).values({
      tenantId,
      examDocumentId: doc.id,
      rawText,
      ocrProvider: 'stub',
      ocrConfidence: parsedJson.overallConfidence?.toString() ?? null,
      structuredData: parsedJson,
      extractionModel: 'stub-deterministic',
      cacheHit: false,
    })

    // 2. Carrega member context (idade, sexo)
    const memberInfo = await db
      .select({
        birthDate: persons.birthDate,
        sex: persons.sex,
      })
      .from(members)
      .innerJoin(persons, eq(persons.id, members.personId))
      .where(eq(members.id, doc.memberId))
      .limit(1)
    const m = memberInfo[0]
    const birthIso = m?.birthDate ? String(m.birthDate) : null
    const today = new Date().toISOString().slice(0, 10)
    const age = birthIso ? ageYearsAt(birthIso, today) : 35
    const sex: PatientContext['sex'] = m?.sex === 'male' || m?.sex === 'female' ? m.sex : 'any'
    const ctx: PatientContext = { ageYears: age, sex }

    // 3. Carrega reference_ranges para os codes detectados
    const codes = parsedJson.analytes.map((a) => a.code)
    const analyteRows = await db
      .select({
        analyteId: labAnalytes.id,
        code: labAnalytes.code,
      })
      .from(labAnalytes)
      .where(inArray(labAnalytes.code, codes))
    const codeToAnalyteId = new Map(analyteRows.map((a) => [a.code, a.analyteId]))

    const analyteIds = analyteRows.map((a) => a.analyteId)
    const rangeRows =
      analyteIds.length === 0
        ? []
        : await db
            .select({
              analyteId: labReferenceRanges.analyteId,
              code: labAnalytes.code,
              sex: labReferenceRanges.sex,
              ageMinYears: labReferenceRanges.ageMinYears,
              ageMaxYears: labReferenceRanges.ageMaxYears,
              condition: labReferenceRanges.condition,
              minValue: labReferenceRanges.minValue,
              maxValue: labReferenceRanges.maxValue,
            })
            .from(labReferenceRanges)
            .innerJoin(labAnalytes, eq(labAnalytes.id, labReferenceRanges.analyteId))
            .where(inArray(labReferenceRanges.analyteId, analyteIds))

    const ranges: ReferenceRangeInput[] = rangeRows.map((r) => ({
      code: r.code,
      sex: r.sex as ReferenceRangeInput['sex'],
      ageMinYears: r.ageMinYears,
      ageMaxYears: r.ageMaxYears,
      condition: r.condition,
      minValue: r.minValue ? Number(r.minValue) : null,
      maxValue: r.maxValue ? Number(r.maxValue) : null,
    }))

    // 4. Compara + detecta padrões
    const outOfRange = compareWithRanges(parsedJson.analytes, ranges, ctx)
    const patterns = detectPatterns(outOfRange)
    const followUp = getFollowUpSuggestions(patterns)

    // 5. Classifier guard
    const fieldsToCheck = [
      ...patterns.map((p) => p.description),
      ...followUp,
    ]
    const classification = classifyInterpretationFields(fieldsToCheck)

    // 6. Persiste draft
    await db.insert(examInterpretationsDraft).values({
      tenantId,
      examDocumentId: doc.id,
      outOfRange: outOfRange.map((o) => ({
        code: o.analyte.code,
        value: o.analyte.value,
        unit: o.analyte.unit,
        direction: o.direction,
        severity: o.severity,
      })),
      patterns: classification.ok ? patterns : [],
      hypotheses: classification.ok ? patterns.map((p) => p.description) : [],
      followUpSuggestions: classification.ok ? followUp : [],
      modelUsed: 'stub-deterministic',
      blockedByClassifier: !classification.ok,
      classifierBlockedTerms: classification.ok
        ? null
        : classification.blockedTerms.map((t) => t.matched),
    })

    // 7. Atualiza doc status='pending_review' + detected
    await db
      .update(examDocuments)
      .set({
        status: 'pending_review',
        examTypeDetected: parsedJson.examType,
        laboratory: parsedJson.laboratory ?? null,
        collectedAt: parsedJson.collectedAt ? new Date(parsedJson.collectedAt) : null,
        processedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(examDocuments.id, doc.id))

    setAuditResource(doc.id, {
      analytes_count: parsedJson.analytes.length,
      out_of_range_count: outOfRange.length,
      patterns_count: patterns.length,
      blocked_by_classifier: !classification.ok,
    })

    return {
      ok: true as const,
      analytesCount: parsedJson.analytes.length,
      outOfRangeCount: outOfRange.length,
      patternsCount: patterns.length,
      blockedByClassifier: !classification.ok,
      codesNotMapped: codes.filter((c) => !codeToAnalyteId.has(c)),
    }
  },
)

// ─── submitExamReview ───────────────────────────────────────────────────

export const submitExamReview = wrapServerAction(
  {
    module: 'exames',
    action: 'document.review',
    resourceType: 'exam_documents',
  },
  async (input: z.infer<typeof SubmitReviewSchema>, { session, setAuditResource }) => {
    const parsed = SubmitReviewSchema.parse(input)
    const tenantId = session.logifit.tenantId

    // Valida doc + tenant + status='pending_review'
    const [doc] = await db
      .select()
      .from(examDocuments)
      .where(
        and(
          eq(examDocuments.id, parsed.examDocumentId),
          eq(examDocuments.tenantId, tenantId),
          eq(examDocuments.status, 'pending_review'),
        ),
      )
      .limit(1)
    if (!doc) {
      throw new ApiException({
        code: 'CONFLICT',
        message: 'Exam não encontrado ou já revisado',
        request_id: '',
      })
    }

    await db.transaction(async (tx) => {
      // 1. Cria exam_interpretations_final
      await tx.insert(examInterpretationsFinal).values({
        tenantId,
        examDocumentId: doc.id,
        acceptedPatterns: parsed.acceptedPatterns,
        acceptedHypotheses: parsed.acceptedHypotheses,
        rejectedHypotheses: parsed.rejectedHypotheses,
        professionalObservations: parsed.observations ?? null,
        reviewedByUserId: session.user.id,
      })

      // 2. Cria audit edits (1 por analito)
      for (const a of parsed.reviewedAnalytes) {
        if (a.edited) {
          await tx.insert(examReviewEdits).values({
            tenantId,
            examDocumentId: doc.id,
            fieldKey: `analyte.${a.code}`,
            beforeValue: null,
            afterValue: { value: a.value, unit: a.unit, ignored: a.ignored },
            editedByUserId: session.user.id,
          })
        }
      }

      // 3. Cria lab_results pra cada analito não-ignorado (Sprint 30 integração)
      for (const a of parsed.reviewedAnalytes) {
        if (a.ignored) continue
        await tx.insert(labResults).values({
          tenantId,
          memberId: doc.memberId,
          analyteId: a.labAnalyteId,
          value: a.value.toString(),
          unit: a.unit,
          collectedAt: doc.collectedAt
            ? (doc.collectedAt.toISOString().slice(0, 10) as never)
            : (new Date().toISOString().slice(0, 10) as never),
          laboratory: doc.laboratory,
          enteredByUserId: session.user.id,
          // outOfRange recalculado pelo Sprint 30 quando registerLabResult — aqui passa false (MVP)
          outOfRange: false,
        })
      }

      // 4. Atualiza doc status='published'
      await tx
        .update(examDocuments)
        .set({
          status: 'published',
          reviewedAt: new Date(),
          reviewedByUserId: session.user.id,
          updatedAt: new Date(),
        })
        .where(eq(examDocuments.id, doc.id))
    })

    setAuditResource(doc.id, {
      analytes_published: parsed.reviewedAnalytes.filter((a) => !a.ignored).length,
      analytes_ignored: parsed.reviewedAnalytes.filter((a) => a.ignored).length,
      patterns_accepted: parsed.acceptedPatterns.length,
      hypotheses_accepted: parsed.acceptedHypotheses.length,
    })

    return { ok: true as const }
  },
)

// ─── listPendingExams ──────────────────────────────────────────────────

export const listPendingExams = wrapServerAction(
  { module: 'exames', action: 'document.list_pending' },
  async (input: unknown, { session }) => {
    const parsed = ListPendingSchema.parse(input ?? {}) ?? { limit: 50, sensitivityFilter: null }
    const tenantId = session.logifit.tenantId

    const conditions = [
      eq(examDocuments.tenantId, tenantId),
      eq(examDocuments.status, 'pending_review'),
    ]
    if (parsed.sensitivityFilter) {
      conditions.push(eq(examDocuments.sensitivity, parsed.sensitivityFilter))
    }

    const rows = await db
      .select({
        id: examDocuments.id,
        memberId: examDocuments.memberId,
        memberName: persons.name,
        source: examDocuments.source,
        sensitivity: examDocuments.sensitivity,
        examTypeDetected: examDocuments.examTypeDetected,
        laboratory: examDocuments.laboratory,
        uploadedAt: examDocuments.uploadedAt,
        processedAt: examDocuments.processedAt,
      })
      .from(examDocuments)
      .innerJoin(members, eq(members.id, examDocuments.memberId))
      .innerJoin(persons, eq(persons.id, members.personId))
      .where(and(...conditions))
      .orderBy(asc(examDocuments.uploadedAt))
      .limit(parsed.limit)

    return { ok: true as const, rows }
  },
)

// ─── getExamDetail ─────────────────────────────────────────────────────

export const getExamDetail = wrapServerAction(
  { module: 'exames', action: 'document.read' },
  async (input: z.infer<typeof GetDetailSchema>, { session }) => {
    const parsed = GetDetailSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [doc] = await db
      .select()
      .from(examDocuments)
      .where(and(eq(examDocuments.id, parsed.examDocumentId), eq(examDocuments.tenantId, tenantId)))
      .limit(1)
    if (!doc) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Exam não encontrado',
        request_id: '',
      })
    }

    const [extraction] = await db
      .select()
      .from(examExtractions)
      .where(eq(examExtractions.examDocumentId, doc.id))
      .orderBy(desc(examExtractions.extractionAt))
      .limit(1)

    const [draft] = await db
      .select()
      .from(examInterpretationsDraft)
      .where(eq(examInterpretationsDraft.examDocumentId, doc.id))
      .orderBy(desc(examInterpretationsDraft.generatedAt))
      .limit(1)

    return { ok: true as const, doc, extraction, draft }
  },
)

// ─── markSensitive ──────────────────────────────────────────────────────

export const markSensitive = wrapServerAction(
  {
    module: 'exames',
    action: 'document.mark_sensitive',
    resourceType: 'exam_documents',
  },
  async (input: z.infer<typeof MarkSensitiveSchema>, { session, setAuditResource }) => {
    const parsed = MarkSensitiveSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [row] = await db
      .update(examDocuments)
      .set({ sensitivity: parsed.sensitivity, updatedAt: new Date() })
      .where(
        and(
          eq(examDocuments.id, parsed.examDocumentId),
          eq(examDocuments.tenantId, tenantId),
        ),
      )
      .returning({ id: examDocuments.id })

    if (!row) {
      throw new ApiException({
        code: 'NOT_FOUND',
        message: 'Exam não encontrado',
        request_id: '',
      })
    }
    setAuditResource(row.id, { new_sensitivity: parsed.sensitivity })
    return { ok: true as const }
  },
)

// ─── rejectExam ─────────────────────────────────────────────────────────

export const rejectExam = wrapServerAction(
  {
    module: 'exames',
    action: 'document.reject',
    resourceType: 'exam_documents',
  },
  async (input: z.infer<typeof RejectSchema>, { session, setAuditResource }) => {
    const parsed = RejectSchema.parse(input)
    const tenantId = session.logifit.tenantId

    const [row] = await db
      .update(examDocuments)
      .set({
        status: 'rejected',
        rejectionReason: parsed.reason,
        reviewedAt: new Date(),
        reviewedByUserId: session.user.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(examDocuments.id, parsed.examDocumentId),
          eq(examDocuments.tenantId, tenantId),
          inArray(examDocuments.status, ['uploaded', 'processing', 'pending_review']),
        ),
      )
      .returning({ id: examDocuments.id })

    if (!row) {
      throw new ApiException({
        code: 'CONFLICT',
        message: 'Exam não encontrado ou já em status terminal',
        request_id: '',
      })
    }
    setAuditResource(row.id, { reason: parsed.reason })
    return { ok: true as const }
  },
)

void tenantExamAiSettings // silence unused import (Sprint 33b consome)
