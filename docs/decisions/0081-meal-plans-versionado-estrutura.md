---
slug: meal-plans-versionado-estrutura
status: proposed
date: 2026-05-18
---

# ADR 0081 — Plano alimentar versionado + estrutura `meal_plans` / `meal_plan_meals` / `meal_items`

## Contexto

Sprint 29 entrega o **plano alimentar interativo** — segunda parte do par de ADRs nutri (junto com [ADR 0080](0080-banco-alimentos-taco-nutrients-jsonb.md)). Decisões fundamentais:

1. **Estrutura hierárquica** — quantos níveis de tabela?
2. **Versionamento** — `parent_meal_plan_id` (Sprint 11 pattern) ou row update?
3. **Cálculo nutricional** — view materializada, gatilho ou função pura em runtime?
4. **Lista de substituições** — gerada por IA, calculada em runtime, ou curada?
5. **Targets** — kcal/protein/carb/lipid no plano ou no contrato (Sprint 04)?

## Decisão

### 1. **3 níveis**: `meal_plans` → `meal_plan_meals` → `meal_items`

```
meal_plans
  ├─ id, tenant_id, member_id, prescription_id?,
  ├─ name, goal (enum), target_kcal/protein_g/carb_g/lipid_g
  ├─ version, parent_meal_plan_id?, active, starts_at, ends_at
  └─ notes, created_by_user_id, archived_at, ...

meal_plan_meals (refeições)
  ├─ id, tenant_id, meal_plan_id (FK), name ("Café", "Almoço", ...)
  ├─ expected_time?, order, notes
  └─ created_at

meal_items (alimentos por refeição)
  ├─ id, tenant_id, meal_id (FK), food_id (FK), grams, measure?, notes, order
  └─ created_at
```

**Por quê 3 níveis e não 2** (achatando meal_items direto em meal_plans com `meal_name` text):
- Plano tem refeições com **observações próprias** (`expected_time`, `notes` da refeição)
- UI faz drag-drop entre refeições; cada refeição é unidade visual independente
- Cálculo nutricional gera total por refeição **e** total do plano — 2 níveis de agregação naturais
- Mantém `meal_items.meal_id` UNIQUE constraint por order, evita ordenação confusa

### 2. **Versionamento via `parent_meal_plan_id` + Sprint 11 pattern** (NÃO UPDATE in-place)

Mesma estratégia de `workouts` Sprint 11:
- Editar plano ativo NÃO atualiza row — cria nova com `version+1` e `parent_meal_plan_id` = original
- Marca antigo `active=false` na transação
- Cria nova prescription (se houver) apontando pro novo plano — antiga preserva `refId` imutável (regra Sprint 11)

```ts
async function updateMealPlan(parsed) {
  await db.transaction(async (tx) => {
    await tx.update(mealPlans).set({ active: false }).where(eq(mealPlans.id, parent.id))
    const [newPlan] = await tx.insert(mealPlans).values({
      ...parsed,
      version: parent.version + 1,
      parentMealPlanId: parent.id,
      active: true,
    }).returning()
    // copia meals + items
    // ...
  })
}
```

**Por quê não UPDATE**:
- **Auditoria** — prontuário do paciente preserva histórico completo (Lei 13.787/2018 retenção 20 anos quando ato de CRN; ADR 0080 + 0028)
- **Prescrições antigas** continuam apontando pro `meal_plan` original (`prescriptions.refId` imutável Sprint 11)
- Paciente em `/meu/cardapio` (Sprint 26) pode ver "versão atual" + "versões anteriores"
- Cron diário fecha `active` quando `ends_at < now()` — sem destruir o histórico

### 3. **Cálculo nutricional via função pura em runtime** (NÃO materialized view nem trigger)

Função `calculateMealPlanNutrition(meals)` em `packages/db/src/nutri/calc.ts`:
- Recebe `meals[]` com `nutrients` já carregados (caller faz JOIN)
- Itera + escala por gramas + soma — função pura, testável (20 unit tests Sprint 29)
- Roda no servidor (cobertura RLS via JOIN + `app.tenant_id`)

**Por quê não trigger / materialized view**:
- Cálculo é **derivado** — não precisa estar persistido
- Editar 1 item dispara re-cálculo de tudo (trigger seria caro)
- Mat view exigiria refresh — operação custosa em base grande
- Função pura testa offline; trigger não

**Trade-off**: cada render de `/app/nutri/planos/[id]` faz cálculo do zero. Aceitável — payload típico (10 meals × 10 items) é ~100 rows. Sprint 29b: cache simples em `meal_plans.cached_totals jsonb` (recomputado em INSERT/UPDATE de item via Server Action; não trigger).

### 4. **Lista de substituições via `food_equivalences` curadas + ranking runtime**

Equivalências são **rows curadas** em `food_equivalences` (`tenant_id NULL` = global; tenant override). Server Action `listSubstitutions(itemId, topN=5)` retorna top-N ordenados por proximidade calórica via lib pura `rankEquivalents()`:

```
score = |seedKcal - candidateKcal| / seedKcal
ordena ascendente; topN primeiros
```

**Por quê não IA generativa**:
- Substituição precisa fazer **sentido clínico** (não substituir azeite por suco)
- Curadoria estatística > inferência estocástica (mesmo padrão ADR 0084 contraindicações)
- Determinístico + auditável
- Sprint 29 entrega 20 equivalências canônicas via seed; expansão gradual + tenant override

**Por quê não calcular tudo em runtime** (pegar todos foods e ordenar por kcal):
- Substituições precisam ser **clinicamente válidas** dentro da mesma categoria (carbo↔carbo); não trocar arroz por azeite só porque kcal bate
- Curadoria captura nuance (ex: "feijão preto ≡ lentilha" pra proteína vegetal, mas não "feijão ≡ manteiga" mesmo se kcal próximo)

### 5. **Targets no `meal_plan`** (NÃO no contrato Sprint 04)

`meal_plans.target_kcal / target_protein_g / target_carb_g / target_lipid_g` — nullable, preenchido pelo nutricionista ao criar o plano.

**Por quê não em `contracts`** (Sprint 04 financeiro):
- Targets nutricionais mudam a cada plano (paciente em fase de emagrecimento → manutenção → ganho)
- Contrato representa relação comercial (plano financeiro do paciente), não programação clínica
- Múltiplos planos podem coexistir (gestante + diabético em fases distintas) — cada um com seu target

Sprint 29b: targets auto-pré-preenchidos via TDEE do treino (`member_insights.tdee` ADR 0070) quando consent `nutri_sees_training` ativo — função `suggestTargets(memberId, goal)` retorna kcal + macros split por objetivo (emagrecimento -15%, ganho +15%, etc).

## Polimorfismo com Sprint 11 `prescriptions`

`prescriptions.kind='meal_plan'` + `refId = meal_plans.id` — mantém pattern de Sprint 11 ADR 0023. Quando o nutricionista assina o plano como ato profissional (CRN), cria-se `prescriptions` apontando pro `meal_plans.id` ativo:

```sql
INSERT INTO prescriptions (tenant_id, member_id, kind, ref_id, starts_at, prescribed_by_user_id)
VALUES ($1, $2, 'meal_plan', $meal_plan_id, NOW(), $crn_user_id)
```

`meal_plans.prescription_id` FK opcional aponta de volta (atalho para query rápida). NULL = plano draft (não prescrito formalmente).

## Compare against targets — função pura

`compareAgainstTargets(totals, targets)` retorna `TargetGap[]`:

```ts
type TargetGap = {
  key: 'kcal' | 'protein_g' | 'carbohydrate_g' | 'lipid_g'
  current: number
  target: number
  delta: number  // current - target
  status: 'low' | 'on_target' | 'high'  // ±10% tolerância
}
```

UI mostra **gap visual** por métrica com emoji + cor. Sprint 29b: alertas automáticos quando balanço calórico desalinha com volume de treino do paciente (cross-module ADR 0070).

## Consequências

✅ **Positivas:**
- Estrutura clara e testável (3 níveis casam com mental model do nutricionista)
- Versionamento preserva histórico clínico (Lei 13.787 + CRN)
- Cálculo determinístico via função pura — fácil testar + auditar
- Targets no plano facilitam tracking de meta (não confunde com financeiro)
- Substituições curadas + ranking runtime balanceiam qualidade e flexibilidade

⚠️ **Trade-offs aceitos:**
- Cálculo nutricional acontece a cada page render (~100 rows típicas) — aceitável; cache em Sprint 29b se virar gargalo
- 20 equivalências canônicas no seed inicial — Sprint 29b expande gradualmente
- Drag-drop editor visual fica Sprint 29b (a página `/app/nutri/planos/[id]` MVP é read-only)
- Export PDF com branding ainda não funcional — Sprint 29b conecta `@react-pdf/renderer`
- Targets manuais MVP; auto-pré-preenchido via TDEE em Sprint 29b
- Sem split de macros opinião por objetivo (emagrecimento → 30/40/30 P/C/L?) — Sprint 29b adiciona `suggestMacroSplit(goal)`

⚠️ **Decisões adiadas (Sprint 29b/c):**
- Editor drag-drop visual completo + cálculo instantâneo client-side
- Auto-pré-preenchimento de targets via TDEE (ADR 0070)
- `suggestMacroSplit(goal)` heurística
- Cache `meal_plans.cached_totals jsonb` (recomputado em Server Action)
- 10 planos modelo via seed (emagrecimento + ganho massa + vegetariano + cetogênico + low carb + diabético + renal + gestante + esportivo + outro)
- Export PDF com branding (`@react-pdf/renderer` + `tenant_branding` Sprint 29)
- RIPD `v1.0-nutri-plano.md` + DPO sign-off (regra 29)
- Feature flag `nutri_plano_v1`
- Widget `<MealPlanCard />` Sprint 28 GenUI (componente já tem placeholder)
- Integração `/meu/cardapio` Sprint 26 portal (member vê plano + download PDF)
- E2E Playwright (montar plano + versionar + exportar)
- Migration data file TACO completa (3000+ entries)
- Plano alimentar gerado por IA Copilot (stretch ADR 0085 GenUI)

## Alternativas consideradas

| Opção | Rejeitada por |
|---|---|
| 2 níveis (achatar `meal_plan_meals` em jsonb dentro de `meal_plans`) | Perde RLS granular + ordenação fica tabela inteira; ALTER rows pesa |
| UPDATE in-place sem versão | Perde histórico clínico (Lei 13.787) + prescrições antigas viram inválidas |
| Materialized view de totals | Refresh custoso + complexidade > benefício (cálculo é barato) |
| Trigger PG recalcula totals em insert/update | Mais lock + mais complexidade SQL + sem audit chain claro |
| Substituições por IA runtime | Não-determinístico + custo + risco de sugestões clinicamente questionáveis |
| Targets em `contracts` Sprint 04 | Confunde domínio comercial com clínico; mudar plano não deveria editar contrato |

## Cenário de uso

1. Nutricionista vai em `/app/members/[id]` → "Criar plano alimentar"
2. `createMealPlan` Server Action recebe `{ memberId, name, goal, targetKcal, meals: [{name, items: [{foodId, grams}]}] }` — transação cria plano + meals + items
3. UI render `/app/nutri/planos/[id]` com 4 KPIs (kcal/P/C/L) comparados aos targets + breakdown por refeição + breakdown por item
4. Nutricionista clica "Editar" → `updateMealPlan` cria v2 + marca v1 inactive + nova prescription
5. Paciente em `/meu/cardapio` (Sprint 26+) vê v2 ativa + opção "ver versões anteriores"
6. Substituições: nutri clica item → modal mostra top-5 equivalentes via `listSubstitutions` → escolhe → cria item replacement no plano

## Status

Proposed — promove para **Accepted** quando Sprint 29b implementar editor drag-drop + auto-targets via TDEE + PDF + feature flag em produção piloto com ≥10 planos reais criados.

## Referências

- [Sprint 29 — Nutri TACO + Plano alimentar](../sprints/29-nutri-alimentos-e-plano.md)
- [ADR 0080 — Banco alimentos TACO/USDA nutrients jsonb](0080-banco-alimentos-taco-nutrients-jsonb.md) (par)
- [ADR 0023 — Prescrições polimórficas versionamento workouts](0023-prescricoes-polimorficas-base.md) (pattern reusado)
- [ADR 0070 — Cross-module insights TDEE](0070-insights-cross-module-timeline-integrada.md) (targets auto Sprint 29b)
- [ADR 0085 — Generative UI (`<MealPlanCard />` placeholder)](0085-generative-ui-framework.md)
- [ADR 0088 — Portal paciente magic link (consumo `/meu/cardapio`)](0088-portal-member-magic-link-auth.md)
- Lei 13.787/2018 — retenção 20a prontuário eletrônico
- CFN 599/2018 — registro eletrônico do nutricionista
- [regra 7 — Zod boundary](../rules.md#7-zod-boundary)
- [regra 28 — IA SaMD II+](../rules.md#28-ia-samd-comite)
