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
- [ ] RLS em todas as tabelas novas + testes nos 5 cenários
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

- **2026-05-13 (final) — Faixa C UI completa entregue 🟢 (Sprint 03 a 75%).** 4 rotas UI novas + getAppointment:
  - **`apps/web/app/app/agenda/new/page.tsx` + `new-appointment-form.tsx`** — Wizard de booking ad-hoc:
    - Server Component carrega `listResources` + `listMembers` em paralelo
    - Form Client com selects (resource + member) + inputs `date`/`time`/`time` (Início/Fim)
    - Helper `combineToIso(date, time)` converte wall-clock pra ISO UTC esperado pelo `createAppointment` (Zod `z.string().datetime()`)
    - Default sugere próxima hora cheia (60 min duração)
    - Empty state se não há recurso ou member cadastrado, com CTA pra cadastrar primeiro
    - Erros do Server Action (incluindo CONFLICT de horário do EXCLUDE constraint) renderizados via `<div role="alert">`
  - **`apps/web/app/app/agenda/[id]/page.tsx` + `appointment-actions.tsx`** — Detail page + ações:
    - Server Component carrega via novo `getAppointment` (8ª Server Action)
    - Lookup nome do recurso via `listResources(includeArchived: true)` em paralelo
    - Renderiza badge de status colorido + grid 2-col com Início/Fim/Recurso/Member + condicional Check-in/Cancelamento details
    - Link pra `/app/members/[id]` (perfil do member)
    - `<AppointmentActions>` Client component aparece só pra status `booked|checked_in`. Botões: "Fazer check-in" (verde, status booked) + "Cancelar agendamento" (vermelho, ambos status). Cancel abre form inline com input motivo opcional + confirm
  - **`apps/web/app/app/agenda/resources/page.tsx`** — Lista de recursos do tenant. Table com colunas Tipo (emoji+label), Nome, Modalidade, Status. Toggle "Mostrar arquivados" via querystring `?archived=1`. Empty state com CTA.
  - **`apps/web/app/app/agenda/resources/new/page.tsx` + `new-resource-form.tsx`** — Wizard de cadastro de recurso:
    - Server Component lookup direto via `pool.connect()` + `set_config('app.tenant_id', ...)` (sem listCompanies action ainda — Sprint 04+) pra trazer companies do tenant
    - Form Client com select Empresa + select Tipo (instrutor/sala/equipamento) + input Nome + select Modalidade (só visível para `kind=instrutor`, valores musculacao/coletiva/personal)
    - Placeholder dinâmico no input Name muda conforme tipo
  - **`apps/web/app/app/agenda/actions.ts`** ganhou **8ª Server Action `getAppointment`** — lookup por id no tenant scope, ApiException `NOT_FOUND` se não encontrar.

  **Validações:** typecheck OK; build prod ✓ — **5 rotas agenda materializadas**:
  - `/app/agenda` (186 B) — lista 7 dias
  - `/app/agenda/[id]` (1.37 kB) — detail
  - `/app/agenda/new` (1.72 kB) — novo
  - `/app/agenda/resources` (186 B) — lista recursos
  - `/app/agenda/resources/new` (1.7 kB) — novo recurso

  **Sprint 03 a 75%.** Faixa C avançada (canvas semanal canvas + drag&drop) e **Faixa D** (Realtime PG LISTEN/NOTIFY + `expandRecurring(rrule)` helper via rrule.js + widget agenda em `/app/members/[id]` slot Sprint 02 + ADR 0012 publicado) restantes.

- **2026-05-13 — Faixas B + C inicial entregues 🟢 (Sprint 03 a 50%).** Server Actions + UI básica:
  - **`apps/web/app/app/agenda/actions.ts`** — **7 Server Actions wrapped** com `wrapServerAction()` (regra 33 + audit_log):
    - `createResource(input)` — INSERT instrutor/sala/equipamento; valida via Zod
    - `listResources({ companyId?, kind?, includeArchived?, limit? })` — query filtrada com `archivedAt IS NULL` default
    - `archiveResource({ resourceId })` — soft delete
    - `createAppointment({ resourceId, memberId, startsAt, endsAt, recurringSlotId? })` — INSERT booked; **catches SQLSTATE `23P01` (exclusion_violation) → mapeia pra `CONFLICT` "horário já reservado"** (defesa em profundidade pra EXCLUDE constraint Faixa A)
    - `cancelAppointment({ appointmentId, reason? })` — **transação** que (1) marca status=cancelled (libera EXCLUDE filter), (2) busca primeiro da waitlist com `ORDER BY created_at ASC LIMIT 1`, (3) promove pra appointment + DELETE da waitlist. Tudo atômico — se INSERT falhar, ROLLBACK preserva consistência
    - `checkInAppointment({ appointmentId })` — transição `booked → checked_in` com guard `WHERE status='booked'`
    - `listAppointments({ resourceId?, memberId?, from, to, status? })` — query range por starts_at (BETWEEN); índice `appointments_tenant_starts_idx` usado
  - **`apps/web/app/app/agenda/page.tsx`** — UI lista MVP (Faixa C inicial). Renderiza próximos 7 dias em table com colunas: Início (data formatada pt-BR), Recurso (lookup via Map), Status (label + cor enum), Ações (link Detalhes). Empty state com CTA. Botões "+ Agendamento" e "Recursos" no header.
  - **`packages/ui/src/menu/menu-items.ts`** — módulo Agenda agora tem item ativo `/app/agenda` (era `items: []` TODO). Aparece no SideMenu.
  - **`apps/web/src/messages/{pt-BR,en-US,es-419}/nav.json`** — chave `nav.agenda.week` nos 3 locales.

  **Validações:** typecheck `@app/web` ✅; build prod ✓ rotas `/app/agenda` (183 B) + `/app/agenda/[id]` placeholder; lint Biome ✓ (corrigido 2 files).

  **Faixa B/C restantes (50%):**
  - Faixa C avançada: visão semanal canvas + drag&drop (calendário tipo FullCalendar custom) — adia pra Sprint 03 fechamento ou Sprint 04
  - UI `/app/agenda/new` (form criar agendamento) + `/app/agenda/[id]` (detail + cancelar/check-in)
  - UI `/app/agenda/resources` + `/app/agenda/resources/new`
  - Faixa B helper `expandRecurring(rrule, range)` — RRULE → date list (precisa lib rrule.js)
  - Faixa D: Realtime via PG LISTEN/NOTIFY + canal `tenant:X:company:Y:unit:Z:agenda` + widget agenda no `/app/members/[id]` (slot do Sprint 02) + ADR 0012 publicado

- **2026-05-12 — Faixa A entregue 🟢 (Sprint 03 a 25%).** Schemas + RLS + EXCLUDE:
  - **`packages/db/src/schema/agenda.ts`** — 4 tabelas:
    - `resources` (id, tenant_id, company_id, unit_id?, kind enum, name, modality?, instructor_user_id?, archived_at) — soft-delete; 4 indexes incluindo parcial `active_idx` para queries de não-arquivados.
    - `recurring_slots` (id, tenant_id, resource_id, rrule text, start_time, end_time, capacity int default 1, active boolean) — RFC 5545 RRULE armazenado como text; materialização lazy (Sprint 03 Faixa B helper `expandRecurring()`).
    - `appointments` (id, tenant_id, resource_id, member_id, recurring_slot_id?, starts_at tstz, ends_at tstz, status enum, cancelled_at?, cancelled_reason?, cancelled_by_user_id?, checked_in_at?, created_by_user_id?) — auditoria mínima inline; 4 indexes para queries comuns.
    - `appointment_waitlist` (id, tenant_id, recurring_slot_id, starts_at, member_id, created_at) — unique index `(recurring_slot_id, starts_at, member_id)`.
  - **2 enums Postgres**: `resource_kind` (instrutor/sala/equipamento), `appointment_status` (booked/checked_in/cancelled/no_show/completed).
  - **`packages/db/src/policies/0017_agenda_rls.sql`** — extensão `btree_gist` + **EXCLUDE constraint anti-overlap** em appointments:
    ```sql
    EXCLUDE USING gist (resource_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
      WHERE (status IN ('booked', 'checked_in'))
    ```
    Postgres rejeita dois booking ativos sobrepostos no mesmo resource — não dependemos de transação aplicação para concorrência. Status `cancelled/no_show/completed` (history) coexistem.
  - **12 RLS policies** (`resources`/`recurring_slots`/`appointments` CRUD + waitlist INSERT/DELETE only). Soft-delete via `archived_at` (resources) e `active=false` (recurring_slots). DELETE em appointments permitido para cleanup admin (audit em member_events Sprint 04+).
  - **GRANTs explícitos** pra role `logifit_app`: SELECT/INSERT/UPDATE/DELETE conforme política.
  - **migration `0008_unusual_christian_walker.sql`** gerada via Drizzle (4 tabelas + indexes + FKs + enums).
  - **`packages/db/tests/agenda-rls.test.ts`** — **7 Vitest integration tests**:
    - RLS isolamento per-tenant (Rede vê seu resource; Franquia vê 0; INSERT cross-tenant rejected)
    - EXCLUDE constraint anti-overlap (2 booked overlap → SQLSTATE 23P01; cancelled+booked coexistem; resources diferentes coexistem)
    - waitlist UPDATE retorna 0 rows (sem policy update — INSERT/DELETE only)

  **Validações:**
  - `db:rls-check` 3 regras OK em todas as tabelas (era 32, agora 36 com agenda)
  - **90 Vitest tests verdes** (era 83 — +7 agenda-rls)
  - typecheck 11/11 verde

  **Sprint 03 a 25%.** Faixas restantes:
  - **Faixa B** — Server Actions (createResource, createRecurringSlot, createAppointment, cancelAppointment, rescheduleAppointment, joinWaitlist/leaveWaitlist, checkInAppointment) + helper `expandRecurring(range)` (RRULE → date list).
  - **Faixa C** — UI `/app/agenda` visão semanal/mensal + filtros + `/app/resources` CRUD + slot wizard.
  - **Faixa D** — Realtime via PG LISTEN/NOTIFY + WS Next.js (canal `tenant:X:company:Y:unit:Z:agenda`) + widget agenda no member detail (Sprint 02 slot) + ADR 0012 publicado.

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
