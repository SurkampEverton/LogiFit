/**
 * Validador TISS proativo — Sprint 22 Faixa B.1 (ADR 0031 esperado).
 *
 * Roda **antes** do envio do lote pra operadora. Pega causas comuns de glosa
 * conhecidas e bloqueia geração/envio com mensagem acionável. Reduz drasticamente
 * taxa de glosa.
 *
 * **10 cenários canônicos cobertos:**
 *   1. Profissional sem `cbo_code` cadastrado (TISS 4.01 obrigatório)
 *   2. Profissional sem `council_body` ativo coerente com kind da consulta
 *   3. Carteirinha expirada (`valid_until < today`)
 *   4. Carteirinha inválida (sem `card_number`)
 *   5. Procedimento exige autorização (`auth_required=true`) mas guia sem `authorizationNumber`
 *   6. Autorização venceu (`valid_until < execution_date`)
 *   7. Quantidade usada + nova > quantidade autorizada
 *   8. Total da guia ≠ soma dos itens (consistência aritmética)
 *   9. Procedimento × especialidade incompatível (tuss.specialties não contém kind)
 *  10. Co-participação informada mas não bate com tabela de preços do acordo
 *
 * Função pura. Caller carrega dados + passa pra validador.
 */

export interface ValidationIssue {
  code: string
  field?: string
  message: string
  severity: 'error' | 'warning'
}

export interface ValidationResult {
  ok: boolean
  issues: ValidationIssue[]
}

// ─── Inputs ──────────────────────────────────────────────────────────────

export interface ValidateGuideInput {
  /** Hoje (controlável pra testes) — YYYY-MM-DD */
  today?: string
  kind: 'consulta' | 'sp_sadt'
  professional: {
    name?: string | null
    councilBody?: string | null // CRM / CREFITO / CRN etc
    councilState?: string | null
    councilNumber?: string | null
    cbosCode?: string | null
    /** Especialidade do profissional (medicina, fisioterapia, nutricao etc) */
    specialty?: string | null
  }
  memberInsurance: {
    cardNumber: string | null
    validUntil?: string | null // YYYY-MM-DD
  }
  /** Autorização vinculada (opcional) */
  authorization?: {
    authorizationNumber: string | null
    quantityAuthorized: number | null
    quantityUsed: number
    validUntil?: string | null // YYYY-MM-DD
    status: string
  } | null
  /** Configuração do procedimento no agreement */
  procedurePrice?: {
    authRequired: boolean
    priceCents: number
    patientCopayCents: number | null
    maxSessionsPerAuth: number | null
  } | null
  /** TUSS catalog para validar especialidade */
  tussSpecialties?: string[] | null
  items: Array<{
    tussCode: string
    quantity: number
    unitPriceCents: number
    totalCents: number
    /** YYYY-MM-DD */
    executionDate?: string | null
  }>
  /** Total da guia em centavos (para conferência) */
  totalCents: number
  /** Co-participação informada na guia */
  declaredCopayCents?: number
  /** Mapping kind → especialidade esperada */
  expectedSpecialtyByKind?: Partial<Record<'consulta' | 'sp_sadt', string>>
}

export function validateGuide(input: ValidateGuideInput): ValidationResult {
  const issues: ValidationIssue[] = []
  const today = input.today ?? new Date().toISOString().slice(0, 10)

  // 1. CBOS obrigatório no profissional (TISS 4.01)
  if (!input.professional.cbosCode || input.professional.cbosCode.trim() === '') {
    issues.push({
      code: 'PROF_NO_CBOS',
      field: 'professional.cbosCode',
      message:
        'Profissional sem CBOS cadastrado. TISS 4.01 obriga. Cadastre em /app/pessoas/[id]/registros (ADR 0055).',
      severity: 'error',
    })
  }

  // 2. Council body + number obrigatórios
  if (!input.professional.councilBody || !input.professional.councilNumber) {
    issues.push({
      code: 'PROF_NO_COUNCIL',
      field: 'professional.councilBody',
      message:
        'Profissional sem conselho ativo coerente. CRM/CREFITO/CRN/CREF obrigatório no executante.',
      severity: 'error',
    })
  }
  if (!input.professional.councilState) {
    issues.push({
      code: 'PROF_NO_UF',
      field: 'professional.councilState',
      message: 'UF do conselho obrigatória no TISS 4.01.',
      severity: 'error',
    })
  }

  // 3. Carteirinha válida
  if (!input.memberInsurance.cardNumber || input.memberInsurance.cardNumber.trim() === '') {
    issues.push({
      code: 'CARD_MISSING',
      field: 'memberInsurance.cardNumber',
      message: 'Carteirinha do paciente não cadastrada — não é possível faturar.',
      severity: 'error',
    })
  }

  // 4. Carteirinha expirada
  if (input.memberInsurance.validUntil && input.memberInsurance.validUntil < today) {
    issues.push({
      code: 'CARD_EXPIRED',
      field: 'memberInsurance.validUntil',
      message: `Carteirinha expirou em ${input.memberInsurance.validUntil}. Solicite renovação ao paciente.`,
      severity: 'error',
    })
  }

  // 5. Procedimento exige autorização mas sem authorizationNumber
  if (
    input.procedurePrice?.authRequired &&
    (!input.authorization?.authorizationNumber ||
      input.authorization.authorizationNumber.trim() === '')
  ) {
    issues.push({
      code: 'AUTH_REQUIRED_MISSING',
      field: 'authorization.authorizationNumber',
      message:
        'Procedimento exige autorização prévia. Solicite à operadora antes de faturar (POST /app/fisio/autorizacoes/new).',
      severity: 'error',
    })
  }

  // 6. Autorização expirada
  if (input.authorization?.validUntil) {
    const earliestExec =
      input.items
        .map((it) => it.executionDate)
        .filter((d): d is string => !!d)
        .sort()[0] ?? today
    if (input.authorization.validUntil < earliestExec) {
      issues.push({
        code: 'AUTH_EXPIRED',
        field: 'authorization.validUntil',
        message: `Autorização expirou em ${input.authorization.validUntil}, antes da execução (${earliestExec}). Solicite renovação.`,
        severity: 'error',
      })
    }
  }

  // 7. Quantidade autorizada × usada
  if (
    input.authorization?.quantityAuthorized != null &&
    input.authorization.quantityUsed + input.items.reduce((s, i) => s + i.quantity, 0) >
      input.authorization.quantityAuthorized
  ) {
    issues.push({
      code: 'AUTH_QTY_EXCEEDED',
      field: 'authorization.quantityAuthorized',
      message: `Quantidade total (${input.authorization.quantityUsed + input.items.reduce((s, i) => s + i.quantity, 0)}) excede autorização (${input.authorization.quantityAuthorized}). Solicite ampliação.`,
      severity: 'error',
    })
  }

  // 8. Autorização não-aprovada
  if (input.authorization && input.authorization.status !== 'approved') {
    issues.push({
      code: 'AUTH_NOT_APPROVED',
      field: 'authorization.status',
      message: `Autorização em status "${input.authorization.status}". Apenas 'approved' permite envio.`,
      severity: 'error',
    })
  }

  // 9. Consistência aritmética total guia × itens
  const sumItems = input.items.reduce((s, i) => s + i.totalCents, 0)
  if (sumItems !== input.totalCents) {
    issues.push({
      code: 'TOTAL_MISMATCH',
      field: 'totalCents',
      message: `Total da guia (R$ ${(input.totalCents / 100).toFixed(2)}) não bate com soma dos itens (R$ ${(sumItems / 100).toFixed(2)}). Recalcule.`,
      severity: 'error',
    })
  }

  // 9b. Consistência por item: quantity × unitPrice = totalCents
  for (const it of input.items) {
    if (it.quantity * it.unitPriceCents !== it.totalCents) {
      issues.push({
        code: 'ITEM_TOTAL_MISMATCH',
        field: `items.${it.tussCode}.totalCents`,
        message: `Item ${it.tussCode}: ${it.quantity} × ${(it.unitPriceCents / 100).toFixed(2)} ≠ ${(it.totalCents / 100).toFixed(2)}`,
        severity: 'error',
      })
    }
  }

  // 10. Especialidade × kind
  const expected = input.expectedSpecialtyByKind?.[input.kind]
  if (expected && input.professional.specialty && input.professional.specialty !== expected) {
    issues.push({
      code: 'SPECIALTY_MISMATCH',
      field: 'professional.specialty',
      message: `Kind ${input.kind} esperava especialidade "${expected}", mas profissional é "${input.professional.specialty}".`,
      severity: 'warning',
    })
  }
  if (
    input.tussSpecialties &&
    input.tussSpecialties.length > 0 &&
    input.professional.specialty &&
    !input.tussSpecialties.includes(input.professional.specialty)
  ) {
    issues.push({
      code: 'TUSS_SPECIALTY_MISMATCH',
      field: 'professional.specialty',
      message: `Procedimento TUSS restrito a [${input.tussSpecialties.join(', ')}]; profissional é ${input.professional.specialty}.`,
      severity: 'warning',
    })
  }

  // 11. Co-participação informada × tabela
  if (
    input.declaredCopayCents != null &&
    input.procedurePrice?.patientCopayCents != null &&
    input.declaredCopayCents !== input.procedurePrice.patientCopayCents
  ) {
    issues.push({
      code: 'COPAY_MISMATCH',
      field: 'declaredCopayCents',
      message: `Co-participação informada (R$ ${(input.declaredCopayCents / 100).toFixed(2)}) ≠ tabela acordo (R$ ${(input.procedurePrice.patientCopayCents / 100).toFixed(2)}).`,
      severity: 'warning',
    })
  }

  const hasError = issues.some((i) => i.severity === 'error')
  return { ok: !hasError, issues }
}
