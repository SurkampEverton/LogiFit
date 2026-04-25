# Sprint 06 — Geral · Assistente IA universal base + arquitetura IA (ADR 0064 + 0075)

- **Área:** geral (fundação IA transversal)
- **Início:** planejado (depois do Sprint 05)
- **Fim planejado:** **+5-6 semanas** (escopo expandido com ADR 0075: 3 camadas + universalização por papel + tool registry distribuído + Camada 3 com confirmação UI + FAB global + personas + cotas alinhadas a planos comerciais)
- **Status:** planejado
- **Item do roadmap:** #8

## Goal

**Entregar a fundação completa de IA do LogiFit + Assistente Universal de 3 camadas** — não só Copilot anchor-em-member, mas assistente acessível a **qualquer usuário em qualquer tela**, com **3 camadas de capacidade** (Help / Insight / Action), **tool registry distribuído por módulo** e **cotas alinhadas aos planos comerciais** (ADR 0066). Todos os sprints de IA posteriores consomem essa base.

**Implementa (ADR 0064 — fundação):**

1. **Provider default LogiFit** (Gemini 2.5 Flash via Vertex AI São Paulo) + BYOK opcional
2. **Tasks tipadas** (chat, embedding, classification, extraction, vision, transcription, reasoning)
3. **Task routing** (qual modelo pra qual task, com scope global/tenant/feature)
4. **RAG completo** (ADRs + Sprints + schema Drizzle + regulações como seed global)
5. **Cache semântico** pgvector + quota tracking mensal por tenant
6. **UI `/app/settings/ia`** (admin tenant cola BYOK opcional)
7. **White-label** do nome do assistente
8. **System prompt composto** (agent + persona + global rules + user + RBAC + RAG)
9. **Tool calling tipado** (nunca SQL arbitrário; sempre Server Actions)
10. **Sistema mínimo de tickets** (`support_tickets` + tool `report_issue`)

**Implementa (ADR 0075 — assistente universal):**

11. **3 camadas de capacidade** com gates progressivos:
    - **Help (RAG read-only)** — liberado por padrão, todos os papéis
    - **Insight (read data via Server Actions)** — RBAC propagado
    - **Action (write via Server Actions)** — confirmação UI obrigatória + audit reforçado
12. **7 personas** (`member`, `professional_clinical`, `professional_coach`, `admin`, `recepcao`, `super_admin`, `contador_externo`, `dpo`) com `inferPersona()` + chip switcher na UI
13. **Tool registry distribuído** — cada módulo registra suas tools via `registerAITool()` em arquivo `<modulo>/ai-tools.ts` (padrão `registerMenuItem` Sprint 00b + `search_index` regra 30)
14. **`<AssistantFAB>`** flutuante global em `<AppLayout>` (mobile bottom sheet 92vh / desktop side panel 420px) + atalho `Ctrl+/`
15. **Página dedicada `/app/assistente`** + variantes `/meu/assistente` (Portal Sprint 26) + `/app/coach/assistente` (Coach PWA ADR 0074)
16. **`<ActionConfirmDialog>`** + fluxo de proposta `proposeAction → confirm → execute` com tabela `assistant_action_proposals`
17. **Whitelist inicial de tools Write** (~9 tools seguras) + `// ai-blocked:` para Server Actions sensíveis
18. **Cotas alinhadas a planos comerciais** (ADR 0066) — Starter 500/mês, Pro 3k/mês, Business 10k/mês, Enterprise 25k/mês ou BYOK ilimitado, com soft daily cap

Assistente **consulta e sugere**, nunca prescreve (regra 28). Camada 3 nunca executa sem confirmação UI explícita do usuário humano. Guardrails ADR 0015/0073 camada 5 ativos.

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

**Assistente IA universal (ADR 0075 — feature cliente):**

- **`<AssistantFAB>`** em `<AppLayout>` (regra 31) — botão flutuante 56×56px mobile / 64×64px desktop, sempre visível em qualquer rota `/app/*`
- **`<AssistantSheet>`** — bottom sheet 92vh em mobile (drag-down fecha) / side panel 420px em desktop
- **Página dedicada `/app/assistente`** com lista de conversas + sessão ativa
- **Atalho `Ctrl+/` ou `Cmd+/`** abre o sheet em qualquer tela; `Esc` fecha
- **Streaming SSE** da resposta via Vercel AI SDK
- **Persona inferida automaticamente** via `inferPersona(user, tenant)` retornando `member | professional_clinical | professional_coach | admin | recepcao | super_admin | contador_externo | dpo`
- **Chip "Falar como: X"** sempre visível no header do sheet — user com permissions múltiplas troca persona; última escolha persiste em `tenant_assistant_personas` ou cookie
- **Personas templates** em `packages/ai/personas/*.ts`:
  - `member.ts` — tom acolhedor, sem jargão clínico, scope=self
  - `professional_clinical.ts` — técnico, classificador SaMD ativo, gate Comitê de IA (regra 28)
  - `professional_coach.ts` — operacional mobile, foco treino do dia
  - `admin.ts` — direto, scope=tenant/company, permissions amplas
  - `recepcao.ts` — operacional, scope=unit, transações comuns
  - `super_admin.ts` — estratégico, scope=group, cross-company só com `franchise_agreements`
  - `contador_externo.ts` — read-only fiscal
  - `dpo.ts` — compliance, auditoria
- **Contexto injetado** automaticamente conforme rota:
  - `/app/members/[id]/*` → member ativo no contexto + tools filtradas por scope=member
  - `/app/financeiro/*` → tools financeiras priorizadas
  - `/app/coach/sessao/[id]` → workout em curso no contexto (ADR 0074)
- **Cross-link com busca global** (ADR 0062): no Command Palette `Ctrl+K` aparece "Não achou? Pergunte ao assistente →"
- Disclaimer fixo em cada resposta clínica: "sugestão auxiliar — profissional humano decide" (regra 28)
- Guardrails ADR 0015 + ADR 0073 camada 5: classificador de output detecta prescrição/diagnóstico → bloqueia + `ai_audit_log.guardrail_blocked=true`
- **White-label:** nome do assistente configurável por tenant (default "Copilot"); hook `useAIAssistantName()`
- `ai_audit_log` registra cada turn + persona + layer + tool_keys + action_proposal_id + consent_id + guardrail_result + tokens + custo + latência

**3 camadas + framework de ações:**

| Camada | Capacidade | Gate | Confirma UI? |
|---|---|---|---|
| **1. Help** (RAG) | "Como faço X?", "O que significa Y?" | Default todos | Não |
| **2. Insight** (read) | "Qual minha mensalidade?", "Última avaliação João" | RBAC + RLS via Server Action read-only | Não |
| **3. Action** (write) | "Cancela aula amanhã", "Cria lead João" | RBAC + `<ActionConfirmDialog>` + audit | **Sim sempre** |

**Fluxo Camada 3 (proposta → confirmação → execução):**

1. LLM emite tool call `proposeAction({ tool, args, reason })`
2. Backend insere em `assistant_action_proposals` (state=`pending`, expira 5min) e retorna `{ proposalId, confirmationCopy: { title, description, impact, affectedEntities } }`
3. Frontend renderiza `<ActionConfirmDialog>` mostrando o que vai acontecer + botões `[Confirmar] [Editar args] [Cancelar]`
4. User confirma → `POST /api/ai/proposals/{id}/confirm` valida estado + chama handler real (Server Action wrapAction)
5. Handler verifica `actionSource='ai_assistant'` ⇒ exige `proposalId` confirmado existente em `assistant_action_proposals` (proteção dupla — LLM não pode chamar handler bypassando UI)
6. Audit log registra com `action_source='ai_assistant'` + `proposal_id` + decisão humana

**Tool registry distribuído** (ADR 0075 + futura regra 41):

- Cada módulo cria `apps/web/app/(modules)/<modulo>/ai-tools.ts` chamando `registerAITool({...})` para cada Server Action exposta ao LLM
- Boot da app (e refresh ao deploy) carrega manifest e popula `tools_registry`
- Server Action que **não** deve ser exposta tem comentário literal `// ai-blocked: <motivo>` no topo; lint custom `ai-block-respected` em CI bloqueia commit se `registerAITool` aponta para handler bloqueado
- Lookup runtime: ao montar system prompt, LLM recebe **só tools disponíveis** (`whenAvailable({user})` retorna true + `showInPersonas` inclui persona ativa)
- Reduz tokens (10-15 tools enviadas em vez de 200) e força segurança em camada de prompt

**Tools no agent `assistant` (whitelist inicial MVP — Camada 1/2/3):**

| Persona | Tool | Camada | Confirma? |
|---|---|---|---|
| todos | `searchHelp(query)` | 1 (RAG) | — |
| todos | `report_issue(title, description)` | 3 | sim |
| `member` | `getMyAppointments(from, to)` | 2 | — |
| `member` | `getMyInvoices(status)` | 2 | — |
| `member` | `cancelMyAppointment(id)` | 3 | sim |
| `member` | `requestSecondCopy(invoiceId)` | 3 | sim |
| `member` | `confirmAppointment(id)` | 3 | sim |
| `professional_*` | `findMember(query)` | 2 | — |
| `professional_*` | `summarizeEvolutions(memberId, limit)` | 2 | — |
| `professional_*` | `findCidByDescription(text)` | 1 | — |
| `professional_clinical` | `createDraftEvolution(memberId, content)` | 3 | sim |
| `professional_coach` | `getNextStudent()` | 2 | — |
| `professional_coach` | `getLastWorkoutMetrics(memberId)` | 2 | — |
| `recepcao`/`admin` | `findMember(query)` | 2 | — |
| `recepcao`/`admin` | `scheduleAppointmentForMember(memberId, slot)` | 3 | sim |
| `recepcao`/`admin` | `requestSecondCopyForMember(memberId, invoiceId)` | 3 | sim |
| `recepcao`/`admin` | `createLead(data)` | 3 | sim |
| `admin` | `getOverdueInvoices()` | 2 | — |
| `admin` | `inviteUser({email, role})` | 3 | sim |
| `super_admin` | `getRedeKPIs()` | 2 | — |
| `super_admin` | `getAlertsCritical()` | 2 | — |
| `contador_externo` | `getInvoicesEmittedMonth(period)` | 2 | — |
| `contador_externo` | `getDREYearToDate()` | 2 | — |
| `dpo` | `listOpenSubjectRequests()` | 2 | — |
| `dpo` | `listExpiringRIPDs()` | 2 | — |

**Tools bloqueadas no MVP** (`// ai-blocked` no handler): qualquer DELETE, `signEvolution` (ICP-Brasil), `chargeBatch`, `anonymizeMember`, `transferMemberBetweenCompanies`, `runOpenFinancePayment`, mudanças em `tenant_settings`/RBAC/plano.

**Cotas alinhadas a planos comerciais (ADR 0066):**

| Plano | Limite mensal | Soft diário | BYOK |
|---|---|---|---|
| Starter R$ 79 | 500 mensagens | ~50/dia | — |
| Pro R$ 199 | 3.000 mensagens | ~150/dia | opcional add-on |
| Business R$ 449 | 10.000 mensagens | ~500/dia | ✅ opcional |
| Enterprise | 25.000 (default) | sem soft | ✅ ilimitado quando ativo |

**Regras de contagem:**
- Camada 1 cache hit ⇒ **0** chamadas; cache miss ⇒ **1**
- Camada 2 ⇒ **1** por turn
- Camada 3 proposta + reformulação pós-execução ⇒ até **2**
- Tool execution (Server Action) **não conta** na quota IA — conta no rate limit Server Actions (regra 36)
- STT minutos: separado (Pro 60min, Business 300min, Enterprise 1500min)

Soft diário excedido → toast informativo, não bloqueia mensal. Mensal excedido → circuit breaker + CTA "Configure BYOK".

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
- Tool `report_issue`: assistente abre ticket com contexto capturado; aparece em `/app/suporte`
- White-label: tenant muda nome para "Vital AI" → hook `useAIAssistantName()` propaga; header, sidepanel, FAB usam o novo nome

**Critérios ADR 0075 (Assistente universal):**

- **FAB global** aparece em qualquer rota `/app/*` (mobile + desktop); `Ctrl+/` abre o sheet em qualquer tela
- **Persona inferida**: user com role `recepcao` abre assistente → system prompt carrega `recepcao.ts` template; chip "Falar como: Recepção" visível
- **Tool registry**: módulo financeiro adiciona arquivo `ai-tools.ts` com `registerAITool({key:'financeiro.invoice.second_copy',...})` → boot detecta + popula `tools_registry` + visível em dashboard `/app/super-admin/ai-usage`
- **Camada 1 (Help)**: aluno pergunta "como cancelo aula?" → resposta vem do RAG (docs/sprints/03 + manuais) sem tool call; cache hit no segundo aluno que perguntar similar
- **Camada 2 (Insight)**: aluno "qual minha próxima aula?" → tool `getMyAppointments({from:'today'})` executa com RBAC=self → resposta natural com data/horário/sala
- **Camada 3 (Action)**: aluno "cancela aula amanhã" → tool `proposeAction(cancelMyAppointment)` cria registro em `assistant_action_proposals` (state=pending) → `<ActionConfirmDialog>` renderiza com título/descrição/impacto + botões → user confirma → handler real executa + audit grava `action_source='ai_assistant'` + `proposal_id`
- **Bypass bloqueado**: tentativa de chamar `cancelMyAppointment` direto com header `x-ai-source: assistant` sem `proposal_id` válido **retorna `FORBIDDEN`** (proteção dupla)
- **Whitelist Write**: tentativa de `proposeAction({tool:'deleteMember',...})` retorna erro "tool not registered or ai-blocked" — handler tem `// ai-blocked: LGPD art. 18 fluxo dedicado`
- **Persona switcher**: admin com permissions de fisio também troca para "Falar como: Profissional clínico" → tools clínicas carregam (com gate Comitê IA aplicado)
- **Cota soft diária**: Starter no 51º msg do dia → toast "Limite diário soft atingido (50/dia)" + permite continuar até bater mensal
- **Cota mensal**: Starter no 501º msg do mês → bloqueia + CTA "Configure BYOK ou faça upgrade"
- **Camada 3 expira**: proposta criada e não confirmada em 5min → state=`expired`, UI mostra "Proposta expirou, tente novamente"
- **Confirmação requerida**: tentar executar `confirm` em proposta state≠`pending` retorna erro
- **Telemetria PostHog**: `assistant.action_proposed` + `assistant.action_confirmed` + `assistant.action_rejected` populam dashboard `/app/super-admin/ai-usage` mostrando taxa de aceitação por tool
- **Mobile-first FAB** (regra 31): testes Playwright em 390/768/1280 — sheet bottom em 390, side panel em 1280, toque ≥44px no FAB
- **i18n**: tool descriptions e persona templates em pt-BR/en-US/es-419 (regra 27); CI `pnpm i18n:check` verde

## Dependências

- Sprint 02 (`members` + timeline)
- Sprint 04 (dados financeiros do member disponíveis)
- Sprint 01b (consent + audit_log)

## Decisões tomadas / ADRs esperados

- **ADR 0015 (esperado)** — Copilot: consulta/sugestão, nunca prescrição. System prompt fixo + classificador de output para detectar prescrição e bloquear.
- [ADR 0064 — Arquitetura de IA (Gemini default + BYOK + RAG)](../decisions/0064-ia-arquitetura-gemini-default-byok-rag.md) — accepted
- [ADR 0075 — Assistente IA universal (3 camadas + tool registry distribuído + cotas por plano)](../decisions/0075-assistente-ia-universal-tres-camadas-tool-registry.md) — accepted (2026-04-24)
- **Pergunta aberta:** limite de contexto — quanto da timeline incluir (últimas 5 interações? últimos 30 dias?). Decidir com análise de custo por conversa.
- **Pergunta aberta:** chunking strategy do RAG — 500 tokens overlap 50 é padrão; pode precisar tunar para docs regulatórios longos.
- **Pergunta aberta:** TTL da proposta Camada 3 — 5min default, mas user em mobile pode demorar; medir empiricamente e ajustar.
- **Pergunta aberta:** persona switcher persiste em cookie ou em `tenant_assistant_personas`? Cookie é mais leve mas não atravessa device; tabela é durável. Decisão: cookie no MVP, migrar pra tabela se houver demanda.

## Módulos entregues

Ver [`modulos.md` — Geral](../modulos.md#geral):

- Assistente IA universal (3 camadas Help/Insight/Action — ADR 0075)
- 7 personas por papel + chip switcher
- `<AssistantFAB>` global em `<AppLayout>`
- `<ActionConfirmDialog>` + `assistant_action_proposals`
- Tool registry distribuído (`tools_registry` + `registerAITool()`)
- Cotas alinhadas a planos comerciais (ADR 0066)
- Cache semântico + rate-limit
- Sistema mínimo de tickets (`support_tickets` + tool `report_issue`)
- White-label do assistente

## Rotas Next.js

- `/app/assistente` — página dedicada (lista de conversas + sessão ativa)
- `/app/assistente/[id]` — conversa específica (compartilhável dentro do tenant)
- `<AssistantFAB>` em `<AppLayout>` — disponível em qualquer rota `/app/*`
- `/app/settings/ia` — admin tenant (BYOK, cota, white-label, personas habilitadas)
- `/meu/assistente` — Portal Paciente (Sprint 26 — adapta com persona=`member`)
- `/app/coach/assistente` — PWA Coach (ADR 0074 — adapta com persona=`professional_coach`)
- `/app/super-admin/ai-usage` — dashboard super-admin LogiFit (top 10 tools usadas, cache hit rate, taxa de aceitação Camada 3 por tool)

## Server Actions + API Routes

API Routes:

- `POST /api/ai/chat` — streaming SSE; body `{ conversation_id?, message, route?, persona_override? }`; valida Zod, checa rate-limit + quota (mensal + soft diário), busca cache, infere persona, monta contexto + tools filtradas, chama AI SDK, salva em `ai_messages`, grava `ai_audit_log` com `persona+layer+tool_keys`
- `POST /api/ai/embed` — gera embedding de uma query (uso interno para busca semântica)
- `POST /api/ai/proposals/{id}/confirm` — Camada 3: valida proposta state=`pending` + não expirada, chama handler real wrapped, atualiza state=`executed`/`failed`, retorna resultado
- `POST /api/ai/proposals/{id}/reject` — user rejeitou; state=`rejected`; LLM informado no próximo turn

Server Actions em `apps/web/app/(modules)/assistente/actions.ts`:

- `newConversation(context?)` — cria `ai_conversations` vazia (com persona inferida + contexto opcional `{memberId, route}`)
- `rateResponse(messageId, thumbsUp | thumbsDown, comment?)` — feedback
- `switchPersona(conversationId, persona)` — troca persona no meio da conversa (registra mudança em `ai_messages` como system event)
- `archiveConversation(id)` — soft delete (`archived_at`)

Server Actions tools (cada módulo registra suas em `<modulo>/ai-tools.ts`):

- `searchHelp(query)` — busca semântica no RAG global, retorna chunks com citação
- `report_issue(title, description)` — abre `support_tickets` com contexto rico
- (demais tools registradas progressivamente — ver tabela "Tools no agent assistant" acima)

Server Actions internas em `packages/ai/registry`:

- `registerAITool(definition)` — chamado em arquivos `<modulo>/ai-tools.ts`; popula manifest in-memory + sync com `tools_registry` em deploy
- `getAvailableTools({persona, user, route})` — retorna tools filtradas runtime
- `proposeAction({tool, args, reason, conversationId})` — cria `assistant_action_proposals` e retorna `{proposalId, confirmationCopy}`

## Schemas Drizzle (esperado)

Em `packages/db/schema/ai.ts`:

- `ai_conversations` — `id`, `tenant_id`, `user_id`, `member_id nullable`, `persona text`, `title`, `created_at`, `last_message_at`, `archived_at`
- `ai_messages` — `id`, `tenant_id`, `conversation_id`, `role` enum (`user`, `assistant`, `system`, `tool`), `content text`, `tool_calls jsonb`, `tool_results jsonb`, `tokens_in int`, `tokens_out int`, `model text`, `cache_hit bool`, `created_at`
- `ai_cache` — `id`, `tenant_id`, `query_embedding vector(768)`, `query_text`, `response_text`, `model`, `hits int default 0`, `created_at`. Índice HNSW para similaridade.
- `ai_incidents` — `id`, `tenant_id`, `conversation_id`, `message_id`, `kind` enum (`prescription_detected`, `pii_leak`, `rate_limit`, `injection_detected`), `resolved bool`, `created_at` — para audit de casos bloqueados
- **`tools_registry`** (ADR 0075) — `id`, `key unique`, `layer enum('help','insight','action')`, `module_path`, `label_pt_br`, `description_pt_br`, `required_permission nullable`, `required_consent_purpose nullable`, `required_vertical nullable`, `available_for_personas text[]`, `args_schema_json jsonb`, `result_schema_json jsonb`, `requires_confirmation bool`, `audit_action nullable`, `audit_sensitive bool default false`, `rate_limit_key nullable`, `is_ai_blocked bool default false`, `active bool default true`, `registered_at`, `updated_at`. Não particiona (~500 linhas).
- **`assistant_action_proposals`** (ADR 0075) — `id`, `tenant_id`, `user_id`, `conversation_id`, `message_id`, `tool_key`, `args jsonb`, `args_validated bool`, `reason_text`, `confirmation_state enum('pending','confirmed','rejected','expired','executed','failed')`, `confirmed_at nullable`, `executed_at nullable`, `execution_result jsonb nullable`, `expires_at`, `created_at`. **Particionada por mês** (regra 34 + ADR 0072) com `@volume_estimate_yearly: 5M+`; retenção 1 ano hot + 5 cold.
- **`tenant_assistant_personas`** (ADR 0075) — `tenant_id pk`, `persona_overrides jsonb default '{}'`, `enabled_personas text[] default array['member','admin','recepcao','professional_clinical','professional_coach']`, `default_persona text`. Não particiona (1 linha por tenant).

Em `packages/db/schema/audit.ts` (estende ADR 0064):

```sql
ALTER TABLE ai_audit_log ADD COLUMN persona text;
ALTER TABLE ai_audit_log ADD COLUMN layer text;            -- 'help'|'insight'|'action'
ALTER TABLE ai_audit_log ADD COLUMN action_proposal_id uuid;
ALTER TABLE ai_audit_log ADD COLUMN tool_keys text[];
```

Rate-limit é **fonte primária em Redis** (Upstash), sem tabela persistente. Contador por `tenant:day` (soft cap) e `tenant:month` (hard cap) com TTL alinhado ao ciclo do plano.

**RLS:**
- `ai_conversations`: tenant_id + `user_id = auth.uid()` (conversa pessoal)
- `assistant_action_proposals`: tenant_id + `user_id = auth.uid()` (só o autor confirma)
- `tools_registry`: tenant_id NULL (global) — read aberto para todos users do tenant; write apenas em deploy via service role
- `tenant_assistant_personas`: tenant_id (admin do tenant edita)

## Eventos de domínio emitidos

- `assistant.session_opened` — `{ persona, route, device, at }`
- `assistant.message_sent` — `{ conversation_id, persona, layer, tokens_in, used_rag, at }`
- `assistant.cache_hit` — `{ conversation_id, cache_id, query_hash }`
- `assistant.tool_called` — `{ tool_key, layer, persona, latency_ms, at }`
- `assistant.action_proposed` — `{ proposal_id, tool_key, persona, at }`
- `assistant.action_confirmed` — `{ proposal_id, time_to_confirm_ms, at }`
- `assistant.action_rejected` — `{ proposal_id, reason?, at }`
- `assistant.action_executed` — `{ proposal_id, ok, latency_ms, at }`
- `assistant.quota_warning` — `{ tenant_id, percent_used, at }` — em 80%
- `assistant.quota_blocked` — `{ tenant_id, at }` — em 100% mensal
- `assistant.rate_limited` — `{ tenant_id, user_id, at }`
- `assistant.incident` — `{ incident_id, kind, at }` — alerta PostHog/Sentry

## Commit (checklist)

**Fundação ADR 0064:**

- [ ] Schemas Drizzle: 7 tabelas IA core (`ai_providers`, `ai_models`, `ai_provider_configs`, `ai_task_routing`, `ai_tenant_usage`, `ai_documents`, `ai_document_chunks`, `ai_semantic_cache`)
- [ ] Schemas Drizzle: `ai_conversations`, `ai_messages` (com `tool_calls`/`tool_results` jsonb), `ai_incidents`, `ai_audit_log` particionada por mês
- [ ] Seed providers (Gemini/Anthropic/OpenAI/Groq/Maritaca) + models + task_routing default
- [ ] Índice HNSW em `ai_semantic_cache.query_embedding` via migration raw
- [ ] RLS em todas + testes
- [ ] Wrapper `packages/ai/chat.ts` com provider plugável (Gemini → OpenAI → Anthropic) — **toda chamada HTTP via `safeFetch()` (ADR 0073 + regra 37)** com allowlist por adapter
- [ ] Wrapper `packages/ai/cache.ts` (similaridade + TTL 30d + LRU eviction)
- [ ] Rate-limit Upstash em `packages/ai/ratelimit.ts` — sobreposto à regra 36 — IA tem cap próprio (20/min/user)
- [ ] **`packages/ai/security/redact.ts` — `redactBeforeLLM(text)`** (ADR 0073 camada 5): mascara CPF/CNPJ/RG/email/telefone/endereço/cartão/PIX antes de enviar `ragChunks` ao provider; teste unit garante que CPF "123.456.789-00" sai como "***.***.***-00"
- [ ] **Classificador anti-prompt-injection** (ADR 0073 camada 5) — bloqueia tool calling se detectado
- [ ] Classificador de output clínico — bloqueia "diagnóstico", "tem [doença]", "prescrever"
- [ ] **Detecção de abuso por tenant** (ADR 0073 camada 5) — 10x consumo médio em 24h dispara `system_alerts severity=warning`
- [ ] API Route `/api/ai/chat` com SSE
- [ ] API Route `/api/ai/embed`
- [ ] Job `SeedRAGSystemDocuments` ingere ADRs + Sprints + schema Drizzle + regulações
- [ ] UI `/app/settings/ia` (BYOK + cota visualizada + white-label)
- [ ] White-label: hook `useAIAssistantName()` em header, sheet, FAB

**ADR 0075 — Assistente universal:**

- [ ] Schemas Drizzle: `tools_registry`, `assistant_action_proposals` (particionada mês), `tenant_assistant_personas`
- [ ] Migration `ALTER ai_audit_log ADD COLUMN persona, layer, action_proposal_id, tool_keys[]`
- [ ] `packages/ai/registry/registerAITool.ts` — função registry + manifest in-memory + sync com `tools_registry`
- [ ] Lint custom `ai-block-respected` em CI — bloqueia commit se `registerAITool` aponta para handler com comentário `// ai-blocked`
- [ ] Build hook que carrega `**/ai-tools.ts` e gera `tools_manifest.json` no deploy → seed `tools_registry`
- [ ] `packages/ai/personas/*.ts` — 7 templates (member, professional_clinical, professional_coach, admin, recepcao, super_admin, contador_externo, dpo) em pt-BR/en-US/es-419
- [ ] `inferPersona(user, tenant)` em `packages/ai/personas/infer.ts` + testes
- [ ] `buildSystemPrompt({persona, availableTools, ...})` estendido (ADR 0064)
- [ ] `getAvailableTools({persona, user, route})` filtra por `whenAvailable + showInPersonas + permissions`
- [ ] `proposeAction({tool, args, reason, conversationId})` Server Action — INSERT `assistant_action_proposals`
- [ ] API Route `POST /api/ai/proposals/{id}/confirm` — valida + chama handler real wrapAction
- [ ] API Route `POST /api/ai/proposals/{id}/reject`
- [ ] **Proteção dupla**: handler real rejeita execução se `actionSource='ai_assistant'` sem `proposal_id` confirmado válido (helper `requireConfirmedProposal()`)
- [ ] Whitelist inicial Camada 3 — registrar ~9 tools em `apps/web/app/(modules)/{members,financeiro,agenda,leads,suporte}/ai-tools.ts`
- [ ] Componentes UI:
  - [ ] `<AssistantFAB>` em `<AppLayout>` (mobile 56px / desktop 64px) — usa tokens touch (regra 31)
  - [ ] `<AssistantSheet>` — bottom sheet 92vh mobile / side panel 420px desktop; drag-to-close mobile
  - [ ] `<AssistantConversation>` — bubble list com streaming, tool result rendering, persona chip
  - [ ] `<PersonaSwitcher>` — chip "Falar como: X" + dropdown
  - [ ] `<ActionConfirmDialog>` — título/descrição/impacto/affectedEntities + [Confirmar/Editar/Cancelar]
  - [ ] `<QuotaIndicator>` — barra "47 de 500 mensagens" no header do sheet
- [ ] Atalho teclado `Ctrl+/` ou `Cmd+/` em `<AppLayout>` abre sheet
- [ ] Página dedicada `/app/assistente` (lista conversas + filtros)
- [ ] Variantes: `/meu/assistente` (Sprint 26 prepara mas o shell PWA carrega aqui), `/app/coach/assistente` (Sprint 11 ADR 0074 prepara)
- [ ] Dashboard `/app/super-admin/ai-usage` — top tools, cache hit rate, taxa de aceitação Camada 3
- [ ] Cotas mensais alinhadas ADR 0066 — circuit breaker em 100% + soft toast em 80% + soft daily cap configurável
- [ ] Telemetria PostHog: 12 eventos `assistant.*` (ver seção "Eventos de domínio emitidos")
- [ ] Disclaimer rendered em toda bolha assistant clínica (regra 28)
- [ ] Audit log por conversa, com `consent_id` quando contexto cruza módulos + `persona/layer/tool_keys/action_proposal_id`
- [ ] Testes:
  - [ ] cache hit (ADR 0064)
  - [ ] rate-limit
  - [ ] classificador bloqueia prescrição
  - [ ] anti-prompt-injection
  - [ ] PII redaction
  - [ ] persona switcher persiste
  - [ ] Camada 3: proposta criada → confirma → executa → audit
  - [ ] Camada 3: bypass bloqueado (handler rejeita sem `proposal_id`)
  - [ ] Camada 3: proposta expira em 5min
  - [ ] Whitelist: tool com `// ai-blocked` não executa via assistant
  - [ ] Cota mensal bloqueia + soft daily warns
  - [ ] FAB Playwright em 390/768/1280 (regra 31)
  - [ ] i18n: tool descriptions presentes em pt-BR/en-US/es-419 (regra 27)
- [ ] Feature flag `assistant_v1`
- [ ] ADR 0015 publicado
- [ ] **Sistema mínimo de tickets**: `support_tickets` schema + tool `report_issue` em `apps/web/app/(modules)/suporte/ai-tools.ts` + UI `/app/suporte` + email Resend ao admin tenant
- [ ] RIPD do módulo "Assistente IA universal" registrado em `ripd_documents` (regra 29 + ADR 0054)

## Stretch

- [ ] Export de conversa como PDF para prontuário (quando Fase 2 precisar)
- [ ] Multi-provider A/B test framework (20% tráfego em fallback para medir diferença)
- [ ] Resumo automático da conversa ao arquivar

## Log

- —

## Definition of Done

- [ ] Feature flag `assistant_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] RLS verificada (conversa privada, propostas privadas, não vazada entre users)
- [ ] Rate-limit comprovado (101ª chamada falha)
- [ ] Classificador bloqueia pelo menos 90% dos casos de prescrição do dataset de teste
- [ ] **Camada 3 bypass test verde**: handler real chamado direto com `actionSource='ai_assistant'` sem `proposal_id` retorna `FORBIDDEN`
- [ ] **Lint `ai-block-respected` verde** em CI
- [ ] **i18n CI verde** (`pnpm i18n:check`) — tool descriptions e personas em 3 locales
- [ ] **Mobile-first verde** — Playwright em 390/768/1280 verifica FAB + sheet
- [ ] **Persona inference test** — user com cada role mapeia para persona correta
- [ ] **Whitelist Write test** — todas as ~9 tools têm `requiresConfirmation:true` + audit configurado
- [ ] **Cotas test** — Starter no 501º msg bloqueia; soft daily warns
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 05 → `done`, item #8 → `done`
- [ ] RIPD "Assistente IA universal" publicado em `ripd_documents` (regra 29)
- [ ] Zero violação de regras

## Retro

- —
