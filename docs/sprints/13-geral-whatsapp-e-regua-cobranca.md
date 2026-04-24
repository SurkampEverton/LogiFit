# Sprint 13 — Geral · WhatsApp + Régua de Cobrança

- **Área:** geral
- **Início:** planejado (depois do Sprint 12)
- **Fim planejado:** +3 semanas — **⚠️ candidato à quebra em 13a (WhatsApp outbound + régua declarativa + Resend email) + 13b (hub inbound pluggable + intent router IA + identity matcher)** se estourar (regra 9). Decisão na abertura do sprint conforme estimativa detalhada.
- **Status:** planejado
- **Item do roadmap:** #15

## Goal

Integração WhatsApp (provider abstraído) **bidirecional** (outbound + inbound) + motor de régua declarativa (cobrança, reengajamento, follow-up de lead) + **hub central de inbound com intent router e identity matcher** + templates + auditoria de mensagens. Funciona sobre `domain_events` (evento → regra → ação → delay) e sobre webhooks inbound com handlers pluggable registrados por sprints consumidores.

## Critério de aceite

- Integração WhatsApp funcional em sandbox (provider a decidir no ADR 0025)
- Também envia e-mail via Resend como canal alternativo/redundante
- Template de mensagem com variáveis (`{{member.name}}`, `{{invoice.amount}}`, `{{proposal.price}}`)
- Aprovação de template (quando exigido pela Meta para WhatsApp Business)
- Motor de régua com **DSL declarativa** (JSON): condição (evento + filtros) → ação (enviar template X via canal Y) → delay antes da próxima
- Réguas pré-prontas: "Cobrança em atraso" (D+1, D+3, D+7), "Reengajamento" (sem check-in há 15d/30d), "Follow-up lead" (sem resposta há 3d), "Confirmação de agendamento" (D-1 lembrete + D-0 confirmação para fisio/consultas), "Manutenção de equipamento" (D-7 antes da manutenção agendada), "Estoque crítico" (quando `stock.low_stock_alert` dispara), **"Lembrete de ingestão de água" (padrão nutri: 4x ao dia em horários configuráveis; opt-in)**, **"Lembrete de refeição" (horários do plano alimentar Sprint 29)**, **"Pedir diário alimentar" (semanal se paciente não registrou — Sprint 31)**, **"Comentário do profissional no diário" (Sprint 31)**, **"Exame laboratorial alterado" (consome `lab_result.alert_raised` — Sprint 30)**
- Controle por member: opt-out respeitado (não envia se `consent.marketing_messages = revoked`)
- Audit log de mensagens enviadas (canal, template, sucesso/falha, timestamp)
- Rate-limit por tenant (config) — evita spam e controle de custo
- Teste E2E: invoice fica overdue → régua D+1 dispara WhatsApp via sandbox → log gravado
- Seed: 3 templates padrão (cobrança, reengajamento, boas-vindas) + 1 régua ativa por tenant

## Dependências

- Sprint 04 (financeiro — fonte do evento `invoice.overdue`)
- Sprint 10 (vendas — eventos de lead para follow-up)
- Sprint 08 (acesso — `member.checked_in` reengajamento)
- Sprint 01b (consent — opt-out de marketing)

## Decisões tomadas / ADRs esperados

- **ADR 0025 (esperado, no sprint)** — Provider WhatsApp: Twilio Business API vs Z-API vs Meta Business API direto. Critérios: custo por conversa, risco de ban, latência de aprovação de templates. Decisão com POC no início do sprint.
- **ADR 0026 (esperado)** — Motor de régua DSL: JSON schema validado por Zod. Estrutura: `{ trigger: { event, filter }, actions: [{ delay, channel, template, fallback }], stop_on: [events] }`. Evita código custom por tenant.
- **ADR 0051 (accepted)** — WhatsApp inbound como canal multi-fluxo pluggable: hub central com identity matcher + intent router + classificador IA de anexos; sprints consumidores (15, 33, 12, 20) registram handlers próprios. Ver [ADR 0051](../decisions/0051-whatsapp-inbound-canal-multifluxo.md).

## Módulos entregues

Ver [`modulos.md` — Geral](../modulos.md#geral):

- Integração WhatsApp
- Integração email (Resend — já previsto mas consolidado aqui)
- Templates de mensagem com variáveis
- Motor de régua declarativa
- Rate-limit e opt-out

## Rotas Next.js

- `/app/mensagens/templates` — CRUD de templates + preview
- `/app/mensagens/reguas` — CRUD de réguas + editor DSL com formulário visual
- `/app/mensagens/historico` — log de mensagens enviadas com filtros
- `/app/mensagens/providers` — config do provider (API key, número, sandbox toggle)
- `/app/members/[id]/mensagens` — histórico de mensagens do member
- `/app/settings/mensagens` — rate-limit global e defaults
- `/app/settings/canais/whatsapp` (ADR 0051) — config do hub inbound multi-fluxo: lista de handlers registrados com toggle (`boleto`, `exame`, `foto-progress`, `receipt`, etc.) + identity matcher config (telefone → fallback pedir CPF) + intent router rules + log recente de classificações IA + métrica "mensagens não roteadas" para detectar gaps
- `/app/mensagens/inbound` — inbox de mensagens recebidas pendentes de ação humana (classificador sem confiança ou member não identificado)

## Server Actions + API Routes

Server Actions em `apps/web/app/mensagens/actions.ts`:

- `createTemplate(input)` / `updateTemplate` / `submitForApproval(id)` (WhatsApp)
- `createRegua(input)` / `activateRegua(id)` / `pauseRegua(id)`
- `sendMessageManual(memberId, templateId, channel)` — bypass de régua; ainda grava audit
- `optOutMember(memberId, categories[])` — adiciona em `consents` com `revoked_at`

API Routes:

- `POST /api/mensagens/webhook/whatsapp` — status callbacks do provider (entregue, lida, falhou)
- **`POST /api/mensagens/webhook/whatsapp-inbound`** — mensagens recebidas do paciente; dispara identity_matcher + intent_router + handler registrado (ver ADR 0051)
- `POST /api/mensagens/webhook/email` — webhook Resend (bounce, complaint)
- Job: `POST /api/jobs/reguas/tick` (a cada 5min) — avalia triggers pendentes e enfileira envios

## Schemas Drizzle (esperado)

Em `packages/db/schema/mensagens.ts`:

- `message_providers` — `id`, `tenant_id`, `channel` enum (`whatsapp`, `email`, `sms`), `provider text`, `credentials_encrypted jsonb`, `from_identifier text`, `sandbox bool`, `active`
- `message_templates` — `id`, `tenant_id`, `channel`, `name`, `subject text nullable` (email), `body text`, `variables text[]` (lista esperada), `approval_status` enum (`draft`, `pending`, `approved`, `rejected`) — só relevante WhatsApp, `approved_at`, `provider_template_id nullable`
- `reguas` — `id`, `tenant_id`, `name`, `description`, `trigger jsonb` (`{ event, filter }`), `actions jsonb` (array de steps), `active bool`, `created_by_user_id`, `last_run_at`, `runs_count int`
- `regua_executions` — `id`, `regua_id`, `tenant_id`, `member_id`, `trigger_event_ref uuid`, `started_at`, `finished_at nullable`, `state` enum (`running`, `completed`, `stopped_by_rule`, `failed`), `current_step int`
- `messages_sent` — `id`, `tenant_id`, `member_id`, `channel`, `provider`, `template_id`, `regua_execution_id nullable`, `sent_at`, `delivered_at nullable`, `read_at nullable`, `failed_at nullable`, `failure_reason text`, `provider_message_id text`, `cost_cents int nullable`, `variables_resolved jsonb`
- **`whatsapp_inbound_messages`** — `id`, `tenant_id`, `provider_message_id text unique`, `from_phone text`, `person_id nullable` (resolvido pelo identity matcher), `body text nullable`, `attachment_url text nullable`, `attachment_storage_path nullable`, `attachment_mime text`, `detected_intent text nullable`, `intent_confidence numeric nullable`, `handler_used text nullable`, `handler_result jsonb nullable`, `received_at`, `processed_at nullable`, `status` enum (`received`, `processing`, `handled`, `pending_confirmation`, `failed`, `rate_limited`)
- **`whatsapp_conversations`** — `id`, `tenant_id`, `person_id`, `phone`, `state` enum (`idle`, `awaiting_cpf`, `awaiting_classification_confirm`, `awaiting_dob_verification`), `context jsonb` (ex: `{ pending_attachment_url }`), `last_message_at`, `created_at`
- **`tenant_whatsapp_settings`** — `tenant_id pk`, `inbound_enabled bool`, `require_dob bool default false`, `classifier_confidence_threshold numeric default 0.80`, `intents_enabled jsonb` (lista de intents ativos), `default_handler text` (fallback quando nenhum match)

**RLS:** tenant_id + scope. Audit obrigatório (regra 5) em criação/edição de régua e template.

## Eventos de domínio emitidos

- `message.sent` — `{ message_id, channel, member_id, template }`
- `message.delivered` / `message.read` / `message.failed`
- `regua.triggered` — `{ regua_id, member_id, trigger_event }`
- `regua.execution_completed` / `regua.execution_stopped`

## Commit (checklist)

- [ ] Schema Drizzle: `message_providers`, `message_templates`, `reguas`, `regua_executions`, `messages_sent`
- [ ] RLS + audit
- [ ] Wrapper de provider abstrato em `packages/ai/messaging/provider.ts` (interface `send(to, template, vars)`) — implementações `whatsapp-twilio.ts`, `whatsapp-zapi.ts`, `email-resend.ts`
- [ ] DSL de régua validada por Zod em `packages/types/reguas.ts`
- [ ] Evaluator de régua em `packages/ai/reguas/evaluator.ts` (consome `domain_events` + enfileira steps com delay)
- [ ] Job tick a cada 5min (Vercel Cron)
- [ ] UI templates com preview variáveis substituídas
- [ ] UI réguas com editor visual (formulário → JSON) + preview do JSON
- [ ] UI histórico com filtros
- [ ] Rate-limit por tenant via Upstash Redis (reusa infra do Sprint 06)
- [ ] Respeito a opt-out (`consents`): verificação antes de enviar
- [ ] POC do provider escolhido no ADR 0025; envio real em sandbox
- [ ] **Hub inbound pluggable** em `packages/ai/whatsapp/`: `inbound-handler.ts`, `intent-router.ts`, `identity-matcher.ts`, `classifier.ts`
- [ ] **Identity matcher**: busca `persons.phone` → se match, prossegue; se não, fluxo conversacional pede CPF e atualiza `persons.phone` após validação
- [ ] **Intent router** com IA classificadora (Claude Haiku ou equivalente); confidence ≥ 80% processa automático; < 80% pergunta ao paciente com botões (1 Exame / 2 Boleto / 3 Receita / 4 Outro)
- [ ] **Default handlers** já no Sprint 13: `copilot-question.ts` (roteia texto livre para Copilot Sprint 06), `fallback-human.ts` (vira tarefa em fila para atendente humano quando não resolve)
- [ ] Handler registry com API `registerIntentHandler({ intent, handle })` — consumido por Sprints 15 (boleto), 33 (exame), 12 (foto) e 20/21 (receita)
- [ ] Templates inbound registrados: `exam.received`, `exam.published`, `boleto.received`, `identity.needed`, `classification.confirm`, etc
- [ ] Consent `whatsapp_exchange` + UI em `/meu/privacidade` para ativar/desativar
- [ ] Rate limit 10 msgs/min/telefone via Upstash Redis (reusa Sprint 06)
- [ ] Dedupe por `provider_message_id`
- [ ] UI `/app/mensagens/inbound` para operador acompanhar mensagens recebidas + intervir em pendentes/falhos
- [ ] Seed: 3 templates + 1 régua ("cobrança D+1/+3/+7")
- [ ] Testes unit do evaluator
- [ ] Testes E2E: invoice.overdue → régua → mensagem no histórico
- [ ] **Canais de notificação para `system_alerts`** (ADR 0071): worker consumer da `notification_queue` — envia email via Resend para `severity='critical'` + WhatsApp via provider escolhido (ADR 0025) para `priority='urgent'`; templates aprovados pré-cadastrados ("🔴 Alerta crítico LogiFit: {title}"); rate limit 3 msgs/hora/user; opt-in obrigatório WhatsApp por admin; canal `privacidade@logifit.com.br` recebe todos `category='security'`
- [ ] Feature flag `mensagens_v1`
- [ ] ADRs 0025 e 0026 publicados

## Stretch

- [ ] Receber mensagens inbound do WhatsApp (conversação bilateral)
- [ ] Métricas de régua: taxa de abertura, resposta, conversão (integra com Sprint 19 churn)
- [ ] Multi-provider com fallback automático (Twilio falha → tenta Z-API)
- [ ] A/B test de templates

## Log

- —

## Definition of Done

- [ ] Feature flag `mensagens_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] RLS verificada
- [ ] Opt-out respeitado comprovado em teste
- [ ] Rate-limit comprovado
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 13 → `done`
- [ ] ADRs 0025 e 0026 publicados

## Retro

- —
