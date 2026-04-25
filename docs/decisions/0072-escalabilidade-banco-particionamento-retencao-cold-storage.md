# ADR 0072 — Estratégia de escalabilidade do banco de dados (particionamento + retenção + cold storage + sharding futuro)

- **Status:** Accepted
- **Date:** 2026-04-24

## Context

LogiFit usa **multi-tenant single-database** com isolamento via RLS (ADR 0002). Para 1-50 tenants, modelo simples basta. Mas:

### Análise de volume — explosão sem estratégia

Tabelas que crescem mais rápido (estimativa por tenant ativo médio Pro com 500 members):

| Tabela | Linhas/dia | Linhas/mês | Linhas/ano |
|---|---|---|---|
| `audit_log` (regra 5 — toda ação) | ~150 | ~4.500 | ~55k |
| `member_events` (timeline) | ~30 | ~900 | ~11k |
| `ai_audit_log` (Sprint 06 + ADR 0064) | ~100 | ~3.000 | ~36k |
| `appointments` | ~10 | ~300 | ~3.6k |
| `workout_sessions` | ~30 | ~900 | ~11k |
| `food_log` (Sprint 31) | ~50 | ~1.500 | ~18k |
| `system_alerts` + `system_alert_occurrences` (ADR 0071) | ~5 | ~150 | ~1.8k |
| `nfe_received` | ~3 | ~90 | ~1.1k |
| `invoices` + `accounts_receivable` | ~5 | ~150 | ~1.8k |
| **`device_readings` (Sprint 32 — wearables)** ⚠ | **~50.000-500.000** | **~1.5M-15M** | **~18M-180M** |

### Projeção por escala

| Escala | Tenants | Members totais | Linhas/ano sem device | Linhas/ano com device 30% |
|---|---|---|---|---|
| MVP | 20 | 5k | ~3M | ~30M |
| Inicial | 100 | 50k | ~15M | **~5B** ⚠ |
| Médio | 500 | 250k | ~75M | ~25B |
| Grande | 2.000 | 1M | ~300M | ~100B |

### Quando vira problema

Postgres aguenta volume, mas:
- **~10M linhas em 1 tabela sem partição** → queries começam a desacelerar (>500ms)
- **~100M linhas** → backup demora horas, índices ocupam GB
- **~1B linhas** → vacuum trava, instabilidade sem partição

**Sem ação proativa, `audit_log` e `device_readings` viram gargalo em ~6-12 meses pós-lançamento.**

### Compliance complica

- **`audit_log`**: 5 anos retenção mínima (LGPD + auditoria)
- **`consultas` (Fisio)** / `lab_results` médicos: 20 anos (**Lei 13.787/2018** — prontuário eletrônico, lei federal primária; reforçada por CFM 2.299/2021)
- **`evolucoes_sessao`**: 5 anos (COFFITO 415/2012)
- **`nfe_received` + `invoices`**: 5 anos (obrigação fiscal)
- **`lab_results`**: 20 anos (Lei 13.787/2018 + CFM)
- **`patient_data_access_log`** (ADR 0077 — passaporte cross-tenant): 5 anos (auditoria LGPD obrigatória)

Não pode simplesmente apagar. **Precisa cold storage.**

### Decisões do usuário (2026-04-24)

1. Particionar `audit_log` desde Sprint 01a — **A** (sim)
2. `device_readings` com partição por dia + agregação 90d — **A**
3. Retenção variável por compliance — **A**
4. Cold storage schema preparado em 01b; job em Fase 2 — **A**
5. Monitoring `/app/super-admin/database` no Sprint 07 — **A**

## Decision

Estratégia em **5 camadas de defesa**, aplicadas conforme tabela:

### 1. Particionamento Postgres nativo (PARTITION BY RANGE/LIST/HASH)

Toda tabela com **volume estimado >5M linhas/ano** **deve nascer particionada** (regra 34, nova).

#### Padrão `audit_log` por mês

```sql
CREATE TABLE audit_log (
  id uuid not null,
  tenant_id uuid not null,
  user_id uuid,
  action text not null,
  resource_type text,
  resource_id uuid,
  payload jsonb,
  ip_address inet,
  user_agent text,
  at timestamptz not null default now(),
  PRIMARY KEY (id, at)  -- precisa incluir coluna de partição
) PARTITION BY RANGE (at);

-- Cria partições antecipadas (~12 meses à frente)
CREATE TABLE audit_log_2026_04 PARTITION OF audit_log
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE audit_log_2026_05 PARTITION OF audit_log
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

-- Indexes na PARTIÇÃO (não na parent)
CREATE INDEX ON audit_log_2026_04 (tenant_id, at DESC);
CREATE INDEX ON audit_log_2026_04 (tenant_id, user_id, at DESC);
CREATE INDEX ON audit_log_2026_04 (tenant_id, resource_type, resource_id) WHERE resource_id IS NOT NULL;

-- Job mensal cria próxima partição
-- packages/db/jobs/create-next-partitions.ts
```

#### `device_readings` por dia + tenant (HASH)

```sql
CREATE TABLE device_readings (
  id uuid not null,
  tenant_id uuid not null,
  member_id uuid not null,
  provider text,
  metric_type text,  -- 'heart_rate','steps','sleep','calories','spo2',...
  value numeric,
  unit text,
  recorded_at timestamptz not null,
  PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

-- Particionamento DIÁRIO (volume gigante)
CREATE TABLE device_readings_2026_04_24 PARTITION OF device_readings
  FOR VALUES FROM ('2026-04-24') TO ('2026-04-25');
-- ... cron diário cria amanhã + 7 dias adiante
```

### 2. Retenção agressiva por tabela

| Tabela | Particionar por | Retenção raw | Notas |
|---|---|---|---|
| `audit_log` | mês | **5 anos** (LGPD + compliance) | drop partition antiga = milissegundos |
| `member_events` | trimestre | 3 anos; depois agrega | agregado mantém histórico longo |
| `ai_audit_log` | mês | 1 ano + cold storage 5 anos (CFM 2.454) | export Parquet para Storage |
| `system_alerts` | mês | 30/90/365/1825 dias por severity | (ADR 0071) |
| `system_alert_occurrences` | mês | 90 dias | apenas timeline recente |
| `appointments` | trimestre | 5 anos | histórico clínico |
| `workout_sessions` | trimestre | 3 anos raw + agregado mensal 5 anos | cross-module insights (ADR 0070) |
| `food_log` | mês | **6 meses raw**; depois agrega diário | resumo nutricional preserva info |
| **`device_readings`** ⚠ | **dia** | **90 dias raw**; agregado diário 1 ano; depois cold storage 1 ano e drop | volume crítico |
| `device_readings_daily_summary` | mês | 5 anos | HR avg/max/min, total steps, total kcal |
| `invoices` | ano | 5 anos | obrigação fiscal |
| `nfe_received` | ano | 5 anos | obrigação fiscal |
| `accounts_receivable` | ano | 5 anos | idem |
| `consultas` (Fisio) | trimestre | **20 anos** (CFM 2.299/2021) | NUNCA drop; arquivar cold após 5 anos |
| `evolucoes_sessao` | trimestre | **5 anos** (COFFITO 415/2012) | drop só se obrigação cessar |
| `meal_plans` | trimestre | 5 anos | acompanhamento Nutri |
| `lab_results` | ano | 20 anos (CFM) | cold storage após 5 anos |
| `ai_semantic_cache` | (sem partição) | TTL 30 dias | cache; LRU eviction |
| `member_insights` | (sem partição) | TTL 6h-24h por insight_key | cache de cálculos cross-module (ADR 0070) |
| **`patient_data_access_log`** (ADR 0077) | **mês** (RANGE recorded_at) | **5 anos** | **CRÍTICO LGPD**: estimativa 10-15M linhas/ano com 30% adoção do passaporte; partição mensal obrigatória desde Sprint 02 (regra 34) |

### 3. Agregações automáticas (rollup) — preserva info, economiza espaço

Job noturno cria resumos para queries frequentes:

#### `food_log` → `food_log_daily_summary`

```sql
CREATE TABLE food_log_daily_summary (
  tenant_id uuid not null,
  member_id uuid not null,
  day date not null,
  total_kcal numeric,
  total_protein_g numeric,
  total_carb_g numeric,
  total_fat_g numeric,
  meal_count int,
  adherence_percent numeric,
  PRIMARY KEY (member_id, day)
) PARTITION BY RANGE (day);

-- Job mensal: agrega + drop raw >6 meses
INSERT INTO food_log_daily_summary
SELECT tenant_id, member_id, DATE(consumed_at), SUM(kcal), SUM(protein_g), ...
FROM food_log
WHERE consumed_at < NOW() - INTERVAL '6 months'
GROUP BY tenant_id, member_id, DATE(consumed_at)
ON CONFLICT DO NOTHING;

DROP TABLE food_log_2025_q1;  -- partição antiga (drop = ms)
```

#### `device_readings` → `device_readings_daily_summary`

```sql
CREATE TABLE device_readings_daily_summary (
  tenant_id uuid not null,
  member_id uuid not null,
  day date not null,
  metric_type text not null,
  avg_value numeric,
  max_value numeric,
  min_value numeric,
  total_value numeric,  -- para steps/calories
  count int,
  PRIMARY KEY (member_id, day, metric_type)
) PARTITION BY RANGE (day);
```

**Resultado:** insights cross-module (ADR 0070) continuam funcionando 5 anos depois; raw economizado **100x**.

### 4. Materialized views para queries hot

```sql
-- Métricas agregadas por tenant (super_admin LogiFit)
CREATE MATERIALIZED VIEW tenant_metrics_daily AS
SELECT 
  tenant_id, DATE(at) AS day,
  COUNT(DISTINCT member_id) AS active_members,
  COUNT(*) FILTER (WHERE event_type = 'check_in') AS checkins,
  COUNT(*) FILTER (WHERE event_type = 'appointment') AS appointments,
  COUNT(*) FILTER (WHERE event_type = 'evolution') AS evolutions
FROM member_events
WHERE at > NOW() - INTERVAL '90 days'  -- só recente
GROUP BY tenant_id, DATE(at);

-- Refresh diário
REFRESH MATERIALIZED VIEW CONCURRENTLY tenant_metrics_daily;

-- Member timeline (já no ADR 0070)
CREATE MATERIALIZED VIEW member_timeline AS ...
```

Outras views planejadas:
- `dashboard_kpis_company` (Sprint 07)
- `member_timeline` (ADR 0070)
- `ai_usage_summary_monthly` por tenant
- `revenue_summary_monthly` por company

Refresh **CONCURRENTLY** — não bloqueia leitura.

### 5. Cold storage para arquivamento legal

#### Estrutura de tiers

```
HOT (Postgres principal — últimos 12 meses)
  ↓ job mensal: archive_old_partitions()
COOL (Postgres cold partition — 12-60 meses)
  - mesmo banco, partições antigas
  - índices reduzidos (só fingerprint/hash)
  ↓ job anual: deep_archive()
COLD (Supabase Storage — Parquet compactado)
  - bucket 'cold-archive/{table}/{year}/{tenant_id}/'
  - compressão zstd (~80% economia)
  - acessível via query lenta (raro consultar)
  ↓ após retention legal expirar (5/20 anos)
DELETED
  - drop de partição cold no Postgres
  - delete object no Storage
  - log em audit_compliance_actions
```

#### Tabelas que vão pra cold storage

| Tabela | Quando vai pra cold | Quando deleta |
|---|---|---|
| `audit_log` | >2 anos | >5 anos |
| `ai_audit_log` | >1 ano | >5 anos |
| `consultas` | >5 anos (mas mantém 20a — só move) | >20 anos (CFM permite descarte) |
| `evolucoes_sessao` | >2 anos | >5 anos |
| `lab_results` | >5 anos | >20 anos |
| `device_readings` raw | >90 dias | >1 ano após cold |
| `nfe_received` | >2 anos | >5 anos |
| `invoices` (paid) | >2 anos | >5 anos |
| `patient_data_access_log` | >2 anos | >5 anos |

#### Schema de gerenciamento

```sql
CREATE TABLE archive_jobs (
  id uuid pk,
  table_name text,
  partition_name text,
  archive_type enum ('to_cold','to_storage','delete'),
  status enum ('pending','running','completed','failed'),
  rows_archived bigint,
  storage_path text,  -- bucket/path do Parquet
  started_at timestamptz,
  completed_at timestamptz nullable,
  error_message text nullable
);

CREATE TABLE compliance_retention_log (
  id uuid pk,
  table_name text,
  partition_name text,
  action enum ('archived','deleted'),
  legal_basis text,  -- 'lgpd_5years','cfm_20years','fiscal_5years'
  data_summary jsonb,  -- contagem de linhas, range de datas
  executed_at timestamptz,
  executed_by uuid  -- system or admin
);
```

### Sharding multi-cluster (decisão futura, não MVP)

**Trigger:** quando 1 tenant tem >100k members ativos OU >50% do tráfego do cluster OU banco passa de 500GB.

```sql
ALTER TABLE tenants ADD COLUMN shard_url text NULL;
-- NULL = cluster default (compartilhado)
-- preenchido = cluster dedicado (Supabase Pro+ separado)
```

App layer escolhe connection string conforme `tenant.shard_url`. **Decisão ad-hoc por tenant grande**, não automática.

Quando entrar em ação:
- Tenant Enterprise com 50k+ members → migra para próprio Supabase
- Backup separado, latência dedicada
- Tenants pequenos permanecem no cluster compartilhado (R$ 5/tenant em infra)

**Não implementar no MVP** — só preparar coluna no schema (Sprint 01a).

### Jobs cron consolidados

| Job | Frequência | O que faz |
|---|---|---|
| `create-next-partitions` | mensal (dia 1) | Cria partições futuras 3 meses adiante |
| `create-daily-partitions` | diário (00:30) | Cria partição `device_readings_{tomorrow+7d}` |
| `aggregate-daily-summaries` | diário (03:00) | Roda rollups (food_log, device_readings, workout_sessions) |
| `refresh-materialized-views` | hourly (queries hot) + diário (analytics) | Refresh CONCURRENTLY |
| `archive-cold-partitions` | mensal | Move partições >2 anos para cold tier |
| `deep-archive-storage` | trimestral | Exporta partições cold para Parquet em Storage |
| `delete-expired-data` | mensal | Drop partições/storage além da retenção legal (audit) |
| `monitor-database-size` | diário | Cria `system_alerts` se tabela passa de 50M linhas ou banco passa de 100GB |
| `vacuum-analyze-partitions` | semanal | Mantém estatísticas atualizadas |

### Monitoring proativo (`/app/super-admin/database`)

UI dedicada do platform admin (você):

```
┌─ Saúde do Banco ───────────────────────────────────────────┐
│                                                             │
│  📊 Tamanho total:           47.2 GB / 100 GB (limite plano)│
│  📈 Crescimento 30d:         +3.8 GB                        │
│  🔝 Maiores tabelas (top 10):                                │
│    audit_log_2026_04        12.1 GB · 41M linhas            │
│    device_readings_2026_04   8.4 GB · 89M linhas ⚠          │
│    member_events_2026_q1     2.3 GB · 7M linhas             │
│    workout_sessions_2026_q1  1.1 GB · 3M linhas             │
│    ai_audit_log_2026_04      980 MB · 12M linhas            │
│    ...                                                      │
│                                                             │
│  ⏱ Próximas partições a dropar (>5 anos):                  │
│    audit_log_2021_04 (drop em 30 dias) ▶ Cold storage       │
│    invoices_2021     (drop em 6 meses)                      │
│                                                             │
│  🔥 Tenants com mais dados:                                 │
│    Hospital ABC      8.4 GB (rede 3 unidades, 8.5k members) │
│    Vital Club        3.2 GB (4 unidades, 1.8k members)      │
│                                                             │
│  ⚠ Alertas:                                                 │
│    `device_readings_2026_04` está em 89M linhas (limit 30M) │
│    [Particionar por hash(member_id)] [Acelerar agregação]   │
│                                                             │
│  [Configurar retenção] [Forçar archive] [Migrations]        │
│  [Considerar sharding tenant Hospital ABC]                  │
└─────────────────────────────────────────────────────────────┘
```

Queries úteis (built-in):

```sql
-- Tamanho por tabela
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) AS total_size,
  pg_size_pretty(pg_relation_size(schemaname || '.' || tablename)) AS table_size,
  pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename) - pg_relation_size(schemaname || '.' || tablename)) AS index_size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname || '.' || tablename) DESC
LIMIT 20;

-- Tamanho por tenant (queries específicas)
SELECT tenant_id,
  COUNT(*) AS total_rows,
  pg_size_pretty(SUM(pg_column_size(t)::bigint)) AS approx_size
FROM audit_log t
GROUP BY tenant_id
ORDER BY 2 DESC LIMIT 10;
```

### Volumes esperados COM estratégia

| Escala | Sem ação | Com ADR 0072 |
|---|---|---|
| 100 tenants × 50k members × 1 ano | 5B+ linhas | ~50M linhas hot + 200M cold |
| 500 tenants × 250k members × 2 anos | 50B+ linhas | ~150M hot + 1B cold (Storage) |
| 2000 tenants × 1M members × 5 anos | 1T+ linhas | sharding por tenants grandes + 500M hot por shard |

**Banco hot fica sempre <100GB**, queries rápidas, custo controlado.

### Custo Supabase escalável

| Tenants | DB size | Plano Supabase | Custo/mês |
|---|---|---|---|
| 1-20 | <500MB | Free | R$ 0 |
| 20-100 | 5-20 GB | Pro | R$ 125 |
| 100-300 | 20-80 GB | Pro + Compute medium | R$ 350 |
| 300-1000 | 80-300 GB | Pro + Compute large + Read replicas | R$ 1.200 |
| 1000+ | sharding | Team plan + dedicated | R$ 3.000+ |

Receita escala mais rápido que custo (margem 95%+).

## Consequences

### Positivas

- **Banco hot sempre <100GB** — queries rápidas, backup viável, custo controlado
- **Compliance preservada** — 5 anos audit, 20 anos prontuário, 5 anos fiscal — tudo respeitado
- **Drop de partição é metadata-only** (milissegundos) vs DELETE row-by-row (horas)
- **Cold storage barato** — Supabase Storage zstd parquet ~80% economia
- **Sharding como evolução natural** — preparado mas não implementado prematuramente
- **Monitoring proativo** — alerts antes de problema (ADR 0071)
- **Insights cross-module** (ADR 0070) preservados via agregados (5 anos+)
- **Margem do plano LogiFit gorda** mesmo com 1000+ tenants
- **Operação solo viável** — jobs automáticos cuidam de tudo

### Negativas (mitigáveis)

- **Complexidade adicional Sprint 01a** — particionamento de `audit_log` desde dia 1; ~1 dia extra de setup
- **Migrations mais cuidadosas** — não pode criar tabela "qualquer jeito"; deve declarar partição se volume >5M/ano. Documentado em padrões do `packages/db/`.
- **Cold storage tem latência alta** — query a dado >2 anos demora minutos (export/parse Parquet); aceitável para casos raros (auditoria, LGPD art. 18)
- **Particionamento por dia (`device_readings`)** gera ~365 partições/ano — manutenção via jobs; aceitável
- **Materialized views precisam refresh** — CONCURRENTLY não bloqueia mas consome IO
- **Sharding multi-cluster (futuro)** complica deploys — quando chegar, cria pipeline próprio

### Riscos não endereçados

- **Tabela com volume não previsto cresce explosivamente** (ex: novo módulo) — mitigar com regra 34 (CI lint) + monitoring
- **Particionamento pode ter bug de "partição não existe"** se job falhou — alerta + criação retroativa
- **Restore de dados muito antigos** (>5 anos da cold storage) é trabalhoso — aceito (caso muito raro)
- **Crescimento de Supabase Storage** custa também — versionar Parquet com `lifecycle policies`

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Sem particionamento; "Postgres aguenta" | 1B linhas em tabela única vira gargalo; backups e queries quebram |
| Particionar tudo manualmente quando precisar | Migration de tabela com 100M linhas é dor; melhor nascer particionada |
| Rolar tudo para cold imediatamente | Latência de cold inviabiliza queries operacionais; tier hot é necessário |
| Sharding por tenant desde o MVP | Over-engineering; complica deploys; custo desnecessário |
| Database por tenant | ADR 0002 já rejeitou — multiplica custo de infra; RLS resolve |
| Apenas TTL sem agregação (drop sem rollup) | Perde insights cross-module (ADR 0070); compromete histórico clínico |
| Partições gigantes (1 por ano) | Volume por partição passa do limit prático Postgres; mês ou trimestre são equilíbrio |

## Escopo de impacto

**Novo ADR:** este (0072).

**Nova regra 34** em `docs/rules.md`:

> Toda tabela com volume estimado **>5M linhas/ano** ou **>50k linhas/dia** **deve nascer particionada** (PARTITION BY RANGE em coluna temporal ou HASH em `tenant_id`/`member_id`). CI tem teste que falha em migration que cria tabela sem partição quando estimativa de volume excede o limite (declaração obrigatória `@volume_estimate_yearly` em comentário SQL). Toda tabela com retenção definida tem job de partition lifecycle (`create-next-partitions`/`drop-old-partitions`/`archive-cold`) cadastrado. Ver [ADR 0072](decisions/0072-escalabilidade-banco-particionamento-retencao-cold-storage.md).

**Sprints ajustados:**

- **Sprint 01a (Identidade + Topology)** — `audit_log` particionado por mês desde dia 1 + tabela `tenants.shard_url` (preparação sharding) + jobs `create-next-partitions` + `monitor-database-size` + tabela `archive_jobs` + `compliance_retention_log`
- **Sprint 01b (RBAC + Consent)** — `system_alerts` + `system_alert_occurrences` particionados por mês (ADR 0071) + jobs de retention conforme severity + cold storage schema preparado (não implementado)
- **Sprint 02 (CRM Members)** — `member_events` particionado por trimestre + materialized view `member_timeline` (já planejado ADR 0070) com refresh hourly + **`patient_data_access_log` particionado por mês** (ADR 0077, retenção 5 anos)
- **Sprint 06 (Copilot + IA)** — `ai_audit_log` particionado por mês + `ai_semantic_cache` com TTL 30 dias + `member_insights` com TTL 6-24h
- **Sprint 07 (Dashboard)** — UI `/app/super-admin/database` com KPIs + maiores tabelas + crescimento + alertas + ações; jobs `aggregate-daily-summaries` + `refresh-materialized-views`
- **Sprint 11 (Prescrições)** — `workout_sessions` particionado por trimestre
- **Sprint 17 (Bancos + NFe)** — `nfe_received` particionado por ano
- **Sprint 20 (Prontuário Fisio)** — `consultas` particionado por trimestre + retenção 20 anos com cold storage após 5 anos
- **Sprint 21 (Evolução)** — `evolucoes_sessao` particionado por trimestre
- **Sprint 31 (Diário Alimentar + Teleconsulta)** — `food_log` particionado por mês + agregação 6 meses para `food_log_daily_summary`
- **Sprint 32 (Device Hub)** — **CRÍTICO**: `device_readings` particionado por **dia** + agregação 90 dias para `device_readings_daily_summary` + cold storage após 1 ano
- **Sprint 33 (Pipeline Exames)** — `lab_results` particionado por ano + retenção 20 anos
- **Pós-MVP**: jobs de cold storage automático (deep archive Parquet) + sharding strategy quando >500 tenants

**Schema novo:**
- `archive_jobs` — controle de jobs de archive
- `compliance_retention_log` — log auditável de archives e deletes legais
- `tenants.shard_url` — preparação para sharding futuro

**Docs:**
- `docs/modulos.md` — módulos "Particionamento + retenção" + "Cold storage" + "Monitoring de banco" em Fundação
- `docs/rules.md` — regra 34 + contagem (34 regras)
- `CLAUDE.md` — regra operacional 19 + contagem
- `CHANGELOG.md` — entrada
- `docs/arquitetura.md` — seção "Estratégia de escalabilidade do banco"

## Related

- Reforça [ADR 0002 — RLS como isolamento primário](0002-rls-como-isolamento-primario.md) — RLS continua válido; particionamento é compatível (cada partição respeita RLS independente)
- Estende [ADR 0007 — Topology](0007-topology-owned-vs-franchise.md) — `shard_url` por tenant é evolução natural
- Integra com [ADR 0070 — Insights cross-module](0070-insights-cross-module-timeline-integrada.md) — agregados preservam histórico para insights de longo prazo
- Integra com [ADR 0071 — Sistema de erros](0071-sistema-tratamento-erros-alertas-tempo-real.md) — `system_alerts` particionado + monitoring de DB cria alerts de capacity
- Reforça [ADR 0054 — LGPD art. 11](0054-lgpd-art11-dados-saude-ripd-versionado.md) — retenção variável respeita base legal por categoria de dado
- Reforça [ADR 0067 — DPO + governança](0067-dpo-governanca-compliance-lgpd.md) — `compliance_retention_log` audita ações de archive/delete
- Fontes: PostgreSQL docs (Partitioning), Supabase performance guide, "Designing Data-Intensive Applications" (Kleppmann), benchmarks Citus/Timescale, casos de uso multi-tenant SaaS scale (Notion, Linear, GitHub)
