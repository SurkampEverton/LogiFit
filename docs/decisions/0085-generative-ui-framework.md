---
slug: generative-ui-framework
status: proposed
date: 2026-05-18
---

# ADR 0085 — Framework de Generative UI (cards de relatório clínico via tool calls)

## Contexto

Sprint 28 fecha a Fase 2 entregando a primeira implementação de **Generative UI** no produto: resposta do Copilot Sprint 06 não renderiza apenas texto — renderiza **componentes ricos** (card de paciente, gráfico de evolução, sugestão de CID com link, lista de exercícios recomendados, comparação de medições, blocos de relatório) que o usuário pode visualizar e interagir.

Decisões fundamentais que este ADR fecha:

1. **Arquitetura** — provider Vercel AI SDK `streamUI`, framework próprio, ou outro?
2. **Registro de componentes** — dinâmico (LLM escreve JSX) ou estático (componentes registrados)?
3. **Validação de args** — JSON Schema, Zod runtime, ou ambos?
4. **Persona-aware** — quais tools cada persona pode invocar?
5. **Auditoria** — onde grava as tool calls?
6. **Streaming** — SSE progressivo ou batch único?

## Decisão

### 1. Framework próprio sobre `assistantMessages.toolCalls jsonb` (Sprint 06)

Sem dependência de Vercel AI SDK `streamUI` no MVP — usamos a estrutura `tool_calls` já preparada no schema Sprint 06 (`assistantMessages.toolCalls jsonb`) e modelamos blocos canônicos `GenUIMessageBlock` (`text | tool_call`). Vantagens:

- **Zero migration nova** — coluna `tool_calls` já existe desde Sprint 06
- **Provider-agnóstico** — funciona com Gemini, Claude, GPT-4 (qualquer LLM com tool calling); LogiFit usa `resolveModelForTask('chat')` (regra 32)
- **Auditável** — cada tool call vira row em `assistantMessages` com `tool_calls jsonb` versionada por mês (regra 5 + ADR 0072)
- **Não acopla a streaming** — MVP entrega batch; Sprint 28b adiciona SSE sem refactor (mesma estrutura de blocos)

Sprint 28b vai conectar LLM real via Vercel AI SDK `generateObject` com schema = união discriminada dos tool args + handler de streaming.

### 2. **Registro estático** (LLM nunca controla qual componente renderiza)

Catálogo fixo de tools registradas via `registerUIComponent({ name, description, argsSchema, ... })` em runtime — singleton map em `packages/ai/src/genui/registry.ts`. **Dynamic UI** (LLM escreve JSX) **foi rejeitada explicitamente**: risco de segurança inaceitável (XSS, code injection, output não-auditável) + viola regra 28 CFM 2.454/2026 (toda decisão IA clínica precisa ser auditável e classificada por SaMD).

**Duplo registro** proposital:
1. Registrar tool em `packages/ai/src/genui/tools.ts` (schema Zod)
2. Adicionar entrada no dispatch fixo em `packages/ui/src/genui/gen-ui-message.tsx`

Cada novo componente exige PR review nos dois pontos — força auditoria de surface de ataque. LLM nunca cria entrada nova nesse mapa.

### 3. **Validação Zod runtime** com `validateToolCall(call, ctx)` + 4 guardrails

`validateToolCall` retorna `GenUIValidationResult` discriminado. Quatro guardrails:

1. **Tool não-registrada** → `unknown_tool` — LLM alucinou nome de tool
2. **Args não passam pelo Zod** → `schema_violation` + detalhes (path + mensagem)
3. **Persona não permitida** → `persona_not_allowed` — `member` não pode invocar `cid_suggestion`
4. **Mutação tentada** → `mutation_attempted` — toda tool MVP tem `readOnly: true`; futuras tools com mutação passam por `proposeAction` (ADR 0075), não por GenUI

Validação falha → componente vira texto curto `[Componente X bloqueado: <reason>]` + audit grava o bloqueio. Cliente nunca recebe args inválidos.

### 4. **Persona-aware** via `allowedPersonas[]` em cada tool

Tools como `cid_suggestion` exigem profissional clínico (CRM/CREFITO) — coach (CREF/CONFEF) **não pode** invocar (apoio diagnóstico é ato exclusivo médico/fisio CFM 2.299/COFFITO 414). Configurado por tool:

```ts
{
  name: 'genui.fisio.cid_suggestion',
  allowedPersonas: ['professional_clinical'],
  ...
}
```

Tools sem `allowedPersonas` declarado = disponíveis pra todas as personas. Default catálogo Sprint 28:

| Tool | Personas permitidas |
|---|---|
| `genui.fisio.patient_card` | professional_clinical, professional_coach, admin |
| `genui.fisio.evolution_chart` | professional_clinical, professional_coach, admin |
| `genui.fisio.cid_suggestion` | **professional_clinical apenas** |
| `genui.fisio.exercise_recommendation` | professional_clinical, professional_coach |
| `genui.geral.measurement_comparison` | professional_clinical, professional_coach, admin |
| `genui.geral.report_section` | professional_clinical, professional_coach, admin |

`member` não invoca nenhuma das tools default — paciente vê texto + componentes simples (`/meu/alertas` Sprint 27 ou Sprint 26 portal); Sprint 28b cria tools dedicadas pra member quando UX exigir.

### 5. **Auditoria** em `assistantMessages.toolCalls` + audit_log wrapper

Cada Server Action `composeGenUIResponse` (via `wrapServerAction`) grava em `audit_log` com:

- `module='ai-genui'`, `action='genui.compose'`, `resource_type='assistant_messages'`, `resource_id = assistant_messages.id`
- `payload`: `{ session_id, tool_calls_count, tool_calls_ok, tool_calls_blocked }`

A coluna `assistantMessages.toolCalls jsonb` armazena array de `{ name, ok, reason, at }` — cobre o cenário "LLM tentou invocar componente bloqueado" (audit forense) e "LLM invocou X com args Y" (debugging).

Sprint 28b adiciona `ai_audit_log` row separada para cada tool call com input/output hashes (regra 39 + ADR 0072 hash chain).

### 6. **Batch MVP** + SSE em Sprint 28b

MVP retorna lista completa de blocos em uma única resposta (`POST /api/ai/genui` ou `composeGenUIResponse` Server Action). Trade-off aceito: UX menos "wow" que streaming progressivo, mas:

- Mais simples de auditar (tudo num único insert)
- Mais simples de testar (sem state machine de stream)
- Mais simples de cachear (response key = hash do prompt + persona + memberId)

Sprint 28b: `/api/ai/genui/stream` usa SSE + cliente acumula blocos conforme chegam + render progressivo. Mesma estrutura `GenUIMessageBlock` — sem refactor.

## Catálogo inicial (Sprint 28)

6 tools cobrindo o uso clínico fisio + base pra Academia/Nutri:

| Tool | Componente | Categoria |
|---|---|---|
| `genui.fisio.patient_card` | `<PatientCard />` | clínico |
| `genui.fisio.evolution_chart` | `<EvolutionChart />` (SVG nativo) | clínico |
| `genui.fisio.cid_suggestion` | `<CidSuggestion />` | clínico |
| `genui.fisio.exercise_recommendation` | `<ExerciseRecommendation />` | academia |
| `genui.geral.measurement_comparison` | `<MeasurementComparison />` | geral |
| `genui.geral.report_section` | `<ReportSection />` (markdown leve) | geral |

Sprint 28b/29 adiciona: `<WorkoutCard />`, `<TrainingHistory />`, `<MealPlanCard />`, `<NutritionTable />`.

## Estrutura no monorepo

```
packages/
  ai/src/genui/
    types.ts           # GenUIToolDefinition, GenUIToolCall, GenUIMessageBlock, ...
    registry.ts        # registerUIComponent, getToolDefinition, validateToolCall, ...
    tools.ts           # 6 tools default + registerDefaultGenUITools()
    registry.test.ts   # 18 unit tests
  ui/src/genui/
    patient-card.tsx
    evolution-chart.tsx
    cid-suggestion.tsx
    exercise-recommendation.tsx
    measurement-comparison.tsx
    report-section.tsx
    gen-ui-message.tsx # renderer principal com dispatch fixo
    index.ts

apps/web/app/
  app/copilot/
    genui-actions.ts                 # composeGenUIResponse Server Action
    genui-demo/page.tsx              # demo Server Component
    genui-demo/form.tsx              # form client + render
  api/ai/genui/route.ts              # POST endpoint (batch MVP)
```

## Consequências

✅ **Positivas:**
- Provider-agnóstico — funciona com qualquer LLM com tool calling
- Auditável — Zod runtime + persona check + `assistantMessages.toolCalls` jsonb + audit_log
- Seguro — registro estático impede LLM de injetar componentes arbitrários
- Persona-aware — `cid_suggestion` bloqueado para coach por design
- Extensível — adicionar componente é 2 PRs (registry + dispatch)

⚠️ **Trade-offs aceitos:**
- Curadoria estática limita criatividade do LLM — toleramos em troca de auditabilidade
- Batch MVP perde feel de "stream chegando" — Sprint 28b resolve sem refactor
- LLM stub determinístico no Sprint 28 — produção real exige conectar Vertex AI Gemini + tool calling (Sprint 28b)
- `<EvolutionChart />` é SVG manual (sem Recharts) — pequeno trade-off de polish em troca de zero dependência nova

⚠️ **Decisões adiadas (Sprint 28b/c):**
- Streaming SSE real (cliente acumula blocos progressivamente)
- LLM real via Vercel AI SDK + `resolveModelForTask('chat')` + tool calling (Vertex AI Gemini default)
- Componentes adicionais: `<WorkoutCard />`, `<TrainingHistory />`, `<MealPlanCard />`, `<NutritionTable />` (depende Sprint 11 + Sprint 29)
- Recharts pra `<EvolutionChart />` com tooltips, zoom, drill-down
- Persistência do layout (conversa lembra componentes renderizados em re-load)
- Export PDF com layout componente preservado
- Few-shot examples no system prompt LLM pra alinhar formato de tool calls
- E2E Playwright (perguntar "relatório do Marcelo" → render card + chart + section)
- Feature flag `genui_v1`
- Markdown leve em `<ReportSection />` substituir regex por `remark-parse` sanitizado
- Tool calls com `result_component` (Sprint 28b: tool retorna dados + nome do componente; LLM compõe via tools como ferramentas, não como retornos finais)

## Alternativas consideradas

| Opção | Rejeitada por |
|---|---|
| Vercel AI SDK `streamUI` direto | Acoplamento ao SDK + provider lock-in implícito; nosso `resolveModelForTask` exige abstração superior; pode complementar Sprint 28b mas não substitui |
| LLM escreve JSX dinâmico | Risco XSS + sem audit + sem persona check + sem schema validation; viola regra 28 |
| JSON Schema (sem Zod) | Zod já é padrão no repo (regra 7); tipo TS gerado nativo > codegen externo |
| Sem persona check (tools livres a todos) | Coach renderizando `cid_suggestion` quebra ato exclusivo CFM/COFFITO |
| Persistir tool defs em `tools_registry` Sprint 06 | Aquela tabela é pra tools de ação (Server Actions); GenUI tools são runtime-only (não persistem) |
| Streaming obrigatório MVP | Complica estado de UI + audit em pieces; batch é mais simples sem perder funcionalidade essencial |

## Cenário de uso (Sprint 28 demo)

`/app/copilot/genui-demo` aceita prompt e demonstra:

- **"resumo do Marcelo"** → texto + `<PatientCard />` + `<ReportSection />`
- **"evolução da dor lombar"** → texto + `<EvolutionChart />`
- **"CIDs prováveis pra lombalgia"** → texto + `<CidSuggestion />`
- **"exercícios pra reabilitação lombar"** → texto + `<ExerciseRecommendation />` com flag `avoid` em agachamento livre (ADR 0084 integração)
- **"comparação antes/depois"** → texto + `<MeasurementComparison />`
- **"relatório completo"** → todos os componentes encadeados

Resposta usa stub determinístico no Sprint 28 — Sprint 28b conecta LLM real.

## Status

Proposed — promove para **Accepted** quando Sprint 28b implementar LLM real + streaming + feature flag em produção piloto com ≥50 conversas reais usando GenUI.

## Referências

- [Sprint 28 — Generative UI v1](../sprints/28-fisio-generative-ui.md)
- [ADR 0064 — IA arquitetura (resolveModelForTask)](0064-ia-arquitetura-gemini-default-byok-rag.md)
- [ADR 0075 — Assistente IA universal 3 camadas + tool registry](0075-assistente-ia-universal-tres-camadas-tool-registry.md)
- [ADR 0053 — Conformidade CFM 2.454/2026 IA saúde](0053-conformidade-cfm-2454-2026-ia-saude.md)
- [ADR 0084 — Cross-alert CID → contraindicação (integração com `<ExerciseRecommendation />` flag)](0084-cross-alert-cid-contraindicacao.md)
- [regra 28 — IA SaMD II+ exige Comitê IA + ai_audit_log](../rules.md#28-ia-samd-comite)
- [regra 32 — chamada IA via resolveModelForTask, nunca hardcode provider](../rules.md#32-resolveModelForTask)
- [regra 44 — design system Equilíbrio Vital (tokens --ev-*)](../rules.md#44-design-system)
