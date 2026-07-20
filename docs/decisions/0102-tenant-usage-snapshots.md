# ADR 0102 — tenant_usage_snapshots (billing de uso mensal — débito de schema do Sprint 04)

- **Status:** Proposed
- **Date:** 2026-07-19
- **Sprint:** 04b (débito descoberto na auditoria do Sprint 36b — ver roadmap "Débitos de schema")

## Context

O ADR 0066 (plano comercial) define cotas mensais por plano — members ativos, NFS-e/notas emitidas, chamadas IA, storage — com **overage cobrado por excedente** (member R$ 0,50; nota R$ 0,25-0,50 por tier). O Sprint 04 deveria ter criado `tenant_usage_snapshots` como base desse billing, mas a tabela nunca nasceu. Sem ela:

- O overage de notas do Sprint 36 (job `aggregate-fiscal-usage-snapshot` do sprint doc) não tem onde gravar.
- A UI `/app/settings/tenant/plan` não consegue mostrar "X/Y notas inclusas; overage estimado".
- O hard-stop de cota IA (ADR 0064) não tem série histórica.

## Decision

**Tabela `tenant_usage_snapshots`** em `packages/db/src/schema/billing.ts`:

- Grão: **1 row por (tenant, year_month)** — `year_month text 'YYYY-MM'` + unique index. Snapshot mensal recalculável, não event-sourcing (o detalhe já vive nas tabelas fonte; snapshot é agregado pra billing e UI).
- Métricas MVP: `active_members_count`, `fiscal_emissions_count`, `ai_calls_count`, `storage_bytes` (as 4 cotas do ADR 0066). Colunas novas = migration aditiva.
- `computed_at` — última recomputação; job pode rodar N vezes no mês (UPSERT idempotente), fechamento usa o último valor do mês encerrado.
- **Sem RLS de escrita pra usuário**: escrita SOMENTE via job cron (role system). Leitura: tenant lê a própria row (UI do plano); `super_admin` lê todas.

**Job `POST /api/jobs/aggregate-usage-snapshots`** (cron diário, Bearer `CRON_SECRET`, mesmo padrão do `aggregate-fiscal-monthly` do 37b):

- Pra cada tenant ativo, UPSERT do mês corrente:
  - `active_members_count`: members não-arquivados do tenant
  - `fiscal_emissions_count`: `count(*)` de `fiscal_emissions` com `status='completed'` e `completed_at` no mês, `kind IN ('nfse','nfe','nfce','nfe_return','nfe_transfer','nfe_conserto_out','nfe_conserto_return')` — **eventos (cancelamento/CC-e/inutilização) não contam** e `nfe_self_entry` não conta (ADR 0066: lista fechada de tipos cobrados)
  - `ai_calls_count` e `storage_bytes`: 0 no MVP — fontes (`ai_audit_log` agregado, MinIO du) plugam em fase 2
- Best-effort por tenant (erro em 1 não derruba o job) + counters no response.

## Alternatives considered

- **Contar on-the-fly na UI/fechamento** (sem snapshot) — rejeitado: fechamento de fatura precisa de valor estável do mês encerrado; count ao vivo muda com cancelamentos retroativos e faz a fatura flutuar.
- **Event sourcing de uso (1 row por evento)** — rejeitado: as tabelas fonte já são o event log; duplicar viraria a tabela de maior volume do banco sem necessidade (regra 34).
- **Grão diário** — rejeitado no MVP: billing é mensal; diário multiplica 30× as rows sem consumidor.

## Consequences

- Sprint 04 (billing Asaas) ganha a fonte pra calcular overage na fatura; Sprint 36 fecha o requisito do ADR 0066.
- Snapshot mensal recalculável significa que correção retroativa (ex: cancelamento de nota do mês anterior) exige re-rodar o job com o mês alvo — o endpoint aceita `?month=YYYY-MM` pra isso.
- Colunas de IA/storage entram zeradas — honesto sobre o que é medido hoje; UI deve tratar 0 como "não medido" até fase 2.
