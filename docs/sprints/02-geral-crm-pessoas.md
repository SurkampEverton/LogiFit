# Sprint 02 — Geral · CRM unificado (pessoas)

- **Área:** geral
- **Início:** planejado (depois do Sprint 01b)
- **Fim planejado:** +3 semanas
- **Status:** planejado
- **Item do roadmap:** #4

## Goal

Perfil único cross-module do aluno/paciente (`members`), timeline append-only (`member_events`), tags e anotações livres — base que todas as verticais (Academia, Fisio, Nutri) consomem.

## Critério de aceite

- `members` cadastrado, editado, arquivado (soft-delete) respeitando RLS de tenant + scope
- Timeline `/app/members/[id]/timeline` mostra eventos append-only ordenados por data
- Tags filtram lista `/app/members`
- Anotações livres (`member_notes`) com autoria, timestamp e visibilidade por role
- Transferência de aluno entre companies (quando `cross_company_access=true`) respeita regras 24 e 25
- Teste E2E: recepção do tenant A não vê `members` do tenant B; fisio de `unit:X` não vê `member_notes` de `unit:Y` sem scope
- Seed adicional: 5 `members` por cenário canônico (ver [multiempresa.md](../multiempresa.md))

## Dependências

- Sprint 01b (RBAC com scope + consent)
- Sprint 01a (`persons` central via [ADR 0047](../decisions/0047-cadastro-central-persons.md) — `members.person_id` FK)

## Decisões tomadas / ADRs esperados

- **ADR 0011 (esperado)** — Member como perfil único cross-module + timeline em `member_events` append-only. Tabelas específicas da vertical (prontuário fisio, antropometria nutri) referenciam `member_id` mas nunca duplicam dados básicos.
- Pergunta aberta: como detectar aluno duplicado entre companies do mesmo tenant `owned`? Candidatos: CPF (vedado por LGPD em algumas ops) ou telefone+data nascimento. Fechar antes da implementação.

## Módulos entregues

Ver [`modulos.md` — Geral](../modulos.md#geral):

- Cadastro de pessoa (`members`)
- Timeline do member (`member_events`)
- Tags e anotações livres
- **Dashboard do member (layout + 1º widget)** — `/app/members/[id]` vira container com slots para widgets; sprint 02 entrega o layout + widget "dados + timeline resumida (últimos 10 eventos)". Sprints 03/04/05/07 preenchem os outros slots.

## Rotas Next.js

- `/app/members` — lista com busca, filtro por tag/company/unit, paginação (usa view `v_members_full` com JOIN em persons)
- `/app/members/new` — wizard com `<PersonPicker>` (busca ou cria persons) + formulário de campos específicos (home_unit, family_history, notas); botão "matricular agora" continua para plano/contrato do Sprint 04
- `/app/members/[id]` — home do paciente: layout com grid de widgets. MVP do sprint 02 entrega widget "dados + tags + timeline resumida". Slots vazios com placeholder para agenda (Sprint 03), financeiro (Sprint 04), copilot (Sprint 06), acessos (Sprint 08), conquistas/metas (Sprint 09)
- `/app/members/[id]/edit` — edição
- `/app/members/[id]/timeline` — histórico completo
- `/app/members/[id]/notes` — anotações livres (com controle de visibilidade)

## Server Actions + API Routes

Server Actions (em `apps/web/app/members/actions.ts`):

- `createMember({ personId, companyId, homeUnitId, familyHistory })` — linka `persons` existente (obrigatório); se persons não existe, UI redireciona para `/app/pessoas/new`. Emite `member.created`.
- `createMemberWithPerson(personInput, memberInput)` — helper que cria persons + members em 1 transação (usado no wizard de matrícula rápida)
- `updateMember(id, patch)` — só campos específicos de member; dados de identidade editam via `/app/pessoas/[id]/edit`
- `archiveMember(id, reason)` — soft-delete do papel; persons permanece ativa (pode ter outros papéis)
- `transferMember(id, toCompanyId)` — respeitando RLS + regras 24/25; emite `member.transferred`
- `addNote(memberId, body, visibility)` — `visibility ∈ {author_only, unit, company, tenant}`
- `addTag(memberId, tag)` / `removeTag(memberId, tag)`

Todos retornam `{ ok: true, data } | { ok: false, error }`. Nenhuma API Route neste sprint (sem webhook externo).

## Schemas Drizzle (esperado)

Em `packages/db/schema/members.ts`:

- `members` — `id uuid pk`, `tenant_id uuid not null`, `person_id uuid not null` (FK `persons` do Sprint 01a — fornece nome, documento, email, phone, endereço, birth_date, sex), `company_id uuid not null`, `home_unit_id uuid`, `family_history jsonb nullable` (array de condições familiares — diabetes, hipertensão, câncer, etc; usado por Fisio Sprint 20 e Nutri Sprint 29 na anamnese), `archived_at timestamptz nullable`, timestamps. Índices: `(tenant_id, company_id)`, `(tenant_id, person_id)` unique (mesma pessoa não vira 2 members no mesmo tenant), `(tenant_id, archived_at)`. Campos de identidade (nome/CPF/email/phone) vêm via JOIN com `persons` — view `v_members_full` materializa leitura quente.
- `member_events` — `id`, `tenant_id`, `member_id`, `actor_user_id`, `kind` enum, `payload jsonb`, `at timestamptz`. Append-only (trigger proíbe UPDATE/DELETE). Partition por mês futura (começa não-particionado, avaliar em Sprint 01b).
- `member_notes` — `id`, `tenant_id`, `member_id`, `author_user_id`, `body text`, `visibility` enum, timestamps.
- `member_tags` — `tenant_id`, `member_id`, `tag text`. PK composta `(tenant_id, member_id, tag)`.

**RLS em todas:** `tenant_id = (auth.jwt() ->> 'tenant_id')::uuid` + predicados por scope de `user_roles` (ver padrão em [acesso-e-autorizacao.md](../acesso-e-autorizacao.md#camada-3--rbac-com-scope)).

## Eventos de domínio emitidos

Em `packages/types/events.ts`:

- `member.created` — `{ member_id, company_id, unit_id, by_user_id, at }`
- `member.updated` — `{ member_id, diff, by_user_id, at }`
- `member.archived` — `{ member_id, reason, by_user_id, at }`
- `member.transferred` — `{ member_id, from_company_id, to_company_id, by_user_id, at }`
- `member.note_added` — `{ member_id, note_id, visibility, by_user_id, at }`

Consumidores no MVP: timeline UI via Realtime (mesmo tenant). Fase 2+ (cross-alert) consome via subscriber.

## Commit (checklist)

- [ ] Schema Drizzle: `members`, `member_events` (append-only), `member_notes`, `member_tags`
- [ ] RLS em todas as tabelas novas, testada nos 4 cenários canônicos
- [ ] Zod schemas em `packages/types/members.ts`
- [ ] Server Actions com retorno padronizado
- [ ] Eventos publicados em `domain_events` + Realtime
- [ ] Páginas `/app/members/*` com tokens "Equilíbrio Vital"
- [ ] Layout de home do member `/app/members/[id]` com grid de widgets; slots padrão do MVP: `overview`, `agenda`, `financeiro`, `copilot`, `acessos` (+ previsão de slots futuros `prontuario`, `evolucao`, `antropometria`, `alimentar`)
- [ ] Registry em `packages/ui/members/registry.ts` exportando `registerMemberWidget(meta)` e `getWidgetsForSlot(slot, ctx)`
- [ ] Componente `<MemberWidgetSlot name="..." member={...} />` que lê do registry e filtra por 4 gates: `requiredPermissions` (role) · `requiredVertical` (tenant tem vertical ativa) · `showWhen(member)` (presença de dados) · `consentPurpose` (consent ativo quando cross-module). Ver [modulos.md — modelo de visibilidade](../modulos.md#dashboard-do-member--modelo-de-visibilidade-de-widgets)
- [ ] Registrar widget inicial do slot `overview`: `{ slot: 'overview', component: OverviewWidget, requiredPermissions: ['member.read'], requiredVertical: null, consentPurpose: null, showWhen: () => true }`
- [ ] Teste e2e: recepção vê `overview`; fisio (sem `member.read` em escopo do member) não vê; widget fantasma de slot vazio não renderiza espaço
- [ ] Seed: 5 members por cenário canônico
- [ ] Testes unit (Vitest) em `members/actions.test.ts`
- [ ] Teste E2E Playwright: isolamento tenant/scope
- [ ] Feature flag `crm_v1` (PostHog)
- [ ] ADR 0011 publicado

## Stretch

- [ ] Merge de `members` duplicados (UI + audit trail)
- [ ] Importador CSV para migração de cliente

## Log

- —

## Definition of Done

- [ ] Feature flag `crm_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] RLS verificada nos 4 cenários
- [ ] Migrations Drizzle aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 02 → `done`, item #4 → `done`
- [ ] Zero violação de regras

## Retro

- —
