# ADR 0027 — Estratégia de modelo para previsão de churn

- **Status:** Proposed
- **Date:** 2026-04-27

## Context

[Sprint 19 — IA · Previsão de churn](../sprints/19-ia-previsao-churn.md) entrega o primeiro caso de **IA preditiva** do LogiFit: prever a probabilidade de cada `member` (academia) cancelar nos próximos 30 dias com base em sinais comportamentais (frequência check-in, último treino, mudança de plano, atrasos de pagamento, NPS, engajamento WhatsApp).

Ao contrário de IA generativa (chat/copilot — ADR 0064 e ADR 0075), churn é **classificação binária** com features estruturadas. Três famílias de implementação são viáveis:

| Família | Exemplo | Prós | Contras |
|---|---|---|---|
| **A. Prompt engineering em LLM** | Gemini Flash recebe JSON de features → retorna `{score, reason}` | Zero infra; rápido para baseline; explicabilidade narrativa nativa | Caro em volume (R$ por inferência); latência ~2-5s; não-determinístico; cota IA mensal pesa |
| **B. Modelo local sklearn / XGBoost** | Treinado em Python + servido via Vercel Edge ou Supabase Edge Function | Custo marginal zero; latência <100ms; explicabilidade via SHAP | Exige pipeline de retreino; dataset histórico necessário (3-6 meses); MLOps; bibliotecas Python no edge |
| **C. Serviço dedicado** | Hugging Face Inference API ou SageMaker Endpoint | Sem MLOps próprio; escalável | Custo fixo mensal mesmo sem uso; sub-processor adicional na lista LGPD |

LogiFit é solo dev no MVP — qualquer escolha precisa ser **operacionalmente leve** e ter **caminho de evolução** se a primeira escolha não escalar.

## Decision

Adotar **estratégia em 2 fases**:

### Fase 1 (Sprint 19) — Família A com prompt engineering estruturado

Implementar inicialmente via **Gemini 2.5 Flash** (provider default — ADR 0064) com prompt determinístico:

```ts
// packages/ai/churn/predict.ts
async function predictChurn(memberId: string, ctx: TenantContext): Promise<ChurnPrediction> {
  const features = await collectChurnFeatures(memberId, ctx);  // 12-15 features estruturadas
  const result = await callAI({
    task: 'classification',                                    // task tipada — ADR 0064
    schema: ChurnPredictionSchema,                             // Zod schema do output
    systemPrompt: buildChurnSystemPrompt(),                    // composto — ADR 0064
    input: features,
    temperature: 0,                                            // determinismo
    cacheKey: `churn:${memberId}:${features.snapshotHash}`,    // cache 24h
  });
  return result;  // { score: 0..1, label: 'low'|'medium'|'high', reasons: string[] }
}
```

Escolha justificada para baseline:
- **Tempo até produção:** <1 sprint (vs 4-6 sprints para Família B com pipeline ML completo)
- **Sem dados históricos no MVP:** academia precisa rodar 3+ meses antes de ter dataset balanceado para treinar modelo local
- **Cache 24h** mata custo recorrente — predição de churn não muda dia a dia
- **Cota IA mensal já controlada** (regra 32, ADR 0064) — `predictChurn` consome do mesmo bucket

### Fase 2 (Sprint pós-19, após 3 meses de dados) — Migração para Família B se justificar

Gatilhos para migração:
- **Volume:** >500 predições/dia/tenant médio (custo Família A vira problema)
- **Qualidade:** baseline LLM <70% precision OU recall — sklearn provavelmente supera
- **Latência:** UX exige <500ms (LLM tem cauda ruim em P95)

Pipeline planejado para Fase 2:
1. **Retreino mensal** — job `retrain-churn-model` consome `churn_training_data` (snapshots históricos com label real "cancelou em 30d")
2. **Modelo servido** via Supabase Edge Function (TS + onnxruntime-web) — sem dependência Python nativa
3. **Versionamento** — `churn_model_versions (version, sha256, accuracy, deployed_at)`
4. **A/B test** — 10% do tráfego em modelo novo por 2 semanas antes de promover

### Compatibilidade entre fases

Wrapper `predictChurn(memberId)` mantém **mesma assinatura** em ambas fases — só muda implementação interna. Nenhum consumidor (UI dashboard, banner WhatsApp régua, alerta operador) sabe qual fase está rodando.

## Consequences

### Positivas

- **Sprint 19 entrega valor em 3 semanas** sem MLOps próprio
- **Cota IA mensal já tem hard-stop** (ADR 0064) — churn ruim não estoura conta
- **Cache 24h** torna custo previsível: ~R$ 0,01 por member/mês
- **Caminho de evolução claro** — se baseline saturar, troca implementação sem refactor de consumidores
- **Explicabilidade nativa** — Gemini retorna `reasons[]` em texto humano, útil para CRM ("Cliente em risco — última visita há 14 dias + mudou para plano básico")

### Negativas (mitigáveis)

- **LLM não-determinístico em casos de borda** — `temperature=0` mitiga, mas não elimina. Mitigação: schema Zod valida output; falha → fallback para heurística simples (`score = 1 - frequencia_30d/frequencia_90d`)
- **Cota IA do tenant pode ser consumida por churn em vez de copilot** — adicionar feature flag por tenant `ai_churn_enabled` (default true em Pro+, opt-in em Starter)
- **Sem ground truth no MVP** — não dá para medir precision/recall até 3 meses de operação. Mitigação: instrumentar `churn_predictions_log` agora para coletar dataset de retreino futuro

### Riscos não endereçados

- **Gemini ficar caro** — `resolveModelForTask('classification')` (ADR 0064) permite trocar para Haiku/GPT-mini sem refactor
- **Dataset desbalanceado em academia** — clinicas têm taxa de churn ~5-10%; dataset pequeno pode treinar modelo enviesado em Fase 2. Mitigação: SMOTE ou class weight em retreino
- **Cliente não querer IA preditiva** — feature flag por tenant + opt-in explícito em painel admin

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Família B direto no Sprint 19 | Sem dataset histórico → treinar com toy data; MLOps sólido para solo dev = 4-6 sprints |
| Família C (HuggingFace Inference) | Custo fixo mensal mesmo sem uso; sub-processor adicional na lista LGPD; sem ganho real vs Família A |
| Heurística simples sem IA | Funciona como fallback, não como produto. Cliente paga por "IA de churn", não por regra `if frequencia<X` |
| Churn via Copilot ad-hoc | Não escala — operador pergunta caso a caso. Precisamos predição em batch + alerta proativo |
| Modelo local Python via Lambda dedicada | Adiciona infra (Lambda BR + cold start) sem necessidade no MVP; reavaliar Fase 2 |

## Escopo de impacto

- **Sprint 19** — `packages/ai/churn/predict.ts` (Família A), schema `churn_features_snapshots` (snapshot diário por member para dataset futuro), schema `churn_predictions_log` (auditoria + dataset de retreino), UI dashboard `/app/insights/churn`
- **Sprint 06** — registrar `predictChurn` em `tools_registry` Camada 2 (Insight) — ADR 0075
- **Sprint pós-19 (futuro)** — pipeline retreino (não criado neste ADR; será ADR de submissão quando gatilho disparar)
- **Cota IA** — `predictChurn` conta no bucket `task=classification` da `ai_tenant_usage` (ADR 0064)

## Related

- Implementa [Sprint 19 — IA · Previsão de churn](../sprints/19-ia-previsao-churn.md)
- Consome [ADR 0064 — IA arquitetura](0064-ia-arquitetura-gemini-default-byok-rag.md) — `resolveModelForTask('classification')`
- Integra [ADR 0075 — Assistente IA universal](0075-assistente-ia-universal-tres-camadas-tool-registry.md) — `predictChurn` exposto como tool Camada 2
- Reforça regra 32 (CLAUDE.md) — chamada IA via `resolveModelForTask`, nunca hardcode
