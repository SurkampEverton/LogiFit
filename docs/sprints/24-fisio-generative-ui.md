# Sprint 24 — Fisio · Generative UI (cards de relatório)

- **Área:** fisio (fundação de Generative UI que depois se estende)
- **Início:** planejado (depois do Sprint 23)
- **Fim planejado:** +3 semanas
- **Status:** planejado (futuro) — **fecha a Fase 2**
- **Item do roadmap:** #26

## Goal

Primeira implementação de Generative UI no produto: resposta do Copilot (Sprint 06) não renderiza só texto — renderiza **componentes ricos** (gráfico de evolução, card de paciente, sugestão de CID com link, lista de exercícios recomendados) que o usuário pode clicar e interagir. Foco inicial: relatórios clínicos do fisio.

## Critério de aceite

- Framework de Generative UI: o modelo retorna **tool calls** com schema Zod, que são mapeadas para componentes React registrados
- Registro de componentes disponíveis: `<PatientCard />`, `<EvolutionChart />`, `<CidSuggestion />`, `<ExerciseRecommendation />`, `<MeasurementComparison />`, `<ReportSection />`
- Pergunta do fisio "resumo do paciente X" gera resposta com `<PatientCard>` + `<EvolutionChart>` + `<ReportSection>` — em vez de texto corrido
- Componente é interativo: clicar em CID sugerido adiciona ao prontuário atual (se tela permitir)
- Streaming progressivo dos componentes (server sends events conforme tool calls são recebidos do modelo)
- Guardrails: modelo só pode invocar componentes registrados; entrada validada por Zod; erros graciosos
- Novos componentes podem ser adicionados sem mudar o copilot (plugável)
- Teste E2E: perguntar "relatório do Marcelo" → resposta tem card + gráfico; clicar no gráfico abre zoom; clicar em CID propõe adicionar
- Auditoria: tool calls registradas em `ai_messages.tool_calls` (auditoria + debugging)

## Dependências

- Sprint 06 (Copilot base)
- Sprint 12 (avaliações — gráficos reusam dados)
- Sprint 16 (consultas — CID vem daqui)
- Sprint 17 (evolução)

## Decisões tomadas / ADRs esperados

- **ADR 0034 (esperado)** — Generative UI: provider (Vercel AI SDK `ui.streamUI` ou framework próprio), registro de componentes, validação Zod por tool, streaming SSE → React. Componentes auditáveis (não código arbitrário).
- **Pergunta aberta:** hard-coded components vs dinâmicos — começar com registro fixo (seguro); dinamic (LLM escreve JSX) fica fora de escopo indefinidamente (risco de segurança inaceitável).

## Módulos entregues

Ver [`modulos.md` — Geral e Fisio](../modulos.md#geral):

- Framework Generative UI
- Catálogo de componentes clínicos
- Streaming de tool calls
- Auditoria de tool calls

## Rotas Next.js

- `/app/copilot` (estendido do Sprint 06) — agora suporta componentes
- `/app/members/[id]/copilot` (estendido) — contexto do paciente

## Server Actions + API Routes

API Routes:

- `POST /api/ai/chat` (estendido do Sprint 06) — ganha suporte a tool calls + streaming de componentes via SSE

## Schemas Drizzle (esperado)

Minimal — estende `ai_messages` do Sprint 06:

- `ai_messages` **ganha coluna** `tool_calls jsonb nullable` — array de `{ name, args, result_component }`

## Eventos de domínio emitidos

- `copilot.tool_invoked` — `{ tool_name, args, at }` (para analytics de uso)

## Commit (checklist)

- [ ] Migration: `ai_messages.tool_calls`
- [ ] Framework em `packages/ai/genui/registry.ts` com `registerUIComponent({ name, schema, Component })`
- [ ] Componentes iniciais em `packages/ui/genui/`: `PatientCard`, `EvolutionChart`, `CidSuggestion`, `ExerciseRecommendation`, `MeasurementComparison`, `ReportSection`
- [ ] API route estendida para streaming tool calls
- [ ] Parser e renderer no cliente (`<GenUIMessage />`)
- [ ] Prompt engineering: instrui o modelo a usar components ao invés de texto sempre que apropriado (com exemplos few-shot)
- [ ] Guardrails: componentes recebidos mas não registrados → warning + fallback para texto
- [ ] Auditoria de tool calls em `ai_messages.tool_calls`
- [ ] Testes: componentes recebem dados reais (via RLS do member_id em contexto) + streaming funciona
- [ ] Testes E2E: perguntas clínicas geram resposta com componente; clicar interage corretamente
- [ ] Feature flag `genui_v1`
- [ ] ADR 0034 publicado

## Stretch

- [ ] Componentes para Academia: `<WorkoutCard />`, `<TrainingHistory />`
- [ ] Componentes para Nutri (prepara Fase 3): `<MealPlanCard />`, `<NutritionTable />`
- [ ] Persistência do layout (conversa lembra componentes renderizados)
- [ ] Exportar resposta como PDF com layout componente preservado

## Log

- —

## Definition of Done

- [ ] Feature flag `genui_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] Streaming funciona em dev + staging
- [ ] Auditoria completa das tool calls
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 24 → `done`
- [ ] **Fase 2 encerrada** — Fisio em produção
- [ ] ADR 0034 publicado

## Retro

- —
