# Sprint 27 — Cross · Alert lesão Fisio → ajuste no treino Academia

- **Área:** cross (fisio + academia)
- **Início:** planejado (depois do Sprint 26)
- **Fim planejado:** +2 semanas
- **Status:** planejado (futuro)
- **Item do roadmap:** #25

## Goal

Implementar o primeiro **cross-alert real** do produto: quando uma lesão é registrada no prontuário Fisio de um paciente que também é aluno da Academia do mesmo tenant, disparar alerta no instrutor responsável e **adaptar automaticamente a ficha de treino** para evitar a região lesionada — respeitando consent explícito do paciente e regra 25 (franchise bloqueia). **Entrega `cid_exercise_contraindications` (ADR 0070)** com seed global LogiFit curado (~200 contraindicações mais comuns: lombalgia, hérnia, lesão meniscal, tendinite, LCA, síndrome do impacto, etc.) + tenant pode override; função `detectContraindications(activeCids, activeWorkouts)` em `packages/db/insights/cross.ts` retorna severidade (avoid/adapt/caution) + alternativas sugeridas.

## Critério de aceite

- CID de consulta fisio (Sprint 20) com categoria relacionada a lesão dispara evento `member.injury_registered`
- Subscriber do cross-alert dispatcher (esqueleto do Sprint 07) avalia:
  - Member também é ativo na Academia? (tem contrato ativo em module academia)
  - Há consent ativo `share_injury_to_training` desse member?
  - Topology permite? (não é franchise cross-company — regra 25)
- Se todos os checks passam: dispara `member.injury_alert_issued` + notifica instrutor via régua (Sprint 13)
- **Adaptação automática do workout ativo**: baseado no CID, marca exercícios da ficha atual como "contraindicados" (exercise tem `contraindications` em metadata: grupo muscular / movimento / articulação); substitui por variação segura automaticamente
- Instrutor revisa adaptação antes de confirmar (`/app/treinos/adaptacao-pendente/[id]`)
- Paciente vê alerta no portal (Sprint 26) explicando a adaptação
- Toda operação cross-module grava `audit_log` com `consent_id` usado (regra 6 + 25)
- Teste E2E: fisio registra CID de lombalgia → alerta dispara → exercícios de agachamento pesado marcados contraindicados → instrutor vê notificação → adaptação aplicada
- Teste: mesmo fluxo sem consent → bloqueia no dispatcher
- Teste: mesmo fluxo em franchise cross-company → bloqueia (regra 25)
- **Teste E2E reforçado da regra 25**: member Maria é paciente fisio em company A (clínica); também é aluna Academia em company B da **mesma franquia** (tenant.topology='franchise'); fisio registra CID de lombalgia em company A; dispatcher deve **bloquear** o alerta **mesmo com `consent.share_injury_to_training` ativo** (regulatório CFM/COFFITO); audit grava tentativa bloqueada com `blocked_reason='regra_25_franchise_cross_company'`; instrutor em company B nunca recebe o alerta. Assert: 0 cross-alerts publicados; 1 entry em `audit_log`

## Dependências

- Sprint 07 (cross-alert dispatcher esqueleto)
- Sprint 11 (workouts + exercises com `contraindications`)
- Sprint 20 (consultas + CID)
- Sprint 13 (régua para notificação)
- Sprint 26 (portal para paciente ver alerta)
- Sprint 01b (consent framework)

## Decisões tomadas / ADRs esperados

- **ADR 0084 (esperado)** — Mapeamento CID → contraindicação de exercício. Começar com tabela `cid_exercise_contraindications` curada pela LogiFit + edit por tenant. Alternativa futura: IA infere (Copilot) — stretch. (Numeração ≥0080 conforme [roadmap §convenção fora-de-sprint](../roadmap.md) — 0033 já alocado a Sprint 15 plano de contas hierárquico.)
- **Pergunta aberta:** autonomia do sistema — adaptação automática ou só sugere e instrutor escolhe? Começar com "sugere e instrutor confirma" para evitar erros clínicos sem supervisão humana.

## Módulos entregues

Ver [`modulos.md` — Geral e Fisio](../modulos.md#geral):

- Cross-alert lesão → treino
- Mapeamento CID → contraindicações
- Adaptação sugerida de workout
- Notificação ao instrutor
- Audit trail cross-module

## Rotas Next.js

- `/app/cross/alertas` — lista de alertas ativos (gerente)
- `/app/cross/alertas/[id]` — detalhe
- `/app/treinos/adaptacao-pendente` — fila do instrutor
- `/app/treinos/adaptacao-pendente/[id]` — confirmar ou editar adaptação
- `/meu/alertas` — paciente vê alertas próprios (portal)

## Server Actions + API Routes

Server Actions em `apps/web/app/cross/actions.ts`:

- `processInjuryAlert(consultaId)` — interno, disparado pelo dispatcher
- `suggestWorkoutAdaptation(memberId, injuryCids[])` — retorna workout modificado
- `confirmAdaptation(adaptationId, byUserId)` — aplica definitivamente; cria nova versão do workout
- `overrideAdaptation(adaptationId, customChanges)` — instrutor ajusta manualmente

## Schemas Drizzle (esperado)

Em `packages/db/schema/cross.ts`:

- `cid_exercise_contraindications` — `cid_code`, `exercise_id nullable` (null = aplica pela category), `movement_pattern text nullable` (ex: `flexao_lombar`, `rotacao_joelho`), `severity` enum (`avoid`, `modify`, `caution`), `alternative_exercise_ids uuid[]`. Global + editável por tenant.
- `member_injury_alerts` — `id`, `tenant_id`, `member_id`, `source_consulta_id`, `primary_cid_code`, `status` enum (`pending_review`, `accepted`, `rejected`, `expired`), `created_at`, `reviewed_by_user_id nullable`, `reviewed_at nullable`, `expires_at`
- `workout_adaptations` — `id`, `alert_id`, `original_workout_id`, `adapted_workout_id nullable` (preenchido após confirm), `changes jsonb` (diff: exercícios removidos, adicionados, substituídos), `status` enum (`suggested`, `confirmed`, `rejected`, `manually_overridden`), `confirmed_at nullable`, `confirmed_by_user_id nullable`

**RLS:** tenant_id + scope; audit obrigatório em cada passo.

## Eventos de domínio emitidos

- `member.injury_registered` — quando consulta fisio marca CID de lesão (gatilho principal)
- `member.injury_alert_issued`
- `member.injury_alert_reviewed` — `{ alert_id, outcome: accepted|rejected }`
- `workout.adaptation_suggested` / `workout.adaptation_confirmed` / `workout.adaptation_rejected`

## Commit (checklist)

- [ ] Schema Drizzle: `cid_exercise_contraindications`, `member_injury_alerts`, `workout_adaptations`
- [ ] RLS + audit + consent validation
- [ ] Seed: ~50 mapeamentos CID → contraindicação mais comuns (lombalgia, lesão joelho, ombro, punho, tornozelo)
- [ ] Listener `consulta.signed` do Sprint 20 dispara `member.injury_registered` quando CID pertencer a categoria "lesão"
- [ ] Subscriber no cross-alert dispatcher (Sprint 07): valida consent + franchise + ativo na Academia
- [ ] Função `suggestWorkoutAdaptation` em `packages/ai/cross/adaptation.ts`
- [ ] UI fila do instrutor com diff visual (verde = adicionado, vermelho = removido)
- [ ] Integração com régua Sprint 13: "injury_alert → notificar instrutor via WhatsApp"
- [ ] Portal do paciente (Sprint 26) mostra o alerta em `/meu/alertas`
- [ ] Testes: happy path + bloqueio sem consent + bloqueio em franchise
- [ ] Feature flag `cross_alert_lesao_v1`
- [ ] ADR 0084 publicado

## Stretch

- [ ] Adaptação automática por IA (Copilot sugere substituição com base em histórico + biomecânica)
- [ ] Notificação ao nutri também (quando lesão afeta atividade e precisa ajustar dieta)
- [ ] Cross-alert inverso: meta da Academia atingida (50 treinos) notifica fisio para próxima avaliação

## Log

- —

## Definition of Done

- [ ] Feature flag `cross_alert_lesao_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] RLS + consent + franchise verificados
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 27 → `done`
- [ ] ADR 0084 publicado

## Retro

- —
