/**
 * Fiscal Emissions — Sprint 36 Faixa A (ADR 0059 Accepted).
 *
 * **Backbone Sprint 36a:** schemas + RLS + provider abstrato + CFOP resolver
 * + Server Actions core (emitNfseFromInvoice + cancel + retry + queryStatus).
 *
 * **Sprint 36b/c:** payload builders restantes (NF-e produto + NFC-e + devolução
 *   + transferência + conserto out/return + entrada própria), webhook callback,
 *   wizard onboarding, catálogo serviços, portal contador externo, retenções,
 *   provider Focus NFe real (homologação + produção), seed sandbox.
 *
 * 5 tabelas:
 *   - `fiscal_emissions` — emissão única (NFS-e, NF-e, NFC-e, devolução,
 *     transferência, conserto, entrada própria). Status workflow.
 *   - `fiscal_events` — eventos pós-emissão (cancelamento + CC-e + inutilização).
 *     Append-only — cada evento gera linha; **NÃO** sobrescreve emission.
 *   - `fiscal_numbering_sequences` — séries + próximo número por (company, kind,
 *     serie). Updates transacionais com SELECT FOR UPDATE pra evitar gap.
 *   - `fiscal_service_catalog` — catálogo de serviços tributáveis do tenant
 *     (código LC 116/2003 + alíquota ISS + retenções).
 *   - `fiscal_provider_credentials` — credentials Focus (api_token cifrado
 *     AES-256-GCM via KEK por tenant, ADR 0073 camada 4) + environment.
 *
 * **Provider plug-in (ADR 0076):** coluna `provider text` em `fiscal_emissions`
 *   preparada pra `nfse_nacional` futuro adapter; MVP só aceita `focus_nfe` +
 *   `mock` (dev/test). Routing `pickNfseProvider(emission)` virá Sprint 36c.
 *
 * **Cobrança (ADR 0066 revisado 2026-04-25):** apenas emissões `status='completed'`
 *   contam pra overage; eventos (cancelamento/CC-e/inutilização) **não contam**.
 *   Job mensal `aggregate-fiscal-usage-snapshot` Sprint 36b agrega.
 *
 * **MFA gate regra 43:** Server Actions `cancelEmission`/`issueCCe`/`inutilizeRange`
 *   exigem `requireRecentMfa(15min)` no wrapper — ações de alto risco fiscal.
 *
 * @volume_estimate_yearly: 3600000
 *   (1k tenants × ~3 notas/dia × 365 = 1.1M MVP; cresce com adesão Pro/Business)
 */
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { invoices } from './financeiro'
import { companies, users } from './identity'

// ─── Enums ───────────────────────────────────────────────────────────────

export const fiscalEmissionKindEnum = pgEnum('fiscal_emission_kind', [
  'nfse', // serviço municipal (academia/clínica/nutri)
  'nfe', // NF-e produto (venda, modelo 55)
  'nfce', // NF-e consumidor (varejo balcão, modelo 65)
  'nfe_return', // NF-e devolução (finNFe=4)
  'nfe_transfer', // NF-e transferência entre filiais
  'nfe_conserto_out', // NF-e remessa pra conserto
  'nfe_conserto_return', // NF-e retorno de conserto
  'nfe_self_entry', // NF-e entrada própria (compra de PF sem inscrição)
])

export const fiscalEmissionStatusEnum = pgEnum('fiscal_emission_status', [
  'draft', // criada local, ainda não enviada
  'queued', // enviada ao provider, aguardando autorização
  'processing', // provider processando (assíncrono)
  'completed', // chave SEFAZ recebida + XML + PDF
  'rejected', // rejeitada por SEFAZ/Município (com rejection_reason)
  'cancelled', // cancelada via evento
])

export const fiscalEventKindEnum = pgEnum('fiscal_event_kind', [
  'cancellation', // cancela emissão dentro da janela permitida
  'cce', // carta de correção eletrônica (NF-e modelo 55)
  'inutilizacao', // inutiliza faixa de numeração pulada
])

export const fiscalProviderEnvEnum = pgEnum('fiscal_provider_env', ['homologacao', 'producao'])

export const fiscalTaxRegimeEnum = pgEnum('fiscal_tax_regime', [
  'simples_nacional',
  'lucro_presumido',
  'lucro_real',
  'mei',
])

// ─── fiscal_emissions ────────────────────────────────────────────────────
/**
 * Cada NFS-e / NF-e / NFC-e emitida (ou tentada) é uma linha. Inicia `draft`,
 * vira `queued` ao enviar pro provider, `processing` enquanto SEFAZ processa,
 * `completed` quando chave chega, `rejected` se erro, `cancelled` se evento de
 * cancelamento foi aplicado.
 *
 * `chave text` é a chave de acesso 44 dígitos (NF-e/NFC-e) OU o protocolo
 * municipal (NFS-e — não padronizado nacional). Unique global por
 * (tenant_id, kind, chave) quando `chave IS NOT NULL`.
 *
 * `provider text default 'focus_nfe'` prepara ADR 0076 (NFS-e Nacional pós-MVP).
 *
 * **Origem polimórfica:** `source_kind` + `source_id` linka pra invoice (NFS-e),
 *   sale (NF-e/NFC-e), nfe_return (devolução), intercompany_entry (transfer),
 *   equipment_maintenance (conserto). Aceita NULL pra emissão manual.
 */
export const fiscalEmissions = pgTable(
  'fiscal_emissions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    kind: fiscalEmissionKindEnum('kind').notNull(),
    status: fiscalEmissionStatusEnum('status').notNull().default('draft'),
    /** Provider que emitiu — MVP: 'focus_nfe' | 'mock' (test). Futuro 0076: 'nfse_nacional' */
    provider: text('provider').notNull().default('focus_nfe'),
    /** Origem polimórfica — tipo do registro fonte */
    sourceKind: text('source_kind'), // 'invoice' | 'sale' | 'billing_guide' | 'nfe_return' | 'intercompany' | 'equipment_maintenance' | 'manual'
    sourceId: uuid('source_id'),
    /** Série (1-999); por tipo + company. NFS-e geralmente única; NF-e + NFC-e podem ter múltiplas */
    serie: integer('serie').notNull(),
    /** Número sequencial dentro da série; gerado via fiscal_numbering_sequences */
    numero: bigint('numero', { mode: 'number' }).notNull(),
    /** Chave SEFAZ 44 dígitos (NF-e/NFC-e) ou protocolo municipal (NFS-e). NULL até autorizar */
    chave: text('chave'),
    /** Token interno do provider (Focus retorna 'ref') pra correlação webhook */
    providerRef: text('provider_ref'),
    /** Valor total da nota em centavos (impostos inclusos) */
    valorTotalCents: bigint('valor_total_cents', { mode: 'number' }).notNull(),
    /** Tomador/destinatário (person_id quando registrado; NULL pra NFC-e sem CPF) */
    recipientPersonId: uuid('recipient_person_id'),
    /** Nome do tomador (snapshot pra histórico) */
    recipientName: text('recipient_name'),
    /** Documento (CPF/CNPJ) sem formatação */
    recipientDocument: text('recipient_document'),
    /** Payload completo enviado ao provider (dump pra auditoria + replay) */
    payload: jsonb('payload').notNull(),
    /** Path MinIO do XML autorizado (TTL signed URL na entrega) */
    xmlStoragePath: text('xml_storage_path'),
    /** Path MinIO do PDF DANFE/DAS gerado pelo provider */
    pdfStoragePath: text('pdf_storage_path'),
    /** Motivo de rejeição (código + descrição SEFAZ) */
    rejectionReason: text('rejection_reason'),
    /** Tentativas de retry (0 = primeira; max 3 pra erro transient) */
    retryCount: integer('retry_count').notNull().default(0),
    /** Janela permitida pra cancelar (24h padrão; alguns UFs diferem) */
    cancelDeadlineAt: timestamp('cancel_deadline_at', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Usuário que disparou (audit) */
    /** FK users.id (migration 0060) — NUNCA auth_user.id; SET NULL preserva o documento fiscal */
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    /** Unique chave por tenant + kind quando não-null (NULL não viola unique) */
    uniqueIndex('fiscal_emissions_chave_uq')
      .on(t.tenantId, t.kind, t.chave)
      .where(sql`chave IS NOT NULL`),
    /** Unique numeração emitida por company + kind + serie + numero pra detectar duplicate write */
    uniqueIndex('fiscal_emissions_numeracao_uq').on(t.companyId, t.kind, t.serie, t.numero),
    /** Inbox por tenant ordenado por created_at desc */
    index('fiscal_emissions_tenant_status_idx').on(t.tenantId, t.status, t.createdAt.desc()),
    /** Lookup pelo provider_ref no webhook callback */
    uniqueIndex('fiscal_emissions_provider_ref_uq')
      .on(t.tenantId, t.provider, t.providerRef)
      .where(sql`provider_ref IS NOT NULL`),
    /** Lookup por origem (invoice → emissão) */
    index('fiscal_emissions_source_idx').on(t.tenantId, t.sourceKind, t.sourceId),
    /** Retry queue: emissões rejected com retry_count < 3 */
    index('fiscal_emissions_retry_idx')
      .on(t.tenantId, t.createdAt.desc())
      .where(sql`status = 'rejected' AND retry_count < 3`),
    /** Provider canônico — MVP só focus_nfe + mock; ADR 0076 adiciona nfse_nacional + enotas */
    check(
      'fiscal_emissions_provider_valid',
      sql`provider IN ('focus_nfe', 'mock', 'nfse_nacional', 'enotas')`,
    ),
    /** Status workflow consistency: completed exige chave; rejected exige rejection_reason */
    check(
      'fiscal_emissions_completed_consistency',
      sql`(status != 'completed' OR (chave IS NOT NULL AND completed_at IS NOT NULL))`,
    ),
    check(
      'fiscal_emissions_rejected_consistency',
      sql`(status != 'rejected' OR rejection_reason IS NOT NULL)`,
    ),
    check(
      'fiscal_emissions_cancelled_consistency',
      sql`(status != 'cancelled' OR cancelled_at IS NOT NULL)`,
    ),
    /** Numeração positiva */
    check('fiscal_emissions_numero_positive', sql`numero > 0`),
    check('fiscal_emissions_serie_positive', sql`serie > 0`),
    check('fiscal_emissions_retry_nonneg', sql`retry_count >= 0`),
  ],
)

// ─── fiscal_events ───────────────────────────────────────────────────────
/**
 * Append-only. Cada evento é uma linha distinta. `event_id` retornado pelo
 * provider (Focus tem `ref` próprio do evento). Cancelamento bem-sucedido
 * marca `fiscal_emissions.status='cancelled'` na mesma transação.
 *
 * **Janela legal típica:**
 *   - Cancelamento: 24h após autorização (alguns UFs: 168h ou 720h)
 *   - CC-e: até 30 eventos por chave; campos não-fiscais (endereço, transportadora)
 *   - Inutilização: faixa de números pulados por falha técnica; antes do uso
 */
export const fiscalEvents = pgTable(
  'fiscal_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    emissionId: uuid('emission_id').references(() => fiscalEmissions.id, {
      onDelete: 'restrict',
    }),
    /** Inutilização não tem emission (referencia faixa de numeração); demais sim */
    kind: fiscalEventKindEnum('kind').notNull(),
    /** Provider ref do evento (distinto do emission_ref) */
    providerRef: text('provider_ref'),
    /** Para inutilização: companyId + emissionKind + serie + numeroFrom + numeroTo */
    companyId: uuid('company_id').references(() => companies.id, {
      onDelete: 'restrict',
    }),
    emissionKind: fiscalEmissionKindEnum('emission_kind'),
    serie: integer('serie'),
    numeroFrom: bigint('numero_from', { mode: 'number' }),
    numeroTo: bigint('numero_to', { mode: 'number' }),
    /** Texto da correção (CC-e) ou motivo do cancelamento/inutilização */
    justification: text('justification').notNull(),
    /** Status: queued/processing/completed/rejected igual emission */
    status: fiscalEmissionStatusEnum('status').notNull().default('draft'),
    rejectionReason: text('rejection_reason'),
    payload: jsonb('payload').notNull(),
    xmlStoragePath: text('xml_storage_path'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** FK users.id (migration 0060) — NUNCA auth_user.id; SET NULL preserva o documento fiscal */
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    /** Inbox de eventos por tenant */
    index('fiscal_events_tenant_idx').on(t.tenantId, t.status, t.createdAt.desc()),
    /** Por emissão (cancelamento + CC-e) */
    index('fiscal_events_emission_idx').on(t.emissionId, t.createdAt.desc()),
    /** Provider ref lookup */
    uniqueIndex('fiscal_events_provider_ref_uq')
      .on(t.tenantId, t.providerRef)
      .where(sql`provider_ref IS NOT NULL`),
    /** Inutilização não tem emission_id; demais têm */
    check(
      'fiscal_events_emission_or_inutilizacao',
      sql`(kind = 'inutilizacao' AND emission_id IS NULL AND numero_from IS NOT NULL AND numero_to IS NOT NULL)
       OR (kind IN ('cancellation', 'cce') AND emission_id IS NOT NULL)`,
    ),
    check(
      'fiscal_events_inutilizacao_range',
      sql`(kind != 'inutilizacao' OR numero_from <= numero_to)`,
    ),
    check(
      'fiscal_events_rejected_consistency',
      sql`(status != 'rejected' OR rejection_reason IS NOT NULL)`,
    ),
  ],
)

// ─── fiscal_numbering_sequences ──────────────────────────────────────────
/**
 * Numeração sequencial por (company, kind, serie). `next_numero` atomicamente
 * incrementado via `UPDATE ... RETURNING` na transação de emissão.
 *
 * **Gap detection** (Sprint 36b): job diário compara `next_numero - 1` vs
 *   `max(numero)` em `fiscal_emissions completed`; gap > 0 dispara
 *   `system_alerts critical` + sugestão de inutilização da faixa.
 */
export const fiscalNumberingSequences = pgTable(
  'fiscal_numbering_sequences',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    kind: fiscalEmissionKindEnum('kind').notNull(),
    serie: integer('serie').notNull(),
    /** Próximo número disponível pra emitir (1-based) */
    nextNumero: bigint('next_numero', { mode: 'number' }).notNull().default(1),
    /** Último número usado com sucesso (UPDATE pós-completed) */
    lastUsedNumero: bigint('last_used_numero', { mode: 'number' }),
    /** Environment desta sequência (homologação tem números separados) */
    environment: fiscalProviderEnvEnum('environment').notNull().default('homologacao'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** 1 sequência ativa por (company, kind, serie, env) */
    uniqueIndex('fiscal_numbering_sequences_uq').on(t.companyId, t.kind, t.serie, t.environment),
    check('fiscal_numbering_sequences_next_positive', sql`next_numero >= 1`),
    check('fiscal_numbering_sequences_serie_positive', sql`serie >= 1 AND serie <= 999`),
  ],
)

// ─── fiscal_service_catalog ──────────────────────────────────────────────
/**
 * Catálogo de serviços tributáveis cadastrados pelo admin do tenant. Cada
 * serviço aponta pra município (IBGE) + LC 116/2003 + alíquota ISS + retenções
 * aplicáveis. NFS-e consome no momento da emissão pra preencher payload.
 *
 * Tabela `nbs_code` é opcional pra serviços que precisam do código BNS
 * (importação/exportação de serviço). LC 116 é o item da Lei Complementar
 * federal (ex: "6.01" = limpeza). CNAE é por empresa, não por serviço.
 */
export const fiscalServiceCatalog = pgTable(
  'fiscal_service_catalog',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    /** Código IBGE 7 dígitos do município onde o serviço é prestado */
    municipalityCode: text('municipality_code').notNull(),
    /** Item LC 116/2003 — formato "X.YY" (ex: "8.01" = ensino) */
    lc116Code: text('lc116_code'),
    /** Código NBS (importação/exportação de serviço; opcional) */
    nbsCode: text('nbs_code'),
    /** CNAE da empresa que presta (cópia denormalizada de `companies`) */
    cnae: text('cnae'),
    /** Descrição visível pro operador no dropdown ("Mensalidade academia") */
    description: text('description').notNull(),
    /** Regime tributário (afeta cálculo de retenções e DAS) */
    taxRegime: fiscalTaxRegimeEnum('tax_regime').notNull(),
    /** Alíquota ISS do município (0-5%); decimal(5,2) representado por percent×100 = bigint */
    issRateBp: integer('iss_rate_bp').notNull(), // basis points: 200 = 2.00%
    pisRateBp: integer('pis_rate_bp'),
    cofinsRateBp: integer('cofins_rate_bp'),
    /** Regras de retenção jsonb (Sprint 36b consome em ADR 0061 pipeline) */
    retentionRules: jsonb('retention_rules'),
    active: boolean('active').notNull().default(true),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('fiscal_service_catalog_tenant_idx').on(t.tenantId, t.companyId),
    index('fiscal_service_catalog_active_idx')
      .on(t.tenantId, t.companyId)
      .where(sql`active = true`),
    /** ISS rate sanity: 0-500 bp (0-5%) */
    check('fiscal_service_catalog_iss_range', sql`iss_rate_bp >= 0 AND iss_rate_bp <= 500`),
  ],
)

// ─── fiscal_provider_credentials ─────────────────────────────────────────
/**
 * Credentials Focus NFe (ou outros providers no futuro) por tenant. Token
 * é AES-256-GCM cifrado com KEK por tenant (ADR 0073 camada 4). Decrypt
 * só acontece em chamada `safeFetch()` no servidor (`packages/security/`).
 *
 * `last_validated_at` é populado em background job que chama endpoint de
 * health do provider — se >24h, UI mostra aviso "Re-validar credentials".
 */
export const fiscalProviderCredentials = pgTable(
  'fiscal_provider_credentials',
  {
    /** PK = (tenant_id, provider) — 1 row por provider configurado */
    tenantId: uuid('tenant_id').notNull(),
    provider: text('provider').notNull(),
    /** Token API cifrado AES-256-GCM (KEK por tenant) */
    apiTokenEncrypted: text('api_token_encrypted').notNull(),
    /** Nonce do GCM */
    apiTokenNonce: text('api_token_nonce').notNull(),
    /** Tag de autenticação GCM */
    apiTokenTag: text('api_token_tag').notNull(),
    environment: fiscalProviderEnvEnum('environment').notNull(),
    /**
     * `true` = tenant tem conta própria na Focus e informa o próprio token de
     * CONTA; `false` (default) = usa a conta da plataforma
     * (`fiscalPlatformCredentials`). Ver ADR 0105.
     */
    ownAccount: boolean('own_account').notNull().default(false),
    /**
     * Token de **conta** do tenant — gerencia `/v2/empresas` (cadastro,
     * credenciais do portal municipal, série). Não confundir com
     * `apiToken*`, que é o token de **emissão** da empresa.
     */
    accountTokenEncrypted: text('account_token_encrypted'),
    accountTokenNonce: text('account_token_nonce'),
    accountTokenTag: text('account_token_tag'),
    /** URL base do provider (override pra sandbox alternativo) */
    baseUrl: text('base_url'),
    /** Webhook callback secret pra HMAC verification */
    webhookSecretEncrypted: text('webhook_secret_encrypted'),
    webhookSecretNonce: text('webhook_secret_nonce'),
    webhookSecretTag: text('webhook_secret_tag'),
    lastValidatedAt: timestamp('last_validated_at', { withTimezone: true }),
    lastValidationStatus: text('last_validation_status'), // 'ok' | 'error_403' | 'error_5xx' | 'timeout'
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('fiscal_provider_credentials_pk').on(t.tenantId, t.provider),
    check(
      'fiscal_provider_credentials_provider_valid',
      sql`provider IN ('focus_nfe', 'mock', 'nfse_nacional', 'enotas')`,
    ),
    /** Flag ligado sem token deixaria o tenant sem caminho de cadastro */
    check(
      'fiscal_provider_credentials_own_account_token',
      sql`own_account = false OR account_token_encrypted IS NOT NULL`,
    ),
  ],
)

/**
 * Token de **conta** Focus NFe da LogiFit — gerencia `/v2/empresas`.
 *
 * Global por design: é credencial da plataforma, não de um tenant. Exceção
 * consciente à regra 1, com o mesmo precedente de `ai_providers`/`ai_models`.
 * A RLS (migration 0063) só libera `app.role='system'` — nenhum contexto de
 * tenant enxerga a linha. Usado quando o tenant tem `own_account = false`.
 */
export const fiscalPlatformCredentials = pgTable(
  'fiscal_platform_credentials',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    provider: text('provider').notNull().default('focus_nfe'),
    environment: text('environment').notNull().default('producao'),
    accountTokenEncrypted: text('account_token_encrypted').notNull(),
    accountTokenNonce: text('account_token_nonce').notNull(),
    accountTokenTag: text('account_token_tag').notNull(),
    lastValidatedAt: timestamp('last_validated_at', { withTimezone: true }),
    lastValidationStatus: text('last_validation_status'),
    updatedByUserId: uuid('updated_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /** Uma conta LogiFit por provider, não N */
    uniqueIndex('fiscal_platform_credentials_provider_uq').on(t.provider),
    check(
      'fiscal_platform_credentials_provider_valid',
      sql`provider IN ('focus_nfe', 'nfse_nacional', 'enotas')`,
    ),
    check('fiscal_platform_credentials_env_valid', sql`environment IN ('homologacao', 'producao')`),
  ],
)

export type FiscalEmissionRow = typeof fiscalEmissions.$inferSelect
export type FiscalEventRow = typeof fiscalEvents.$inferSelect
export type FiscalNumberingSequenceRow = typeof fiscalNumberingSequences.$inferSelect
export type FiscalServiceCatalogRow = typeof fiscalServiceCatalog.$inferSelect
export type FiscalProviderCredentialsRow = typeof fiscalProviderCredentials.$inferSelect

/** Discriminator do `source_kind` polimórfico (string union) */
export type FiscalEmissionSourceKind =
  | 'invoice'
  | 'sale'
  | 'billing_guide'
  | 'nfe_return'
  | 'intercompany'
  | 'equipment_maintenance'
  | 'manual'

void invoices // silence import (Sprint 36b adiciona FK pro invoice via column ALTER)
