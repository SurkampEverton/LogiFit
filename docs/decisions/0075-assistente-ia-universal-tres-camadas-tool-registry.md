# ADR 0075 — Assistente IA universal: 3 camadas (Help/Insight/Action) + tool registry distribuído + cotas por plano

- **Status:** Accepted
- **Date:** 2026-04-24

## Context

[ADR 0064](0064-ia-arquitetura-gemini-default-byok-rag.md) (accepted 2026-04-24) entregou a **fundação** de IA do LogiFit: Gemini Flash default, BYOK opcional, RAG global curado, cache semântico, 7 tabelas (`ai_providers`, `ai_models`, `ai_provider_configs`, `ai_task_routing`, `ai_tenant_usage`, `ai_documents`, `ai_document_chunks`, `ai_semantic_cache`), tasks tipadas, system prompt composto, fallback cascade, white-label.

Sprint 06 ("Copilot base") foi planejado para **um caso de uso estreito**: assistente clínico ancorado em member (`/app/copilot` + `/app/members/[id]/copilot`), com 5 tools de profissional (`findMember`, `scheduleAppointment`, `findCidByDescription`, `summarizeEvolutions`, `report_issue`). Era pensado para fisio/nutri trabalhando em consultório.

**Pergunta do usuário (2026-04-24):**

> "Vamos ter um chat com a IA para resolver qualquer questão relacionada ao sistema para auxiliar os usuários — qualquer usuário do sistema, tudo (perguntas + ações), com urgência."

Isso é **3-4× mais ambicioso** que o Sprint 06 original. Precisa cobrir:

| Persona | Caso de uso esperado |
|---|---|
| **Aluno/paciente** | "Quando é minha próxima aula?", "Cancela minha aula de amanhã", "Gera 2ª via do boleto", "Como funciona o Pilates?" |
| **Profissional clínico (fisio/nutri/médico)** | "Resume evolução do paciente X", "Sugere CID pra dor lombar crônica", "Cria rascunho de SOAP" |
| **Personal trainer** | "Próximo aluno hoje", "Mostra última carga do Bruno no supino", "Cria treino baseado no anterior" |
| **Recepção/admin tenant** | "Cadastra esse lead com nome João", "Quantos cancelamentos hoje?", "Gera 2ª via pro João Silva", "Inadimplentes do mês" |
| **Super admin rede** | "DRE consolidado matriz", "Alertas de inadimplência > R$ 5k", "Tenants com IA em quota cap" |
| **Contador externo** | "Razão da conta 4.1.01 abril", "NFS-e emitidas mês passado" (read-only) |
| **DPO** | "RIPDs vencendo este mês", "Pedidos de titular abertos" |

Cada persona quer **conversa em linguagem natural** acessível **em qualquer tela** (não só `/copilot`), respeitando **RBAC + scope + consent**, com a **opção de pedir IA pra executar a ação** ("cancela essa aula" — não só "como cancelo aula?").

**Tensões a resolver:**

1. **Universalização vs persona** — assistente precisa entender o papel do usuário e não oferecer ações que ele não tem permission. Profissional vê `scheduleAppointment`, aluno vê `cancelMyAppointment`. Mesmo agent, prompts diferentes.
2. **Read vs Write** — perguntar é seguro; executar é arriscado. LLM alucina, paciente entende mal, ação destrutiva acontece sem confirmação humana. Camada de write precisa **sempre confirmar UI antes**.
3. **Tool registry centralizado vs distribuído** — Sprint 06 lista 5 tools hardcoded. Mas LogiFit terá ~200+ Server Actions ao final do MVP (financeiro, agenda, members, leads, prescrições, exames, devices, fiscal). Centralizar tudo em `packages/ai/tools.ts` cria god-file e acopla módulos. Padrão vencedor já usado: `registerMenuItem` (Sprint 00b), `search_index_sync` (regra 30). Cada módulo registra suas tools.
4. **Cotas por plano** — ADR 0064 fala em 500/3k/10k chamadas/mês genéricas. ADR 0066 (Plano Comercial) fechou 4 tiers concretos (Starter/Pro/Business/Enterprise). Precisa alinhar e deixar claro o que conta como chamada (RAG hit é grátis? tool call conta?).
5. **Mobile-first** (regra 31, ADR 0063) — assistente precisa ser usável no celular, principalmente para aluno (Portal) e personal coach (PWA). FAB flutuante + bottom sheet em mobile, side panel em desktop.
6. **Compliance** — toda mensagem é dado de saúde potencialmente (paciente conversa sobre sintoma). Precisa CFM 2.454/2026 (regra 28: Comitê de IA + classifier de output) + LGPD art. 11 (regra 29: RIPD + consent). PII redaction antes de enviar pro LLM (regra 35/ADR 0073 camada 5).

## Decision

### Princípio orientador

> O Assistente IA do LogiFit é **universal por papel** (qualquer usuário, qualquer tela), **estratificado por risco** (3 camadas com gates progressivos), e **extensível por módulo** (cada sprint adiciona suas tools no registry).

### Parte 1 — 3 camadas com gates progressivos

| Camada | Capacidade | Risco | Gate | Confirma UI? |
|---|---|---|---|---|
| **1. Help (RAG read-only)** | "Como faço X?", "O que significa Y?", "Pra que serve a aba Z?" | Baixo | Liberado por padrão (todos os papéis, todos os planos) | Não |
| **2. Insight (read data)** | "Qual minha mensalidade?", "Quantos alunos hoje?", "Última avaliação do João" | Médio (RBAC + RLS + scope) | Tools tipadas read-only (Server Actions com `isReadOnly: true`); RBAC propagado | Não |
| **3. Action (write)** | "Cancela a aula de amanhã", "Cria lead João Silva", "Abre 2ª via desse boleto" | Alto | Tools tipadas write; **confirmação UI obrigatória**; permission check duplo (LLM proposer + handler executor); audit reforçado | **Sim, sempre** |

**Camada 1** consome só o RAG global + docs do tenant. Resposta vem com citação (`source: ADR 0053`, `source: docs/sprints/04`). Cache semântico bate em 60-80% (perguntas comuns).

**Camada 2** chama Server Action read-only. Exemplo: tool `getMemberFinancialSummary({memberId})` — Server Action com `wrapAction()` (regra 33), valida `permission='financeiro.read'` no scope do user, retorna estrutura tipada Zod. LLM transforma em resposta natural. Sem confirmação UI (read não tem efeito colateral).

**Camada 3** segue um fluxo de 4 etapas:

```
1. LLM PROPÕE  → tool call `proposeAction({ tool: 'cancelAppointment', args: {...}, reason: '...' })`
2. UI RENDERIZA → <ActionConfirmDialog> mostra: o que vai acontecer + impacto + [Confirmar] [Cancelar] [Editar args]
3. USER CONFIRMA → fronted chama Server Action real `cancelAppointment(args)` com `wrapAction()` (regra 33)
4. AUDIT       → grava `audit_log` com `action_source='ai_assistant'` + `proposal_id` + decisão humana
```

Sem confirmação ⇒ sem execução. Mesmo se LLM tentar chamar a Server Action diretamente, ela **rejeita** se `actionSource === 'ai_assistant'` e não houver `proposal_id` confirmado em `assistant_action_proposals`.

### Parte 2 — Tool registry distribuído

Padrão idêntico a `registerMenuItem` (Sprint 00b) e `search_index_sync` (regra 30). Cada módulo registra suas tools no próprio package, em arquivo `tools.ts`:

```ts
// apps/web/app/(modules)/financeiro/ai-tools.ts
import { registerAITool } from '@repo/ai/registry';
import { generateInvoice2ndCopy } from './actions';

registerAITool({
  key: 'financeiro.invoice.second_copy',
  layer: 'action',                    // 'help' | 'insight' | 'action'
  label: { 'pt-BR': '2ª via de boleto', 'en-US': 'Invoice 2nd copy', 'es-419': 'Segunda vía de boleto' },
  description: { 'pt-BR': 'Gera nova URL de boleto com mesmo valor', /* ... */ },
  whenAvailable: ({ user }) => user.permissions.includes('financeiro.invoice.read'),
  showInPersonas: ['member', 'recepcao', 'admin'],
  argsSchema: z.object({ invoiceId: z.string().uuid() }),
  resultSchema: z.object({ url: z.string().url(), expiresAt: z.string() }),
  requiresConfirmation: true,
  confirmationCopy: ({ args, ctx }) => ({
    title: '2ª via do boleto',
    description: `Vai gerar nova URL para o boleto #${args.invoiceId}. URL antiga continua válida.`,
    impact: 'low',
    affectedEntities: [{ kind: 'invoice', id: args.invoiceId }],
  }),
  handler: generateInvoice2ndCopy,    // Server Action já wrapped em wrapAction()
  audit: { action: 'invoice.second_copy.generate', sensitive: false },
  rateLimitKey: 'financeiro.invoice.second_copy',
});
```

**Boot da app** carrega todos os arquivos `**/ai-tools.ts` (Vite glob/require.context) e popula a tabela `tools_registry` (refresh a cada deploy, similar a `search_index`).

**Lookup em runtime:** ao montar system prompt, LLM recebe **só as tools disponíveis pra persona + permissions atuais do user**. Outros vetores são invisíveis. Isso reduz tokens (não envia 200 tools desnecessárias) e força segurança em camada de prompt.

### Parte 3 — Personas por papel + system prompt composto

Estende `buildSystemPrompt()` (ADR 0064) com `persona`:

```ts
buildSystemPrompt({
  persona,        // 'member' | 'professional_clinical' | 'professional_coach' | 'admin' | 'recepcao' | 'super_admin' | 'contador_externo' | 'dpo'
  tenant, user, task, featureKey,
  globalRules,
  ragChunks,
  conversationHistory,
  userContext,    // dados em foco (member ativo, sessão, tela atual)
  availableTools, // ← NOVO: tools filtradas por persona+permission
})
```

Cada persona tem seu **template base** em `packages/ai/personas/*.ts`:

| Persona | Tom | Permissões IA | Tools típicas |
|---|---|---|---|
| `member` | Acolhedor, simples, sem jargão clínico | Só self (RBAC do próprio user); sem dado de outros members | `getMyAppointments`, `cancelMyAppointment`, `getMyInvoices`, `requestSecondCopy`, `searchHelp` |
| `professional_clinical` | Técnico, precavido (CFM 2.454: nunca prescrever, nunca diagnosticar) | scope=member em foco; consent ativo cruz-módulo | `findMember`, `summarizeEvolutions`, `findCidByDescription`, `createDraftEvolution`, `report_issue` |
| `professional_coach` | Operacional, mobile-friendly, foco em treino | scope=member do dia | `getNextStudent`, `getLastWorkoutMetrics`, `cloneLastWorkout`, `markAttendance` |
| `admin` | Direto, executivo | scope=tenant/company; permissions amplas | `findLead`, `createLead`, `getOverdueInvoices`, `runDREMonth`, `inviteUser` |
| `recepcao` | Operacional, transações comuns | scope=unit; permissions limitadas | `findMember`, `scheduleAppointment`, `markAttendance`, `requestSecondCopy` |
| `super_admin` | Estratégico, multi-empresa | scope=group; cross-company só com `franchise_agreements` ativos | `getRedeKPIs`, `getAlertsCritical`, `compareCompanies` |
| `contador_externo` | Read-only fiscal | permissions=`fiscal.read` apenas | `getInvoicesEmittedMonth`, `getRetentionsMonth`, `getDREYearToDate` |
| `dpo` | Compliance, auditoria | permissions=`compliance.*` | `listOpenSubjectRequests`, `listExpiringRIPDs`, `auditConsentChanges` |

**Detecção de persona:**

```ts
inferPersona(user, tenant): Persona {
  if (user.context === 'portal_member') return 'member';
  if (user.permissions.includes('compliance.dpo')) return 'dpo';
  if (user.role === 'contador_externo') return 'contador_externo';
  if (user.permissions.includes('super_admin.read')) return 'super_admin';
  if (user.permissions.includes('financeiro.write') || user.permissions.includes('agenda.write_full')) return 'admin';
  if (user.permissions.includes('prontuario.write') && user.professional_council === 'CRM|CRN|COFFITO') return 'professional_clinical';
  if (user.permissions.includes('agenda.write') && user.professional_council === 'CREF') return 'professional_coach';
  return 'recepcao';
}
```

User com permissions múltiplas pode trocar de persona via UI ("Falar como: Personal coach / Recepção"). Default vem da inferência.

### Parte 4 — UI universal: FAB global + página dedicada + atalhos

Adicionar à `<AppLayout>` (regra 31, ADR 0063):

```
<AssistantFAB />     → botão flutuante fixo bottom-right (mobile: 56×56px; desktop: 64×64px)
                       - badge "novo" quando há sugestão proativa
                       - tap abre <AssistantSheet> (mobile bottom sheet 92vh / desktop side panel 420px)
                       - drag-down em mobile fecha; Esc desktop fecha
                       - persona inferida + chip "Falar como: X" tocável
```

**Rotas:**

```
/app/assistente             → página dedicada (histórico + sessão atual + arquivar)
/app/assistente/[id]        → conversa específica (compartilhável dentro do tenant para co-trabalho)
/app/settings/ia            → admin tenant: BYOK + cota + white-label (já planejado Sprint 06)
/meu/assistente             → no Portal Paciente (PWA Sprint 26), assistente do member
/app/coach/assistente       → no PWA Coach (ADR 0074), assistente do personal
```

**Atalhos teclado:**

- `Ctrl+/` ou `Cmd+/` em qualquer tela `/app/*` → abre sheet
- `Ctrl+K` permanece em busca global (ADR 0062), separado mas com cross-link "Não achou? Pergunte ao assistente"
- `Esc` fecha sheet

**Mobile contextual:** se user está em `/app/members/[id]`, o FAB já abre com **contexto do member em foco** + tools filtradas por essa persona+escopo (ex: profissional vê `summarizeEvolutions(memberId)` pré-preenchido).

### Parte 5 — Cotas alinhadas a planos comerciais (ADR 0066)

| Plano | Limite mensal | Limite diário | O que conta? | BYOK |
|---|---|---|---|---|
| **Starter R$ 99** | 500 mensagens | ~50 msg/dia (soft) | Mensagens user (Camada 2 + 3) | — |
| **Pro R$ 199** | 3.000 mensagens | ~150 msg/dia (soft) | Idem | opcional via add-on |
| **Business R$ 449** | 10.000 mensagens | ~500 msg/dia (soft) | Idem | ✅ opcional |
| **Enterprise** | 25.000 mensagens (default) | sem limit diário | Idem | ✅ ilimitado quando ativo |

**Regras de contagem:**

- **Camada 1 (Help/RAG)** — pergunta com cache hit (`ai_semantic_cache.hit_count++`) custa **0**; cache miss custa **1**
- **Camada 2 (Insight)** — sempre custa **1** (chama LLM com contexto + tool result)
- **Camada 3 (Action)** — custa **1** pela proposta + **1** pela confirmação se LLM precisar reformular pós-execução = até 2
- **Tool execution** (Server Action chamada) **não conta** na quota IA — conta no rate limit normal das Server Actions (regra 36)
- **STT (transcription)** conta separado por **minuto** (Pro 60min, Business 300min, Enterprise 1500min — já em ADR 0066)

**Soft daily limit:** previne burn rápido (user fazendo 500 mensagens em 1 dia esgota 90% do mês). Excedido o diário → toast "Limite diário atingido. Aguarde até amanhã ou faça upgrade." (não bloqueia o mensal — só desencoraja burst).

**Excedido mensal:** circuit breaker → CTA "Configure BYOK" + bloqueia novas mensagens até próximo ciclo. Ações já em fila (Camada 3 pendente confirmação) podem terminar.

**Cache hit** preserva quota — incentivo natural pra perguntas comuns (Help). Cache TTL 30d global; perguntas idênticas no mês não consomem.

### Parte 6 — Whitelist inicial de tools Write seguras (MVP Sprint 06)

Camada 3 começa com **whitelist conservadora**. Tools de alto risco entram em sprints posteriores ou ficam fora.

**MVP Sprint 06 — Write tools liberadas:**

| Persona | Tool | Risco | Confirmação UI |
|---|---|---|---|
| `member` | `cancelMyAppointment(id)` | Baixo (próprio member) | Mostra aula + horário + política de cancelamento |
| `member` | `requestSecondCopy(invoiceId)` | Baixo | Confirma valor + vencimento + envia URL por email |
| `member` | `confirmAppointment(id)` | Baixo | Mostra detalhes + confirma |
| `professional_*` | `createDraftEvolution(memberId, content)` | Médio (rascunho, não assinado) | Mostra preview + autor pode editar antes |
| `professional_*` | `report_issue(title, description)` | Baixo | Mostra ticket que vai ser aberto |
| `recepcao` / `admin` | `createLead({name, phone})` | Baixo | Mostra dados + duplicate check |
| `recepcao` / `admin` | `scheduleAppointmentForMember(memberId, slot)` | Médio | Mostra slot + member + agenda |
| `recepcao` / `admin` | `requestSecondCopyForMember(memberId, invoiceId)` | Baixo | Confirma + log de quem solicitou |
| `admin` | `inviteUser({email, role})` | Médio | Mostra role + permissions resultantes |

**Bloqueado no MVP** (precisa permission especial OU action manual sem IA):

- ❌ `deleteMember`, `deleteInvoice`, `deletePrescription` — qualquer DELETE
- ❌ `signEvolution` (assinatura ICP-Brasil) — exige flow dedicado UI
- ❌ `chargeBatch` (cobrança em massa) — exige tela admin com confirmação dupla
- ❌ `anonymizeMember` (LGPD art. 18) — exige `/app/compliance/titular-requests`
- ❌ `transferMemberBetweenCompanies` — flow admin dedicado
- ❌ `runOpenFinancePayment` — pagamento real de fornecedor
- ❌ Qualquer tool que dispara cobrança Asaas em produção sem dry-run prévio
- ❌ Qualquer tool que muda configuração de tenant (`tenant_settings`, RBAC, plano)

**Convenção de código:** Server Action que **não** deve ser exposta ao LLM tem comentário literal `// ai-blocked: <motivo>` no topo. Lint custom `ai-block-respected` em CI verifica que nenhum `registerAITool` aponta para handler com esse comentário.

### Parte 7 — Esquemas novos

Em `packages/db/schema/ai.ts` (estende ADR 0064):

```sql
-- Registry de tools disponíveis no momento (refresh ao boot/deploy)
tools_registry
  id uuid pk
  key text unique             -- 'financeiro.invoice.second_copy'
  layer enum ('help','insight','action')
  module_path text             -- 'financeiro/ai-tools.ts'
  label_pt_br text
  description_pt_br text
  required_permission text nullable  -- ex: 'financeiro.invoice.read'
  required_consent_purpose text nullable
  required_vertical text nullable
  available_for_personas text[]      -- ['member','admin']
  args_schema_json jsonb
  result_schema_json jsonb
  requires_confirmation bool
  audit_action text nullable
  audit_sensitive bool default false
  rate_limit_key text nullable
  is_ai_blocked bool default false   -- handler tem `// ai-blocked` comentário
  active bool default true
  registered_at timestamp default now()
  updated_at timestamp default now()

-- Propostas de Camada 3 aguardando confirmação UI
assistant_action_proposals
  id uuid pk
  tenant_id uuid fk
  user_id uuid fk
  conversation_id uuid fk → ai_conversations
  message_id uuid fk → ai_messages       -- mensagem do LLM que propôs
  tool_key text fk → tools_registry.key
  args jsonb
  args_validated bool                    -- passou Zod parse
  reason_text text                       -- LLM explica por que essa ação
  confirmation_state enum ('pending','confirmed','rejected','expired','executed','failed')
  confirmed_at timestamp nullable
  executed_at timestamp nullable
  execution_result jsonb nullable
  expires_at timestamp                   -- 5min default; UI deve confirmar rápido
  created_at timestamp

-- Personas configuradas por tenant (override do default)
tenant_assistant_personas
  tenant_id uuid pk
  persona_overrides jsonb default '{}'   -- { 'member': { tone: 'casual', custom_intro: '...' } }
  enabled_personas text[] default array['member','admin','recepcao','professional_clinical','professional_coach']
  default_persona text                   -- usado quando inferência for ambígua

-- Audit estendido (extends ai_audit_log do ADR 0064)
ALTER TABLE ai_audit_log ADD COLUMN persona text;
ALTER TABLE ai_audit_log ADD COLUMN layer text;            -- 'help'|'insight'|'action'
ALTER TABLE ai_audit_log ADD COLUMN action_proposal_id uuid;  -- FK quando layer=action
ALTER TABLE ai_audit_log ADD COLUMN tool_keys text[];      -- tools chamadas no turn
```

**Particionamento (regra 34 + ADR 0072):**

- `assistant_action_proposals` → `@volume_estimate_yearly: 5M+` → particiona por mês; retenção 1 ano hot + 5 cold (alinha com `ai_audit_log`)
- `tools_registry` → tabela pequena (~500 linhas), não particiona

### Parte 8 — Fluxo end-to-end (exemplo "aluno cancela aula")

```
[USER aluno no Portal /meu]
  abre AssistantFAB → "cancela minha aula de amanhã"

[FRONTEND]
  POST /api/ai/chat { message, context: { route: '/meu' } }

[API ROUTE wrapApiHandler]
  - request_id gerado
  - rate limit check (regra 36): IA 20/min/user
  - quota check: tenant em Starter, 47 msg consumidas no mês → OK
  - inferPersona(user, tenant) → 'member'
  - getAvailableTools({persona:'member', permissions:['member.self']}) → [getMyAppointments, cancelMyAppointment, ...]
  - buildSystemPrompt({ persona:'member', availableTools, userContext: { memberId } })
  - resolveModelForTask('chat', 'assistant.member', tenantCtx) → Gemini Flash (LogiFit default)

[LLM TURN 1]
  - tool call: getMyAppointments({ from: 'tomorrow' })

[FRONTEND]
  - Server Action getMyAppointments wrapAction → retorna [{ id:'apt_1', start:'2026-04-25 09:00', resource:'Sala 2', kind:'pilates' }]
  - inject result no contexto

[LLM TURN 2]
  - decide: 1 aula amanhã → propor cancelamento
  - tool call: proposeAction({ tool:'cancelMyAppointment', args:{id:'apt_1'}, reason:'Aluna pediu cancelamento da aula de pilates amanhã 09h' })

[BACKEND proposeAction handler]
  - valida tool existe + persona='member' tem permissão
  - valida args via Zod (id é uuid)
  - INSERT assistant_action_proposals(state='pending', expires=+5min)
  - retorna { proposalId, confirmationCopy: { title, description, impact, affectedEntities } }

[FRONTEND]
  - render <ActionConfirmDialog proposalId>
    - "Cancelar aula de Pilates · 25/04 09:00 · Sala 2"
    - "Política: cancelamento até 12h antes não gera taxa"
    - [Confirmar] [Editar horário] [Cancelar proposta]

[USER aluno confirma]
  - POST /api/ai/proposals/{id}/confirm

[BACKEND confirm handler wrapAction]
  - valida proposal existe + não expired + state='pending'
  - update state='confirmed'
  - chama handler real cancelMyAppointment({id:'apt_1'}) wrapAction
    - permission check member.self → OK (próprio user)
    - update appointments status='cancelled'
    - emit appointment.cancelled event
    - audit_log INSERT { action:'appointment.cancel', source:'ai_assistant', proposal_id }
  - update proposal state='executed', execution_result
  - retorna { ok:true }

[FRONTEND]
  - confirma sucesso no chat: "Pronto, aula cancelada. Quer reagendar pra outro horário?"

[ai_audit_log] grava turn completo:
  { persona:'member', layer:'action', tool_keys:['getMyAppointments','cancelMyAppointment'],
    action_proposal_id:'...', tokens, cost, latency, human_decision:'accepted' }
```

### Parte 9 — Compliance integrada

- **Regra 28 (CFM 2.454/2026)** — quando persona=`professional_clinical` e tool toca dado clínico (evolução, prescrição, diagnóstico), gate de Comitê de IA aplicado igual ADR 0053. Aluno usando assistente em Portal **não cai em SaMD II+** (não há decisão clínica).
- **Regra 29 (LGPD art. 11)** — RIPD do módulo "Assistente IA universal" registrado em `ripd_documents` com versão vigente. Consent finalidade `ai_assistant_personal_data` no signup do tenant + opt-in no primeiro uso pelo member.
- **Regra 32 (resolveModelForTask)** — `featureKey='assistant.{persona}'` permite tier mínimo por persona (member usa Flash, profissional clínico exige Flash+).
- **Regra 33 (wrapAction)** — TODA tool é Server Action wrapped. Sem exceção.
- **Regra 35/ADR 0073 PII redaction** — `redactBeforeLLM()` aplicado em `userContext` antes de enviar pro LLM. CPF/email/telefone/endereço mascarados.
- **Regra 36 (rate limit)** — IA tem cap de 20/min já existente.
- **Regra 39 (audit hash chain)** — `ai_audit_log` particionada continua append-only com hash chain.

### Parte 10 — Telemetria PostHog

Novos eventos:

```
assistant.session_opened     { persona, route, device }
assistant.message_sent       { persona, tokens_in, layer, used_rag }
assistant.cache_hit          { query_hash, hit_count }
assistant.tool_called        { tool_key, layer, persona, latency_ms }
assistant.action_proposed    { tool_key, persona }
assistant.action_confirmed   { proposal_id, time_to_confirm_ms }
assistant.action_rejected    { proposal_id, reason? }
assistant.action_executed    { proposal_id, ok, latency_ms }
assistant.quota_warning      { tenant_id, percent_used }   // 80%
assistant.quota_blocked      { tenant_id }                 // 100%
```

Dashboard `/app/super-admin/ai-usage` (super_admin LogiFit) mostra:
- Top 10 tenants por consumo
- Top 10 tools mais usadas
- Cache hit rate global
- Latência média por persona
- % de propostas Camada 3 confirmadas vs rejeitadas (sinal de qualidade da IA)

## Consequences

### Positivas

- **Cobre 7 personas** com mesmo motor — econômico arquiteturalmente; cada sprint adiciona tools sem reescrever LLM stack
- **Camada 3 com confirmação UI** previne 99% dos casos de "LLM alucinou e executou ação errada" — confirmação dupla (LLM propõe + handler valida)
- **Tool registry distribuído** — segue padrão LogiFit já validado (`registerMenuItem`, `search_index`); sprint 12 (avaliações) registra suas tools sem tocar Sprint 06
- **Escalabilidade sem god-file** — 200 tools? cada uma no seu módulo, lookup em `tools_registry` indexada
- **Personas reduz tokens** — LLM recebe só ~10-15 tools relevantes em vez de 200; barato e mais preciso
- **Cache hit grátis** — incentivo natural pra Help (perguntas comuns)
- **Cotas concretas + alinhadas comercial** — ADR 0066 fica respeitado; user vê "47 de 500 mensagens" no UI
- **FAB universal** — assistente acessível em qualquer tela, mobile-first compliance (regra 31)
- **Compliance built-in** — regras 28/29/32/33/35/36/39 todas incorporadas; nada adicional pra acompanhar
- **Whitelist Write conservadora** — começa pequeno (~9 tools), expande conforme evidência empírica de uso seguro
- **Reusa ADR 0064** — não joga fora arquitetura existente; estende

### Negativas (mitigáveis)

- **Sprint 06 cresce de 3-4 semanas para 5-6 semanas** — aceitável pela urgência declarada; alternativa seria fragmentar em 06 + 06b mas a coerência se perde
- **Confirmação UI adiciona fricção** — 1 tap a mais por ação. Mitigado por: copy curta, foco em [Confirmar] como ação default (Enter), preview claro do impacto
- **LLM pode "desistir" de ação após confirmação** se feature flag mudar — precisamos passar handle de feature flags como parte do contexto pro LLM não propor ação que vai falhar
- **Tool registry refresh complexo em prod** — boot reanalisa todos arquivos `**/ai-tools.ts`; alternativa é gerar `tools_manifest.json` no build (Vercel deploy) e seedar tabela; decisão: manifest estático no build, runtime hot-reload em dev
- **Personas mal classificadas** — user com permissions ambíguas (admin que também atende como fisio) pode ser inferido mal. Mitigado por: chip "Falar como: X" sempre visível + persistência da última escolha
- **Custo de PostHog events** — 9 novos eventos × volume → estimar antes; pode caber no plano Free com sampling
- **Quota daily soft** — user volta no dia seguinte e descobre que pode falar de novo; UI precisa explicar bem ("Limite diário atingido — não consome do mensal")
- **Camada 3 abuso** — user testando assistente pode propor 50 ações sem confirmar. Mitigar: rate limit `proposeAction` 10/min (separa do chat)

### Riscos não endereçados

- **Idiomas pt-BR/en-US/es-419 (regra 27)** — system prompt + tool descriptions multilingues; trabalho não-trivial; tratar como entrega Sprint 06 sem deixar a desejar
- **Tenant com role custom** — admin criou role `recepcao_pleno` que não bate com nossas 7 personas → fallback `inferPersona` cai em `recepcao` por padrão; aceitável
- **Aluno mal-intencionado** propõe ação fora do scope → handler real rejeita por permission check; mas user pode burnar quota tentando; rate limit + soft daily limit cobrem
- **Conflito de tool nomes** entre módulos — `findMember` em `members/` e `findMemberFiscal` em `fiscal/`; chave deve ser sempre `<modulo>.<acao>` enforce no lint
- **Fluxos multi-step** ("primeiro cria lead, depois agenda aula experimental") — Camada 3 pede confirmação por ação; sequência longa fica chata. Solução: `proposeWorkflow({steps:[...]})` futuro (Fase 2) — não MVP

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Manter Copilot só ancorado em member (Sprint 06 original) | Perde casos aluno + admin + recepção; não atende pedido do usuário (qualquer usuário, tudo) |
| Camada 3 sem confirmação UI ("LLM executa direto") | Risco operacional alto; alucinação executada como verdade; vetor pra ataque social ("manda IA fazer X"); inaceitável |
| Tool registry centralizado em `packages/ai/tools.ts` | God-file; acopla módulos; viola separação por área (igual razão de search_index distribuído) |
| Persona única "assistente" sem distinção | Tokens explodem (200 tools enviadas sempre); LLM sugere ações fora do scope; UX ruim (aluno vê opções de admin) |
| Cota fixa por user (não tenant) | Conta complica; tenant grande seria incentivado a criar muitos users; manter por tenant alinha com modelo SaaS |
| Whitelist Write ampla (~50 tools no MVP) | Risco alto sem evidência empírica; preferimos liberar gradual conforme telemetria mostra "tool X confirmada 95% das vezes sem incidente" |
| FAB só em `/copilot` (não global) | Usuário precisa lembrar de ir lá; perde o ganho de "assistente em qualquer tela" |
| Modal centered em mobile | Pior UX; bottom sheet é padrão iOS/Android |
| Confirmação por senha/PIN | Excesso de fricção; confirmação UI clara é suficiente para Camada 3 conservadora |
| Streaming SSE substituído por WebSocket | SSE já funciona em Vercel + Supabase Realtime; WebSocket adiciona overhead sem ganho real |
| Manifest gerado em runtime (sem `tools_registry`) | Perde dashboard super_admin de tools ativas; perde lint cross-deploy; tabela é mais barata |

## Escopo de impacto

**Sprints ajustados:**

- **Sprint 06 — expandido** (ver detalhes em `docs/sprints/06-geral-copilot-base.md`):
  - Renomeia para "Assistente IA universal base"
  - Adiciona Camada 1/2/3 framework + `<ActionConfirmDialog>` + `<AssistantFAB>` + `<AssistantSheet>` + `tools_registry` + `assistant_action_proposals` + 7 personas + cotas alinhadas a planos comerciais (ADR 0066) + whitelist inicial Write tools (~9)
  - Cresce de 3-4 semanas → 5-6 semanas
- **Sprints 02, 03, 04, 05, 08, 09, 10, 11, 12, 13, 15, 17, 19, 20, 21, 22, 24, 26, 30, 31, 32, 33, 36** — cada um adiciona arquivo `<modulo>/ai-tools.ts` registrando suas tools (esforço ~1-2 dias por sprint, faz parte do checklist Definition of Done)
- **Sprint 26 (portal paciente PWA)** — adiciona `/meu/assistente` no shell PWA
- **Sprint 11 (treinos coach PWA)** — adiciona `/app/coach/assistente` no shell coach (ADR 0074)

**Schemas novos** (em `packages/db/schema/ai.ts`):

```sql
tools_registry              -- ~500 linhas, não particiona
assistant_action_proposals  -- particionada por mês, @volume_estimate_yearly: 5M+
tenant_assistant_personas   -- 1 linha por tenant, não particiona

ALTER ai_audit_log ADD COLUMN persona, layer, action_proposal_id, tool_keys[]
```

**Regra nova:**

- **Regra 41** — Toda Server Action de módulo que deve ser usável pelo Assistente IA registra-se em `tools_registry` via `registerAITool({...})` em arquivo `<modulo>/ai-tools.ts`. Server Action que **não** deve ser exposta ao LLM tem comentário literal `// ai-blocked: <motivo>` no topo do handler. Lint custom `ai-block-respected` em CI verifica que `registerAITool` nunca aponta para handler com `ai-blocked`. Tools Camada 3 (write) sempre têm `requiresConfirmation: true` e fluem por `<ActionConfirmDialog>` antes de executar. LLM **nunca** chama Server Action diretamente — sempre via `proposeAction(toolKey, args)` que cria registro em `assistant_action_proposals` aguardando confirmação UI; handler real rejeita execução se `actionSource='ai_assistant'` sem `proposal_id` confirmado.

**Docs:**

- `docs/rules.md` — adiciona regra 41
- `docs/modulos.md` — atualiza linha "Copilot chat (IA)" → "Assistente IA universal" + adiciona linhas 3 camadas / tool registry / ActionConfirmDialog / FAB / personas
- `docs/sprints/06-geral-copilot-base.md` — refactor mantendo número
- `CLAUDE.md` — adiciona regra 41 na lista
- `CHANGELOG.md` — entrada deste ADR
- `docs/comercial.md` — destaca "Assistente IA universal" como diferencial vs concorrentes

**Telas a prototipar (alta prioridade):**

- `prototipo/telas/assistente-fab-mobile.html` — FAB + bottom sheet 92vh viewport 375×812
- `prototipo/telas/assistente-confirm-action.html` — `<ActionConfirmDialog>` mostrando proposta de cancelamento
- `prototipo/telas/assistente-persona-switcher.html` — chip "Falar como: X" com 3 personas disponíveis
- `prototipo/telas/assistente-quota-warning.html` — UI quando 80% e 100% da quota mensal

## Related

- Estende [ADR 0064 — Arquitetura IA (Gemini default + BYOK + RAG)](0064-ia-arquitetura-gemini-default-byok-rag.md) — usa toda a fundação (tasks tipadas, system prompt composto, BYOK, RAG, cache, fallback)
- Estende [ADR 0066 — Plano comercial](0066-plano-comercial-pricing-trial.md) — cotas IA alinhadas aos 4 tiers (500/3k/10k/25k+)
- Estende [ADR 0070 — Insights cross-module + timeline integrada](0070-insights-cross-module-timeline-integrada.md) — assistente consome `member_insights` cache para Camada 2
- Estende [ADR 0073 — Postura segurança defesa em profundidade](0073-postura-seguranca-defesa-em-profundidade.md) — camada 5 (PII redaction + anti-prompt-injection) aplicada; tool calling sempre via `wrapAction()` (camada 3)
- Reusa pattern [ADR 0062 — Pesquisa global Command Palette](0062-pesquisa-global-command-palette.md) — `tools_registry` segue mesmo padrão de `search_index` (registry distribuído por módulo + sync trigger)
- Reusa pattern Sprint 00b `registerMenuItem` — distribuição por módulo
- Reforça [ADR 0053 — CFM 2.454/2026](0053-conformidade-cfm-2454-2026-ia-saude.md) — gate de Comitê de IA aplicado em persona profissional clínica
- Reforça [ADR 0054 — LGPD art. 11](0054-lgpd-art11-dados-saude-ripd-versionado.md) — RIPD novo "Assistente IA universal"
- Estende [ADR 0063 — Responsividade total mobile-first](0063-responsividade-total-mobile-first.md) — FAB obrigatório em `<AppLayout>`
- Integra com [ADR 0074 — Modo Coach mobile-first PWA](0074-modo-coach-mobile-first-pwa.md) — coach acessa assistente no PWA dedicado

## Referências

- Pattern de "Action Confirmation" inspirado em Anthropic Tool Use docs (gateway humano em ações destrutivas)
- Pattern de "registry distribuído" inspirado em rotas Next.js convention-based + Sprint 00b LogiFit
- Telemetria PostHog inspirada em produtos copilot (Cursor, GitHub Copilot Workspace) onde % de aceitação é métrica chave
- Comparação com concorrentes: Tecnofit, Trainerize, iClinic, Feegow — nenhum oferece assistente IA universal com Camada 3 (write actions com confirmação); LogiFit fica isolado no diferencial
