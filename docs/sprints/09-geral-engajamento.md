# Sprint 09 — Geral · Engajamento (brindes, conquistas, metas)

- **Área:** geral
- **Início:** planejado (depois do Sprint 08)
- **Fim planejado:** +3 semanas
- **Status:** planejado
- **Item do roadmap:** #11

## Goal

Camada de engajamento v1 consumindo `domain_events`: catálogo de conquistas (gamification), catálogo de brindes (recompensas físicas/digitais) disparados por triggers e metas do member com progresso automático. Fecha o MVP.

## Critério de aceite

- Conquistas: catálogo configurável por tenant com **regra declarativa** (ex: `{ kind: 'checkin_count', target: 50, window_days: null }`)
- Member atinge regra → `member_achievements` ganha linha com `earned_at`; evento `achievement.earned` emitido
- Brindes: catálogo com tipo (`physical`, `digital_credit`, `service_credit`) e trigger (evento de domínio + predicate)
- Conquista concedida aciona possível brinde (via `achievement.reward_mapping`)
- Metas: member/profissional cria meta com `kind` (`weight_loss`, `frequency`, `strength_pr`, `custom`), `target_value`, `target_date`
- Progresso da meta calculado automaticamente de fontes: check-ins (frequência), antropometria (peso — Fase 3), medição manual
- Meta atingida emite `goal.reached`; vencida emite `goal.missed`
- Widgets `conquistas` e `metas` no dashboard do member (slots novos)
- Dashboard geral (Sprint 07) ganha card "top performers do mês" (stretch)
- Regras de conquista não re-disparam — idempotência via `(member_id, achievement_id)` unique
- Brinde físico tem workflow: `pending_redeem` → `shipped`/`delivered`/`cancelled`
- Teste E2E: configurar conquista "10 check-ins em 7 dias"; simular check-ins; member ganha; aciona brinde; brinde flui até `delivered`
- Teste E2E: meta de frequência atingida pelos check-ins reais do sprint 08
- Seed: 5 conquistas + 3 brindes + 2 metas-modelo por tenant

## Dependências

- Sprint 02 (member events — fonte de dados)
- Sprint 03 (agenda — check-in manual gera evento; frequência de metas)
- Sprint 04 (financeiro — cobrança paga conta como evento)
- Sprint 05 (ofertas — `digital_credit` e `service_credit` dos brindes reusam `appointment_credits` e `cashback_ledger`)
- Sprint 06 (copilot — opcional: responder "quantas conquistas me faltam?" consultando dados)
- Sprint 07 (dashboard — card "top performers" reusa tokens e componentes)
- Sprint 08 (acesso academia — check-in da catraca é gatilho principal)

## Decisões tomadas / ADRs esperados

- **ADR 0021 (esperado)** — Engajamento leve: conquistas como regras declarativas + dispatcher que consome `domain_events` e avalia predicates. Evita hard-coding de conquistas em código — cada conquista nova é linha em `achievements`, não deploy.
- **Pergunta aberta:** motor de regras — DSL própria (JSON schema), JS sandbox, ou SQL parametrizado? Decidir cedo. Começar com JSON schema simples (`kind + params`) e evoluir.

## Módulos entregues

Ver [`modulos.md` — Geral](../modulos.md#geral) (serão adicionados neste sprint):

- Conquistas (gamification leve)
- Brindes (reward catalog + grants)
- Metas (goals + progresso automático)
- Top performers (dashboard card — stretch)

## Rotas Next.js

- `/app/engajamento` — overview: conquistas, brindes pendentes, metas em andamento
- `/app/engajamento/conquistas` — catálogo + CRUD
- `/app/engajamento/brindes` — catálogo + fluxo de entrega
- `/app/engajamento/metas` — modelos de meta reutilizáveis
- `/app/members/[id]/conquistas` — conquistas do member + progresso em abertas
- `/app/members/[id]/metas` — metas ativas + histórico
- `/app/meu/conquistas` (aluno — futuro app) — ver as próprias

## Server Actions + API Routes

Server Actions em `apps/web/app/engajamento/actions.ts`:

- `createAchievement(input)` / `updateAchievement` / `archiveAchievement`
- `createRewardCatalog(input)` / `grantReward(memberId, rewardId, reason)` (manual)
- `updateRewardStatus(grantId, status)` — workflow físico
- `createGoal(memberId, kind, target, targetDate, createdBy)` / `updateGoalStatus` / `recordGoalMeasurement(goalId, value, source)`

API Routes:

- `POST /api/engajamento/dispatcher` — endpoint interno chamado pelo cross-alert dispatcher do Sprint 07 quando chegam `domain_events` relevantes. Avalia todas as regras de conquista pendentes do member.

## Schemas Drizzle (esperado)

Em `packages/db/schema/engajamento.ts`:

- `achievements` — `id`, `tenant_id`, `name`, `description`, `icon_url`, `rule jsonb` (ex: `{ kind: 'checkin_count', params: { target: 50, within_days: 30 } }`), `reward_id nullable`, `points int default 0`, `active`, `archived_at`
- `member_achievements` — `tenant_id`, `member_id`, `achievement_id`, `earned_at`, `progress jsonb`. PK `(member_id, achievement_id)` — 1 conquista por member
- `rewards_catalog` — `id`, `tenant_id`, `name`, `kind` enum (`physical`, `digital_credit`, `service_credit`), `value_ref jsonb` (ex: `{ credit_service_type: 'personal_training', quantity: 1 }` ou `{ sku: 'camiseta-m' }`), `stock_qty int nullable` (só para físico), `active`
- `reward_grants` — `id`, `tenant_id`, `member_id`, `reward_id`, `source` enum (`achievement`, `referral`, `manual`, `promotion`), `source_ref uuid nullable`, `granted_at`, `status` enum (`pending_redeem`, `redeemed`, `shipped`, `delivered`, `cancelled`), `delivered_at nullable`, `cancellation_reason nullable`
- `goals` — `id`, `tenant_id`, `member_id`, `kind` enum (`weight_loss`, `frequency`, `strength_pr`, `body_composition`, `custom`), `title`, `target_value numeric`, `target_unit text`, `current_value numeric`, `target_date date`, `status` enum (`active`, `reached`, `missed`, `abandoned`), `created_by_user_id`, `created_at`, `reached_at nullable`
- `goal_measurements` — `id`, `goal_id`, `value numeric`, `measured_at`, `source` enum (`antropometria`, `checkin_count`, `self_report`, `manual`), `source_ref uuid nullable`

**RLS:** tenant_id + scope. Conquistas e metas respeitam permission (`engajamento.read`, `engajamento.write`).

## Eventos de domínio emitidos

- `achievement.earned` — `{ achievement_id, member_id, earned_at }`
- `reward.granted` — `{ grant_id, member_id, reward_id, source }`
- `reward.status_changed` — `{ grant_id, from, to }`
- `goal.created` / `goal.reached` / `goal.missed` / `goal.abandoned`
- `goal.progress_updated` — `{ goal_id, current_value }`

## Commit (checklist)

- [ ] Schema Drizzle: `achievements`, `member_achievements`, `rewards_catalog`, `reward_grants`, `goals`, `goal_measurements`
- [ ] RLS + testes
- [ ] DSL inicial de regra (JSON schema Zod) para `achievement.rule`
- [ ] Avaliador de regra em `packages/ai/engajamento/evaluator.ts` — recebe `(rule, member_ctx)` retorna `{ matched, progress }`
- [ ] Dispatcher engatado no cross-alert dispatcher (Sprint 07): ao receber `member.checked_in`, `payment.received`, `appointment.checked_in` etc, dispara re-avaliação das regras aplicáveis do member
- [ ] Server Actions de catálogos e grants
- [ ] Workflow físico de brinde com transições válidas (state machine simples)
- [ ] Cálculo de progresso automático de metas de frequência (vindo de check-ins)
- [ ] UI `/app/engajamento/*` e `/app/members/[id]/{conquistas,metas}`
- [ ] Widget "conquistas" em `/app/members/[id]` (slot `conquistas`): últimas 3 + progresso em abertas. Metadado: `{ slot: 'conquistas', requiredPermissions: ['engajamento.read'], requiredVertical: null, consentPurpose: null, showWhen: () => true }`
- [ ] Widget "metas" em `/app/members/[id]` (slot `metas`): metas ativas com % progresso. Metadado: `{ slot: 'metas', requiredPermissions: ['engajamento.read'], requiredVertical: null, consentPurpose: null, showWhen: (m) => m.has_active_goals }`
- [ ] Seed: 5 conquistas + 3 brindes + 2 metas-modelo
- [ ] Testes unit do evaluator (matriz de regras × contextos)
- [ ] Testes E2E: conquista completa, brinde flow, meta de frequência
- [ ] Feature flag `engajamento_v1`
- [ ] ADR 0021 publicado

## Stretch

- [ ] Card "top performers do mês" no dashboard geral (Sprint 07)
- [ ] Leaderboard por unit/company (opt-in via consent para aparecer em ranking)
- [ ] Desafios temporários (ex: "quem treinar 20x em julho ganha X")
- [ ] Notificação via Resend quando conquista é ganha
- [ ] Share social "acabei de conquistar Y" (com consent, sem dado sensível)

## Log

- —

## Definition of Done

- [ ] Feature flag `engajamento_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] RLS verificada
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 09 → `done`, item #11 → `done`
- [ ] ADR 0021 publicado
- [ ] **MVP encerrado** — fechamento oficial da Fase 1
- [ ] Zero violação de regras

## Retro

- —
