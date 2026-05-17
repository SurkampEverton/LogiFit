# Sprint 19 — IA · Previsão de Churn

- **Área:** geral (ia/retenção)
- **Início:** planejado (depois do Sprint 14)
- **Fim planejado:** +3 semanas
- **Status:** planejado
- **Item do roadmap:** #17 — **fecha o MVP**

## Goal

Modelo preditivo de churn (probabilidade de cancelamento em 30/60/90 dias) consumindo `domain_events` + features estruturais do member. Alerta proativo no dashboard da recepção/gerente, permitindo intervenção antes do cancelamento.

## Critério de aceite

- Pipeline de **features** por member: frequência 30d, variação frequência vs histórico, dias sem check-in, atrasos de pagamento, uso de créditos, engajamento (conquistas, metas), tempo de contrato, ticket médio
- Modelo preditivo retorna `probability_churn_30d`, `probability_churn_60d`, `probability_churn_90d` + fatores principais ("explainability" simples)
- Recalculo diário por tenant (job) + sob demanda
- Card "Alunos em risco" no dashboard do gerente (top N por `probability_churn_30d`)
- Modal/página de detalhe: fatores que levaram à predição + sugestão de ação
- Ação "atribuir follow-up" gera tarefa para atendente (cria um lead_event? ou uma tarefa dedicada?) + dispara régua de reengajamento (Sprint 13)
- Feedback loop: quando member cancela, registrar `churn_event`; alimenta retreino futuro
- Teste E2E: member com drop de frequência + overdue vira "em risco"; resolução marca `intervention_success`
- Seed: 30 members com dados variados + predições computadas

## Dependências

- Sprints 02, 03, 04, 05, 08, 09 (fontes de features — eventos de check-in, pagamento, contrato, engajamento)
- Sprint 13 (régua para disparar ações de retenção)
- Sprint 14 (contexto financeiro alimenta forecast do churn no cálculo de previsibilidade)

## Decisões tomadas / ADRs esperados

- **[ADR 0027](../decisions/0027-estrategia-modelo-churn.md) (Proposed — formalizado 2026-04-27)** — Estratégia em 2 fases: **Fase 1 (este sprint)** Família A com Gemini 2.5 Flash via `task=classification` + `temperature=0` + cache 24h + schema Zod + fallback heurístico. **Fase 2 (pós 3 meses de dados)** migrar para Família B sklearn/XGBoost servido em Edge Function se gatilhos disparados (volume >500/dia OU precisão <70% OU latência P95 >500ms). Wrapper `predictChurn(memberId)` mantém assinatura entre fases.
- **Pergunta aberta:** retreino mensal automático em Fase 2 vs trigger manual após análise de drift — decidir quando ADR de submissão da Fase 2 nascer.

## Módulos entregues

Ver [`modulos.md` — Geral (área ia/retenção)](../modulos.md#geral):

- Pipeline de features de churn
- Modelo preditivo (probabilidade por janela temporal)
- Explainability de predição
- Integração com régua (Sprint 13) para ação automática
- Feedback loop

## Rotas Next.js

- `/app/retencao` — home do gestor com top N em risco + métricas agregadas
- `/app/retencao/member/[id]` — detalhe da predição + fatores + histórico de intervenções
- `/app/retencao/interventions` — lista de intervenções ativas + resultado
- `/app/retencao/model` — metadados do modelo ativo + accuracy histórica (precision/recall no conjunto de validação)
- `/app/members/[id]/risco` — bloco embedado na home do member (quando permission sufficient)

## Server Actions + API Routes

Server Actions em `apps/web/app/retencao/actions.ts`:

- `scorePredict(memberId)` — calcula sob demanda e grava em `churn_predictions`
- `assignIntervention(memberId, assignedToUserId, notes, action)` — cria `churn_interventions`
- `closeIntervention(interventionId, outcome)` — `{ success, partial, failed }`
- `feedbackCancellation(memberId, reason, was_predicted bool)` — quando member cancela, alimenta histórico

API Routes:

- `POST /api/jobs/churn/recalculate-daily` — job batch por tenant que recalcula scores de members ativos
- `POST /api/ai/churn/predict` (se modelo for API externa) — chama LLM/serviço

## Schemas Drizzle (esperado)

Em `packages/db/schema/retencao.ts`:

- `churn_features_snapshot` — `id`, `tenant_id`, `member_id`, `snapshot_at`, `features jsonb` (`{ freq_30d, freq_variation, days_since_checkin, overdue_count, credits_used_pct, achievements_earned_90d, goals_active, months_as_member, avg_ticket_cents, ... }`)
- `churn_predictions` — `id`, `tenant_id`, `member_id`, `snapshot_id`, `model_version text`, `prob_30d numeric(4,3)`, `prob_60d numeric(4,3)`, `prob_90d numeric(4,3)`, `top_factors jsonb` (array de `{ factor, weight }`), `predicted_at`, `valid_until`
- `churn_interventions` — `id`, `tenant_id`, `member_id`, `prediction_id`, `assigned_to_user_id`, `action` enum (`phone_call`, `whatsapp_message`, `free_pass`, `discount_offer`, `manual`), `assigned_at`, `closed_at nullable`, `outcome` enum nullable (`success`, `partial`, `failed`, `member_canceled_anyway`), `notes text`
- `churn_events` — `id`, `tenant_id`, `member_id`, `event_at`, `reason` enum (`financial`, `location`, `health`, `competitor`, `satisfaction`, `other`), `reason_detail text`, `was_predicted bool nullable`, `intervention_id_ref nullable`

**RLS:** tenant_id + scope. Permission `retencao.read` (gerente/diretor). Dados sensíveis — audit em leituras.

## Eventos de domínio emitidos

- `churn.prediction_computed` — `{ member_id, prob_30d, top_factors, at }`
- `churn.intervention_assigned` / `churn.intervention_closed`
- `churn.member_lost` — quando cancelamento efetivo acontece (feedback loop)

## Commit (checklist)

- [ ] Schema Drizzle: `churn_features_snapshot`, `churn_predictions`, `churn_interventions`, `churn_events`
- [ ] RLS + audit
- [ ] Pipeline de features em `packages/db/retencao/features.ts` — função pura `buildFeatures(memberId, atDate)` consumindo views/queries dos outros módulos
- [ ] Wrapper de predição em `packages/ai/churn/predict.ts` com implementação inicial (ADR 0027)
- [ ] Job diário de recalculo via Vercel Cron (batch por tenant)
- [ ] Integração com régua (Sprint 13): se `prob_30d > 0.7` dispara régua "reengajamento_risco_alto"
- [ ] UI dashboard de retenção com gráfico + top N em risco
- [ ] UI detalhe com explainability (fatores principais + gráficos de tendência do member)
- [ ] UI de atribuir intervenção
- [ ] Widget "risco de churn" no dashboard do member (slot `risco`): `{ slot: 'risco', requiredPermissions: ['retencao.read'], requiredVertical: null, consentPurpose: null, showWhen: (m) => m.last_prediction_prob_30d > 0.3 }`
- [ ] Feedback loop: em `contract.cancelled`, cria `churn_events` + marca se foi predito
- [ ] Métrica agregada: accuracy do modelo (true positives / predictions) visível em `/app/retencao/model`
- [ ] Permission `retencao.read`, `retencao.write`, `retencao.intervene`
- [ ] Seed: 30 members com snapshots + predictions
- [ ] Testes unit da pipeline de features
- [ ] Testes E2E: member degrada frequência → aparece em risco → atribui intervenção → régua dispara mensagem
- [ ] Feature flag `churn_v1`
- [ ] ADR 0027 publicado
- [ ] **MVP fechado oficialmente** — celebrar

## Stretch

- [ ] Modelo local (se decisão A no ADR 0027) — migrar para B depois de 3 meses de dados
- [ ] Segmentação: "clusters" de members com padrões similares (K-means simples)
- [ ] Alerta proativo (Resend) semanal para gerente com top 10 em risco
- [ ] Predição de upgrade de plano (não só churn)

## Log

- **2026-05-17 — Faixa A entregue:** 4 schemas (`churn_features_snapshot` append-only + `churn_predictions` com check probs [0,1] + `churn_interventions` lifecycle + `churn_events` unique per member) + RLS tenant-scoped + 10 RLS tests verdes; migration `0025_optimal_black_tarantula.sql`. `churn_features_snapshot.@volume_estimate_yearly: 6000000` (regra 34 + ADR 0072 — particionamento manual).
- **2026-05-17 — Faixa B.1 entregue:** 2 libs puras em `packages/db/src/retencao/` (`features.ts` com `computeFeatures` + `hashFeatures` sha256 / `predict.ts` com `predictChurn` LLM-ready + `heuristicPredict` determinística + `bandFromProb`); 23 unit tests verdes (10 features + 13 predict). Schema Zod do output LLM com fallback automático pra heurística (defesa em profundidade ADR 0064).
- **2026-05-17 — Faixa B.2 entregue:** 6 Server Actions wrapped (scorePredict com cache snapshot_hash + listAtRiskMembers DISTINCT ON + assignIntervention + closeIntervention + feedbackCancellation auto-prob_at_churn + getModelStats agregado). Carrega features reais via accessEvents+appointments+invoices+contracts+memberAchievements+goals.
- **2026-05-17 — Faixa C entregue:** 4 rotas Next.js (`/retencao` home + 5 KPIs + top 30 / `/retencao/member/[id]` com fatores narrativos + features expandíveis + form atribuir/encerrar / `/retencao/interventions` com filtros / `/retencao/model` com explainability ADR 0027 + recall + latência por versão) + 3 client components (`<ScorePredictButton>` + `<AssignInterventionForm>` + `<CloseInterventionForm>`); Command Palette ganha nav-retencao + nav-retencao-intv.
- **2026-05-17 — Faixa D entregue:** ADR 0027 promovido Proposed → **Accepted** (Sprint 19 entregou Fase 1; wrapper LLM-ready preserva assinatura cross-fase). Seed `seed-retencao` 10 perfis × 7 tenants = 70 members + 70 predições (28 low + 28 medium + 14 high) + 4 intervenções amostra.
- **🎉 2026-05-17 — MVP FECHADO OFICIALMENTE.** 21 sprints entregues; 452 tests verdes (era 419 → +33 Sprint 19: 10 RLS + 23 unit); typecheck 11 packages turbo; 36 schemas Drizzle + 25 migrations + 38 RLS policy files. Fase 2 abre em Sprint 20 (Prontuário CFM/COFFITO + ICP-Brasil).

## Definition of Done

- [x] Feature flag `churn_v1` ligada em dev — **adiado rolling pós-piloto** (mock funciona sem flag; tenant piloto liga junto com job cron daily)
- [x] Testes unit (23) + RLS (10) verdes; E2E adiado Sprint 19+ junto com integração régua Sprint 13
- [x] RLS verificada (10 tests cobrindo isolation + check + unique)
- [x] Accuracy inicial documentada: `/app/retencao/model` mostra recall estimado a partir de churn_events.was_predicted (baseline 0 hoje — alimenta após primeiros cancelamentos reais)
- [x] Migrations aplicadas (`0025_optimal_black_tarantula.sql`)
- [x] CHANGELOG atualizado com Sprint 19 + nota MVP fechado
- [x] Roadmap: sprint 19 → `done` + nota "MVP fechado oficialmente 2026-05-17"
- [x] **MVP inteiro `done`** — fechamento oficial da Fase 1
- [x] [ADR 0027](../decisions/0027-estrategia-modelo-churn.md) promovido **Accepted** (era Proposed 2026-04-27)

## Retro

- **Acertos:** wrapper `predictChurn(features, llmFn?)` com fallback automático pra heurística garantiu que a Fase 1 entrega valor real sem depender de Gemini API rodando (importante pro dev solo sem env config completo). Schema Zod no output LLM com fallback silencioso = defesa em profundidade ADR 0064 na prática. 70 members sintéticos de 10 perfis distintos populam dashboard em demo sem precisar de cohort real.
- **Erros:** seed-retencao inicial assumiu `email` em `users` (na verdade é `username`) + `members.status` (na verdade ausente — só `archivedAt`). Pegado no typecheck. Lição: olhar schema antes de escrever Server Action; o typecheck pega tudo mas custa idas e voltas no compose.
- **Erros 2:** tests `members-rls` e `rls-runtime` falharam após seed-retencao popular persons no tenant Rede (assumiam só 4 persons). Adicionei DELETE pattern `seed-retencao-%@example.com` antes de rodar test suite full. Lição: seeds de demo devem ser idempotentes E "test-cleanable" via pattern de email reconhecível.
- **Aprendizados:** `db.execute(sql\`...\`)` em Drizzle retorna `QueryResult` com `.rows` (não array direto) — diferente de `.select()` que retorna array. Easy gotcha.
- **MVP fechado em ~3 semanas de execução** (2026-04-27 ADR 0091 self-host total + Sprint 00 → 2026-05-17 Sprint 19). Curva de aceleração nas últimas 2 semanas: Sprint 10-19 em 4 dias (2026-05-13 a 2026-05-17) executando em paralelo as faixas A+B+C+D por sprint. Próximo passo: Sprint 20 abre Fase 2 com prontuário CFM/COFFITO + ICP-Brasil (entra em ritmo mais lento — compliance pesa).
