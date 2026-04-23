# Sprint 06 — Geral · Copilot base (chat IA ancorado em member)

- **Área:** geral
- **Início:** planejado (depois do Sprint 05)
- **Fim planejado:** +2 semanas
- **Status:** planejado
- **Item do roadmap:** #8

## Goal

Chat IA ancorado em contexto de um `member` selecionado — usa nome, plano, histórico de agenda/financeiro como contexto. Cache semântico para reduzir custo e rate-limit por tenant para evitar runaway bill. Copilot **consulta e sugere**, nunca prescreve (regra safety).

## Critério de aceite

- Sidepanel global (`/app/copilot`) e contextual (`/app/members/[id]/copilot`)
- Streaming SSE da resposta do modelo
- Cache semântico: segunda pergunta com similaridade >0.93 bate `ai_cache` sem chamar modelo
- Rate-limit por tenant via Upstash Redis: 100 msg/hora/tenant (configurável por plano)
- Provider plugável: Claude default, OpenAI/Gemini fallback quando erro 5xx
- Disclaimer em toda resposta: "sugestão auxiliar — profissional humano decide"
- System prompt proíbe prescrição de treino/dieta/medicação; resposta com essa intenção é truncada + log de incidente
- Contexto inclui: dados do member (nome, idade, plano ativo), últimas 5 sessões de agenda, status financeiro — **nunca** prontuário Fisio ou dieta Nutri sem `consent` ativo
- `audit_log` registra cada conversa + `consent_id` quando aplicável
- Teste E2E: cache hit retorna resposta idêntica sem incrementar gasto de tokens; rate-limit bate em 101ª chamada

## Dependências

- Sprint 02 (`members` + timeline)
- Sprint 04 (dados financeiros do member disponíveis)
- Sprint 01b (consent + audit_log)

## Decisões tomadas / ADRs esperados

- **ADR 0015 (esperado)** — Copilot: consulta/sugestão, nunca prescrição. System prompt fixo + classificador de output para detectar prescrição e bloquear.
- **Pergunta aberta:** limite de contexto — quanto da timeline incluir (últimas 5 interações? últimos 30 dias?). Decidir com análise de custo por conversa.

## Módulos entregues

Ver [`modulos.md` — Geral](../modulos.md#geral):

- Copilot chat (IA)
- Cache semântico + rate-limit

## Rotas Next.js

- `/app/copilot` — sidepanel global flutuante (componente compartilhado em layout)
- `/app/members/[id]/copilot` — conversa focada no member
- `/app/settings/copilot` — config por tenant (limite, toggle de provider)

## Server Actions + API Routes

API Routes:

- `POST /api/ai/chat` — streaming SSE; body `{ conversation_id?, message, member_id? }`; valida Zod, checa rate-limit, busca cache, monta contexto do member (com RLS do caller), chama AI SDK, salva em `ai_messages`, grava `audit_log`
- `POST /api/ai/embed` — gera embedding de uma query (uso interno para busca semântica)

Server Actions em `apps/web/app/copilot/actions.ts`:

- `newConversation(memberId?)` — cria `ai_conversations` vazia
- `rateResponse(messageId, thumbsUp | thumbsDown, comment?)` — feedback

## Schemas Drizzle (esperado)

Em `packages/db/schema/ai.ts`:

- `ai_conversations` — `id`, `tenant_id`, `user_id`, `member_id nullable`, `title`, `created_at`, `last_message_at`, `archived_at`
- `ai_messages` — `id`, `tenant_id`, `conversation_id`, `role` enum (`user`, `assistant`, `system`), `content text`, `tokens_in int`, `tokens_out int`, `model text`, `cache_hit bool`, `created_at`
- `ai_cache` — `id`, `tenant_id`, `query_embedding vector(1536)`, `query_text`, `response_text`, `model`, `hits int default 0`, `created_at`. Índice HNSW para similaridade.
- `ai_incidents` — `id`, `tenant_id`, `conversation_id`, `message_id`, `kind` enum (`prescription_detected`, `pii_leak`, `rate_limit`), `resolved bool`, `created_at` — para audit de casos bloqueados

Rate-limit é **fonte primária em Redis** (Upstash), sem tabela persistente. Contador por `tenant:day` com TTL.

**RLS:** tenant_id + `user_id = auth.uid()` nas conversas (conversa é pessoal; não compartilhada por padrão).

## Eventos de domínio emitidos

- `copilot.question_asked` — `{ conversation_id, member_id?, tokens_in, at }`
- `copilot.cache_hit` — `{ conversation_id, cache_id }`
- `copilot.rate_limited` — `{ tenant_id, user_id, at }`
- `copilot.incident` — `{ incident_id, kind, at }` — alerta PostHog/Sentry

## Commit (checklist)

- [ ] Schema Drizzle: `ai_conversations`, `ai_messages`, `ai_cache`, `ai_incidents`
- [ ] Índice HNSW em `ai_cache.query_embedding` via migration raw
- [ ] RLS em todas + testes
- [ ] Wrapper `packages/ai/chat.ts` com provider plugável (Claude → OpenAI → Gemini)
- [ ] Wrapper `packages/ai/cache.ts` (similaridade + TTL)
- [ ] Rate-limit Upstash em `packages/ai/ratelimit.ts`
- [ ] System prompt fixo em `packages/ai/prompts/copilot.ts` com guardrails
- [ ] Classificador de output (regex inicial; se sofisticar, virar ADR)
- [ ] API Route `/api/ai/chat` com SSE
- [ ] UI sidepanel com Tailwind v4 + tokens "Equilíbrio Vital"
- [ ] Widget "copilot do paciente" em `/app/members/[id]` (slot `copilot`): botão CTA abrindo conversa contextual pré-populada com `member_id` + últimas 2 perguntas resumidas. Registrar com `{ slot: 'copilot', requiredPermissions: ['copilot.use'], requiredVertical: null, consentPurpose: null, showWhen: () => true }`. Ver [modulos.md — matriz](../modulos.md#matriz-de-visibilidade-mvp--previsão-fase-23)
- [ ] Disclaimer rendered em toda bolha assistant
- [ ] Audit log por conversa, com `consent_id` quando contexto cruza módulos
- [ ] Testes: cache hit, rate-limit, classificador bloqueia prescrição
- [ ] Feature flag `copilot_v1`
- [ ] ADR 0015 publicado

## Stretch

- [ ] Export de conversa como PDF para prontuário (quando Fase 2 precisar)
- [ ] Multi-provider A/B test framework (20% tráfego em fallback para medir diferença)
- [ ] Resumo automático da conversa ao arquivar

## Log

- —

## Definition of Done

- [ ] Feature flag `copilot_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] RLS verificada (conversa privada, não vazada entre users)
- [ ] Rate-limit comprovado (101ª chamada falha)
- [ ] Classificador bloqueia pelo menos 90% dos casos de prescrição do dataset de teste
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 05 → `done`, item #8 → `done`
- [ ] Zero violação de regras

## Retro

- —
