/**
 * Devolução de compra (NF-e) — Sprint 17b (ADR 0104 + ADR 0058; débito #2 da
 * auditoria 36b — o último da lista).
 *
 * **Desacoplado da inbox de NF-e recebida** (ADR 0104): a chave da nota
 * original é digitada pelo operador (`original_chave` — está no DANFE que veio
 * com a mercadoria), em vez de FK obrigatória pra `nfe_received`, que ainda
 * não existe (Sprint 17). O campo `nfe_received_id` já fica preparado pra
 * ganhar a FK + backfill por chave quando aquele sprint chegar.
 *
 * Emissão: `emitNfeReturn` monta `finNFe=4` + `notas_referenciadas` com a
 * chave original, reusando o builder de NF-e (Sprint 36b).
 *
 * @volume_estimate_yearly: 30000
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
  check,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { companies, users } from './identity'

export const nfeReturnKindEnum = pgEnum('nfe_return_kind', ['total', 'partial'])

export const nfeReturnReasonEnum = pgEnum('nfe_return_reason', [
  'defeito',
  'divergencia_quantidade',
  'divergencia_especificacao',
  'atraso',
  'cancelamento',
  'outro',
])

/**
 * Ciclo MVP (ADR 0104): draft → emitted → cancelled.
 * Os estados de conciliação com fornecedor (`confirmed_by_supplier` etc.)
 * entram junto com a inbox do Sprint 17.
 */
export const nfeReturnStatusEnum = pgEnum('nfe_return_status', ['draft', 'emitted', 'cancelled'])

export const nfeReturns = pgTable(
  'nfe_returns',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    /** Chave SEFAZ 44 dígitos da NF-e original — vira `refNFe` no payload */
    originalChave: text('original_chave').notNull(),
    /** Preparado pro Sprint 17: ganha FK + backfill por chave quando nfe_received nascer */
    nfeReceivedId: uuid('nfe_received_id'),
    /** Emitente da nota original (sem inbox, não há de onde derivar) */
    originalSupplierName: text('original_supplier_name'),
    originalSupplierDocument: text('original_supplier_document'),
    kind: nfeReturnKindEnum('kind').notNull(),
    /** [{ description, ncm, quantity, unitCents, cfop? }] — null quando total */
    items: jsonb('items'),
    returnAmountCents: bigint('return_amount_cents', { mode: 'number' }).notNull(),
    reasonCategory: nfeReturnReasonEnum('reason_category').notNull(),
    /** Texto livre obrigatório ≥20 chars — vai na justificativa da nota */
    reasonDescription: text('reason_description').notNull(),
    status: nfeReturnStatusEnum('status').notNull().default('draft'),
    /** Chave da NF-e de devolução emitida (preenchida no emitNfeReturn) */
    externalChave: text('external_chave'),
    externalXmlStoragePath: text('external_xml_storage_path'),
    externalIssueDate: date('external_issue_date'),
    emittedAt: timestamp('emitted_at', { withTimezone: true }),
    /** 'focus_nfe' (emissão própria) | 'external_import' (XML de fora — Sprint 17) */
    emissionMode: text('emission_mode'),
    /** Emissão fiscal gerada (fiscal_emissions.id) */
    fiscalEmissionId: uuid('fiscal_emission_id'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('nfe_returns_tenant_status_idx').on(t.tenantId, t.status),
    index('nfe_returns_tenant_company_idx').on(t.tenantId, t.companyId),
    index('nfe_returns_original_chave_idx').on(t.originalChave),
    check('nfe_returns_chave_44', sql`original_chave ~ '^[0-9]{44}$'`),
    check('nfe_returns_amount_positive', sql`return_amount_cents > 0`),
    check('nfe_returns_reason_min', sql`length(reason_description) >= 20`),
    // Parcial exige discriminar os itens; total dispensa
    check('nfe_returns_partial_needs_items', sql`kind = 'total' OR items IS NOT NULL`),
    check('nfe_returns_emitted_consistency', sql`(status = 'emitted') = (emitted_at IS NOT NULL)`),
  ],
)
