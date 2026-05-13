---
slug: engajamento-regras-declarativas-dsl
status: accepted
date: 2026-05-13
---

# ADR 0021 — Engajamento como regras declarativas (DSL JSON Schema)

## Contexto

Sprint 09 entrega engajamento v1: conquistas (gamification leve), brindes
(recompensas físicas/digitais) e metas (goals). 3 caminhos pra modelar a
lógica de "quando o member desbloqueou X":

### A. Hard-coded em código

```typescript
async function checkMember(memberId) {
  if (await checkinsLast30d(memberId) >= 12) grant('Frequência ouro')
  if (await paymentMonthsStreak(memberId) >= 12) grant('Cliente fiel')
  // ...
}
```

- ❌ **Cada conquista nova exige deploy** — operador tenant não pode criar
- ❌ **Acopla regras à versão do app** — rollback de deploy reverte regras
- ❌ **Difícil testar** — função fica monolítica conforme cresce
- ❌ **N+1 queries garantidas** quando rodando pra todos os members

### B. Workflow engine completo (Temporal, BullMQ + custom DSL)

- ❌ **Overkill MVP** — regras de engajamento são predicados puros, não
  workflows multi-step
- ❌ **Operadores não vão escrever workflows BPMN**
- ❌ **Custo de infra** (Temporal exige cluster próprio)

### C. DSL declarativa em jsonb com avaliador puro (escolhido)

```typescript
type AchievementRule =
  | { kind: 'checkin_count'; params: { target: number; within_days?: number } }
  | { kind: 'payment_streak'; params: { months: number } }
  | { kind: 'goal_reached'; params: { goal_kind?: string; count?: number } }
  | { kind: 'tenure_days'; params: { target: number } }
  | { kind: 'referral_count'; params: { target: number } }
```

- ✅ **Schema Zod valida no INSERT** — `achievements.rule` é jsonb mas
  Zod garante shape no Server Action `createAchievement`
- ✅ **Avaliador puro (sem hit DB)** — caller monta `MemberContext` 1×
  com agregados (checkin counts por janela, streak meses, etc), avaliador
  consome
- ✅ **Operador tenant cria via form** — UI futura `/app/engajamento/conquistas/new`
  monta jsonb conforme `kind` selecionado
- ✅ **Testável**: matriz de regras × contexts em vitest sem DB
- ✅ **Idempotente**: `member_achievements` PK composta impede re-disparo

## Decisão

Adotar **DSL declarativa** com 5 kinds canônicos MVP:

| kind | params | semântica |
|---|---|---|
| `checkin_count` | `{target, within_days?}` | N check-ins em janela (Sprint 08) |
| `payment_streak` | `{months}` | N meses consecutivos com payment.confirmed |
| `goal_reached` | `{goal_kind?, count?}` | ≥N goals atingidas (filtro opcional por kind) |
| `tenure_days` | `{target}` | Member tem cadastro há N dias |
| `referral_count` | `{target}` | N referrals convertidos (Sprint 05) |

Implementação: `packages/db/src/engajamento/evaluator.ts`:

```typescript
export function evaluateRule(
  rule: AchievementRule,
  ctx: MemberContext,
): { matched: boolean; progress: { current; target; percent } }
```

`MemberContext` é montado pelo **dispatcher cross-alert** (Sprint 07+
infrastructure já existe via `alert_subscribers` tabela). Quando chega
`member.checked_in` event, dispatcher carrega:

```typescript
const ctx: MemberContext = {
  memberId,
  checkinCounts: aggregateCheckins(memberId), // Map<window_days|'all', count>
  paymentStreakMonths: computePaymentStreak(memberId),
  goalsReachedByKind: aggregateGoalsByKind(memberId),
  tenureDays: daysSince(member.createdAt),
  referralConvertedCount: countReferralUses(memberId),
}
// Re-avalia todas achievements ativas do tenant
for (const ach of achievementsActive) {
  const { matched } = evaluateRule(ach.rule, ctx)
  if (matched) INSERT member_achievements ON CONFLICT DO NOTHING
}
```

PK composta `(member_id, achievement_id)` + ON CONFLICT garante
idempotência sem advisory locks.

### Validação Zod no INSERT

`createAchievement` Server Action valida `rule` via
`AchievementRuleSchema.safeParse()` antes do INSERT. Rule inválida →
SQLSTATE não chega — Zod retorna `VALIDATION_ERROR` no envelope ADR 0071.

Schema strict (`discriminatedUnion('kind')`) garante que só os 5 kinds
canônicos passem.

### Extensão futura

Sprint 11+ pode adicionar novos kinds:
- `strength_pr`: bench press personal record (depende workout logs Sprint 11)
- `body_composition_target`: % gordura corporal (depende avaliações Sprint 12)
- `weekly_consistency`: 5 dias com check-in por 4 semanas seguidas

Adicionar kind = adicionar entrada no `AchievementRuleSchema` discriminated
union + branch no switch do `evaluateRule`. **Sem migration**. Sem deploy
de DSL.

### Evolução pra Workflow engine

Se conquistas evoluirem pra workflows multi-step ("complete 5 metas em 3
meses → desbloqueia nivel master"), migração futura: `rule.kind = 'workflow'`
com referência a workflow_id em tabela nova `engagement_workflows`. MVP
não precisa.

## Consequências

### Positivas

- **Conquista é dado, não código**: operador tenant cadastra via UI futura;
  nunca exige deploy
- **Avaliador puro**: testável em 14 unit tests sem DB; performance previsível
- **Idempotência por PK composta**: sem advisory lock; sem complex consensus
- **Audit trail via member_achievements**: campo `progress jsonb` snapshot
  do momento do grant (debug retroativo)
- **DSL Zod validada no INSERT**: garante shape correto no banco; UI futura
  consome `AchievementRuleSchema` pra gerar form automaticamente

### Negativas

- **5 kinds fixos hoje**: cliente que quer "10 check-ins de Pilates" precisa
  Sprint 11+ adicionar parâmetro de modalidade. Aceito.
- **Avaliador precisa MemberContext completo**: caller carrega N agregados
  pra cada member event — N+1 risk se mal implementado. Mitigação: dispatcher
  Sprint 09+ Faixa C cacheia ctx 60s ou monta via single SQL com CTEs.
- **Performance grant em massa**: 1000 members × 50 achievements ativas =
  50k avaliações no boot do dispatcher. Mitigação: re-avaliação só dispara
  em **events relevantes ao kind** (ex: `checkin_count` rule re-avalia só
  no `member.checked_in`); 90% das achievements ficam idle entre check-ins.

## Migração futura

Sprint 09+ Faixa D:
- Form `/app/engajamento/conquistas/new` que gera jsonb correto por kind
- Tests E2E: criar achievement → simular checkins → verificar `member_achievements` row

Sprint 11+:
- Adicionar kinds `strength_pr`, `body_composition_target`
- Adicionar campo `modality_filter` em `checkin_count` params

## Referências

- [Sprint 09 — Engajamento](../sprints/09-geral-engajamento.md)
- [ADR 0011 — Member perfil único](0011-member-perfil-unico-cross-module.md)
- [ADR 0020 — Ofertas (rewards_catalog)](0020-ofertas-promotions-bundles-credits-referrals.md)
- `packages/db/src/engajamento/evaluator.ts` — implementação MVP + 14 unit tests
- `packages/db/src/schema/engajamento.ts` — 6 tabelas + DSL `rule jsonb`
