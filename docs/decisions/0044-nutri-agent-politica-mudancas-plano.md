---
slug: nutri-agent-politica-mudancas-plano
status: proposed
date: 2026-05-18
---

# ADR 0044 — Política de mudanças automáticas em plano alimentar (Nutri-Agent)

## Contexto

ADR 0043 define a arquitetura do Nutri-Agent. Este ADR fecha a decisão **operacional crítica**:

**O Nutri-Agent pode editar `meal_plans` direto? Ou tudo é proposta com revisão profissional obrigatória?**

A questão impacta:
- Responsabilidade clínica (CFN 599/2018 — registro do nutricionista é ato profissional)
- Supervisão humana CFM 2.454/2026 (regra 28)
- LGPD art. 20 (decisão automatizada — paciente tem direito à revisão humana)
- ANVISA SaMD Classe II (RDC 657/2022)
- UX (autonomia do nutri vs intervenção do agent)

## Decisão

### **NUNCA mudança automática. SEMPRE proposta com revisão profissional.**

`nutri_agent_suggestions` é a **única superfície de output** do agent. Workflow:

1. Agent detecta padrão → cria `nutri_agent_suggestions status='pending'`
2. Profissional revisa em `/app/nutri-agent` (lista filtrável por severity)
3. Profissional decide: `acceptSuggestion(applyChanges=true|false)` ou `rejectSuggestion(reason)`
4. Se `applyChanges=true` + `kind='plan_adjustment'`:
   - Sprint 34b: aciona `updateMealPlan` (Sprint 29 ADR 0081 pattern) → cria new version do meal_plan
   - `nutri_agent_suggestions.applied_meal_plan_id` FK = id do novo plano
   - Audit: `reviewed_by_user_id` + `reviewed_at` registrados
5. Se rejeitado: `status='rejected' + rejection_reason` registrados (Sprint 34c usa pra training feedback)

**Nenhum path bypassa profissional.** `runNutriAgentForMember` NUNCA escreve em `meal_plans`, NUNCA cria `prescriptions`, NUNCA chama Server Actions de Sprint 29 que mutariam plano. Só insere em tabelas `nutri_agent_*`.

### Razões (todas inegociáveis)

#### 1. Responsabilidade profissional (CFN 599/2018)

Ato profissional do nutricionista (registro eletrônico) **exige assinatura humana**. Plano alimentar prescrito é ato sujeito a fiscalização do CRN. Sistema mudar automaticamente significa:
- Nutri perde traceabilidade (não sabe quando IA mudou nem por quê)
- CRN pode questionar quem é o responsável técnico
- Em ação judicial: "quem prescreveu este ajuste?" — agent sem assinatura humana = nutri responde por algo que não autorizou

#### 2. Regra 28 CFM 2.454/2026 — supervisão humana

CFM 2.454/2026 estabelece que toda decisão IA em saúde (não só medicina; nutri é regulada também) **exige supervisão humana documentada**. Comitê IA do tenant verifica conformidade. Mudança automática viola direto.

#### 3. LGPD art. 20 — direito à revisão humana

Art. 20: titular tem direito a solicitar revisão de decisões tomadas unicamente com base em tratamento automatizado de dados pessoais que afetem seus interesses. Plano alimentar é decisão que afeta saúde — automação direta cai diretamente nesse artigo.

#### 4. ANVISA SaMD Classe II (RDC 657/2022)

Agent é **Software as Medical Device Classe II** (auxílio decisão clínica). Software de Classe II que **executa decisão automática** subiria pra Classe III (alto risco) — exigiria registro pleno ANVISA (vs notificação Classe II). LogiFit evita Classe III por design (CLAUDE.md).

#### 5. Risco real de erro do agent

Detectores podem falhar em casos atípicos:
- Atleta de alto rendimento com IMC "obeso" mas com composição corporal saudável
- Paciente com TCA — déficit calórico não significa problema do plano
- Gestante com necessidades únicas
- Período de cutting esportivo intencional

Nutri sabe o contexto que o agent não tem. Sem revisão: agent + algoritmo errados = plano errado entregue ao paciente.

### Excedido: o que o agent **pode** fazer sem revisão?

- **Audit-only**: registrar `runs` + `metrics_snapshot` + `suggestions pending` (audit sempre permitido)
- **Notificar nutri**: criar `system_alerts` em casos `critical` (sempre notifica, nunca executa)
- **Pre-consult summary**: gerar resumo descritivo (sem ação) pra nutri ler antes da consulta (Sprint 34b)

Tudo **acima é descritivo** (leitura + descrição). Não é prescritivo (ato profissional).

### O que dispara approval do nutri?

A maioria dos `suggestions` exige profissional ativo, mas há gradação por severity:

| Severity | UX padrão |
|---|---|
| `critical` | Vai pra tela de fila com badge vermelho; ainda exige profissional confirmar antes de qualquer ação |
| `attention` | Vai pra fila normal; profissional revisa no fluxo |
| `info` | Vai pra fila secundária; nutri vê quando entra no detail do member |

Mesmo `critical` **não escala pra mudança automática** — só prioriza UX da fila.

### Workflow visual

```
[Run Agent]
    │
    ▼
[Pattern Detector] (deterministic)
    │
    ▼
[Suggestion Generator] (deterministic)
    │
    ▼
[Classifier Anti-diagnóstico] (regra 28 reuse Sprint 33)
    │
    ▼
[Persist nutri_agent_suggestions status='pending']  ◄── ÚNICO output
    │
    ▼
[Profissional revisa em /app/nutri-agent]
    │
    ├──► [acceptSuggestion(applyChanges=true)] ──► Sprint 34b: updateMealPlan (cria new version)
    ├──► [acceptSuggestion(applyChanges=false)] ──► só marca accepted (sem aplicar)
    └──► [rejectSuggestion(reason)] ──► status='rejected' + reason
```

### Exception: cancelamento + alerta crítico

Único caso de **ação automática** que avaliamos: paciente registra valor crítico (ex: glicemia 400 mg/dL no diário) — agent dispara `system_alerts` + WhatsApp ao nutri sem aguardar revisão.

**Mas isso não muda plano**; apenas notifica. Continua respeitando a política (decisão clínica fica com o humano).

## Mecanismos de enforcement

1. **Server Action `runNutriAgentForMember`** só insere em `nutri_agent_*`. Verificável.
2. **`nutri_agent_suggestions` schema** tem `status` default `'pending'`. Default seguro.
3. **`applied_meal_plan_id`** FK populado **apenas** quando `acceptSuggestion(applyChanges=true)` (Sprint 34b). FK NULL = não aplicado.
4. **Audit**: toda transição status (`pending → accepted | rejected`) grava `reviewed_by_user_id + reviewed_at`. Se NULL → check constraint rejeita.
5. **Lint custom (Sprint 34b)**: `no-nutri-agent-direct-write` bloqueia commit que tente importar `Drizzle.update(mealPlans)` em arquivos `packages/ai/src/nutri-agent/*` ou `apps/web/app/app/nutri-agent/*`.

## Consequências

✅ **Positivas:**
- Responsabilidade profissional preservada
- LGPD art. 20 respeitada
- ANVISA Classe II (não escala pra Classe III)
- Agent é assistente; profissional é decisor
- Erros do agent não viram erros do plano

⚠️ **Trade-offs aceitos:**
- UX requer profissional online (não 100% automação)
- Aceitar 100 sugestões manualmente é overhead — Sprint 34c mitigá com bulk-accept de info-level
- Pacientes com nutri ausente esperam revisão (não há autoplay)
- Métrica de "tempo até aceitar" é importante (Sprint 34b adicionar)

⚠️ **Decisões adiadas (Sprint 34b/c):**
- `acceptSuggestion(applyChanges=true)` integração Sprint 29 `updateMealPlan` (cria new meal_plan version + linka `applied_meal_plan_id`)
- Lint custom `no-nutri-agent-direct-write`
- Bulk-accept de info-level
- Métrica "tempo até aceitar" no dashboard
- Notificação push ao nutri quando `critical` aparece (Sprint 13 régua)
- Rejection feedback feeds training (Sprint 34c: feedback loop pra melhorar detectores)
- Override Enterprise: nutri pode pré-aprovar "tipos de mudanças automáticas dentro de range" (ex: `±100 kcal` em target sem revisar) — **rejeitada para MVP**; reabrir se cliente real pedir + ADR adicional + revisão jurídica/regulatória

## Alternativas consideradas

| Opção | Rejeitada por |
|---|---|
| Auto-apply pra suggestions de baixa severity (info) | Mesmo info pode estar errado; nutri precisa ver contexto |
| Auto-apply pra changes pequenos (±10% target kcal) | Definir "pequeno" é arbitrário; risco de drift acumulado |
| Pre-approval de "tipos" de mudança pelo nutri | Confunde — nutri ainda precisa decidir caso a caso; complexidade UX vs benefício nulo |
| Auto-apply quando confidence > 0.95 | Agent não sabe contexto clínico completo; confidence alta não significa segurança alta |
| Permitir tenant Enterprise opt-in pra auto-apply | Risco regulatório + responsabilidade — reabrir só com cliente real pedindo + ADR adicional + revisão jurídica |

## Status

Proposed — promove para **Accepted** quando Sprint 34b implementar:
- `acceptSuggestion(applyChanges=true)` integração com updateMealPlan
- Lint custom `no-nutri-agent-direct-write`
- E2E Playwright validando que não existe code path que escreve em meal_plans sem revisão

## Referências

- [Sprint 34 — Nutri-Agent IA](../sprints/34-nutri-agent-ia.md)
- [ADR 0043 — Nutri-Agent arquitetura](0043-nutri-agent-arquitetura.md) (par)
- [ADR 0053 — CFM 2.454/2026 IA saúde](0053-conformidade-cfm-2454-2026-ia-saude.md)
- [ADR 0054 — LGPD art. 11 + RIPD versionado](0054-lgpd-art11-dados-saude-ripd-versionado.md)
- [ADR 0081 — meal_plans versionado (updateMealPlan pattern)](0081-meal-plans-versionado-estrutura.md)
- [ADR 0084 — Cross-alert: profissional confirma adaptação (mesma decisão)](0084-cross-alert-cid-contraindicacao.md)
- ANVISA RDC 657/2022 — SaMD classes I/II/III/IV
- CFN 599/2018 — registro eletrônico do nutricionista
- CFM 2.454/2026 — IA em medicina + supervisão humana documentada
- LGPD art. 20 — direito à revisão humana de decisões automatizadas
- [regra 28 — IA SaMD II+ exige Comitê IA + supervisão humana](../rules.md#28-ia-samd-comite)
