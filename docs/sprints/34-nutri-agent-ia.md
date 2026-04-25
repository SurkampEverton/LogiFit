<!-- Stub. Quando virar `doing`, expandir para o formato completo de [`_template.md`](_template.md) — Goal, Critério de aceite, Dependências, Decisões/ADRs, Módulos entregues, Rotas, Server Actions/API, Schemas Drizzle, Eventos, Commit checklist, Stretch, Log, Definition of Done. -->

# Sprint 34 — Nutri-Agent IA (cruza dados Academia + Fisio + Nutri)

- **Área:** nutri/ia
- **Início:** planejado (Fase 3, depois do Sprint 33)
- **Fim planejado:** +3 semanas
- **Status:** planejado (futuro)
- **Item do roadmap:** #36

> **Stub** — este sprint ainda não tem detalhamento profundo. Arquivo nasceu para preencher gap de numeração no roadmap; será expandido quando virar candidato a `doing` (próximo 1-2 da fila), conforme convenção em [`roadmap.md`](../roadmap.md).

## Goal (rascunho)

Agente IA dedicado à nutrição que cruza:

- **Plano alimentar** (Sprint 29) + **diário alimentar** (Sprint 31)
- **Antropometria** (Sprint 12) + tendências de peso/circunferências
- **Treino** (Sprint 11) + gasto calórico via MET (ADR 0070)
- **Prontuário Fisio** (Sprint 20) — restrições, lesões, hipóteses
- **Device readings** (Sprint 32) — HR contínuo, sono, atividade
- **Lab results** (Sprint 33) — perfil lipídico, glicêmico, hormonal

Para gerar:

- Sugestões conservadoras de ajuste no plano alimentar (sempre **revisão humana obrigatória** — regra 28)
- Alertas de aderência abaixo do esperado (consome `domain_events`)
- Resumo "estado nutricional" pré-consulta para nutricionista
- Detecção de pattern de risco (ex: déficit calórico extremo + cortisol alto + sono ruim)

## Pré-requisitos

- Sprints 29, 30, 31, 32, 33 concluídos
- Comitê IA tenant cadastrado (regra 13/28) — **gate funcional bloqueia ativação sem ata**
- Classificação SaMD: provável **Classe II** (auxílio decisão clínica) — exige ANVISA notificação
- RIPD `v1.0-nutri-agent.md` (Sprint 01b/Sprint 33 já estabeleceram template)

## Decisões esperadas

- ADR 0043 (esperado) — Arquitetura Nutri-Agent: agente especializado vs Copilot generalizado com persona "nutricionista"
- ADR 0044 (esperado) — Política de mudanças automáticas em plano alimentar (sempre proposta, nunca write direto)

## ADRs já fechados que se aplicam

- [ADR 0053](../decisions/0053-conformidade-cfm-2454-2026-ia-saude.md) — CFM 2.454 + classificação SaMD
- [ADR 0054](../decisions/0054-lgpd-art11-dados-saude-ripd-versionado.md) — RIPD obrigatório
- [ADR 0064](../decisions/0064-ia-arquitetura-gemini-default-byok-rag.md) — IA arquitetura
- [ADR 0070](../decisions/0070-insights-cross-module-timeline-integrada.md) — insights cross-module
- [ADR 0075](../decisions/0075-assistente-ia-universal-tres-camadas-tool-registry.md) — 3 camadas + tool registry
- [ADR 0077](../decisions/0077-passaporte-paciente-vinculo-cross-tenant.md) — passaporte cross-tenant (alcance dos dados)
