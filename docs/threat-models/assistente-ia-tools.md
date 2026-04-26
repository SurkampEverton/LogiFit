# Threat Model STRIDE — Assistente IA universal (tool calling write)

> **Stub** — Threat model esperado para o Assistente IA universal ([ADR 0075](../decisions/0075-assistente-ia-universal-tres-camadas-tool-registry.md) + regra 41), implementado a partir de [Sprint 06](../sprints/06-geral-copilot-base.md) e expandido em sprints subsequentes (cada módulo registra suas tools). Será expandido. Template-base em [`_template-stride.md`](_template-stride.md).

- **Feature:** Assistente IA universal — 3 camadas (Help/Insight/Action) + tool registry distribuído (`registerAITool` em `<modulo>/ai-tools.ts`) + `proposeAction` + `<ActionConfirmDialog>` + audit
- **Sprint:** 06 (base) + 07-36 (cada sprint registra suas tools)
- **Data:** stub criado em 2026-04-25
- **ADR de referência:** ADR 0075 + ADR 0064 (provider IA)

## Superfície de ataque (a expandir)

A superfície é grande porque cada módulo expõe Server Actions ao LLM. O threat model expandido precisa cobrir:

```
[Usuário fala com FAB]
        │
        ▼
[LLM (Gemini Flash padrão; BYOK opcional)]
        │
        ├── Camada 1 (Help) — RAG sobre docs/ → resposta direta
        ├── Camada 2 (Insight) — read-only via Server Actions tipadas
        └── Camada 3 (Action) — proposeAction(toolKey, args)
                │
                ▼
        [assistant_action_proposals (state=pending, expira 5min)]
                │
                ▼
        [Usuário confirma via <ActionConfirmDialog>]
                │
                ▼
        [Server Action real exige proposal_id válido — proteção dupla]
```

## Análise STRIDE (a expandir antes de cada nova tool entrar)

| Ameaça | Cenário-chave |
|---|---|
| **S**poofing | LLM se identifica como usuário e chama Server Action sem proposal — `actionSource='ai_assistant'` sem proposta deve dar `FORBIDDEN` |
| **T**ampering | Atacante via prompt injection no input do member faz LLM propor tool com args maliciosos — confirmation dialog mostra args claros |
| **R**epudiation | Usuário nega ter confirmado tool — `assistant_action_proposals` + `audit_log` (regra 5/39) registram com hash chain |
| **I**nformation disclosure | Tool de leitura retorna dado fora do escopo do user (não respeita RBAC) — `wrapAction` valida permissions (regra 33) + tool deve usar `whenAvailable({user, tenant})` |
| **D**enial of service | Bombardeio de `proposeAction` — rate limit por `(tenant_id, user_id)` em IA 20/min/user (regra 36) |
| **E**levation of privilege | Tool exposta sem `// ai-blocked` para Server Action sensível (DELETE, signEvolution, chargeBatch, anonymizeMember, etc) — lint `ai-block-respected` mitiga |

## Riscos específicos a investigar

- Prompt injection multi-turn (LLM ataca a si mesmo via histórico de conversa)
- Cross-tool chaining (LLM combina insight + write para extrair dado que não deveria — ex: lista members + propõe ação só pra "vazar" lista no diálogo)
- BYOK (tenant configura modelo próprio Anthropic/OpenAI) — provider externo lê todos prompts; declarar como sub-processor + DPA (ADR 0067)
- Generative UI (Sprint 28) — LLM gera componentes; validar Zod por tool (ADR 0034 esperado)
- Modo Coach (ADR 0074) — assistente embarcado em PWA mobile, novo vetor

## Referências

- [ADR 0075 — Assistente IA universal](../decisions/0075-assistente-ia-universal-tres-camadas-tool-registry.md)
- [ADR 0064 — IA arquitetura Gemini default + BYOK](../decisions/0064-ia-arquitetura-gemini-default-byok-rag.md)
- [Regra 41 em rules.md](../rules.md)
- [SaMD classification](../compliance/samd-classification.md)
