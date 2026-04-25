# Sprint 06 — Geral · Copilot base + arquitetura IA (ADR 0064)

- **Área:** geral (fundação IA transversal)
- **Início:** planejado (depois do Sprint 05)
- **Fim planejado:** **+3-4 semanas** (escopo cresceu com ADR 0064: schemas + RAG + tasks tipadas + quota + UI + STT + tickets)
- **Status:** planejado
- **Item do roadmap:** #8

## Goal

**Entregar a arquitetura de IA completa do LogiFit (ADR 0064)** — não só Copilot, mas fundação que todos os sprints de IA posteriores consomem. Implementa:

1. **Provider default LogiFit** (Gemini 2.5 Flash via Vertex AI São Paulo) + BYOK opcional
2. **Tasks tipadas** (chat, embedding, classification, extraction, vision, transcription, reasoning)
3. **Task routing** (qual modelo pra qual task, com scope global/tenant/feature)
4. **RAG completo** (ADRs + Sprints + schema Drizzle + regulações como seed global)
5. **Cache semântico** pgvector + quota tracking mensal por tenant
6. **UI `/app/settings/ia`** (admin tenant cola BYOK opcional)
7. **White-label** do nome do assistente
8. **System prompt composto** (agent + global rules + user + RBAC + RAG)
9. **Tool calling tipado** (nunca SQL arbitrário; sempre Server Actions)
10. **Sistema mínimo de tickets** (`support_tickets` + tool `report_issue`)
11. **Copilot chat ancorado em member** (feature cliente — `/app/copilot` + `/app/members/[id]/copilot`)

Copilot **consulta e sugere**, nunca prescreve (regra safety 28). Guardrails ADR 0015 ativos.

## Critério de aceite

**Arquitetura IA (ADR 0064):**

- **7 tabelas novas:** `ai_providers`, `ai_models`, `ai_provider_configs`, `ai_task_routing`, `ai_tenant_usage`, `ai_documents`, `ai_document_chunks`, `ai_semantic_cache`
- **`ai_audit_log` particionado por mês** (ADR 0072 + regra 34) com `@volume_estimate_yearly: 30M+`; retenção 1 ano hot + 5 anos cold storage (CFM 2.454/2026 exige); job `archive-cold-partitions` exporta para Supabase Storage Parquet zstd
- **`ai_semantic_cache` com TTL 30 dias** (não particionado; LRU eviction)
- **`member_insights` (cache cross-module ADR 0070) com TTL 6-24h por insight_key** (não particionado)
- **Seed global de providers:** Gemini (Vertex AI SP — default LogiFit), Anthropic, OpenAI, Groq, Maritaca
- **Seed de modelos** com capabilities (function_calling, vision, streaming, context window, preço)
- **Seed de task routing** com Gemini 2.5 Flash como priority 100 em `chat`, `embedding`, `classification`, `extraction`, `vision`; Groq `whisper-large-v3-turbo` para `transcription`; fallback cascade OpenAI/Anthropic
- **Quota enforcement:** `ai_tenant_usage` rastreia calls/tokens/cost por mês; circuit breaker quando passar limite do plano (500/3k/10k chamadas)
- **Cache semântico:** pergunta com similarity >0.93 no embedding retorna resposta cached sem nova chamada; redução estimada 40-60% do consumo
- **Rate-limit por tenant** via Upstash Redis: 100 msg/hora/tenant como teto anti-burst (independente da quota mensal)
- **Fallback cascade automático:** default Gemini → fallback OpenAI → fallback Anthropic em caso de 429/500/timeout; audit marca `fallback_used=true`

**RAG (seed global LogiFit):**

- Job `SeedRAGSystemDocuments` no boot ingere: todos os ADRs (`docs/decisions/*.md`), todos os Sprints (`docs/sprints/*.md`), schema Drizzle (tabelas + colunas + comentários), regulações curadas (CFM 2.454, LGPD art. 11/18, TISS 4.01, CFN 599, COFFITO 414, ANVISA RDC 657/751)
- Chunking ~500 tokens com overlap 50; embedding Gemini `text-embedding-004` (768 dim)
- Hash do conteúdo detecta mudança → deleta chunks antigos + reseed
- Tenant pode subir docs próprios (`source_type='user_uploaded'`) via `/app/settings/ia/knowledge`

**BYOK opcional:**

- UI `/app/settings/ia` (role `super_admin_rede`) — admin cola API key própria de Anthropic/OpenAI/Gemini/Groq/Maritaca
- Key criptografada em `ai_provider_configs.api_key_encrypted` (AES-256-GCM, chave em `ENCRYPTION_KEY`)
- Botão "Testar" valida a key com uma chamada de eco
- BYOK ativo: bypass da quota LogiFit; tenant paga direto ao provider
- BYOK ausente: usa default LogiFit (Gemini Flash) sujeito à quota do plano

**Copilot (feature cliente):**

- Sidepanel global `/app/copilot` e contextual `/app/members/[id]/copilot`
- Streaming SSE da resposta via Vercel AI SDK
- Contexto inclui: dados do member (nome, idade, plano ativo), últimas 5 sessões de agenda, status financeiro — **nunca** prontuário Fisio ou dieta Nutri sem `consent` ativo
- Disclaimer fixo em cada resposta: "sugestão auxiliar — profissional humano decide" (regra 15)
- Guardrails ADR 0015: classificador de output detecta prescrição/diagnóstico → bloqueia + `ai_audit_log.guardrail_blocked=true`
- Tools tipadas disponíveis no agent `general`: `findMember`, `scheduleAppointment`, `findCidByDescription`, `summarizeEvolutions` (com permission check), `report_issue`
- **White-label:** nome do assistente configurável por tenant (default "Copilot")
- `ai_audit_log` registra cada turn + consent_id + guardrail_result + tokens + custo + latência

**Sistema mínimo de tickets:**

- Tabela `support_tickets (id, tenant_id, user_id, category, title, description, context jsonb, status, created_at)`
- Tool `report_issue(title, description)` — LLM pode abrir ticket com contexto rico (pergunta original, tools chamadas, SQL tentado, erro)
- UI `/app/suporte` — lista tickets do tenant + detalhe
- Notificação email para admin do tenant quando ticket aberto (Sprint 13 Resend)

**Critérios de aceite:**

- Cache hit retorna resposta idêntica sem incrementar gasto de tokens
- Rate-limit bate em 101ª chamada na mesma hora
- Quota bate no limit do plano → circuit breaker + UI "Configure BYOK" + bloqueia novas chamadas até próximo ciclo
- BYOK configurado: primeira chamada usa key do tenant, audit mostra `provider_config_id` preenchido
- Fallback automático: simulação de 429 no Gemini → próxima chamada usa OpenAI; audit registra
- RAG: pergunta "o que a CFM 2.454 diz sobre Comitê de IA?" retorna resposta com citação do ADR 0053 (seed global ingeriu)
- Tool `report_issue`: Copilot abre ticket com contexto capturado; aparece em `/app/suporte`
- White-label: tenant muda nome para "Vital AI" → hook `useAIAssistantName()` propaga; header, sidepanel, Copilot usam o novo nome

## Dependências

- Sprint 02 (`members` + timeline)
- Sprint 04 (dados financeiros do member disponíveis)
- Sprint 01b (consent + audit_log)

## Decisões tomadas / ADRs esperados

- **ADR 0015 (esperado)** — Copilot: consulta/sugestão, nunca prescrição. System prompt fixo + classificador de output para detectar prescrição e bloquear.
- [ADR 0064 — Arquitetura de IA (Gemini default + BYOK + RAG)](../decisions/0064-ia-arquitetura-gemini-default-byok-rag.md) — accepted
- **Pergunta aberta:** limite de contexto — quanto da timeline incluir (últimas 5 interações? últimos 30 dias?). Decidir com análise de custo por conversa.
- **Pergunta aberta:** chunking strategy do RAG — 500 tokens overlap 50 é padrão; pode precisar tunar para docs regulatórios longos.

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
- [ ] Wrapper `packages/ai/chat.ts` com provider plugável (Claude → OpenAI → Gemini) — **toda chamada HTTP via `safeFetch()` (ADR 0073 + regra 37)** com allowlist por adapter (`generativelanguage.googleapis.com` + `vertex.googleapis.com` para Gemini · `api.anthropic.com` · `api.openai.com` · `api.groq.com` · `chat.maritaca.ai`)
- [ ] Wrapper `packages/ai/cache.ts` (similaridade + TTL)
- [ ] Rate-limit Upstash em `packages/ai/ratelimit.ts` — sobreposto à regra 36 (rate limit global) — IA tem cap próprio adicional (20/min/user)
- [ ] System prompt fixo em `packages/ai/prompts/copilot.ts` com guardrails
- [ ] **`packages/ai/security/redact.ts` — `redactBeforeLLM(text)`** (ADR 0073 camada 5): mascara CPF/CNPJ/RG/email (mantém domínio)/telefone/endereço/cartão/PIX antes de enviar `ragChunks` ao provider; aplicado dentro de `buildSystemPrompt()`; teste unit garante que CPF "123.456.789-00" sai como "***.***.***-00"; `tenant_ai_settings.aggressive_redaction` (Enterprise) mascara também nome próprio
- [ ] **Classificador anti-prompt-injection** (ADR 0073 camada 5) detecta padrões "ignore previous instructions", "system prompt:", "you are now" → marca `ai_audit_log.injection_detected=true` + bloqueia execução de tool calling se detectado; output que repete >200 chars do system prompt = vazamento, bloqueado
- [ ] Classificador de output clínico (regex inicial; se sofisticar, virar ADR) — bloqueia "diagnóstico", "tem [doença]", "prescrever"
- [ ] **Detecção de abuso por tenant** (ADR 0073 camada 5): tenant com 10x consumo médio em 24h → `system_alerts severity=warning` + soft-block até admin LogiFit aprovar; query em `ai_tenant_usage` agrupada por dia
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
