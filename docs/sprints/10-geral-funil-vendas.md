# Sprint 10 — Geral · Funil de Vendas (CRM de leads)

- **Área:** geral
- **Início:** planejado (depois do Sprint 09)
- **Fim planejado:** +3 semanas
- **Status:** planejado
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

- **ADR 0022 (esperado)** — `leads` como entidade separada de `members`. Conversão copia dados relevantes e cria `member` novo (não transforma in-place). Histórico do lead preservado em `leads.converted_to_member_id`.
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

- `createLead(input)` / `updateLead(id, input)` / `archiveLead(id, reason)`
- `moveLeadToStage(leadId, stageId, reason?)` — emite `lead.stage_changed`
- `scheduleTrialClass(leadId, resourceId, startsAt)` — cria appointment com flag trial
- `createProposal(leadId, planId, priceCents, discountCents, validUntil)` — versionada
- `acceptProposal(proposalId)` — aceita e dispara conversão
- `convertLeadToMember(leadId, proposalId?)` — cria member + contrato draft + arquiva lead

## Schemas Drizzle (esperado)

Em `packages/db/schema/vendas.ts`:

- `lead_stages` — `id`, `tenant_id`, `name`, `order int`, `is_terminal bool`, `kind` enum (`open`, `won`, `lost`), `color text`. Seed default: 6 estágios.
- `leads` — `id`, `tenant_id`, `company_id`, `assigned_to_user_id nullable`, `full_name`, `phone`, `email`, `source` enum (`website`, `instagram`, `referral`, `walk_in`, `panfleto`, `other`), `source_ref uuid nullable` (ex: referral_id), `interest text`, `stage_id`, `notes text`, `converted_to_member_id uuid nullable`, `lost_reason text nullable`, `created_at`, `updated_at`
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

- [ ] Schema Drizzle: `lead_stages`, `leads`, `lead_events`, `trial_classes`, `proposals`
- [ ] RLS + testes (vendedor vê só seus; gerente vê todos)
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

- —

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
