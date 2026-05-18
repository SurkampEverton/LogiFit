'use server'

/**
 * Server Actions Exames — portal do paciente. Sprint 33 Faixa B.2.
 *
 * Member sobe próprio exame com consent_self_upload_exam (Sprint 31b RIPD).
 * MVP: storage path stub (Sprint 33b plugar MinIO + scanUpload regra 38).
 */

import { pool } from '@repo/db/client'
import { ApiException } from '@repo/errors'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  requireMemberSession,
  withMemberContext,
} from '../../lib/member-session'

const UploadExamSchema = z.object({
  storagePath: z.string().min(2).max(500),
  originalFilename: z.string().min(2).max(200),
  mimeType: z.string().min(2).max(80),
  fileSizeBytes: z.number().int().min(1).max(50_000_000).optional().nullable(),
})

// ─── selfUploadExam (member portal) ─────────────────────────────────────

export async function selfUploadExam(input: unknown) {
  const parsed = UploadExamSchema.safeParse(input)
  if (!parsed.success) {
    throw new ApiException({
      code: 'VALIDATION_ERROR',
      message: parsed.error.issues.map((i) => i.message).join('; '),
      request_id: randomUUID(),
    })
  }
  const session = await requireMemberSession('/meu/exames/upload')

  return withMemberContext(session, async () => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO exam_documents
       (tenant_id, member_id, source, uploaded_by_member_id, storage_path, original_filename, mime_type, file_size_bytes, status)
       VALUES ($1, $2, 'patient_portal', $3, $4, $5, $6, $7, 'uploaded')
       RETURNING id`,
      [
        session.tenantId,
        session.memberId,
        session.memberId,
        parsed.data.storagePath,
        parsed.data.originalFilename,
        parsed.data.mimeType,
        parsed.data.fileSizeBytes ?? null,
      ],
    )

    // Sprint 33b: dispara job de processamento (OCR + IA) via fila

    return { ok: true as const, id: r.rows[0]!.id }
  })
}

// ─── listMyExams ────────────────────────────────────────────────────────

interface MyExamRow {
  id: string
  status: string
  exam_type_detected: string | null
  laboratory: string | null
  uploaded_at: Date
  reviewed_at: Date | null
  collected_at: Date | null
}

export async function listMyExams() {
  const session = await requireMemberSession('/meu/exames')

  return withMemberContext(session, async () => {
    const r = await pool.query<MyExamRow>(
      `SELECT id, status::text AS status, exam_type_detected, laboratory,
              uploaded_at, reviewed_at, collected_at
       FROM exam_documents
       WHERE member_id = $1
       ORDER BY uploaded_at DESC
       LIMIT 50`,
      [session.memberId],
    )
    return { ok: true as const, rows: r.rows }
  })
}
