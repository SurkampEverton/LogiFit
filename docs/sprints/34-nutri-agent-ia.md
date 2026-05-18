<!-- Stub. Quando virar `doing`, expandir para o formato completo de [`_template.md`](_template.md) — Goal, Critério de aceite, Dependências, Decisões/ADRs, Módulos entregues, Rotas, Server Actions/API, Schemas Drizzle, Eventos, Commit checklist, Stretch, Log, Definition of Done. -->

# Sprint 34 — Nutri-Agent IA (cruza dados Academia + Fisio + Nutri)

- **Área:** nutri/ia
- **Início:** planejado (Fase 3, depois do Sprint 33)
- **Fim planejado:** +3 semanas
- **Status:** **done (34a core)** 2026-05-18 — backbone entregue (schemas+RLS+libs determinísticas+SAs+UI dashboard); LLM Vertex AI real + cron triggers + integração updateMealPlan + RIPD/ANVISA sign-off em Sprint 34b
- **Item do roadmap:** #36

> **Sprint 34a (core MVP)** entregue 2026-05-18. Stub anterior expandido conforme convenção em [`roadmap.md`](../roadmap.md) — agente determinístico (pattern detector curado + suggestion generator + classifier reusado Sprint 33) com gate Comitê IA. Sprint 34b promove ADRs 0043/0044 pra Accepted quando: IA Vertex AI real + cache hash + cron triggers + acceptSuggestion(applyChanges=true) integra updateMealPlan + lint `no-nutri-agent-direct-write` + RIPD DPO sign-off + notificação ANVISA Classe II + feature flag piloto ≥10 runs reais.

## Goal (rascunho)

Agente IA dedicado à nutrição que cruza:

- **Plano alimentar** (Sprint 29) + **diário alimentar** (Sprint 31)
- **Antropometria** (Sprint 12) + tendências de peso/circunferências
- **Treino** (Sprint 11) + gasto calórico via MET (ADR 0070)
- **Prontuário Fisio** (Sprint 20) — restrições, lesões, hipóteses
- **Device readings** (Sprint 32) — HR contínuo, sono, atividade
- **Lab results** (Sprint 33) — perfil lipídico, glicêmico, hormonal

Para gerar:

- Sugestões conservadoras de ajuste no plano alimentar (sempre **revisão humana obrigatória** — regra 28)
- Alertas de aderência abaixo do esperado (consome `domain_events`)
- Resumo "estado nutricional" pré-consulta para nutricionista
- Detecção de pattern de risco (ex: déficit calórico extremo + cortisol alto + sono ruim)

## Pré-requisitos

- Sprints 29, 30, 31, 32, 33 concluídos
- Comitê IA tenant cadastrado (regra 13/28) — **gate funcional bloqueia ativação sem ata**
- Classificação SaMD: provável **Classe II** (auxílio decisão clínica) — exige ANVISA notificação (procedimento em [`docs/compliance/samd-classification.md`](../compliance/samd-classification.md))
- RIPD [`v1.0-nutri-agent-ia.md`](../compliance/ripd/v1.0-nutri-agent-ia.md) — stub publicado; expandir e assinar pelo DPO antes do feature flag `nutri_agent_v1` ir a produção (regra 29 + ADR 0054 + ADR 0053 — feature classe II SaMD)
- Tabela `domain_events` deve existir e estar populada por Sprints upstream — **dono a definir quando Sprint 34 detalhar**: candidatos prováveis são Sprint 00 (infra) ou Sprint 31 (nutri diário/plano publicam eventos). Spike de 2h no kickoff de 34 confirma; se nenhum sprint a entrega, Sprint 34 cria como entrega adicional

## Decisões esperadas

- [ADR 0043](../decisions/0043-nutri-agent-arquitetura.md) (Proposed — 2026-05-18) — Arquitetura Nutri-Agent: agente especializado vs Copilot generalizado com persona "nutricionista"
- [ADR 0044](../decisions/0044-nutri-agent-politica-mudancas-plano.md) (Proposed — 2026-05-18) — Política de mudanças automáticas em plano alimentar (sempre proposta, nunca write direto)

## ADRs já fechados que se aplicam

- [ADR 0053](../decisions/0053-conformidade-cfm-2454-2026-ia-saude.md) — CFM 2.454 + classificação SaMD
- [ADR 0054](../decisions/0054-lgpd-art11-dados-saude-ripd-versionado.md) — RIPD obrigatório
- [ADR 0064](../decisions/0064-ia-arquitetura-gemini-default-byok-rag.md) — IA arquitetura
- [ADR 0070](../decisions/0070-insights-cross-module-timeline-integrada.md) — insights cross-module
- [ADR 0075](../decisions/0075-assistente-ia-universal-tres-camadas-tool-registry.md) — 3 camadas + tool registry
- [ADR 0077](../decisions/0077-passaporte-paciente-vinculo-cross-tenant.md) — passaporte cross-tenant (alcance dos dados)

## Log

- **2026-05-18 — Faixa A backbone entregue (`done (34a core)`)**
  - 3 schemas Drizzle em `packages/db/src/schema/nutri-agent.ts` (5 enums + 3 tabelas: `nutri_agent_runs` com 6 status `queued/collecting/analyzing/completed/failed/blocked` + 4 triggers `manual_professional/pre_consult_auto/weekly_adherence/risk_event_triggered` + 2 indexes incl. partial `WHERE status IN ('queued','collecting','analyzing')` pra fila ativa + CHECK `completed_consistency` (status terminal exige completedAt); `nutri_agent_suggestions` com 5 kinds `plan_adjustment/alert/risk_pattern/pre_consult_summary/follow_up_exam` + 3 severities `info/attention/critical` + 4 statuses `pending/accepted/rejected/expired` + targetMealPlanId/appliedMealPlanId FKs setNull pra mealPlans Sprint 29 + blocked_by_classifier flag + classifier_blocked_terms jsonb audit reusa Sprint 33 + expiresAt obrigatório 14d + 4 indexes incl. partial pending+severity + 2 CHECKs confidence_range 0-1 e reviewed_consistency; `nutri_agent_metrics_snapshot` append-only com `data jsonb` snapshot completo cross-module + `data_hash` SHA-256 pra reprodutibilidade + 2 indexes run+hash). Migration `0039_nutri_agent.sql`. RLS `0052_nutri_agent_rls.sql` FORCE em 3 tabelas + 8 policies (tenant scope em runs/suggestions/metrics + member portal via `app.member_id` em suggestions WHERE `status='accepted'` — paciente vê só sugestões aplicadas em plano dele; GRANT diferenciado: metrics_snapshot recebe só `SELECT, INSERT` append-only).
  - 3 libs puras em `packages/ai/src/nutri-agent/` (508 linhas totais):
    - `types.ts` (131l) — `MemberContextSnapshot` (demographics + mealPlan + diaryLast14d + workoutLoad + fisioActiveCids + labResultsRecent + deviceSummary + consentsUsed) + `DetectedRiskPattern` + `AgentSuggestion` cross-module canônicos reusando schemas Sprints 29/30/31/32/33.
    - `pattern-detector.ts` (228l) com 7 detectores curados conservadores (estratégia catálogo > IA generativa, mesmo padrão Sprint 33 detectPatterns): `checkExtremeCaloricDeficit` (avg kcal 7d / target_kcal < 0.7 → attention; < 0.5 → critical; conf 0.95), `checkLowAdherence` (avg_adherence_pct 7d < 50% → info; < 30% → attention; conf 0.92), `checkOvertrainingSuggestion` (resting_hr > 75bpm + sleep < 360min concomitantes → attention; conf 0.78), `checkCardiovascularRisk` (LDL above + HDL below outOfRange em lab_results → attention; conf 0.88), `checkGlycemicRisk` (glicose_jejum ou hba1c above outOfRange → attention; conf 0.86), `checkRapidWeightLoss` (weightTrendKgPerMonth < -6 = -1.5kg/sem → attention; conf 0.90), `checkFisioWorkoutTension` (fisio_active_cids > 0 + sessions_count ≥ 5 → info; conf 0.75). `detectRiskPatterns(snapshot)` orchestrador retorna ordenado por severityRank critical=3>attention=2>info=1.
    - `suggestion-generator.ts` (149l) — `generateSuggestionsFromPatterns(patterns, snapshot)` mapeia code→kind via `PATTERN_TO_KIND` + `computeProposedChanges` conservador (deficit_calorico_extremo: subir target pra avgKcal × 1.1; perda_peso_rapida: +200kcal target; risco_cardiovascular/glicemico/fisio_workout: sem changes específicas → profissional decide); `generatePreConsultSummary(patterns, snapshot)` gera bullet list determinística com plano ativo + diary status + CIDs fisio + exames alterados + padrões — confidence=1.0 (resumo determinístico) + severity propagada do pior padrão detectado.
  - 18 unit tests `pattern-detector.test.ts` (392l) cobrindo: deficit extremo critical < 0.5 / attention 0.5-0.7 / null > 0.7; baixa adherence info<50% / attention<30% / null≥50%; overtraining requer HR + sleep concomitantes; cardiovascular requer LDL above + HDL below ambos; glicemic ativa em glicose ou hba1c; rapid weight loss threshold -6kg/month; fisio_workout requer ≥5 sessões + CIDs ativos; orchestrator ordena por severity; vazio quando nada detectado; severityRank critical>attention>info.
  - 5 Server Actions wrapped em `apps/web/app/app/nutri-agent/actions.ts` (618 linhas):
    - `runNutriAgentForMember({memberId, trigger='manual_professional'})` — orquestra: (1) **gate Comitê IA regra 13/28** valida `ai_committees.status='active'` no tenant → cria run blocked + audit reason `comite_ia_inativo` + retorna FORBIDDEN com mensagem orientativa pra `/app/settings/compliance/comite-ia`; (2) cria run status `collecting`; (3) `collectMemberContext()` busca cross-module — demographics via `persons.birthDate/sex` + `ageYearsAt`, mealPlan ativo Sprint 29, food_log_daily_summary 14d Sprint 31, lab_results 90d com JOIN labAnalytes Sprint 30, consulta_cids signed kind='principal' fisio Sprint 20, device_readings_daily_summary 7d agregado (HR_RESTING/SLEEP_DURATION_MIN/STEPS/HRV) Sprint 32, prescriptions kind='workout' active Sprint 11 — retorna `MemberContextSnapshot` completo; (4) persiste `nutri_agent_metrics_snapshot` com data jsonb + SHA-256 hash (audit forense + reprodutibilidade — LGPD provar quais dados foram processados); (5) atualiza run `analyzing`; (6) `detectRiskPatterns` + `generateSuggestionsFromPatterns` + `generatePreConsultSummary`; (7) classifier guard `classifyInterpretationFields` (regra 28 reusa Sprint 33) em title+description de cada sugestão + insert assistant_messages.tool_calls jsonb auditável + retorna blocks); (8) persiste suggestions com `blocked_by_classifier` flag + `expires_at = now + 14d`; (9) marca run `completed` com summary jsonb (patterns_count, suggestions_count, critical, attention, blockedByClassifier); erro técnico marca run `failed` com failureReason.
    - `listSuggestions({status?, severity?, memberId?, limit?=50})` com filtros + JOIN members+persons retorna ORDER BY expiresAt ASC (urgentes primeiro).
    - `acceptSuggestion({suggestionId, applyChanges=false})` atualiza status=`accepted` + reviewed* (MVP só registra; Sprint 34b conecta `applyChanges=true` → `updateMealPlan` Sprint 29).
    - `rejectSuggestion({suggestionId, reason})` atualiza status=`rejected` + rejectionReason.
    - `getPreConsultSummary({memberId})` retorna kind=`pre_consult_summary` mais recente do member.
  - UI `/app/nutri-agent` dashboard (224 linhas) Server Component: 5 KPI cards (Pendentes, Críticas vermelho, Aceitas 30d, Runs 30d, Bloqueadas Comitê IA 30d amarelo) + nav filtros severity (Todas/critical/attention/info) + lista sugestões pendentes com card por suggestion (borderLeft 4px color-coded severity + KIND_LABEL 🍽/⚠/🩺/📋/🧪 + confidence% + expira data + member name link); empty state aponta `/app/members/[id]/nutri-summary`; nota "UI completa accept/reject inline + diff visual proposedChanges entra Sprint 34b".
  - 9 RLS + check tests em `packages/db/tests/nutri-agent-rls.test.ts` (264l) cobrindo isolation + checks + member portal access.
  - 2 ADRs **Proposed 2026-05-18**: [ADR 0043](../decisions/0043-nutri-agent-arquitetura.md) (agente especializado vs Copilot generalizado — task router resolveModelForTask + reuso classifier Sprint 33 + 4 alternativas rejeitadas); [ADR 0044](../decisions/0044-nutri-agent-politica-mudancas-plano.md) (sempre proposta nunca write direto + revisão profissional obrigatória + 3 alternativas rejeitadas).
  - **Pendências Sprint 34b/c** (não bloqueiam fechamento backbone): IA real `resolveModelForTask('reasoning')` Vertex AI Gemini Pro substitui pattern-detector determinístico em padrões não-catalogados + cache semântico via `data_hash` (mesmo input retorna mesma run); cron triggers (Vercel Cron `pre_consult_auto` 24h antes consulta agendada + `weekly_adherence` ticking domingo 06:00 SP + `risk_event_triggered` consumer `domain_events` Sprint 31 quando meal_log_reviews score baixo); `acceptSuggestion(applyChanges=true)` integra `updateMealPlan` Sprint 29 versionado via Sprint 11 pattern + lint custom `no-nutri-agent-direct-write` bloqueia commit que persista mealPlan via SA do nutri-agent; cron `expire-nutri-agent-suggestions` D+14 → status=`expired`; UI accept/reject inline + diff visual de proposedChanges + `/app/members/[id]/nutri-summary` consolidado com timeline runs + cards severity color-coded; particionamento `nutri_agent_runs` ANUAL (regra 34 — @volume 720k+/ano); permissions RBAC `nutri_agent.read`/`nutri_agent.run`/`nutri_agent.accept`/`nutri_agent.reject`; consent `cross_module_nutri_agent` cobrindo cruzamento de dados Fisio↔Nutri↔Devices; **notificação ANVISA RDC 657/2022 SaMD Classe II** antes de feature flag prod (regra 28 + ADR 0053); **RIPD `v1.0-nutri-agent-ia.md`** com DPO sign-off (regra 29 + ADR 0054 — cobre IA generativa + cruzamento cross-module + classifier + revisão humana obrigatória); feature flag `nutri_agent_v1`; E2E Playwright fluxo manual_professional + cron pre_consult_auto + gate Comitê IA inativo bloqueia; piloto ≥10 runs reais antes de promover ADRs 0043/0044 pra Accepted; stretch: tool calling LLM via tools_registry ADR 0075 + persona `nutricionista-agent` dedicada + RAG indexando guidelines SBNutri + ABRAN; reconhecimento de foto refeição Whisper-Vision.
