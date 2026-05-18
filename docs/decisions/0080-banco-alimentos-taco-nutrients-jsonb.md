---
slug: banco-alimentos-taco-nutrients-jsonb
status: proposed
date: 2026-05-18
---

# ADR 0080 — Banco de alimentos TACO/USDA com nutrients em jsonb

## Contexto

Sprint 29 abre a Fase 3 entregando o **banco de alimentos nacional** + **plano alimentar interativo**. Decisões fundamentais que este ADR fecha:

1. **Estrutura de nutrientes** — tabela 1:N (`food_nutrients`) vs jsonb na própria row de `foods`?
2. **Catálogo global vs custom** — quem decide quais alimentos existem?
3. **Medidas caseiras** — schema separado ou em jsonb?
4. **Idempotência do seed** — como atualizar a TACO sem duplicar?
5. **Faixas fisiológicas** — onde validar limites razoáveis (kcal ≤ 900, protein ≤ 100g, etc)?

ADR 0081 cobre `meal_plans` (estrutura + versionamento).

## Decisão

### 1. **`foods.nutrients jsonb`** com schema Zod estrito (NÃO tabela 1:N)

Estrutura final:

```ts
foods (
  id, tenant_id?, source ('taco' | 'usda' | 'custom'),
  external_code?, name, name_normalized, category, subcategory?, preparation?,
  nutrients jsonb,  // 30+ campos canônicos
  density_g_per_ml?, active, created_at, updated_at
)
```

**Por quê jsonb e não 1:N (`food_nutrients`)**:

- **Volume nutricional é estático** por alimento (não muda em runtime); 1:N de tabela inteira por food é overhead de JOINs sem ganho real
- **Acesso é sempre "todos os nutrients de um food"** (nunca "qual food tem mais cálcio?" sem cruzar com objetivo do plano) — jsonb com `@>` operador + index GIN cobre todos os filtros nutricionais
- **Facilita import/export TACO/USDA** — esses bancos chegam como JSON; 1:N exigiria parsing por nutriente
- **Validação consolidada** em uma função pura (`NutrientsSchema` Zod em `packages/db/src/nutri/nutrients-schema.ts`) — tabela 1:N exigiria check por linha

Trade-offs aceitos:
- Adicionar novo nutriente exige update do Zod schema (e re-validação dos seeds) → ok, frequência de mudança é anual ou menor
- Buscar "alimentos com >15g protein" exige `nutrients @> '{"protein_g":15}'` — funciona via GIN, mas é menos óbvio que `WHERE protein_g > 15` num join. Aceitamos a verbosidade.

### 2. **Catálogo global LogiFit + tenant custom**

`foods.tenant_id` nullable:
- **NULL** = catálogo global (TACO ~3000 alimentos, USDA stretch). RLS policy permite SELECT por todo `logifit_app`; INSERT/UPDATE/DELETE rejeitados (curadoria via `platform_admin` direto no banco).
- **NOT NULL** = alimento custom do tenant (alimento local, preparação interna). RLS isola por `tenant_id`.

Mesmo padrão de `exercises` Sprint 11 e `cid_exercise_contraindications` Sprint 27 (ADR 0084). **Override per tenant** vem em equivalences/measures também — clínica pode preferir medidas caseiras locais ("escudela 200ml" vez de "concha média 80g") sem mexer no global.

### 3. **`food_measures` separada** (não em jsonb)

```ts
food_measures (
  food_id, measure (text), grams (numeric), display_order, created_at
)
// PK (food_id, measure)
```

Trade-off oposto ao de nutrients:
- Medidas caseiras são **listas curtas variáveis** (1–6 por food); jsonb seria lista de objetos sem benefício
- UI precisa **ordem** (display_order) e renderiza dropdown — query separada com `ORDER BY` é mais natural
- Cada food tem subset diferente de medidas — esquema fica heterogêneo se virar jsonb

### 4. **`external_code` único por (source, code)** para idempotência do seed

```sql
uniqueIndex('foods_external_uq')
  .on(t.source, t.externalCode)
  .where(sql`tenant_id IS NULL AND external_code IS NOT NULL`)
```

Seed `seed-nutri-foods` faz `ON CONFLICT (source, external_code) WHERE tenant_id IS NULL DO UPDATE` — re-rodar atualiza nutrients sem duplicar. Sprint 29b: import oficial TACO 2011 completa (~3000 entries) via migration data file.

### 5. **Faixas fisiológicas no Zod**, não em DB constraints

`NutrientsSchema` valida via Zod:
- kcal: 0–900 (azeite 884, manteiga 717 — gorduras puras são teto)
- protein/lipid/carb por 100g: 0–100
- micros: faixas curadas por nutriente (ver `nutrients-schema.ts`)
- **strict mode** — campos não-listados são rejeitados

DB tem só `check` mínimo (não-negativo via tipo numeric); validação rica fica na lib pura — Server Action chama `parseNutrients(input)` antes de inserir; INSERT direto via SQL bypassa (aceitável — operadores DBA conhecem o domínio).

## Esquema dos 30+ nutrientes (`packages/db/src/nutri/nutrients-schema.ts`)

Macros core (obrigatórios): `kcal`, `protein_g`, `lipid_g`, `carbohydrate_g`

Macros detalhados (opcionais): `fiber_g`, `saturated_lipid_g`, `monounsaturated_lipid_g`, `polyunsaturated_lipid_g`, `cholesterol_mg`, `sugar_g`

Minerais (opcionais): `sodium_mg`, `potassium_mg`, `calcium_mg`, `magnesium_mg`, `phosphorus_mg`, `iron_mg`, `zinc_mg`, `copper_mg`, `manganese_mg`, `selenium_mcg`, `iodine_mcg`

Vitaminas (opcionais): `vitamin_a_mcg`, `vitamin_d_mcg`, `vitamin_e_mg`, `vitamin_k_mcg`, `vitamin_c_mg`, complexo B (`thiamin_b1_mg`, `riboflavin_b2_mg`, `niacin_b3_mg`, `pantothenic_b5_mg`, `pyridoxine_b6_mg`, `folate_b9_mcg`, `vitamin_b12_mcg`, `biotin_b7_mcg`)

Outros: `water_g`, `caffeine_mg`, `alcohol_g`

Adição de campo novo:
1. Atualizar `NutrientsSchema` no Zod
2. Re-validar foods existentes via `safeParseNutrients` (Server Action puxa todas as rows globais + tenant + relata divergências)
3. Migration de dados se necessário (raro — campos novos são adicionados como opcionais)

## Consequências

✅ **Positivas:**
- Estrutura simples e auditável (1 query devolve food completo)
- Validação rica via Zod (runtime + tipo TS gerado)
- Importação TACO/USDA é trivial (json direto pra jsonb)
- Catálogo global + tenant custom segue padrão estabelecido (exercises, contraindications)
- Idempotência do seed via `external_code` único

⚠️ **Trade-offs aceitos:**
- Sprint 29 entrega ~50 alimentos canônicos (subset estratégico); TACO completa 3000 fica em migration data file Sprint 29b — não bloqueia uso porque planos comuns usam top-50
- Filtros nutricionais agregados (ex: "alimentos com >20g protein") exigem `@>` jsonb operator — menos óbvio que coluna dedicada
- Adição de campo no Zod exige re-validar foods existentes (raro, baixo custo)
- Sem normalização de nomes alternativos ("arroz comum" vs "arroz branco" vs "arroz") — UI precisa de `unaccent` + `pg_trgm` (Sprint 29b)
- Nutrientes obrigatórios são só macros core; micros opcionais — TACO tem cobertura variável (alguns alimentos só têm macros, outros têm micros completos)

⚠️ **Decisões adiadas (Sprint 29b/c):**
- Migration data file com TACO 2011 completa (~3000 entries via copia de NEPA/Unicamp public domain)
- USDA FoodData Central como segundo source (~8000 entries em inglês)
- Extension PG `pg_trgm` + `unaccent` pra busca fuzzy (`name_normalized` está populado mas index GIN trigram não está criado ainda)
- Trigger PG que recalcula `name_normalized` automaticamente em INSERT/UPDATE
- Tabela `food_aliases` com sinônimos pra busca melhor
- Cache de pesquisas frequentes via `ai_semantic_cache` Sprint 06
- ETL automático pra novos releases TACO (anual)

## Alternativas consideradas

| Opção | Rejeitada por |
|---|---|
| Tabela 1:N `food_nutrients(food_id, nutrient_key, value, unit)` | JOIN extra em toda query + sem schema validation runtime + nutriente não-listado fica como string livre |
| Cada nutriente como coluna dedicada (`kcal numeric, protein_g numeric, ...`) | 30+ colunas + ALTER TABLE pra cada nutriente novo + INSERT difícil de manter |
| jsonb sem Zod validation | Lixo cai no banco (nutriente errado, valor fora de faixa, key typo) |
| TACO como ETL externo (fora do Drizzle) | Catálogo é parte do domínio LogiFit; ETL externo desacopla demais e dificulta migração de tenant custom pra contribuir de volta |
| Nutrients sempre obrigatórios completos | TACO 2011 tem cobertura variável (alimentos antigos só têm macros); exigir tudo = perder ~30% do catálogo |

## Referências

- [Sprint 29 — Nutri TACO + Plano alimentar](../sprints/29-nutri-alimentos-e-plano.md)
- [ADR 0081 — meal_plans versionado + estrutura](0081-meal-plans-versionado-estrutura.md) (par)
- [ADR 0023 — Prescrições polimórficas (kind='meal_plan')](0023-prescricoes-polimorficas-base.md)
- [ADR 0070 — Cross-module insights (TDEE compartilhado treino↔nutri)](0070-insights-cross-module-timeline-integrada.md)
- TACO 2011 — Tabela Brasileira de Composição de Alimentos · NEPA/Unicamp · domínio público
- USDA FoodData Central · domínio público
- [regra 7 — Zod boundary validation](../rules.md#7-zod-boundary)
