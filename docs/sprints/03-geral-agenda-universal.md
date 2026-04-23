# Sprint 03 — Geral · Agenda universal + modalidades Academia

- **Área:** geral (com extensão embutida Academia)
- **Início:** planejado (depois do Sprint 02)
- **Fim planejado:** +3 semanas
- **Status:** planejado
- **Item do roadmap:** #5

## Goal

Agenda universal base (recursos, slots recorrentes, agendamentos, waitlist) servindo todas as verticais. Modalidades específicas de Academia (musculação, aula coletiva, personal) entram como extensão no mesmo sprint porque Academia é o vertical do MVP.

## Critério de aceite

- Cadastro de `resources` (instrutor, sala, equipamento) por company/unit respeitando RLS
- Slot recorrente ("toda segunda 18h–19h, instrutor X, sala Y") gera `appointments` sob demanda (materialização lazy)
- Agendamento, cancelamento, reagendamento funcionam via Server Actions
- Waitlist quando slot lotado; promoção automática quando vaga abre
- Conflito de horário detectado por exclusion constraint `tstzrange` (banco rejeita, não só aplicação)
- Atualização Realtime da agenda no canal `tenant:X:company:Y:unit:Z:agenda`
- Modalidades Academia: `type ∈ {musculacao, coletiva, personal}` em `resources`; UI filtra por modalidade
- Teste E2E: dois usuários agendando o mesmo slot; um recebe conflito
- Teste E2E: slot recorrente cancelado em uma semana não afeta semanas anteriores já consumidas

## Dependências

- Sprint 01b (RBAC + scope; `unit_id` existe)
- Sprint 02 (`members` existe — agendamento referencia member)

## Decisões tomadas / ADRs esperados

- **ADR 0012 (esperado)** — Agenda como recurso + slot recorrente + materialização lazy. Slots não são linhas no banco pré-geradas; são "regras" que produzem appointments on-demand. Exclusion constraint garante unicidade no nível de banco.
- **Pergunta aberta:** política de cancelamento (cancel até X horas antes sem custo) — configurar por plano/company; fica como coluna em `plans` (Sprint 04) ou config do tenant? Decidir antes de implementar.

## Módulos entregues

Ver [`modulos.md` — Geral](../modulos.md#geral) e [Academia](../modulos.md#academia):

- Recursos agendáveis
- Slots recorrentes
- Agendamentos + waitlist
- Modalidades de Academia (extensão)

## Rotas Next.js

- `/app/agenda` — visão semanal/mensal por company/unit, filtro por modalidade/recurso
- `/app/agenda/new` — criação manual (operador)
- `/app/agenda/[appointmentId]` — detalhe + cancelar/remarcar
- `/app/resources` — lista e cadastro de recursos
- `/app/resources/[id]/schedule` — slots recorrentes do recurso
- `/app/members/[id]/agenda` — histórico + próximos agendamentos do member

## Server Actions + API Routes

Server Actions em `apps/web/app/agenda/actions.ts`:

- `createResource(input)` — instrutor/sala/equipamento
- `createRecurringSlot(resourceId, rrule, startTime, endTime, modality)` — regra tipo RFC 5545 RRULE
- `createAppointment(slotId | adhocSlot, memberId)` — com validação de conflito
- `cancelAppointment(id, reason)` — emite `appointment.cancelled`; promove waitlist
- `rescheduleAppointment(id, newSlotId)` — cancel + create atômicos em transação
- `joinWaitlist(slotId, memberId)` / `leaveWaitlist(...)`
- `checkInAppointment(id)` — manual (recepção); sem catraca ainda (Sprint 08)

Nenhuma API Route neste sprint.

## Schemas Drizzle (esperado)

Em `packages/db/schema/agenda.ts`:

- `resources` — `id`, `tenant_id`, `company_id`, `unit_id`, `type` enum (`instrutor`, `sala`, `equipamento`), `name`, `modality text nullable` (só preenchido em instrutor de Academia), `archived_at`
- `recurring_slots` — `id`, `tenant_id`, `resource_id`, `rrule text`, `start_time time`, `end_time time`, `capacity int default 1`, `active boolean`
- `appointments` — `id`, `tenant_id`, `resource_id`, `member_id`, `recurring_slot_id nullable`, `starts_at timestamptz`, `ends_at timestamptz`, `status` enum (`booked`, `cancelled`, `checked_in`, `no_show`, `completed`), `cancelled_at`, `cancelled_reason`
- `appointment_waitlist` — `id`, `tenant_id`, `recurring_slot_id`, `starts_at`, `member_id`, `created_at`. PK lógica `(recurring_slot_id, starts_at, member_id)`.

Constraint crítica em `appointments`:

```sql
EXCLUDE USING gist (
  resource_id WITH =,
  tstzrange(starts_at, ends_at, '[)') WITH &&
) WHERE (status IN ('booked', 'checked_in'))
```

Índices: `(tenant_id, starts_at)`, `(tenant_id, member_id, starts_at)`, `(resource_id, starts_at)`.

**RLS:** `tenant_id = jwt.tenant_id` + scope do operador sobre `company_id`/`unit_id` via `resources`.

## Eventos de domínio emitidos

- `appointment.booked` — `{ appointment_id, member_id, resource_id, starts_at, by_user_id, at }`
- `appointment.cancelled` — `{ appointment_id, reason, by_user_id, at }`
- `appointment.rescheduled` — `{ appointment_id, from_starts_at, to_starts_at, by_user_id, at }`
- `appointment.checked_in` — `{ appointment_id, by_user_id, at }`
- `waitlist.promoted` — `{ waitlist_id, appointment_id, member_id, at }`

Consumidor no MVP: UI via Realtime. Financeiro (Sprint 04) consome `appointment.checked_in` quando houver plano com aula avulsa.

## Commit (checklist)

- [ ] Schema Drizzle: `resources`, `recurring_slots`, `appointments`, `appointment_waitlist`
- [ ] Exclusion constraint `tstzrange` aplicada via migration SQL (Drizzle não cobre — ir para `packages/db/rls/` ou migration raw)
- [ ] RLS em todas as tabelas novas + testes nos 4 cenários
- [ ] Zod schemas + Server Actions
- [ ] Materialização lazy do slot recorrente (função utility `expandRecurring(range)`)
- [ ] Promoção automática de waitlist em `cancelAppointment`
- [ ] Canal Realtime por unit/company com filtro por scope
- [ ] UI semanal/mensal em `/app/agenda`
- [ ] Widget "agenda do paciente" em `/app/members/[id]` (slot `agenda`): próximos 3 agendamentos + frequência últimos 30d + taxa de no-show. Registrar com `{ slot: 'agenda', requiredPermissions: ['agenda.read'], requiredVertical: null, consentPurpose: null, showWhen: (m) => m.has_appointments }`. Ver [modulos.md — matriz](../modulos.md#matriz-de-visibilidade-mvp--previsão-fase-23)
- [ ] Seed: 3 recursos + 2 slots recorrentes por company de cada cenário canônico
- [ ] Testes unit + E2E (conflito simultâneo, cancelamento recorrente, waitlist)
- [ ] Feature flag `agenda_v1`
- [ ] ADR 0012 publicado

## Stretch

- [ ] Bloqueios (férias/feriados) como exceções do recurring slot
- [ ] Google Calendar read-only sync para instrutor (OAuth)
- [ ] Lembrete 1h antes do agendamento via Resend

## Log

- —

## Definition of Done

- [ ] Feature flag `agenda_v1` ligada em dev
- [ ] Testes unit + E2E verdes (conflito de horário é hard-block)
- [ ] RLS verificada
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 03 → `done`, item #5 → `done`
- [ ] Zero violação de regras

## Retro

- —
