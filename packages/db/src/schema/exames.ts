/**
 * Pipeline Exames Laboratoriais — Sprint 33 Faixa A (ADR 0050 Accepted).
 *
 * 6 tabelas:
 *   - `exam_documents` — PDF/imagem original; status workflow
 *     uploaded → processing → pending_review → published | rejected.
 *     Particionamento ANUAL Sprint 33b (regra 34 + ADR 0072); @volume 2M+/ano;
 *     retenção 20 anos Lei 13.787/CFM 2.299.
 *   - `exam_extractions` — texto bruto OCR + structured_data jsonb (analitos
 *     extraídos por IA). 1:1 com exam_documents.
 *   - `exam_interpretations_draft` — interpretação preliminar IA: padrões,
 *     hipóteses, follow-up. Conservadora (nunca diagnóstico).
 *   - `exam_interpretations_final` — versão revisada pelo profissional.
 *   - `exam_review_edits` — audit append-only de toda edição durante review.
 *   - `tenant_exam_ai_settings` — opt-out por tenant (LGPD-sensitive).
 *
 * **Sources** (origem do upload):
 *   - `professional_upload` — staff sobe direto
 *   - `patient_portal` — paciente via `/meu/exames/upload` (consent obrigatório)
 *   - `patient_whatsapp` — anexo WhatsApp (Sprint 13 hub ADR 0051) com
 *     `source_ref` apontando pra `whatsapp_inbound_messages.id`
 *   - `lab_integration_future` — Sprint 33b: integração direta com Sabin/DB/Fleury
 *
 * **Sensitivity** (HIV/psiquiátrico/genético/paternidade):
 *   - `sensitivity='high'` exige permission `exam.sensitive.read`
 *   - Audit reforçado em leituras
 *
 * **Classificador anti-diagnóstico** (regra 28 + ADR 0050): output IA passa
 *   por `classifyInterpretationOutput` antes de virar `exam_interpretations_draft`.
 *   Frases bloqueadas viram `blocked_by_classifier=true` + fallback texto manual.
 *
 * **ANVISA RDC 657/2022**: pipeline interpretação é SaMD Classe II — exige
 *   notificação ANVISA antes do feature flag ir a prod (ADR 0053 + regra 28).
 *
 * @volume_estimate_yearly: 2000000
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { members } from './members'
import { users } from './identity'

// ─── Enums ───────────────────────────────────────────────────────────────

export const examDocumentSourceEnum = pgEnum('exam_document_source', [
  'professional_upload',
  'patient_portal',
  'patient_whatsapp',
  'lab_integration_future',
])

export const examDocumentSensitivityEnum = pgEnum('exam_document_sensitivity', [
  'normal',
  'high',
])

export const examDocumentStatusEnum = pgEnum('exam_document_status', [
  'uploaded', // recém-chegado; aguarda scan + OCR
  'processing', // OCR + extração + interpretação rodando
  'pending_review', // tudo pronto; aguarda profissional
  'published', // confirmado; lab_results criados
  'rejected', // descartado pelo profissional (PDF ilegível, exame não pertinente)
  'failed', // erro técnico (OCR falhou, IA bloqueou tudo)
])

export const aiClassifierStrictnessEnum = pgEnum('ai_classifier_strictness', [
  'strict',
  'moderate',
])

// ─── exam_documents ─────────────────────────────────────────────────────

export const examDocuments = pgTable(
  'exam_documents',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    /** Origem do upload */
    source: examDocumentSourceEnum('source').notNull(),
    /** Quem subiu (professional_upload + lab_integration_future) */
    uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Quem subiu (patient_portal + patient_whatsapp) — member_id do paciente */
    uploadedByMemberId: uuid('uploaded_by_member_id').references(() => members.id, {
      onDelete: 'set null',
    }),
    /** Referência opcional pra rastreabilidade (whatsapp_inbound_messages.id, etc.) */
    sourceRef: uuid('source_ref'),
    /** Path MinIO bucket lab-documents */
    storagePath: text('storage_path').notNull(),
    originalFilename: text('original_filename').notNull(),
    mimeType: text('mime_type').notNull(),
    fileSizeBytes: integer('file_size_bytes'),
    sensitivity: examDocumentSensitivityEnum('sensitivity').notNull().default('normal'),
    /** Tipo detectado pela IA (hemograma, perfil lipídico, etc.) */
    examTypeDetected: text('exam_type_detected'),
    laboratory: text('laboratory'),
    collectedAt: timestamp('collected_at', { withTimezone: true }),
    status: examDocumentStatusEnum('status').notNull().default('uploaded'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    /** Motivo da rejeição (status='rejected') */
    rejectionReason: text('rejection_reason'),
    /** Erro técnico (status='failed') */
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** Fila do profissional (status=pending_review por tenant) */
    index('exam_docs_pending_idx')
      .on(t.tenantId, t.uploadedAt.desc())
      .where(sql`status = 'pending_review'`),
    /** Histórico do member */
    index('exam_docs_member_idx').on(t.memberId, t.uploadedAt.desc()),
    /** Filtros por status */
    index('exam_docs_tenant_status_idx').on(t.tenantId, t.status, t.uploadedAt.desc()),
    /** Sensitivity lookup pra audit reforçado */
    index('exam_docs_sensitive_idx')
      .on(t.tenantId, t.memberId)
      .where(sql`sensitivity = 'high'`),
    check(
      'exam_docs_uploader_consistency',
      sql`(${t.uploadedByUserId} IS NOT NULL OR ${t.uploadedByMemberId} IS NOT NULL)`,
    ),
    check(
      'exam_docs_review_consistency',
      sql`(status NOT IN ('published', 'rejected') OR (reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL))`,
    ),
  ],
)

// ─── exam_extractions ────────────────────────────────────────────────────

export const examExtractions = pgTable(
  'exam_extractions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    examDocumentId: uuid('exam_document_id')
      .notNull()
      .references(() => examDocuments.id, { onDelete: 'cascade' }),
    /** Texto bruto do OCR */
    rawText: text('raw_text'),
    /** Provider OCR usado (ADR 0035) — 'ocr_space', 'google_vision', etc. */
    ocrProvider: text('ocr_provider'),
    /** Confiança média 0-1 (provider-specific) */
    ocrConfidence: numeric('ocr_confidence', { precision: 4, scale: 3 }),
    /** JSON normalizado:
     * { examType, laboratory, collectedAt, analytes: [{ code, value, unit, referenceHint, lab_analyte_id_match? }] }
     */
    structuredData: jsonb('structured_data'),
    extractionModel: text('extraction_model'), // ex: 'claude-3.5-sonnet', 'gemini-1.5-pro'
    extractionAt: timestamp('extraction_at', { withTimezone: true }).notNull().defaultNow(),
    extractionCostCents: integer('extraction_cost_cents'),
    /** Cache hit (Sprint 06) */
    cacheHit: boolean('cache_hit').notNull().default(false),
  },
  (t) => [
    /** 1:1 com exam_documents (mais recente; pode re-extrair) */
    index('exam_extractions_doc_idx').on(t.examDocumentId, t.extractionAt.desc()),
    index('exam_extractions_tenant_idx').on(t.tenantId, t.extractionAt.desc()),
    check(
      'exam_extractions_confidence_range',
      sql`${t.ocrConfidence} IS NULL OR (${t.ocrConfidence} >= 0 AND ${t.ocrConfidence} <= 1)`,
    ),
  ],
)

// ─── exam_interpretations_draft ──────────────────────────────────────────

export const examInterpretationsDraft = pgTable(
  'exam_interpretations_draft',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    examDocumentId: uuid('exam_document_id')
      .notNull()
      .references(() => examDocuments.id, { onDelete: 'cascade' }),
    /** Analitos fora da faixa: [{ code, value, direction: 'above'|'below', severity }] */
    outOfRange: jsonb('out_of_range'),
    /** Padrões cross-analito detectados: [{ pattern_code, confidence, evidence: [analyte_codes] }] */
    patterns: jsonb('patterns'),
    /** Hipóteses conservadoras: [{ hypothesis, confidence, evidence }] */
    hypotheses: jsonb('hypotheses'),
    /** Sugestões de exames complementares */
    followUpSuggestions: jsonb('follow_up_suggestions'),
    modelUsed: text('model_used').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Classificador bloqueou termo proibido — fallback texto manual */
    blockedByClassifier: boolean('blocked_by_classifier').notNull().default(false),
    classifierBlockedTerms: jsonb('classifier_blocked_terms'),
    generationCostCents: integer('generation_cost_cents'),
  },
  (t) => [
    index('exam_interp_draft_doc_idx').on(t.examDocumentId, t.generatedAt.desc()),
    index('exam_interp_draft_blocked_idx')
      .on(t.tenantId, t.generatedAt.desc())
      .where(sql`blocked_by_classifier = true`),
  ],
)

// ─── exam_interpretations_final ──────────────────────────────────────────

export const examInterpretationsFinal = pgTable(
  'exam_interpretations_final',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    examDocumentId: uuid('exam_document_id')
      .notNull()
      .references(() => examDocuments.id, { onDelete: 'cascade' }),
    /** Padrões aceitos pelo profissional (subset do draft) */
    acceptedPatterns: jsonb('accepted_patterns'),
    /** Hipóteses aceitas */
    acceptedHypotheses: jsonb('accepted_hypotheses'),
    /** Hipóteses rejeitadas (audit — saber o que IA sugeriu vs profissional descartou) */
    rejectedHypotheses: jsonb('rejected_hypotheses'),
    professionalObservations: text('professional_observations'),
    reviewedByUserId: uuid('reviewed_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('exam_interp_final_doc_idx').on(t.examDocumentId),
    index('exam_interp_final_reviewer_idx').on(t.reviewedByUserId, t.reviewedAt.desc()),
  ],
)

// ─── exam_review_edits (audit append-only) ───────────────────────────────

export const examReviewEdits = pgTable(
  'exam_review_edits',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    examDocumentId: uuid('exam_document_id')
      .notNull()
      .references(() => examDocuments.id, { onDelete: 'cascade' }),
    fieldKey: text('field_key').notNull(),
    beforeValue: jsonb('before_value'),
    afterValue: jsonb('after_value'),
    editedByUserId: uuid('edited_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    editedAt: timestamp('edited_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('exam_review_edits_doc_idx').on(t.examDocumentId, t.editedAt.desc()),
    index('exam_review_edits_user_idx').on(t.editedByUserId, t.editedAt.desc()),
  ],
)

// ─── tenant_exam_ai_settings ─────────────────────────────────────────────

export const tenantExamAiSettings = pgTable(
  'tenant_exam_ai_settings',
  {
    tenantId: uuid('tenant_id').primaryKey(),
    /** Opt-out de extração IA (mantém só OCR) */
    aiExtractionEnabled: boolean('ai_extraction_enabled').notNull().default(true),
    /** Opt-out de interpretação IA (extração roda; interpretação pula) */
    aiInterpretationEnabled: boolean('ai_interpretation_enabled').notNull().default(true),
    /** Strictness do classificador de output (strict bloqueia mais frases) */
    classifierStrictness: aiClassifierStrictnessEnum('classifier_strictness')
      .notNull()
      .default('strict'),
    /** Provider preferido (override do default Sprint 06) */
    preferredModel: text('preferred_model'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
)

export type ExamDocumentRow = typeof examDocuments.$inferSelect
export type ExamExtractionRow = typeof examExtractions.$inferSelect
export type ExamInterpretationDraftRow = typeof examInterpretationsDraft.$inferSelect
export type ExamInterpretationFinalRow = typeof examInterpretationsFinal.$inferSelect
export type ExamReviewEditRow = typeof examReviewEdits.$inferSelect
export type TenantExamAiSettingsRow = typeof tenantExamAiSettings.$inferSelect
