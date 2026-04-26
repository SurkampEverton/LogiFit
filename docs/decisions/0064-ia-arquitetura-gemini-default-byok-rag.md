# ADR 0064 — Arquitetura de IA: Gemini Flash default + BYOK + RAG + tasks tipadas

- **Status:** Accepted
- **Date:** 2026-04-24

## Context

Durante as decisões arquiteturais de pré-implementação, a relação **LogiFit ↔ IA ↔ tenant** passou por 3 propostas antes de fechar no modelo híbrido atual:

1. **LogiFit revende IA** (cobra quota/overage no plano) — rejeitado pelo risco de margem com preço variável do provider
2. **BYOK-only obrigatório** (tenant contrata direto; LogiFit não toca em IA) — rejeitado pela fricção no onboarding e pela demo comercial fraca
3. **Híbrido: IA embutida de baixo custo + BYOK opcional** — **aceito**

Referência externa examinada: arquitetura de IA do projeto **Deep Control** (9 dias atrás), que trouxe ideias maduras já validadas em produção — tabelas granulares (`ai_providers`, `ai_models`, `ai_task_routing`), RAG completo (`ai_documents`, `ai_document_chunks`, `ai_semantic_cache`), multimodal (STT + vision como serviços abstratos), system prompt composto, white-label do assistente.

Decisões do usuário (2026-04-24):

1. **Default LogiFit = Gemini 2.5 Flash** via Vertex AI São Paulo
2. **Transcription (STT) = Groq Whisper** embutido no plano (Sprint 31)
3. **Tabela `ai_tenant_usage`** para quota tracking mensal
4. **Quota excedida = bloqueio + CTA para BYOK** (sem overage pago)

## Decision

### Modelo comercial

- **LogiFit fornece IA padrão** via conta corporativa Google Cloud (Vertex AI Gemini 2.5 Flash, região **São Paulo**) — custo absorvido no plano fixo
- **BYOK opcional** — admin do tenant cola API key própria em `/app/settings/ia` → bypass da quota; tenant paga direto ao provider
- **Transcription (STT)** via Groq Whisper incluído no plano (~US$ 0,30/tenant/mês absorvido); BYOK OpenAI Whisper possível
- **Quota por plano** com circuit breaker → CTA para BYOK

| Plano | Preço | Quota IA/mês | Custo real LogiFit |
|---|---|---|---|
| Starter | R$ 99 | 500 chamadas | ~R$ 1,50 |
| Pro | R$ 199 | 3.000 chamadas | ~R$ 5 |
| Business | R$ 449 | 10.000 chamadas | ~R$ 17 |
| Enterprise | R$ 1.199+ | 25.000 chamadas | ~R$ 40 |
| + BYOK (Pro+) | mesmo preço | ilimitado | R$ 0 |

Cache semântico pgvector reduz ~40-60% do consumo real.

### Providers suportados

| Slug | Provider | Modo | Uso |
|---|---|---|---|
| `gemini` | Google Gemini (Vertex AI SP) | **Default LogiFit** + BYOK | chat, embedding, vision, extraction |
| `anthropic` | Claude | BYOK | chat, vision, extraction, reasoning |
| `openai` | GPT | BYOK | chat, embedding, vision, transcription (Whisper) |
| `groq` | Groq | **LogiFit (STT)** + BYOK | transcription, chat rápido |
| `maritaca` | Maritaca (BR) | BYOK | chat (tenant exige datacenter BR absoluto) |

**Fora do escopo:** DeepSeek (LGPD duvidosa — data residency CN), modelos deprecated (Claude 3.5, GPT-4o, Gemini 2.0, Grok 2).

### Tasks tipadas

Categorização do tipo de chamada IA (inspirado Deep Control):

| Task | Descrição | Default LogiFit | Usado em |
|---|---|---|---|
| `chat` | Conversação com system prompt + tools | Gemini Flash | Copilot (06), Nutri-Agent (34) |
| `embedding` | Vetorização para RAG + cache | Gemini `text-embedding-004` (768 dim) | Cache semântico (06), Busca global (07) |
| `classification` | Classificar texto/anexo em categoria finita | Gemini Flash | Classificador WhatsApp (13) |
| `extraction` | Texto/PDF → JSON estruturado | Gemini Flash (vision) | Pipeline Exames (33), OCR boleto estendido (15) |
| `vision` | Interpretação de imagem (exame, foto postural) | Gemini Flash | Exames (33), Foto postural (21) |
| `transcription` | Áudio → texto | **Groq `whisper-large-v3-turbo`** | Teleconsulta (31), áudio WhatsApp (13) |
| `reasoning` | Raciocínio profundo (o1-like) | BYOK-only (Claude Opus thinking, o1) | Casos raros; sugestão clínica complexa |

**Regra:** nunca hardcode provider/modelo no código — sempre `resolveModelForTask(task, featureKey?, tenantCtx)` consulta `ai_task_routing`.

### Schema

7 tabelas em `packages/db/schema/ai.ts`:

```sql
-- Catálogo global curado pelo LogiFit
ai_providers
  id uuid pk
  slug text unique          -- 'gemini','anthropic','openai','groq','maritaca'
  label text
  country text              -- 'BR'|'US'|'EU'
  data_residency text       -- 'SP'|'us-east-1'|...
  requires_dpa bool
  active bool
  created_at

ai_models
  id uuid pk
  provider_id fk
  slug text                 -- 'gemini-2.5-flash', 'claude-sonnet-4-5', ...
  label text
  model_type enum ('chat','embedding','vision','transcription','reasoning')
  supports_function_calling bool
  supports_vision bool
  supports_streaming bool
  context_window_tokens int
  max_output_tokens int
  price_input_per_mtok_usd numeric
  price_output_per_mtok_usd numeric
  deprecated_at timestamp nullable
  active bool

-- BYOK — credenciais do tenant (criptografadas)
ai_provider_configs
  id uuid pk
  tenant_id uuid fk
  provider_id fk
  api_key_encrypted text    -- AES-256-GCM; chave em ENCRYPTION_KEY (.env)
  base_url text nullable    -- para self-hosted/proxy
  validated_at timestamp nullable
  last_used_at timestamp nullable
  active bool
  created_at
  unique (tenant_id, provider_id)

-- Roteamento task → modelo
ai_task_routing
  id uuid pk
  scope_type enum ('global','tenant','feature')
  tenant_id uuid nullable
  task text not null        -- 'chat','embedding',...
  feature_key text nullable -- 'copilot','classifier.whatsapp',... (NULL = qualquer feature daquela task)
  provider_id fk
  model_id fk
  priority int default 0    -- fallback cascade
  active bool
  -- índice: (scope_type, tenant_id, task, feature_key, priority)

-- Quota tracking mensal por tenant
ai_tenant_usage
  id uuid pk
  tenant_id uuid fk
  period_ym text            -- '2026-04'
  provider_id fk
  task text
  calls_count int default 0
  tokens_input_total bigint default 0
  tokens_output_total bigint default 0
  cost_usd_cents bigint default 0  -- calculado em tempo de escrita
  last_call_at timestamp
  unique (tenant_id, period_ym, provider_id, task)

-- RAG: documentos + chunks + cache semântico
ai_documents
  id uuid pk
  tenant_id uuid nullable   -- NULL = global curado LogiFit (ADRs, sprints, schema, regulação)
  source_type enum ('schema_drizzle','adr','sprint_doc','regulatory','manual','user_uploaded')
  source_ref text           -- path do arquivo ou id da entidade origem
  title text
  content_hash text         -- SHA-256 do conteúdo — detecta mudança
  processing_status enum ('pending','processing','ready','failed')
  processing_error text nullable
  total_chunks int default 0
  created_at
  updated_at
  unique (source_type, source_ref) where tenant_id is null

ai_document_chunks
  id uuid pk
  document_id fk
  chunk_index int
  content text
  embedding vector(768)     -- gemini text-embedding-004 default
  tokens_estimate int
  created_at

ai_semantic_cache           -- cache de perguntas repetidas
  id uuid pk
  tenant_id uuid fk
  query_hash text           -- SHA-256 da query normalizada
  query_text text
  query_embedding vector(768)
  response_cached text      -- resposta completa
  provider_id fk
  model_id fk
  tokens_in int
  tokens_out int
  hit_count int default 1
  ttl_expires_at timestamp
  created_at
  last_hit_at timestamp
  -- índice gin no embedding para busca por similarity
```

Em `packages/db/schema/audit.ts` (já existe do ADR 0053):

```sql
ai_audit_log              -- já previsto em 0053; detalhado aqui
  id uuid pk
  tenant_id uuid
  user_id uuid nullable
  feature_key text          -- 'copilot','classifier.whatsapp',...
  task text
  provider_id fk
  model_id fk
  input_summary text        -- truncado 500 chars; payload completo em storage se necessário
  output_summary text
  tokens_in int
  tokens_out int
  cost_usd_cents int
  latency_ms int
  cache_hit bool
  fallback_used bool            -- true quando provider principal falhou (429/500/timeout) e cascade pegou
  human_decision text nullable  -- 'accepted'|'edited'|'rejected'|null (quando não clínica)
  is_sensitive bool             -- ADR 0053 classificação SaMD II+
  at timestamp
```

### System prompt composto

Função pura em `packages/ai/prompt.ts`:

```ts
buildSystemPrompt({
  agent,                 // 'general'|'nutri_agent'|'classifier_whatsapp'|'extraction_exam'
  tenant,                // { name, whiteLabelName, verticals, topology }
  user,                  // { name, roleLabel, permissions }
  task,                  // categoriza
  featureKey,
  globalRules,           // regra 28 (supervisão humana), regra 15 (vocabulário proibido)
  ragChunks,             // top-k similarity dos docs relevantes
  conversationHistory,   // última janela de turnos
  userContext,           // dados do member em foco, appointment, etc.
}): string
```

Template:

```
# Assistente {whiteLabelName} ({tenant.name})

## Regras globais (não-negociáveis)
{globalRules}

## Contexto do usuário
- Nome: {user.name}
- Role: {user.roleLabel}
- Permissions ativas: {permissions}
- Vertical ativa: {verticals}
- Topology: {topology}

## Documentos relevantes (RAG)
{ragChunks formatados com fonte}

## Contexto da conversa
{userContext}

## Histórico recente
{conversationHistory}

## Suas tools disponíveis
{toolList com descrições}
```

### Tool calling

**Modo AUTO** (LLM decide qual tool chamar), mas com **whitelist tipada por agent**:

```ts
const tools = {
  copilot: [
    'findMember',           // busca member por query
    'scheduleAppointment',  // agenda (com permission agenda.write)
    'findCidByDescription', // sugestão de CID
    'summarizeEvolutions',  // resumo de evoluções (permission prontuario.read)
    'report_issue',         // abre ticket de suporte
  ],
  nutri_agent: [ /* ... */ ],
  classifier_whatsapp: [ 'classifyAttachment' ],
}
```

**Nunca SQL arbitrário.** Cada tool é Server Action tipada com Zod; executa sob RLS + permission check. LLM não toca em banco direto.

### RAG seed global (LogiFit-curado)

Na boot da app (ou job noturno), `SeedRAGSystemDocuments` faz upsert de:

| source_type | Conteúdo | Quando reprocessa |
|---|---|---|
| `schema_drizzle` | Cada tabela do Drizzle schema com colunas + relations + RLS comentário | Migration aplicada → hash muda → reseed |
| `adr` | Todos os `docs/decisions/*.md` | Arquivo modificado |
| `sprint_doc` | Todos os `docs/sprints/*.md` | Arquivo modificado |
| `regulatory` | Seções de CFM 2.454/2026, LGPD art. 11/18, TISS 4.01, CFN 599, COFFITO 414, ANVISA RDC 657/751 | Manual (LogiFit admin cura) |

**Benefício:** Copilot responde "qual tabela guarda as consultas?" ou "o que a CFM 2.454 diz sobre Comitê de IA?" sem prompting constante — busca por similarity no RAG.

Global (`tenant_id IS NULL`) = todos os tenants herdam. Tenant pode adicionar docs próprios (`user_uploaded`) — protocolos internos, manuais, regulamento, etc.

### White-label do assistente

Tabela `tenant_settings` ou `white_label_configs` (Sprint 01a):

```sql
tenant_settings
  tenant_id pk
  ai_assistant_name text default 'Copilot'   -- ex: "Vital AI", "Dr. Copiloto"
  ai_assistant_avatar_url text nullable
  ai_assistant_tone text default 'formal'    -- 'formal'|'casual'
```

Hook frontend `useAIAssistantName()` consumido em AIChatWidget, header, alertas proativos.

### Fallback cascade

Em caso de erro (429, 500, timeout) do provider principal, tenta automaticamente o próximo em `ai_task_routing.priority` (ordem DESC). Audit marca `fallback_used=true`.

**Exemplo:** Copilot em Gemini Flash (priority 100) → falha → tenta OpenAI GPT-4.5-mini (priority 90) → sucesso.

Configuração padrão LogiFit:
```
task=chat, priority=100 → gemini-2.5-flash (default)
task=chat, priority=90  → gpt-4.5-mini (fallback)
task=chat, priority=80  → claude-haiku-4.5 (fallback último)
```

Tenant com BYOK tem sua key como priority 100; LogiFit default vira fallback implícito (ou não, configurável).

### Compliance integrada

Tudo o que já existe **continua valendo**:

- **Regra 28** (ADR 0053): feature IA classe SaMD II+ exige Comitê de IA no tenant
- **Regra 29** (ADR 0054): dado de saúde com RIPD vigente + consent granular
- **Guardrails** (ADR 0015): classificador de output proibido ("diagnóstico de", "prescrever") ativo em toda chamada clínica
- **`ai_audit_log`**: toda chamada grava input/output/modelo/decisão humana
- **Classificação SaMD por feature**: `ai_feature_classifications` (Sprint 01b)

**Novo:** quando LogiFit é o operador (IA default embutida), LogiFit assina **DPA com Google Cloud** e **com Groq** e repassa cláusulas no Termo de Uso do tenant. Quando BYOK, tenant assume controle direto.

### Regra nova — tier mínimo por feature clínica (regra 32)

Features críticas têm **modelo mínimo obrigatório** imposto pelo LogiFit:

| Feature | Tier mínimo |
|---|---|
| Pipeline Exames — interpretação | Gemini Flash (default) ou superior; **Claude Haiku não permitido** por qualidade insuficiente em reasoning médico |
| Nutri-Agent — cruzamento multi-fonte | Mesmo |
| Classificador de output proibido (guardrails) | Qualquer modelo — é task trivial |
| Generative UI clínica | `supports_function_calling=true` obrigatório |

UI bloqueia seleção abaixo do tier mínimo com mensagem explicativa.

## Consequences

### Positivas

- **Zero fricção onboarding** — tenant usa IA sem configurar nada (Gemini Flash default)
- **Demo comercial forte** — Copilot funcional no primeiro login
- **Margem preservada** — custo <2% da mensalidade (cache reduz mais)
- **Flexibilidade enterprise** — BYOK para quem quer provider/modelo específico
- **LGPD facilitada** — Gemini Vertex AI SP resolve residency para tenants clínicos
- **Transcription novo** — Groq Whisper habilita Sprint 31 com SOAP automático
- **RAG maduro** — schema Drizzle + ADRs + regulações como fonte de verdade; Copilot cita fonte
- **White-label** — tenant customiza nome ("Vital AI", "Dr. Clinica X")
- **Arquitetura limpa** — tasks tipadas + task_routing em tabela → zero hardcode
- **Compliance preservada** — ADRs 0015/0053/0054 intactos

### Negativas (mitigáveis)

- **Custo variável no LogiFit** (~R$ 1-17/mês por tenant conforme plano) — aceitável; <2% da mensalidade
- **LogiFit vira operador LGPD** do dado que trafega pro Gemini — assina DPA com Google; tenant permanece controlador
- **Complexidade Sprint 06** cresce (de 2 para 3-4 semanas) — aceitável; evita refactor depois
- **Dependência de Google Cloud** — Vertex AI único provedor Gemini; Vertex AI SP pode ter incidentes; mitigado por fallback automático OpenAI/Anthropic
- **Admin Google Cloud** — LogiFit precisa gerenciar projeto GCP + billing + IAM; pouca experiência solo; mitigado por documentação
- **Tabela `ai_tenant_usage` cresce rápido** — particionamento mensal quando passar de 10M linhas; deferir

### Riscos não endereçados

- **Provider LogiFit default fica offline** — fallback automático; mas se TODOS os 3 (Gemini/OpenAI/Anthropic) caírem, IA para. Raro; aceitamos
- **Tenant tentar abuse da quota** — 500-10k chamadas/mês limita naturalmente; rate limit Upstash por minuto evita burst
- **Preço Gemini subir drasticamente** — ADR permite trocar default para GPT-4-mini ou Haiku sem refactor (só muda seed de `ai_task_routing`)

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| LogiFit revende IA com quota/overage pago | Complexifica cobrança; risco de margem com preço variável do provider |
| BYOK obrigatório (tenant contrata tudo) | Fricção onboarding; demo comercial fraca; tenant pequeno nunca liga IA |
| Claude Haiku como default | 10x mais caro que Gemini Flash; sem vantagem real de qualidade para o LogiFit |
| Modelo local (Llama, Mistral) via Ollama em servidor próprio | Custo infra alto; manutenção de ML-ops; scope desproporcional |
| DeepSeek como default | LGPD duvidosa (data residency CN); não apropriado para saúde |
| Tool calling com SQL arbitrário (como Deep Control) | Risco RLS; LLM pode vazar dado cross-tenant; rejeitado — sempre Server Actions tipadas |
| Overage pago quando passar quota | Complica cobrança; melhor bloquear + CTA BYOK |

## Escopo de impacto

**Novo ADR:** este (0064).

**Sprints ajustados:**

- **06 Copilot base** — escopo cresce: 7 tabelas novas + RAG ingestion job + system prompt builder + quota enforcement + circuit breaker + UI `/app/settings/ia` + white-label settings + seed de providers/models/task_routing + Vertex AI client + Groq client + Anthropic client (fallback) + OpenAI client (fallback). De 2 semanas → 3-4 semanas. **Atualização (2026-04-25):** ADR 0075 (Assistente IA Universal — 3 camadas + tool registry) expandiu o escopo posteriormente; estimativa vigente em [Sprint 06 header](../sprints/06-geral-copilot-base.md): **5-6 semanas**.
- **13 WhatsApp** — classificador usa `resolveModelForTask('classification', 'whatsapp_attachment')`; handler de áudio usa `transcription`
- **20 Prontuário** — CID autocomplete usa task routing; IA via ADR 0064
- **21 Evolução mídias** — foto postural usa task `vision`
- **31 Teleconsulta** — **STT via Groq Whisper embutido** (ADR 0064 confirma); transcript → rascunho SOAP automático; custo ~US$ 0,30/tenant/mês absorvido
- **33 Pipeline Exames** — usa tasks `extraction` + `vision`; ADR 0050 opt-out se tenant desativou IA
- **34 Nutri-Agent** — task `chat` com agent `nutri_agent`; tier mínimo Flash ou superior
- **28 Generative UI** — tool calling via task routing
- **19 Churn** — features pipeline local + task `chat` pontual para explicações

**Novo sprint possível:** "Sprint 06c — Sistema de tickets" (mini, ~3 dias) com tabela `support_tickets` + tool `report_issue` + UI `/app/suporte`. Pode caber como parte do Sprint 06.

**Regra nova:**

- **Regra 32** — tier mínimo por feature clínica (ver seção acima); CI bloqueia configuração abaixo do tier mínimo em `ai_task_routing`

**Docs:**
- `docs/modulos.md` — novos módulos (IA default, BYOK, RAG, STT, white-label, tickets)
- `CLAUDE.md` — regra operacional sobre `resolveModelForTask`
- `CHANGELOG.md` — entrada desta mudança
- `.env.example` — GOOGLE_CLOUD_PROJECT, VERTEX_AI_LOCATION, VERTEX_AI_SERVICE_ACCOUNT_KEY, GROQ_API_KEY, ENCRYPTION_KEY

## Related

- Inspiração direta: arquitetura de IA do projeto **Deep Control** (multi-provider, task routing, RAG completo, multimodal, white-label) — adaptada ao contexto de saúde LogiFit
- Reforça [ADR 0053 — CFM 2.454](0053-conformidade-cfm-2454-2026-ia-saude.md): SaMD + Comitê + audit — agora com tier mínimo regra 32
- Reforça [ADR 0054 — LGPD art. 11](0054-lgpd-art11-dados-saude-ripd-versionado.md): RIPD precisa listar Google Cloud (Vertex AI) e Groq como operadores; DPA assinada pela LogiFit
- Reforça **ADR 0015 — Copilot safety** (será produzido no Sprint 06 conforme convenção de ADRs reservados a sprints — ver `roadmap.md`): guardrails de vocabulário proibido aplicados em todo `task='chat'` clínico
- Substitui versões rascunho anteriores do ADR 0064 (BYOK-only e híbrido sem detalhamento)
- Fontes: documentação Vertex AI Gemini, Groq API, benchmarks openrouter.ai/rankings, Deep Control internal architecture memo
