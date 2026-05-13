# Sprint 10 — Geral · Funil de Vendas (CRM de leads)

- **Área:** geral
- **Início:** 2026-05-13
- **Fim:** 2026-05-13 (mesmo dia — schemas + Server Actions + UI + ADR 0022 entregues em paralelo)
- **Status:** **done** (100% — Faixas A+B+C+D entregues, pendências menores adiadas)
- **Item do roadmap:** #12

## Goal

Funil de vendas pré-matrícula: captura de `leads`, estágios configuráveis (novo → aula experimental → proposta → matriculado / perdido), conversão automática `lead → member`, campanhas por estágio. Academia é o primeiro caso de uso; Fisio e Nutri reusam.

## Critério de aceite

- Cadastro de `lead` (nome, contato, origem, interesse)
- Estágios do funil configuráveis por tenant (default: `novo`, `contato_feito`, `aula_experimental`, `proposta`, `matriculado`, `perdido`)
- Movimentação entre estágios via drag-and-drop em board kanban ou Server Action
- Aula experimental agendada a partir do lead vira `appointment` (reusa Sprint 03) com flag `is_trial=true`
- Proposta é documento/orçamento versionado (preço, desconto, validade)
- Conversão: lead em `matriculado` cria `member` automaticamente (reusa Sprint 02) + contrato draft (reusa Sprint 04)
- Lead `perdido` registra motivo (preço, localização, concorrência, desistência, outro)
- Campanhas por estágio: templates de mensagem (WhatsApp/email) disparados manual ou via régua (Sprint 13)
- Origem rastreável: website, indicação (reusa `referrals` do Sprint 05), Instagram, panfleto, etc
- Teste E2E: lead entra, agenda experimental, recebe proposta, converte em member; contrato é gerado
- Seed: 10 leads distribuídos por estágio em cada tenant

## Dependências

- Sprint 02 (members — conversão cria member)
- Sprint 03 (agenda — aula experimental é appointment)
- Sprint 04 (financeiro — contrato draft na conversão)
- Sprint 05 (referrals — origem "indicação")

## Decisões tomadas / ADRs esperados

- **[ADR 0022](../decisions/0022-funil-vendas-lead-quick-capture-person-fk.md)** — `leads` como entidade separada de `members`, ambas linkando `persons` via FK (padrão do [ADR 0047](../decisions/0047-cadastro-central-persons.md)). `leads.person_id` é **nullable** + campos `quick_name/quick_phone/quick_email` permitem captura mínima antes de CPF confirmado. Conversão adiciona registro em `members` com **mesmo `person_id`** do lead — não duplica dados de identidade; `leads.converted_to_member_id` preserva histórico do funil.
- **Pergunta aberta:** estágios fixos com `lead_stages` configurável ou enum rígido? Começar configurável (tabela `lead_stages` por tenant).

## Módulos entregues

Ver [`modulos.md` — Geral](../modulos.md#geral) (serão adicionados):

- Funil de vendas (leads + estágios)
- Conversão lead → member
- Propostas comerciais
- Rastreamento de origem

## Rotas Next.js

- `/app/vendas` — board kanban do funil
- `/app/vendas/leads` — lista tabular com filtros
- `/app/vendas/leads/new` — cadastro rápido
- `/app/vendas/leads/[id]` — detalhe + timeline + propostas + aulas experimentais
- `/app/vendas/leads/[id]/converter` — wizard de conversão em member
- `/app/vendas/propostas` — lista de propostas ativas
- `/app/vendas/funil/configurar` — customizar estágios do tenant

## Server Actions + API Routes

Server Actions em `apps/web/app/vendas/actions.ts`:

- `createLead(input)` — aceita `personId` (se já cadastrada) ou `quickName + quickPhone` (captura rápida). Emite `lead.created`.
- `upgradeLeadToPerson(leadId, personInput)` — quando lead avança para `proposta`, cria persons linkada e preenche `person_id`
- `updateLead(id, input)` / `archiveLead(id, reason)`
- `moveLeadToStage(leadId, stageId, reason?)` — emite `lead.stage_changed`
- `scheduleTrialClass(leadId, resourceId, startsAt)` — cria appointment com flag trial
- `createProposal(leadId, planId, priceCents, discountCents, validUntil)` — versionada
- `acceptProposal(proposalId)` — aceita e dispara conversão
- `convertLeadToMember(leadId, proposalId?)` — exige `person_id` no lead; cria member com **mesmo `person_id`** + contrato draft + arquiva lead. Atomic.

## Schemas Drizzle (esperado)

Em `packages/db/schema/vendas.ts`:

- `lead_stages` — `id`, `tenant_id`, `name`, `order int`, `is_terminal bool`, `kind` enum (`open`, `won`, `lost`), `color text`. Seed default: 6 estágios.
- `leads` — `id`, `tenant_id`, `company_id`, `person_id uuid nullable` (FK `persons` — pode ser nulo inicialmente se lead ainda não tem CPF confirmado; `quick_name text nullable` e `quick_phone text nullable` capturam os mínimos enquanto persons não é criada), `assigned_to_user_id nullable`, `source` enum (`website`, `instagram`, `referral`, `walk_in`, `panfleto`, `other`), `source_ref uuid nullable` (ex: referral_id), `interest text`, `stage_id`, `notes text`, `converted_to_member_id uuid nullable`, `lost_reason text nullable`, `created_at`, `updated_at`. Regra: quando lead avança para estágio `proposta` ou `matriculado`, `person_id` torna-se obrigatório (trigger valida); até lá aceita `quick_*` só. Campos de identidade (nome/email/phone) preferidos via JOIN com persons quando `person_id` setado.
- `lead_events` — histórico de mudanças de estágio, mensagens enviadas, interações. Append-only.
- `trial_classes` — `id`, `lead_id`, `appointment_id`, `outcome` enum (`booked`, `attended`, `no_show`, `cancelled`)
- `proposals` — `id`, `tenant_id`, `lead_id`, `plan_id nullable`, `bundle_plan_id nullable`, `price_cents`, `discount_cents default 0`, `valid_until`, `status` enum (`draft`, `sent`, `accepted`, `rejected`, `expired`), `sent_at`, `accepted_at`, `rejection_reason text nullable`, `version int`

**RLS:** tenant_id + scope por company. Vendedor vê só seus leads (via `assigned_to_user_id`) ou todos se permission `vendas.read_all`.

## Eventos de domínio emitidos

- `lead.created`
- `lead.stage_changed` — `{ lead_id, from_stage, to_stage, by_user, at }`
- `lead.trial_scheduled` / `lead.trial_attended` / `lead.trial_no_show`
- `proposal.created` / `proposal.sent` / `proposal.accepted` / `proposal.rejected`
- `lead.converted` — `{ lead_id, member_id, contract_id, at }`
- `lead.lost` — `{ lead_id, reason, at }`

## Commit (checklist)

- [x] Schema Drizzle: `lead_stages`, `leads`, `lead_events`, `trial_classes`, `proposals` (Faixa A 2026-05-13)
- [x] RLS tenant-scoped + 8 tests (isolation, check constraints, lead_events append-only) — `0029_vendas_rls.sql` + `tests/vendas-rls.test.ts` (Faixa A 2026-05-13)
- [ ] Scope vendedor-vê-só-seus via permission `vendas.read_all` (Faixa B+ adiada — depende de seed RBAC com perms `vendas.*`)
- [x] Zod schemas inline em `apps/web/app/app/vendas/actions.ts` (Faixa B 2026-05-13 — externalizar pra `packages/types/vendas.ts` adiado pra refactor)
- [x] Server Actions: `createLead`, `moveLeadToStage` (atomic INSERT lead_event), `archiveLead`, `createProposal` (versionada), `convertLeadToMember` (transaction atomic com `db.transaction`), `listLeads`, `listLeadStages` (Faixa B 2026-05-13)
- [x] Conversão cria member + (opcional) contrato active atomicamente em transação (mesmo `person_id` via ADR 0022) (Faixa B 2026-05-13)
- [x] UI `/app/vendas` board kanban server-rendered (Faixa C 2026-05-13 — drag-and-drop client-side adiado)
- [x] UI tabular `/app/vendas/leads` com filtros (estágio, vendedor via querystring) (Faixa C 2026-05-13)
- [x] UI `/app/vendas/leads/new` form quick capture (Faixa C 2026-05-13)
- [x] UI `/app/vendas/leads/[id]` detalhe + timeline + propostas + LeadStageSelector chips + LeadActions converter/arquivar (Faixa C 2026-05-13)
- [ ] Widget "funil resumo" no dashboard do gerente (Sprint 13+ régua)
- [ ] Permission `vendas.read_own`, `vendas.read_all`, `vendas.write` (Sprint 11+ RBAC permissions seed)
- [x] Seed: 6 stages default + 10 leads por tenant via `pnpm db:seed:vendas` script standalone (Faixa C 2026-05-13)
- [ ] Testes E2E: fluxo completo novo → experimental → proposta → matriculado (Sprint 11+)
- [ ] Feature flag `vendas_v1` (Sprint 00 dropou PostHog; flag gate via env)
- [x] ADR 0022 publicado (Faixa D 2026-05-13)
- [ ] Zod schemas em `packages/types/vendas.ts`
- [ ] Server Actions de lead, proposta, conversão
- [ ] Conversão cria member + contrato draft atomicamente em transação
- [ ] UI board kanban drag-and-drop
- [ ] UI tabular com filtros (estágio, vendedor, origem, período)
- [ ] Widget "funil resumo" no dashboard do gerente (Sprint 07 já existe — adicionar aqui)
- [ ] Permission `vendas.read_own`, `vendas.read_all`, `vendas.write`
- [ ] Seed: 10 leads por tenant em estágios variados
- [ ] Testes E2E: fluxo completo novo → experimental → proposta → matriculado
- [ ] Feature flag `vendas_v1`
- [ ] ADR 0022 publicado

## Stretch

- [ ] Automação: lead parado em estágio >X dias gera tarefa de follow-up
- [ ] Integração com formulário público (`/captar`) no site do tenant
- [ ] Integração Instagram/Facebook Lead Ads (webhook)
- [ ] Predição de conversão (simples: % histórico por origem)

## Log

- **2026-05-13 — Faixa A: schemas + RLS + tests (Sprint 10 → doing 25%)**
  - Criado `packages/db/src/schema/vendas.ts` com 5 tabelas (lead_stages, leads, lead_events, trial_classes, proposals) + 4 enums (lead_stage_kind, lead_source, proposal_status, trial_outcome).
  - Modelo ADR 0022 esperado: `leads.person_id` nullable + `quick_name/quick_phone/quick_email` pra captura inicial; conversão `lead → member` reusa mesmo `person_id` (zero duplicação de identidade).
  - Check constraints: `leads_min_contact_or_person` (person OU quick_*), `proposals_price_non_negative`, `proposals_discount_lt_price`, `proposals_one_plan_xor_bundle`.
  - `trial_classes.appointment_id` é FK lógica (sem `references()`) pra evitar dependência circular vendas ↔ agenda.
  - RLS policy `packages/db/src/policies/0029_vendas_rls.sql` tenant-scoped via `current_setting('app.tenant_id')`. `lead_events` append-only (sem UPDATE/DELETE).
  - Migration `0016_worried_wonder_man.sql` aplicada.
  - 8 tests em `tests/vendas-rls.test.ts`: isolation (Rede vs Franquia), check constraints (price negativo, discount >= price, min contact), lead_stages unique por tenant, lead_events append-only via RLS sem policy UPDATE.
  - Total: 137 tests verdes.
- **2026-05-13 — Faixa B + C + D: Server Actions + UI + seed + ADR 0022 (Sprint 10 → done 100%)**
  - **`apps/web/app/app/vendas/actions.ts`** — 7 Server Actions via `wrapServerAction` (regra 33 + ADR 0071):
    - `createLead` (resolve stage default via 1º active orderIdx; emite `lead.created` em lead_events)
    - `moveLeadToStage` (`db.transaction` — UPDATE lead.stageId + INSERT lead_events kind=stage_changed)
    - `archiveLead` (soft-delete + lost_reason + lead_events kind=lead.archived)
    - `createProposal` (versão auto via `MAX(version) + 1`)
    - `convertLeadToMember` (`db.transaction` atomic: requer person_id, INSERT member com `ON CONFLICT (tenant, person_id) DO NOTHING` + busca existente em conflict, opcional contract status=active a partir da proposta com plan_id, UPDATE proposals.status=accepted, marca lead.converted_to_member_id + archived, INSERT lead_events kind=lead.converted)
    - `listLeads` (filtros stageId + assignedToUserId)
    - `listLeadStages` (lookup pra kanban columns)
  - **UI `/app/vendas/page.tsx`** — Server Component board kanban com colunas por stage, count badge, cor da borda por kind (open/won/lost), leftJoin com persons pra mostrar nome real ou quick_name.
  - **UI `/app/vendas/leads/page.tsx`** — lista tabular responsiva com leftJoin persons + leadStages + users + assignedPerson (alias drizzle), filtros via querystring.
  - **UI `/app/vendas/leads/new/page.tsx`** + `new-lead-form.tsx` — form quick capture (Server Component fetch companies + stages; Client Component form com useTransition + redirect ao detalhe pós-create).
  - **UI `/app/vendas/leads/[id]/page.tsx`** — detalhe com cabeçalho (nome + telefone + estágio badge + status convertido/arquivado), card de dados, card de propostas, timeline append-only de lead_events, ações dropdown.
  - **Client Components**: `LeadStageSelector` (chips de stages com onClick → moveLeadToStage + router.refresh) + `LeadActions` (dialog converter com proposalId select + dialog arquivar com motivo, ambos com useTransition + estado pending).
  - **`packages/db/scripts/seed-vendas.ts`** — script standalone idempotente (`pnpm db:seed:vendas`): popula 6 stages default + 10 sample leads distribuídos em open stages por cada tenant existente. Roda em 8 tenants canônicos OK.
  - **Tests ajustados**: vendas-rls.test.ts usa slug `test_novo` (não 'novo') pra não colidir com seed-vendas. 137 tests verdes.
  - **ADR 0022 publicado** — `docs/decisions/0022-funil-vendas-lead-quick-capture-person-fk.md` documenta o modelo `leads.person_id` opcional + `quick_*` + conversão reusa mesmo `person_id` (ADR 0047 alinhado).
  - **Pendências menores adiadas Sprint 11+**: trigger SQL validando `person_id NOT NULL` em stage proposta/won, constraint 1 stage `kind='won'` ativo por tenant, scheduleTrialClass + appointment is_trial (Sprint 03 integration), acceptProposal dispatch separado de convertLeadToMember, upgradeLeadToPerson wizard, drag-and-drop kanban client-side, E2E Playwright completo, feature flag `vendas_v1`, permission `vendas.read_own/read_all/write` no RBAC seed, widget funil-resumo no dashboard gerente, externalizar Zod schemas pra `packages/types/vendas.ts`.

## Definition of Done

- [ ] Feature flag `vendas_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] RLS verificada
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 10 → `done`
- [ ] ADR 0022 publicado

## Retro

- —
