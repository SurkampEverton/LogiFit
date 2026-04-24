# Sprint 11 — Geral · Prescrições e biblioteca (treinos + exercícios)

- **Área:** geral
- **Início:** planejado (depois do Sprint 10)
- **Fim planejado:** +3 semanas
- **Status:** planejado
- **Item do roadmap:** #13

## Goal

Biblioteca de exercícios com vídeos + montagem de treinos + atribuição (prescrição) ao `member`. Model genérico para reuso por Fisio (protocolos de reabilitação) e Nutri (planos alimentares seguem o mesmo padrão de "prescrição ao member"). **`exercises.met_value` obrigatório (ADR 0070)** com seed de ~800 exercícios da Compendium of Physical Activities 2024 — base para cálculo automático de gasto calórico cross-module; `workout_sessions.calculated_kcal` preenchido automaticamente via `calculateKcalPerSession(met, weight, duration)` de `packages/db/insights/workout.ts`.

## Critério de aceite

- Catálogo `exercises` (nome, descrição, grupo muscular, equipamento, vídeo curto <60s)
- Upload de vídeo para Supabase Storage com assinatura curta (URL 1h) para visualização segura
- Biblioteca compartilhada entre tenants: "templates globais" (read-only) + biblioteca do tenant (editável)
- Montagem de `workout`: conjunto ordenado de `workout_items` (exercício + séries + repetições + carga + descanso + observação)
- Prescrição: atribuir `workout` a um `member` com vigência (`workout_prescriptions`)
- Ficha acessível em `/app/members/[id]/treino` — com "iniciar sessão" que registra execução
- Registro de execução: `workout_sessions` com `rpe` (percepção de esforço 1–10) — prepara base para Fase 3 prescrição adaptativa
- Versionamento de workout: editar uma ficha cria nova versão sem perder histórico
- Widget "treino atual" no dashboard do member (slot `treino`) — próxima sessão + progresso
- Teste E2E: instrutor cria workout, prescreve a aluno, aluno abre ficha, executa sessão, registra RPE
- Seed: 20 exercícios globais (musculação básica) + 2 workouts prontos por tenant

## Dependências

- Sprint 02 (members)
- Sprint 03 (opcional — registrar sessão pode virar `appointment` do tipo "execução de treino")

## Decisões tomadas / ADRs esperados

- **ADR 0023 (esperado)** — Prescrição genérica: `prescriptions` polimórfico com `kind` enum (`workout`, `meal_plan`, `fisio_protocol`, `custom`). Detalhe por tipo fica em tabelas especializadas (`workouts`, `meal_plans` futuros, `fisio_protocols` futuros). Justifica: Fisio (Fase 2) e Nutri (Fase 3) reusam a mesma abstração de "prescrever algo ao member com vigência".
- **Pergunta aberta:** biblioteca global (templates compartilhados entre tenants) — quem cura? LogiFit (admin interno) ou comunitário? Começar com curadoria LogiFit (role `platform_admin`).

## Módulos entregues

Ver [`modulos.md` — Geral](../modulos.md#geral):

- Biblioteca de exercícios (catálogo + vídeos)
- Workouts (montagem de treinos)
- Prescrições de treino ao member
- Registro de sessão + RPE

## Rotas Next.js

- `/app/biblioteca/exercicios` — catálogo com busca e filtros
- `/app/biblioteca/exercicios/[id]` — detalhe + vídeo + variações
- `/app/biblioteca/exercicios/new` — cadastrar no tenant
- `/app/treinos` — lista de workouts do tenant
- `/app/treinos/[id]` — detalhe + editor
- `/app/treinos/new` — wizard de criação
- `/app/members/[id]/treino` — ficha ativa + próxima sessão + botão "iniciar"
- `/app/members/[id]/treino/sessao/[sessionId]` — UI de execução com cronômetro por série + input RPE
- `/app/members/[id]/treino/historico` — todas as sessões + gráficos

## Server Actions + API Routes

Server Actions em `apps/web/app/treinos/actions.ts`:

- `createExercise(input)` / `uploadExerciseVideo(exerciseId, file)`
- `createWorkout(input, items[])` / `updateWorkout` (cria nova versão)
- `prescribeWorkout(memberId, workoutId, startsAt, endsAt, notes?)` — cria `workout_prescriptions`
- `startSession(prescriptionId)` — cria `workout_sessions` vazia
- `recordSessionItem(sessionId, workoutItemId, reps, weight_kg, rpe)` — durante execução
- `finishSession(sessionId, overallRpe, notes?)` — emite `workout.session_completed`

API Routes:

- `GET /api/biblioteca/video/[exerciseId]` — redireciona para URL assinada curta do Storage

## Schemas Drizzle (esperado)

Em `packages/db/schema/treinos.ts`:

- `exercises` — `id`, `tenant_id nullable` (null = template global), `name`, `description`, `muscle_groups text[]`, `equipment text`, `video_storage_path nullable`, `thumbnail_url nullable`, `level` enum (`iniciante`, `intermediario`, `avancado`), `variations uuid[]` (outros exercises), `created_by_user_id`, `active`, `archived_at`
- `workouts` — `id`, `tenant_id`, `name`, `description`, `goal text` (hipertrofia, resistência, reabilitação, etc), `estimated_duration_min int`, `version int default 1`, `parent_workout_id nullable` (para versionamento), `created_by_user_id`, `archived_at`
- `workout_items` — `id`, `workout_id`, `exercise_id`, `order int`, `sets int`, `reps text` (pode ser "10" ou "8-12" ou "AMRAP"), `load_kg numeric nullable`, `rest_seconds int`, `notes text`, `superset_group int nullable`
- `prescriptions` — base polimórfica: `id`, `tenant_id`, `member_id`, `kind` enum (`workout`, `meal_plan`, `fisio_protocol`), `ref_id uuid` (points to `workouts.id` quando kind=workout), `starts_at`, `ends_at nullable`, `active bool`, `prescribed_by_user_id`, `notes text`, `created_at`. Preparada para Fisio/Nutri futuros sem migration destrutiva.
- `workout_sessions` — `id`, `tenant_id`, `prescription_id`, `member_id`, `started_at`, `finished_at nullable`, `overall_rpe int nullable` (1–10), `notes text`
- `workout_session_items` — `id`, `session_id`, `workout_item_id`, `set_number int`, `reps_performed int nullable`, `weight_kg numeric nullable`, `rpe int nullable`, `done_at`

**RLS:** tenant_id + scope. Biblioteca global (`tenant_id IS NULL`) liberada via policy que checa `kind=global`.

## Eventos de domínio emitidos

- `exercise.created` / `exercise.updated`
- `workout.created` / `workout.new_version`
- `prescription.created` / `prescription.ended`
- `workout.session_started`
- `workout.session_completed` — `{ session_id, member_id, prescription_id, overall_rpe, duration_min }`

Consumidores:
- Sprint 09 Engajamento: `workout.session_completed` pode disparar conquista "50 treinos completos"
- Fase 3 (prescrição adaptativa IA) consome RPE pra ajustar carga

## Commit (checklist)

- [ ] Schema Drizzle: `exercises`, `workouts`, `workout_items`, `prescriptions` (polimórfico), `workout_sessions`, `workout_session_items`
- [ ] Migration: biblioteca global (tenant_id NULL) + policy apropriada
- [ ] RLS + testes
- [ ] Zod schemas em `packages/types/treinos.ts`
- [ ] Upload de vídeo para Supabase Storage bucket `exercises` com URL assinada
- [ ] Server Actions
- [ ] UI catálogo + player de vídeo no modal
- [ ] UI editor de workout com drag-and-drop de exercícios
- [ ] UI execução de sessão com cronômetro por descanso
- [ ] Widget "treino" em `/app/members/[id]` (slot `treino`): `{ slot: 'treino', requiredPermissions: ['prescricao.read'], requiredVertical: null, consentPurpose: null, showWhen: (m) => m.has_active_prescription }`
- [ ] Seed: 20 exercícios globais + 2 workouts prontos por tenant
- [ ] Testes unit: versionamento de workout, cálculo de duração
- [ ] Testes E2E: fluxo completo instrutor → aluno
- [ ] Feature flag `treinos_v1`
- [ ] ADR 0023 publicado

## Stretch

- [ ] Import de workout via CSV / planilha
- [ ] Template de workout inteligente gerado pelo copilot (Sprint 06)
- [ ] Gráfico de progressão de carga por exercício
- [ ] Timer automático de descanso com notificação

## Log

- —

## Definition of Done

- [ ] Feature flag `treinos_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] RLS verificada
- [ ] Vídeos entregues via URL assinada (sem link público permanente)
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 11 → `done`
- [ ] ADR 0023 publicado

## Retro

- —
