# Sprint 04 — Geral · Financeiro Asaas

- **Área:** geral
- **Início:** planejado (depois do Sprint 03)
- **Fim planejado:** +3 semanas
- **Status:** planejado
- **Item do roadmap:** #6

## Goal

Catálogo de planos, contratos (matrículas), cobranças Asaas (boleto/Pix/cartão), recorrência, webhooks idempotentes — respeitando a topologia fiscal definida pela flag `financial_mode` ([ADR 0010](../decisions/0010-financial-mode-centralized-usa-1-matriz-n-units.md)).

## Critério de aceite

- Cadastro de `plans` por company (ou pelo tenant quando `financial_mode=centralized`, i.e. 1 matriz só)
- **Plano composto por serviços via `plan_items`** (ADR 0068): plano referencia N `services` com `included_quantity`, `period`, `extra_price_cents`, `extra_allowed`
- `contracts` ganha `discount_type` (none/percent/fixed/free_months) + `discount_value` + `discount_valid_until` + `referral_code_applied`
- `invoices` ganha `breakdown jsonb` com `{base, overage_items, discounts, surcharges, taxes_withheld}` para transparência
- Matrícula de `member` em `plan` gera `contract` com vigência e ciclo + cria `appointment_credits` iniciais baseados em `plan_items`
- Cobranças automáticas mensais criadas D-5 do vencimento via job agendado
- Webhook Asaas idempotente — mesmo `external_id` duas vezes não duplica `payment`
- Pagamento confirmado marca `invoice.status=paid` e emite evento; falha marca `overdue` após grace period
- Split Asaas configurável para `franchise_agreements` (ADR 0014 fechará detalhe)
- `financial_mode=centralized` usa chave Asaas do tenant; `distributed` usa chave da company
- Teste E2E: webhook repetido não duplica; mudança de plano preserva histórico
- Seed: 2 planos por company de cada cenário canônico
- **Widget `financeiro` do member consolidado** (ADR 0068): mostra plano · consumo do ciclo (créditos usados/incluídos) · ARs em aberto · histórico 12 meses · saldo cashback · ações (alterar plano, forçar cobrança, isentar extra, ver histórico)
- **Evento `contract.renewed`** reseta `appointment_credits` baseado em `plan_items.included_quantity` + aplica descontos ativos na nova invoice + oferece cashback (se houver)
- **Tracking de overage do plano LogiFit (ADR 0066 + 0078)**: tabela `tenant_usage_snapshots (tenant_id, snapshot_date, active_member_count, plan_member_limit, fiscal_emissions_count, ai_calls_count, plan_tier)` populada por job diário. Widget `/app/settings/tenant/plan` mostra: barra de uso de members (verde <80% / amarelo 80-100% / vermelho >100%) · estimativa de overage member (R$ 0,50 × excedente) · CTA "Atualizar plano" se >100% · estimativa de overage fiscal (preview do mês corrente). Banner topo dashboard se >100% members ou >cap fiscal: "Você passou do incluído — overage estimado R$ XX neste ciclo. [Atualizar plano]"

## Dependências

- Sprint 02 (`members` existe)
- Sprint 01b (audit_log funciona — toda mudança financeira grava)
- [ADR 0010](../decisions/0010-financial-mode-centralized-usa-1-matriz-n-units.md) (modelo centralized)

## Decisões tomadas / ADRs esperados

- **ADR 0013 (esperado)** — Plano → Contrato → Cobrança como entidades separadas (não colapsar "assinatura" numa tabela só). Justifica: contrato tem vigência independente das cobranças; cobrança tem status próprio; histórico audita tudo.
- **ADR 0014 (esperado)** — Chave Asaas + conta bancária: por `company` quando `financial_mode=distributed`; por `tenant` (via a única matriz) quando `centralized`. Casa com ADR 0010.
- **Pergunta aberta:** grace period de inadimplência (dias entre vencer e bloquear QR no sprint 07) — decidir agora ou deixar como config por tenant.

## Módulos entregues

Ver [`modulos.md` — Geral](../modulos.md#geral):

- Planos (ofertas comerciais)
- Contratos (member ↔ plano)
- Cobranças Asaas
- Webhooks idempotentes

## Rotas Next.js

- `/app/financeiro` — visão geral (MRR, overdue, receita 30d por company)
- `/app/financeiro/planos` — lista + CRUD de planos
- `/app/financeiro/planos/[id]` — detalhe + members matriculados
- `/app/financeiro/contratos` — lista geral com filtro por status
- `/app/financeiro/contratos/[id]` — detalhe do contrato + linha do tempo de cobranças
- `/app/financeiro/cobrancas` — lista de invoices com filtros
- `/app/members/[id]/financeiro` — visão do member (contratos ativos + cobranças)

## Server Actions + API Routes

Server Actions em `apps/web/app/financeiro/actions.ts`:

- `createPlan(input)` / `updatePlan(id, input)` / `archivePlan(id)`
- `subscribeMember(memberId, planId, startDate, billingDay)` — cria `contract` + 1ª `invoice` no Asaas
- `cancelContract(contractId, reason, effectiveAt)` — emite `contract.cancelled`
- `reissueInvoice(invoiceId)` — 2ª via manual
- `applyDiscount(invoiceId, amount, reason)` — audit trail obrigatório

API Routes:

- `POST /api/webhooks/asaas` — valida HMAC + idempotência via `webhook_events.external_id`; atualiza `payment`/`invoice` e emite evento de domínio
- Job (Vercel Cron ou Supabase Edge): `POST /api/jobs/billing/daily` — gera cobranças D-5; retry de falhas D+1

## Schemas Drizzle (esperado)

Em `packages/db/schema/financeiro.ts`:

- `plans` — `id`, `tenant_id`, `company_id`, `name`, `description`, `price_cents`, `billing_cycle` enum (`monthly`, `quarterly`, `yearly`), `active`, `trial_days`, `cancel_notice_days`
- `contracts` — `id`, `tenant_id`, `company_id`, `member_id`, `plan_id`, `started_at`, `ends_at nullable`, `status` enum (`active`, `paused`, `cancelled`, `expired`), `billing_day int` (1–28), `pause_reason text nullable`, `pause_starts_at nullable`, `pause_ends_at nullable`, `auto_pause_rule jsonb nullable` (ex: `{ trigger: 'no_checkin_days', value: 30 }`), timestamps
- `invoices` — `id`, `tenant_id`, `company_id`, `contract_id`, `member_id`, `amount_cents`, `due_at`, `status` enum (`pending`, `paid`, `overdue`, `cancelled`, `refunded`), `asaas_id text unique`, `external_url`, timestamps
- `payments` — `id`, `tenant_id`, `invoice_id`, `amount_cents`, `method` enum (`boleto`, `pix`, `credit_card`), `paid_at`, `asaas_id unique`, `raw_payload jsonb`
- `asaas_keys` — `id`, `tenant_id`, `company_id nullable`, `api_key` (criptografado), `sandbox bool`, `active`. Regra: quando `tenant.financial_mode=centralized`, `company_id` é NULL; quando `distributed`, é obrigatório. Enforced por check constraint.
- `webhook_events` (já criada em Sprint 01a? — se não, cria aqui) — `id`, `source`, `external_id unique`, `received_at`, `processed_at`, `payload jsonb`, `error text nullable`
- `plan_tier_rates` (seed global LogiFit, fonte única de verdade para limits/rates por tier — alimenta `tenant_usage_snapshots`):
  - `plan_tier enum('solo','solo_combo','starter','pro','business','enterprise') primary key`
  - `member_limit int not null` (30/60/100/500/2000/null=ilimitado)
  - `member_overage_rate_cents int not null` (50/50/50/50/40/0)
  - `ai_calls_limit int not null` (200/200/500/3000/10000/25000)
  - `fiscal_emissions_limit int not null` (20/30/50/200/1000/5000)
  - `fiscal_overage_rate_cents int not null` (50/50/50/40/35/25)
  - `storage_bytes_limit bigint not null` (1GB/2GB/5GB/50GB/200GB/500GB+ em bytes)
  - `effective_from date not null`, `effective_to date null` — versionamento histórico de pricing (mudanças retroativas não afetam snapshots antigos)
  - Seed inicial = ADR 0066 vigente 2026-04-25; mudanças futuras criam linha nova com `effective_from = today`
- Função SQL `get_tier_rates_for_date(p_tenant_id uuid, p_snapshot_date date)` em `packages/db/functions/get-tier-rates-for-date.sql`:
  - Resolve tier vigente do tenant em `p_snapshot_date` via `tenant_subscriptions` histórico
  - Retorna linha de `plan_tier_rates` com `effective_from <= p_snapshot_date AND (effective_to IS NULL OR effective_to > p_snapshot_date)` para o tier resolvido
  - Cobre mudança de plano mid-month (snapshot_date <D> usa tier vigente <D>)
- `tenant_usage_snapshots` (responsabilidade de schema = Sprint 04; popula = sprints downstream):
  - **Colunas básicas:** `tenant_id uuid not null`, `snapshot_date date not null`, `plan_tier enum('solo','solo_combo','starter','pro','business','enterprise') not null` (snapshot do tier vigente naquele dia)
  - **Member counting (popula = Sprint 04 via job):** `active_member_count int not null default 0`, `plan_member_limit int not null`, `member_overage_rate_cents int not null` — `plan_member_limit` e `member_overage_rate_cents` **populados pelo job `compute-tenant-usage-snapshot` via `get_tier_rates_for_date(tenant_id, snapshot_date)`** (snapshot dos rates congelados — auditável; mudança futura de pricing não retro-afeta), `member_overage_count int generated always as (greatest(active_member_count - plan_member_limit, 0)) stored`, `member_overage_value_cents int generated always as (greatest(active_member_count - plan_member_limit, 0) * member_overage_rate_cents) stored`
  - **AI counting (popula = Sprint 06 via job `aggregate-tenant-ai-usage`):** `ai_calls_count int not null default 0`, `ai_calls_limit int not null` (mesma lógica via `get_tier_rates_for_date`)
  - **Fiscal counting (popula = Sprint 36 via job `aggregate-fiscal-usage-snapshot`):** `fiscal_emissions_count int not null default 0` (NFS-e + NF-e + NFC-e + devolução + transferência + conserto; **eventos não contam** conforme ADR 0066), `fiscal_emissions_limit int not null`, `fiscal_overage_rate_cents int not null` (mesma lógica), `fiscal_overage_count int generated always as (greatest(fiscal_emissions_count - fiscal_emissions_limit, 0)) stored`, `fiscal_overage_value_cents int generated always as (greatest(fiscal_emissions_count - fiscal_emissions_limit, 0) * fiscal_overage_rate_cents) stored`
  - **Storage counting (popula = Sprint 06 ou job dedicado pós-32):** `storage_bytes_used bigint not null default 0`, `storage_bytes_limit bigint not null`
  - PK `(tenant_id, snapshot_date)`. **PARTITION BY RANGE (snapshot_date)** **por trimestre** (regra 34 — snapshots diários × 3 meses ≈ 90 rows/tenant/partição × N tenants ≈ 27k rows/partição saudável; partição anual seria ~365 rows × N = baixo demais para Postgres aproveitar pruning). Job `create-next-partitions` (regra 34) inclui essa tabela trimestralmente.
  - Job diário `compute-tenant-usage-snapshot` (Sprint 04) recalcula `active_member_count` + chama `get_tier_rates_for_date()` + popula todas as colunas de limit/rate (não-generated) + colunas generated calculam automaticamente via Postgres
  - Widget `/app/settings/tenant/plan` (Sprint 04) lê todas as colunas + mostra preview de overage member + AI quota; widget recebe upgrade visual em Sprint 06 (AI) e Sprint 36 (fiscal preview)
  - **Exemplo numérico (tenant Pro, 2026-04, 650 members ativos, 250 chamadas IA, 220 NFS-e):**
    - `plan_tier='pro'`, `plan_member_limit=500`, `member_overage_rate_cents=50`, `ai_calls_limit=3000`, `fiscal_emissions_limit=200`, `fiscal_overage_rate_cents=40`
    - `active_member_count=650`, `ai_calls_count=250`, `fiscal_emissions_count=220`
    - `member_overage_count=150` (generated), `member_overage_value_cents=7500` (R$ 75,00)
    - `fiscal_overage_count=20` (generated), `fiscal_overage_value_cents=800` (R$ 8,00)
    - **Total fatura abril:** R$ 199,00 (Pro) + R$ 75,00 (member) + R$ 8,00 (fiscal) = **R$ 282,00**

**RLS:** tenant_id + scope por company; `audit_log` obrigatório em mudança de `invoices.status` e `contracts.status`.

## Eventos de domínio emitidos

- `plan.created` / `plan.archived`
- `contract.created` — `{ contract_id, member_id, plan_id, starts_at }`
- `contract.cancelled` — `{ contract_id, reason, effective_at }`
- `invoice.issued` — `{ invoice_id, member_id, amount_cents, due_at }`
- `payment.received` — `{ invoice_id, payment_id, amount_cents, method, paid_at }`
- `payment.failed` / `payment.refunded`
- `invoice.overdue` — `{ invoice_id, days_overdue }` — Sprint 08 consome para bloquear QR
- `contract.paused` — `{ contract_id, member_id, reason, starts_at, ends_at? }` — Sprint 08 bloqueia QR durante pausa
- `contract.resumed` — `{ contract_id, member_id, at }`
- `contract.auto_paused` — variante com `trigger_rule` informado

## Commit (checklist)

- [ ] Schema Drizzle: `plans`, `contracts`, `invoices`, `payments`, `asaas_keys`, `webhook_events`
- [ ] RLS + check constraint de `asaas_keys` (centralized vs distributed)
- [ ] Zod schemas em `packages/types/financeiro.ts`
- [ ] Wrapper Asaas em `packages/db/integrations/asaas.ts` (SDK HTTP tipado) — **toda chamada HTTP via `safeFetch()` (ADR 0073 + regra 37)** com `allowedHosts: ['asaas.com', 'sandbox.asaas.com']`; rate limit interno respeita limites Asaas (HTTP 429 mapeia para `RATE_LIMITED`)
- [ ] Server Actions de plano + contrato
- [ ] Webhook `/api/webhooks/asaas` com HMAC + idempotência **+ validação de IP source Asaas (allowlist documentada)** + safeFetch quando re-fetcha cobrança para reconciliação
- [ ] Job diário de geração de cobranças (Vercel Cron)
- [ ] Retry de webhook em dead-letter se processing falhar 3x
- [ ] UI `/app/financeiro/*` com estado vazio e filtros
- [ ] Widget "financeiro do paciente" em `/app/members/[id]` (slot `financeiro`): contrato ativo + status + próximo vencimento + flag inadimplente. Registrar com `{ slot: 'financeiro', requiredPermissions: ['financeiro.read'], requiredVertical: null, consentPurpose: null, showWhen: (m) => m.has_contract }`. Fisio/Nutri/Instrutor **não** veem (regra de role). Ver [modulos.md — matriz](../modulos.md#matriz-de-visibilidade-mvp--previsão-fase-23)
- [ ] **Trancamento manual de contrato** (`pauseContract(contractId, startsAt, endsAt?, reason)`) — pausa emissão de cobranças + bloqueia acesso (consumido pelo Sprint 08 via `contract.paused`)
- [ ] **Trancamento automático por regra** configurável em `auto_pause_rule`: ex: sem check-in há 30 dias aciona pause automático com notificação; retornou a fazer check-in (ou admin retoma manual) reativa
- [ ] Job diário que avalia `auto_pause_rule` dos contratos ativos e dispara pause quando critério é atingido
- [ ] **DRE básico por company + consolidado por tenant** — saída (receita - custos do Sprint 14 quando disponível; no MVP do Sprint 04 só receita) em `/app/financeiro/dre`. Sprint 14 amplia com custos operacionais.
- [ ] Seed: 2 planos por company + 5 contratos ativos por tenant
- [ ] Testes unit (parser de webhook, cálculo de próxima data de cobrança)
- [ ] Testes E2E: assinar plano, simular webhook de pagamento, cancelar contrato
- [ ] Feature flag `financeiro_v1`
- [ ] ADRs 0013 e 0014 publicados

## Stretch

- [ ] Cobranças avulsas (fora de contrato)
- [ ] DRE avançado com filtros e export PDF (base é commit; refinamento é Sprint 14)

## Log

- **2026-05-13 — Faixa B entregue 🟢 (Sprint 04 a 50%).** Server Actions + webhook + envelope:
  - **`packages/security/src/envelope-crypto.ts`** — helper AES-256-GCM:
    - `encryptSecret(plaintext) → 'enc:v1:{iv}:{ciphertext+tag}'` (random IV 12 bytes)
    - `decryptSecret(encrypted)` — tolera plain text legado (sem prefix `enc:`)
    - Chave-mestre via `LOGIFIT_DATA_KEY` env (32 bytes base64). Sprint 04+ Faixa C: per-tenant em KMS externo.
    - Throw em tampering (tag mismatch), formato inválido, chave errada
    - Função `generateMasterKey()` pra setup local
  - **`packages/security/src/envelope-crypto.test.ts`** — **9 Vitest unit tests** (puros, sem DB):
    - round-trip básico encrypt→decrypt
    - mesmo plain → ciphertext diferente (random IV)
    - texto vazio idempotente
    - aceita plain text legado (sem prefix)
    - tampering → throws
    - formato malformado → throws
    - chave errada → throws decrypt failed
    - texto longo 1KB preserva
    - UTF-8 special chars preservam (açúcar 🔑 中文)
  - **`apps/web/app/app/financeiro/actions.ts`** — **6 Server Actions** wrapped:
    - `createPlan({companyId, name, priceCents, billingCycle, trialDays, cancelNoticeDays})` → id
    - `updatePlan({planId, ...partial})` → id (NOT_FOUND se não pertence ao tenant)
    - `archivePlan({planId})` — soft-delete via `archivedAt` + `active=false`
    - `subscribeMember({memberId, planId, startedAt?, billingDay})` → `{contractId, invoiceId}`. Transação: cria contract `active` + 1ª invoice `pending` com `due_at = startedAt + 5d` + breakdown jsonb populado
    - `cancelContract({contractId, reason, effectiveAt?})` → id. Atualiza status `cancelled` + `cancelledAt` + `cancelledReason` + `endsAt`. CONFLICT se já cancelled.
    - `applyDiscount({invoiceId, amountCents, reason})` → `{id, newAmountCents}`. Append no `breakdown.discounts[]` com `applied_by user_id` (audit trail obrigatório). Valida invoice `pending` + desconto < total.
    - `listPlans({includeArchived?, companyId?, limit})` — list scoped tenant.
  - **`apps/web/app/api/webhooks/asaas/route.ts`** — webhook handler POST:
    - Auth via `asaas-access-token` header vs env `ASAAS_WEBHOOK_TOKEN` (timingSafeEqual). Sem token → 200 sem processar (não bloqueia config error).
    - Idempotência: `INSERT INTO webhook_events ... ON CONFLICT (source, external_id) DO NOTHING RETURNING id` — segunda chamada com mesmo event id retorna 200 `duplicate:true` sem reprocessar.
    - **Eventos tratados**:
      - `PAYMENT_RECEIVED|CONFIRMED|RECEIVED_IN_CASH` → marca invoice `paid` + `paidAt` + cria payment row (transação atômica)
      - `PAYMENT_OVERDUE` → invoice `overdue`
      - `PAYMENT_REFUNDED` → invoice `refunded`
      - `PAYMENT_DELETED` → invoice `cancelled` + `cancelledAt`
      - Outros → log info `unhandled_event` (não erro)
    - Helper `asaasMethodToInternal()` mapeia BOLETO/PIX/CREDIT_CARD → enum interno
    - `webhook_events.processed_at` marcado no fim + `error` opcional
    - Sempre retorna 200 mesmo em erro de processamento (Asaas não deve retry se nosso bug)
    - Log estruturado pino-style (level/module/stage/event_id)

  **Validações:**
  - typecheck 11/11 ✅
  - build `@app/web` ✓ — **2 rotas novas**: `/api/webhooks/asaas` + endpoints financeiro consumindo actions
  - **114 Vitest tests verdes** (era 105 — +9 envelope-crypto)

  **Sprint 04 a 50%.** Faixas restantes: C (UI `/app/financeiro` lista + planos + contratos + cobranças + widget em member detail), D (job D-5 cobranças automáticas + envelope encryption integration em asaas_keys + ADRs 0013+0014 publicados).

- **2026-05-13 — Faixa A entregue 🟢 (Sprint 04 a 25%).** Schemas + RLS + tests:
  - **`packages/db/src/schema/financeiro.ts`** — 6 tabelas:
    - `plans` (id, tenant_id, company_id, name, price_cents, billing_cycle enum monthly/quarterly/yearly, trial_days, cancel_notice_days, active, archived_at). Check `price_cents >= 0`.
    - `contracts` (id, tenant_id, company_id, member_id, plan_id, started_at, ends_at?, status enum active/paused/cancelled/expired, billing_day int 1-28, pause fields, auto_pause_rule jsonb, cancelled fields). Check `billing_day BETWEEN 1 AND 28`.
    - `invoices` (id, tenant_id, company_id, contract_id, member_id, amount_cents, due_at, status enum, asaas_id text, external_url, **breakdown jsonb** ADR 0068, paid_at?, cancelled_at?). **Partial UNIQUE asaas_id WHERE NOT NULL** (múltiplas invoices pre-sync coexistem).
    - `payments` (id, tenant_id, invoice_id, amount_cents, method enum boleto/pix/credit_card, paid_at, asaas_id UNIQUE, raw_payload jsonb).
    - `asaas_keys` (id, tenant_id, company_id?, api_key, sandbox, active). Unique parcial `(tenant, company) WHERE active`.
    - `webhook_events` (id, source, external_id, received_at, processed_at?, payload jsonb). **Unique `(source, external_id)`** = idempotência Asaas reenvia.
  - **4 enums Postgres novos**: `billing_cycle`, `contract_status`, `invoice_status`, `payment_method`.
  - **migration `0009_lumpy_moira_mactaggert.sql`** gerada via Drizzle.
  - **`packages/db/src/policies/0019_financeiro_rls.sql`**:
    - 14 RLS policies (CRUD em plans/contracts/invoices + INSERT-only em payments + CRUD em asaas_keys)
    - `webhook_events` SEM RLS — tabela técnica (sem tenant_id obrigatório; processor resolve via payload)
    - GRANTs explícitos pra `logifit_app`
  - **`packages/db/tests/financeiro-rls.test.ts`** — **9 Vitest integration tests**: RLS isolamento, check constraints (priceCents/billingDay), asaas_id UNIQUE com partial index, breakdown jsonb persiste, payments append-only, webhook_events idempotência.

  **Validações:** typecheck 11/11 ✅; db:rls-check 3 regras OK em 42 tabelas (era 36, +6); **105 Vitest tests** (era 96 — +9).

  **Sprint 04 a 25%.** Faixas restantes: B (Server Actions + webhook handler + envelope encryption), C (UI + widget financeiro), D (job D-5 + ADRs 0013+0014).

## Definition of Done

- [ ] Feature flag `financeiro_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] Webhook idempotente comprovado (replay 10x gera 1 payment)
- [ ] RLS verificada nos 5 cenários
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 04 → `done`, item #6 → `done`
- [ ] Zero violação de regras (especial atenção à regra 8 — webhooks idempotentes)

## Retro

- —
