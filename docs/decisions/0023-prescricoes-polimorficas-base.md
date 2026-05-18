---
slug: prescricoes-polimorficas-base
status: accepted
date: 2026-05-13
---

# ADR 0023 — `prescriptions` polimórfico como base de prescrição cross-vertical

## Contexto

Sprint 11 entrega o módulo de treinos (Academia: workouts + sessões). Logo
em seguida, Fase 2 entrega protocolos de fisioterapia (Sprint 20) e Fase 3
entrega planos alimentares (Sprint 29). Os três se parecem muito do ponto
de vista de "ato profissional aplicado ao paciente":

- Vigência (data início → data fim)
- Profissional responsável (`prescribed_by_user_id`)
- Vinculado a 1 member do tenant
- Pode estar ativo ou expirado
- Tem notas livres
- Audit cross-module (Sprint 13 régua, Sprint 06 copilot, Sprint 27
  cross-alert lesão→treino) precisa **listar todas as prescrições ativas
  de um member** sem precisar conhecer cada tipo separado

Sem decisão arquitetural, o caminho default seria criar
`workout_prescriptions` (Sprint 11), depois `meal_plan_prescriptions`
(Sprint 29), depois `fisio_protocol_prescriptions` (Sprint 20) — três
tabelas com 80% colunas idênticas. Cada cross-feature seria forçada a
fazer 3-way UNION em runtime.

Pior: Sprint 11 entrega cross-prescription alert (regra 42 + ADR 0077),
que precisa **detectar conflitos entre prescrições de tenants diferentes**
— sem tabela canônica, esse motor vira N×M comparações tipadas.

## Decisão

### Tabela `prescriptions` polimórfica com `kind` + `ref_id`

```sql
CREATE TYPE prescription_kind AS ENUM (
  'workout',         -- ref_id → workouts.id (Sprint 11)
  'meal_plan',       -- ref_id → meal_plans.id (Sprint 29 futuro)
  'fisio_protocol',  -- ref_id → fisio_protocols.id (Sprint 20 futuro)
  'custom'           -- ref_id NULL, notes livre (instruções não-estruturadas)
);

CREATE TABLE prescriptions (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  member_id uuid NOT NULL REFERENCES members,
  kind prescription_kind NOT NULL,
  ref_id uuid,                              -- FK lógica (não relacional)
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  prescribed_by_user_id uuid REFERENCES users,
  notes text,
  CONSTRAINT prescriptions_ref_required
    CHECK (kind = 'custom' OR ref_id IS NOT NULL),
  CONSTRAINT prescriptions_ends_after_starts
    CHECK (ends_at IS NULL OR ends_at > starts_at)
);
```

**FK lógica em `ref_id`** (sem `REFERENCES` relacional): cada `kind`
aponta pra tabela diferente. Server Action `prescribeWorkout` valida que
`ref_id` existe em `workouts` no INSERT; Sprint 20/29 farão o mesmo pra
seus tipos. Postgres não suporta polymorphic FK nativo — alternativa
seria `workout_id NULLABLE` + `meal_plan_id NULLABLE` + ... mas isso
explode colunas conforme novas verticais entram (e CHECK constraint
exigindo exatamente 1 ≠ NULL fica ilegível).

**`active` materializado** (vs derivado de `ends_at > now()`): widget
perfil do member roda 10× por carga de página. `WHERE active = true`
usando índice parcial é 100× mais barato que `WHERE ends_at IS NULL OR
ends_at > now()`. Custo: job cron diário (Sprint 12+) zera `active`
quando `ends_at < now()`. Conscientemente aceitando overhead de
manutenção pra ganhar latência de leitura.

### Cada vertical mantém tabela própria pra dados específicos

Workouts tem `workouts` + `workout_items` (ordem, séries, reps, carga).
Plano alimentar terá `meal_plans` + `meal_plan_meals` + `meal_items`
(refeições por horário, quantidades, substituições). Protocolo fisio
terá `fisio_protocols` + `protocol_exercises` (com `restricted_movements`,
fases de reabilitação). **`prescriptions` não duplica esses dados** —
serve como ponteiro + metadata genérica.

### Tabela `workout_sessions` referencia `prescriptions.id` (não `workouts.id`)

```sql
CREATE TABLE workout_sessions (
  prescription_id uuid NOT NULL REFERENCES prescriptions,
  member_id uuid NOT NULL REFERENCES members,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  overall_rpe int CHECK (overall_rpe BETWEEN 1 AND 10),
  calculated_kcal numeric,
  ...
);
```

Sessão é **execução de uma prescrição específica** — se profissional
trocar de workout no meio do mês (cria nova prescrição), sessões antigas
seguem apontando pra prescrição original. Preserva historicidade.

### Versionamento de workouts via `parent_workout_id`

Editar workout NÃO faz UPDATE — cria nova row com `version+1` e
`parent_workout_id` apontando pra original. Prescrições antigas seguem
referenciando workout_id imutável → ficha histórica intacta.

```sql
CREATE TABLE workouts (
  id uuid PRIMARY KEY,
  version int NOT NULL DEFAULT 1,
  parent_workout_id uuid REFERENCES workouts,
  ...
);
```

Server Action `updateWorkout` materializa: INSERT INTO workouts +
INSERT workout_items (cópia + edits).

## Consequências

### Positivas

- **Cross-feature uniforme**: copilot (Sprint 06) lista prescrições ativas
  do member sem 3-way UNION. Régua WhatsApp (Sprint 13) notifica
  "prescrição expirando" via 1 query. Cross-alert lesão→treino (Sprint 27)
  detecta conflito entre `kind='workout'` e `kind='fisio_protocol'`
  trivialmente.
- **Schema único de governança**: RLS por tenant_id, audit_log
  uniforme, retenção alinhada (5a hot + agregação Sprint 12+ pós-prod).
- **Cross-tenant alert (Sprint 11+ futuro, ADR 0077)**: motor de
  conflito cross-prescrição roda em `prescriptions` (single source) ao
  invés de N tabelas — fundamental pra diferencial do produto.
- **Adicionar nova vertical = adicionar enum** (`prescription_kind` +=
  `supplementation`, `psicologia_protocol`, ...). Schema base não muda.

### Negativas

- **FK lógica não-relacional**: deletar workout não cascateia
  prescription. Server Action `archiveWorkout` deve checar prescrições
  ativas e bloquear, OU job de limpeza diário marca prescriptions órfãs
  como `active=false`. Resolveremos quando ADR de retenção rodar (Sprint 12+).
- **Validação de `ref_id` em Server Action**: não em SQL. Lint policy
  pode ser tentada pra detectar `INSERT INTO prescriptions` sem checagem
  de ref_id existente. MVP delega aos testes E2E.
- **`active` materializado exige job de cleanup**: até job rodar
  (Sprint 12+), prescrições com `ends_at < now()` continuam aparecendo
  como ativas. Server Action filtra por `ends_at > now() OR ends_at IS
  NULL` defensivamente até cron entrar.

### Alternativas consideradas

1. **Tabela por vertical** (`workout_prescriptions`, `meal_plan_prescriptions`,
   ...). Rejeitada: explode N tabelas, 3-way UNION em todo cross-feature.
2. **JSONB `prescription_data`** (sem `ref_id`). Rejeitada: perde
   integridade referencial total, queries em JSONB são caras, audit
   complica.
3. **Single Table Inheritance** (workout + meal_plan + fisio_protocol
   numa só tabela, colunas nullable). Rejeitada: tabela com 80+ colunas
   nullable é anti-padrão; metade é específica de tipo e fica vazia 90%
   do tempo.

## Status

Accepted (Sprint 11 Faixa D, 2026-05-13).

## Referências

- Sprint 11 [`docs/sprints/11-geral-prescricoes-e-biblioteca.md`](../sprints/11-geral-prescricoes-e-biblioteca.md)
- Regra 7 (Zod no boundary — Server Action valida `ref_id`)
- Regra 33 ([ADR 0071](0071-sistema-tratamento-erros-alertas-tempo-real.md) — `wrapServerAction` aplica envelope)
- Regra 42 ([ADR 0077](0077-passaporte-paciente-vinculo-cross-tenant.md) — cross-prescrição cross-tenant; motor futuro consome `prescriptions` base)
- [ADR 0011](0011-member-perfil-unico-cross-module.md) — member como perfil único cross-module
- [ADR 0070](0070-insights-cross-module-timeline-integrada.md) — `calculateKcalPerSession` usa MET dos exercises da prescrição
