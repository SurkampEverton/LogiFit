# Sprint 11 — Geral · Prescrições e biblioteca (treinos + exercícios)

- **Área:** geral
- **Início:** planejado (depois do Sprint 10)
- **Fim planejado:** +3 semanas
- **Status:** planejado
- **Item do roadmap:** #13

## Goal

Biblioteca de exercícios com vídeos + montagem de treinos + atribuição (prescrição) ao `member`. Model genérico para reuso por Fisio (protocolos de reabilitação) e Nutri (planos alimentares seguem o mesmo padrão de "prescrição ao member"). **`exercises.met_value` obrigatório (ADR 0070)** com seed de ~800 exercícios da Compendium of Physical Activities 2024 — base para cálculo automático de gasto calórico cross-module; `workout_sessions.calculated_kcal` preenchido automaticamente via `calculateKcalPerSession(met, weight, duration)` de `packages/db/insights/workout.ts`.

**Entrega também o detector de conflito cross-prescrição (ADR 0077 — diferencial-chave do produto):** quando profissional vai prescrever treino/dieta, sistema consulta `getCrossTenantSummary(memberId)` (Sprint 02) e detecta conflitos com prescrições ativas de outros tenants vinculados ao paciente. Banner de alerta na UI antes de salvar prescrição. Esse cruzamento só existe porque ADR 0077 permite passaporte cross-tenant — é o motivo de ter LogiFit em vez de 3 sistemas separados.

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
- **Cross-prescrição alert (ADR 0077):** ao prescrever workout pra paciente vinculado em outro tenant que tem `nutricao` ativo, sistema busca `meal_plans.calorie_target` e detecta:
  - **Risco de hipoglicemia:** `(prescribed_workout.estimated_kcal_burn / 7) > meal_plan.daily_kcal × 0.25` → alerta vermelho
  - **Volume incompatível:** workout >5x/semana com dieta hipocalórica (<1.500 kcal) → alerta amarelo
  - **Restrição motora não respeitada:** prescreveu deadlift mas paciente tem restrição "sem agachamento profundo" cadastrada por fisio em outro tenant → alerta vermelho
  - Banner exibido **antes** de `prescribeWorkout` salvar; profissional pode: (a) ajustar e re-tentar; (b) prosseguir mesmo assim com justificativa registrada em `cross_prescription_alerts.acknowledged_with_reason`
- Teste E2E cross-prescrição: paciente Maria com dieta 1.400 kcal de Tenant Nutri Ana → personal Maria de Tenant Academia Forma tenta prescrever HIIT 5x/semana → banner aparece + alerta gravado

## Dependências

- Sprint 02 (members + passaporte cross-tenant ADR 0077 + função `getCrossTenantSummary`)
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
- `prescribeWorkout(memberId, workoutId, startsAt, endsAt, notes?, acknowledgedAlerts?: string[])` — cria `workout_prescriptions`. Antes de salvar, chama `detectCrossPrescriptionConflicts(memberId, workoutId)` (regra 42 + ADR 0077); se houver `severity='critical'` sem `acknowledgedAlerts` cobrindo, retorna `{ ok: false, error: { code: 'CROSS_PRESCRIPTION_CONFLICT', alerts: [...] } }`. Profissional confirma na UI e re-chama com `acknowledgedAlerts: ['hipoglicemia', 'restricao_motora']` + justificativa registrada
- `detectCrossPrescriptionConflicts(memberId, workoutId)` — Server Action read-only; chama `getCrossTenantSummary(memberId)` (Sprint 02), busca prescrições ativas em outros tenants (módulo `nutricao` via `meal_plans` quando Sprint 29 entregar; módulo `fisioterapia` via `fisio_protocols` quando Sprint 20 entregar), aplica regras de conflito da função `evaluateCrossPrescriptionRules(workout, otherPrescriptions)` em `packages/db/insights/cross-prescription.ts`, retorna `[{ severity, type, message, source_tenant_id_masked, source_module }]`. **Não grava** (read-only) — gravação acontece em `prescribeWorkout` via `cross_prescription_alerts`
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
- `workout_sessions` — `id`, `tenant_id`, `prescription_id`, `member_id`, `started_at`, `finished_at nullable`, `overall_rpe int nullable` (1–10), `calculated_kcal numeric nullable` (preenchido por `calculateKcalPerSession`), `notes text`. **Particionado por TRIMESTRE** (ADR 0072 + regra 34); `@volume_estimate_yearly: 8M+` (1k tenants × 1k members × 8 sessões/mês × 12); retenção: 5 anos hot, depois agrega para `workout_sessions_summary_quarterly` (preserva total de sessões + média RPE + kcal por member×mês para gráficos longo prazo)
- `workout_session_items` — `id`, `session_id`, `workout_item_id`, `set_number int`, `reps_performed int nullable`, `weight_kg numeric nullable`, `rpe int nullable`, `done_at`. **Particionado por TRIMESTRE** seguindo a parent (`workout_sessions`); `@volume_estimate_yearly: 80M+` (10× workout_sessions); retenção 2 anos hot + agregado em `workout_session_items_summary_monthly` (max load, total volume por exercise×member×mês)
- `cross_prescription_alerts` — `id`, `tenant_id` (do tenant que prescreveu), `member_id`, `prescription_id` (da prescrição que disparou; pode ser FK polimórfica via `kind`+`ref_id`), `triggered_at timestamptz`, `severity` enum (`info`, `warning`, `critical`), `alert_type` enum (`hypoglycemia_risk`, `volume_incompatible`, `motor_restriction_violation`, `cardiac_load_excessive`, `nutrient_conflict`, `medication_interaction`), `message text`, `source_module text` (módulo de onde veio o dado conflitante: `nutricao`/`fisioterapia`/`academia`/...), `source_tenant_id` (tenant cujo dado disparou o conflito; **só identificador interno LogiFit** — UI mostra mascarado `"Outra empresa nutricional"`), `acknowledged_with_reason text nullable` (preenchido se profissional prosseguiu mesmo assim), `acknowledged_by_user_id nullable`, `acknowledged_at nullable`, `created_at`. RLS: tenant_id próprio + visível também ao paciente em `/meu/privacidade/alertas-cruzados` (transparência total). **Particionado por TRIMESTRE**; `@volume_estimate_yearly: 500k+` estimado.

**RLS:** tenant_id + scope. Biblioteca global (`tenant_id IS NULL`) liberada via policy que checa `kind=global`. `cross_prescription_alerts` adiciona policy: paciente (via member.person_id = jwt.person_id) lê próprios alertas.

## Eventos de domínio emitidos

- `exercise.created` / `exercise.updated`
- `workout.created` / `workout.new_version`
- `prescription.created` / `prescription.ended`
- `workout.session_started`
- `workout.session_completed` — `{ session_id, member_id, prescription_id, overall_rpe, duration_min }`
- `cross_prescription_alert.triggered` — `{ alert_id, member_id, severity, alert_type, source_module, by_user_id }` — Sprint 13 (régua WhatsApp) pode notificar paciente quando alerta `critical` é gerado; Sprint 06 (copilot) pode propor ajuste automático

Consumidores:
- Sprint 09 Engajamento: `workout.session_completed` pode disparar conquista "50 treinos completos"
- Fase 3 (prescrição adaptativa IA) consome RPE pra ajustar carga
- Sprint 13 WhatsApp: notifica paciente quando alerta cross-prescription `critical` foi gerado pelo profissional ("Sua nutricionista do Tenant X recomenda ajustar a dieta após o aumento de treino do Tenant Y")

## Commit (checklist)

**Treinos core:**

- [ ] Schema Drizzle: `exercises`, `workouts`, `workout_items`, `prescriptions` (polimórfico), `workout_sessions`, `workout_session_items`
- [ ] Migration: biblioteca global (tenant_id NULL) + policy apropriada
- [ ] RLS + testes
- [ ] Zod schemas em `packages/types/treinos.ts`
- [ ] Upload de vídeo para Supabase Storage bucket `exercises` com URL assinada
- [ ] Server Actions (incluindo `prescribeWorkout` + `detectCrossPrescriptionConflicts`)
- [ ] UI catálogo + player de vídeo no modal
- [ ] UI editor de workout com drag-and-drop de exercícios
- [ ] UI execução de sessão com cronômetro por descanso
- [ ] Widget "treino" em `/app/members/[id]` (slot `treino`): `{ slot: 'treino', requiredPermissions: ['prescricao.read'], requiredVertical: null, consentPurpose: null, showWhen: (m) => m.has_active_prescription }`
- [ ] Seed: 20 exercícios globais + 2 workouts prontos por tenant
- [ ] Testes unit: versionamento de workout, cálculo de duração
- [ ] Testes E2E: fluxo completo instrutor → aluno
- [ ] Feature flag `treinos_v1`
- [ ] ADR 0023 publicado

**Cross-prescrição alert (ADR 0077 + regra 42 — diferencial-chave):**

- [ ] Schema Drizzle: `cross_prescription_alerts` particionado por trimestre
- [ ] Função `evaluateCrossPrescriptionRules(workout, otherPrescriptions)` em `packages/db/insights/cross-prescription.ts` com regras canônicas:
  - `hypoglycemia_risk`: workout `estimated_kcal_burn / 7 > meal_plan.daily_kcal × 0.25` (paciente queima >25% das calorias diárias em 1 sessão)
  - `volume_incompatible`: ≥5 sessões/semana + dieta hipocalórica <1.500 kcal
  - `motor_restriction_violation`: workout contém exercício em `fisio_protocol.restricted_movements[]`
  - `cardiac_load_excessive`: workout HIIT/intensidade alta + paciente tem cardiopatia em `clinical_conditions` cross-tenant
  - (escopo MVP: 4 regras acima; expansível em Fase 2)
- [ ] Server Action `detectCrossPrescriptionConflicts` chama `getCrossTenantSummary` (Sprint 02) + `evaluateCrossPrescriptionRules` + retorna alertas — read-only, grava `patient_data_access_log` (regra 42)
- [ ] `prescribeWorkout` modificado: bloqueia se `severity='critical'` sem `acknowledgedAlerts`; salva `cross_prescription_alerts` com `acknowledged_with_reason` quando profissional força
- [ ] UI: banner amarelo/vermelho na tela de prescrição antes de "Salvar"; mostra mensagem + módulo origem mascarado ("Outra empresa nutricional"); checkbox "Estou ciente e quero prosseguir" + textarea de justificativa obrigatória pra `critical`
- [ ] UI paciente `/meu/privacidade/alertas-cruzados` (Sprint 26 entrega completo; Sprint 11 entrega placeholder com lista simples)
- [ ] Evento `cross_prescription_alert.triggered` publicado em `domain_events`
- [ ] Testes unit: cada uma das 4 regras com casos positivos/negativos
- [ ] Teste E2E cross-prescrição: paciente Maria com vínculo nutricional Tenant Ana (dieta 1.400 kcal) → personal Maria de Tenant Forma tenta HIIT 5x/semana → banner aparece → personal força com justificativa → alerta gravado → paciente vê em `/meu/privacidade/alertas-cruzados`
- [ ] i18n: catálogo das mensagens de alerta nos 3 locales (regra 27)
- [ ] Lint `cross-tenant-read-must-log` passa (regra 42)

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
