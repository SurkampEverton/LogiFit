---
slug: nutri-agent-arquitetura
status: proposed
date: 2026-05-18
---

# ADR 0043 — Nutri-Agent IA: arquitetura especializada vs Copilot generalizado

## Contexto

Sprint 34 entrega o **Nutri-Agent IA** que cruza dados de 6 sprints (29 plano + 30 lab + 31 diário + 32 device + 33 exames + 11 treino) pra gerar sugestões de ajuste no plano alimentar, alertas de aderência, padrões de risco e resumo pré-consulta.

Decisões fundamentais:

1. **Arquitetura** — agent dedicado especializado OU usar Copilot universal (Sprint 06) com persona "nutricionista"?
2. **Onde fica o estado** — agent é stateless ou tem memória entre runs?
3. **Gatilhos** — manual / cron / event-driven?
4. **Detecção de padrões** — IA generativa ou regras curadas?

## Decisão

### 1. **Agent dedicado especializado** (não persona do Copilot universal)

Tabelas + libs puras + Server Actions dedicadas em `packages/ai/src/nutri-agent/` e `apps/web/app/app/nutri-agent/`. Não acopla ao Copilot Sprint 06 (que é conversacional de uso geral via FAB).

**Por quê especializar** (rejeitada alternativa "persona nutricionista no Copilot universal"):

- **Audit dedicado**: `nutri_agent_runs` + `nutri_agent_metrics_snapshot` + `nutri_agent_suggestions` separados de `assistant_messages` (Sprint 06) — facilita auditoria forense + LGPD provar processamento + ANVISA SaMD Classe II rastreabilidade
- **Snapshot reprodutível**: `metrics_snapshot.data_hash` permite rodar de novo a análise com input idêntico → mesmo output. Impossível com chat conversacional (state implícito)
- **Cross-module deterministic**: agent **não** é Q&A — é pipeline com input cross-module estruturado + saída tabular (suggestions[]). Copilot universal é conversacional + RAG; estilos diferentes
- **Vocabulário fixo**: pattern detector trabalha com codes canônicos (`deficit_calorico_extremo`, `overtraining_sugestivo`, etc) — copilot universal é open-ended
- **Gate Comitê IA**: ativação do agent exige `ai_committees.status='active'` (regra 13/28 CFM 2.454/2026) — Server Action própria valida; Copilot universal tem gate diferente
- **SaMD Classe II separável**: agent vai precisar de notificação ANVISA própria; Copilot é Classe I ou não-SaMD. Mistura aumenta superfície regulatória do Copilot

Sprint 34c stretch: integrar como **tool** disponível ao Copilot universal (`tools_registry`) — Copilot chama agent quando user pergunta "como está a evolução nutricional de X?". Mantém arquitetura separada + integração ortogonal.

### 2. **Stateless** entre runs (snapshot por execução)

Cada run de `runNutriAgentForMember` cria seu próprio snapshot completo. Não compartilha memória entre runs. Razões:

- **Reprodutibilidade**: rodar 2x deve dar mesmo resultado se input idêntico
- **Snapshot é audit**: `metrics_snapshot.data_hash` é evidência LGPD
- **Cache via hash**: Sprint 34b pode adicionar cache (mesmo hash + mesmo prompt = mesma sugestão; economiza custo IA)
- **Sem coupling com session**: agent roda em cron sem session de operador

State histórico vem dos dados cross-module reais (não precisa carregar conversation history).

### 3. **3 gatilhos** complementares (manual + cron + event-driven)

`nutri_agent_run_trigger` enum:

- **`manual_professional`** — nutri clica "Re-analisar" no detalhe do member
- **`pre_consult_auto`** — cron 24h antes da consulta (Sprint 34b: query `appointments` com kind='nutri' e starts_at amanhã)
- **`weekly_adherence`** — cron domingo às 06:00 SP pra cada member com plano ativo
- **`risk_event_triggered`** — domain event consumido (Sprint 34c: lab_result.published com out_of_range crítico dispara automaticamente)

Cada trigger tem janela de tolerância pra dedup (Sprint 34b: 24h entre `weekly_adherence` no mesmo member, etc).

### 4. **Catálogo curado de padrões** > IA generativa (mesma decisão Sprint 27/33)

`detectRiskPatterns` consome `MemberContextSnapshot` e roda 7 detectores curados:

- `deficit_calorico_extremo` — avg consumo 7d < 70% target
- `aderencia_baixa` — adherence média < 50%
- `overtraining_sugestivo` — HR repouso alto + sono baixo
- `risco_cardiovascular_lipidico` — LDL alto + HDL baixo
- `risco_glicemico` — glicemia ou HbA1c elevados
- `perda_peso_rapida` — trend > -1.5 kg/semana
- `fisio_workout_tensao` — CIDs ativos + alta carga de treino

Sprint 34b/c: IA Gemini Flash sugere padrões adicionais (sempre passa classifier anti-diagnóstico Sprint 33 antes de virar suggestion).

**Por quê curado primeiro** (alternativa IA-first rejeitada):

- Pattern nutricional segue racional clínico bem documentado — não-determinístico não agrega
- Auditável por nutricionista revisor (cada padrão tem evidence trail)
- Determinístico = mesmo input gera mesmo output (LGPD audit + ANVISA SaMD)
- Curadoria fica em `packages/ai/src/nutri-agent/pattern-detector.ts` versionado

## Esquema persistido

3 tabelas em `packages/db/src/schema/nutri-agent.ts`:

```
nutri_agent_runs
  id, tenant_id, member_id, triggered_by_user_id?,
  trigger (manual/pre_consult/weekly/risk_event),
  status (queued→collecting→analyzing→completed | failed | blocked),
  model_used, cost_cents, failure_reason, summary jsonb,
  queued_at, started_at, completed_at

nutri_agent_suggestions
  id, tenant_id, run_id (FK), member_id,
  kind (plan_adjustment | alert | risk_pattern | pre_consult_summary | follow_up_exam),
  severity (info | attention | critical),
  title, description, evidence jsonb, confidence,
  proposed_changes jsonb (kind='plan_adjustment'),
  target_meal_plan_id?,
  blocked_by_classifier bool, classifier_blocked_terms jsonb,
  status (pending | accepted | rejected | expired),
  reviewed_by_user_id?, reviewed_at?, rejection_reason?,
  applied_meal_plan_id? (FK pra novo meal_plan version se aceito + aplicado),
  expires_at (default 14d)

nutri_agent_metrics_snapshot (append-only)
  id, tenant_id, run_id (FK), data jsonb, data_hash, captured_at
```

Migration `0039_nutri_agent.sql`. RLS `0052_nutri_agent_rls.sql`.

## Server Actions implementadas (Sprint 34a)

`apps/web/app/app/nutri-agent/actions.ts`:

- `runNutriAgentForMember({memberId, trigger})` — gate Comitê IA → coleta snapshot via `collectMemberContext` (8 queries cross-module: persons + meal_plans + food_log_daily_summary + lab_results + consultas+cids + device_readings_daily_summary + prescriptions) → `detectRiskPatterns` + `generateSuggestionsFromPatterns` + `generatePreConsultSummary` → classifyInterpretationFields (Sprint 33 reuse) → persiste run + metrics_snapshot + suggestions com expires_at 14d
- `listSuggestions({status?, severity?, memberId?, limit})` — fila do nutri ordenada por severity → expires_at
- `acceptSuggestion({suggestionId, applyChanges?})` — status='accepted'; Sprint 34b: applyChanges aciona updateMealPlan Sprint 29
- `rejectSuggestion({suggestionId, reason})` — status='rejected' + audit
- `getPreConsultSummary({memberId})` — busca mais recente kind='pre_consult_summary'

## Consequências

✅ **Positivas:**
- Snapshot reprodutível + audit forense + LGPD trail
- Pattern detector determinístico + curado (auditável por nutri)
- Gate Comitê IA bloqueia antes de gastar IA (regra 13/28 + Sprint 01b)
- Classifier anti-diagnóstico reusa Sprint 33
- Server Action orquestra TUDO (não há código IA solto sem audit)
- Plan_adjustment com proposedChanges concreto (kcal delta) mas SEMPRE proposta (ADR 0044)

⚠️ **Trade-offs aceitos:**
- Sprint 34a usa stub determinístico — Sprint 34b conecta `resolveModelForTask('reasoning')` Vertex AI Gemini Pro pra padrões IA adicionais (sempre via catálogo + classifier)
- `collectMemberContext` faz 8 queries (otimização Sprint 34b: 1 query agregada com CTEs)
- `workoutLoad` é stub MVP (Sprint 34b: query `workout_sessions` + cálculo MET real)
- Sem cron jobs (Sprint 34b adiciona `pre_consult_auto` 24h antes + `weekly_adherence` domingo + `risk_event_triggered` consume domain_events)
- UI completa (accept/reject inline + diff visual proposedChanges) é Sprint 34b
- `acceptSuggestion.applyChanges=true` ainda não dispara updateMealPlan automaticamente — Sprint 34b

⚠️ **Decisões adiadas (Sprint 34b/c):**
- IA generativa real via `resolveModelForTask('reasoning')` Vertex AI Gemini Pro (Sprint 34b — gate Comitê IA + classifier guard + custo registrado em run.cost_cents)
- Cron jobs `pre_consult_auto` + `weekly_adherence` + consumer de domain_events `risk_event_triggered`
- `acceptSuggestion.applyChanges=true` aciona updateMealPlan Sprint 29 transacional (cria nova version + linka applied_meal_plan_id)
- Otimização `collectMemberContext` via CTE single-query (8x → 1x)
- WorkoutLoad real via `workout_sessions` + MET Sprint 11
- Consents reais em `consentsUsed[]` (LGPD audit)
- Cache via data_hash (mesmo input = pula IA + reusa suggestions)
- Notificação ANVISA SaMD Classe II antes do prod (regra 28 + ADR 0053)
- RIPD `v1.0-nutri-agent-ia.md` + DPO sign-off (regra 29 + ADR 0054)
- Feature flag `nutri_agent_v1`
- UI completa: accept/reject inline + diff visual proposedChanges + retroactive run history
- E2E Playwright (manual trigger + suggestion gerada + accept → meal_plan v+1 criado)
- Integração como tool no Copilot universal Sprint 06 (`tools_registry`)
- `/app/members/[id]/nutri-summary` (página dedicada por member com runs history + pending suggestions)

## Alternativas consideradas

| Opção | Rejeitada por |
|---|---|
| Persona "nutricionista" no Copilot universal Sprint 06 | Audit + reprodutibilidade + SaMD separation impossível com chat state implícito |
| Agent stateful entre runs (memória persistida) | Quebra reprodutibilidade + dificulta cache via data_hash |
| Apenas IA generativa (sem catálogo curado) | Não-determinístico em decisão clínica + custo + auditabilidade ruim |
| Sem gate Comitê IA | Viola regra 13/28 CFM 2.454/2026 |
| Aceitar suggestion + write direto em meal_plans sem revisão | Viola ADR 0044 (escopo deste ADR) + regra 28 supervisão humana |

## Status

Proposed — promove para **Accepted** quando Sprint 34b implementar:
- IA real Vertex AI Gemini Pro + cache por data_hash
- Cron triggers funcionais + consumer domain_events
- `acceptSuggestion.applyChanges=true` integração Sprint 29
- Notificação ANVISA + RIPD + DPO sign-off
- Feature flag em piloto com ≥10 runs reais

## Referências

- [Sprint 34 — Nutri-Agent IA](../sprints/34-nutri-agent-ia.md)
- [ADR 0044 — Política de mudanças automáticas em plano alimentar](0044-nutri-agent-politica-mudancas-plano.md) (par)
- [ADR 0053 — Conformidade CFM 2.454/2026](0053-conformidade-cfm-2454-2026-ia-saude.md)
- [ADR 0054 — LGPD art. 11 dados saúde + RIPD versionado](0054-lgpd-art11-dados-saude-ripd-versionado.md)
- [ADR 0064 — IA arquitetura Gemini default + BYOK + RAG](0064-ia-arquitetura-gemini-default-byok-rag.md)
- [ADR 0070 — Insights cross-module timeline integrada](0070-insights-cross-module-timeline-integrada.md)
- [ADR 0075 — Assistente IA universal 3 camadas + tool registry](0075-assistente-ia-universal-tres-camadas-tool-registry.md)
- [ADR 0084 — Cross-alert lesão (catálogo curado > IA, mesma decisão)](0084-cross-alert-cid-contraindicacao.md)
- [ADR 0050 — Pipeline Exames (classifier anti-diagnóstico reusado)](0050-pipeline-exames-laboratoriais.md)
- ANVISA RDC 657/2022 — SaMD Classe II
- CFM 2.454/2026 — IA em medicina + supervisão humana
- [regra 13/28 — Comitê IA + audit log](../rules.md#28-ia-samd-comite)
