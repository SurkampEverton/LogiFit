# Sprint 29 — Nutri · Banco de Alimentos (TACO) + Plano Alimentar interativo

- **Área:** nutri
- **Início:** planejado (início da Fase 3, depois do MVP + Fase 2)
- **Fim planejado:** +4 semanas
- **Status:** **done (29a core)** 2026-05-21 — Faixas A+B+C+D entregues:
  - **Faixa A — Schema**: 7 tabelas (`foods` global+tenant com `nutrients jsonb` Zod-validated, `food_measures`, `food_equivalences` direcional, `meal_plans` versionado polimórfico via `prescriptions` Sprint 11, `meal_plan_meals`, `meal_items`, `tenant_branding`); 3 enums (`food_source` taco/usda/custom, `food_category` 15 grupos TACO, `meal_plan_goal` 12 metas); migration `0034_nutri_foods_planos.sql`; policy `0047_nutri_rls.sql` (RLS tenant_id + scope nutri.read; global SELECT permitido pra `tenant_id IS NULL`).
  - **Faixa B — Lib pura** `packages/db/src/nutri/`:
    - `nutrients-schema.ts` (118l) — Zod schema com 30+ nutrientes fixos + `scaleNutrientsByGrams` + `addNutrients`
    - `calc.ts` — `calculateMealNutrition(items)` + `calculateMealPlanNutrition(meals)` + `compareAgainstTargets(totals, targets)` (gap kcal/macros)
    - `equivalences.ts` — `listEquivalents(foodId, targetGrams, equivalences[])` retorna ranked por categoria
    - `lab.ts` — utilitário pra Sprint 30 labs
    - **49 unit tests passing** (calc + equivalences + lab)
  - **Faixa C — Server Actions + UI** `apps/web/app/app/nutri/`:
    - 10 Server Actions (777 linhas em `actions.ts`): `searchFoods`/`getFoodDetail`/`createTenantFood`/`listMealPlans`/`createMealPlan`/`getMealPlanFull`/`updateMealPlan` (versionamento via `parentMealPlanId`)/`listSubstitutions`/`upsertBranding`/`getBranding` — todas wrapped via `wrapServerAction` (lint `no-unwrapped-action` clean)
    - 5 rotas UI: `/app/nutri` (hub), `/app/nutri/alimentos` (catálogo), `/app/nutri/alimentos/[id]` (detalhe), `/app/nutri/planos` (lista), `/app/nutri/planos/[id]` (editor)
  - **Faixa D — Seed + feature flag**:
    - Script `packages/db/scripts/seed-nutri-foods.ts` (876l) — 48 alimentos TACO canônicos + 57 medidas caseiras + 20 equivalências direcionais; idempotente; comando `pnpm db:seed:nutri-foods`
    - Feature flag `nutri_plano_v1` habilitada em dev (ADR 0098 / Sprint 02b7)
    - DB local validado: 48 foods + 57 measures + 20 equiv populados via seed run
  - **Pendências Sprint 29b futuro** (escopo grande):
    - TACO completa (~3000 alimentos via scraping Embrapa) — MVP entrega 48 amostra estratégica
    - USDA opcional (~8000 alimentos)
    - Editor drag-drop fancy com cálculo em tempo real React (MVP entrega editor simples)
    - PDF render via `@react-pdf/renderer` com branding tenant
    - Portal paciente `/meu/cardapio` (Sprint 26 integração)
    - E2E Playwright spec dedicado
    - RIPD `v1.0-nutri-plano.md` com DPO sign-off (LGPD art. 11 — categoria saúde; retenção 20a Lei 13.787 quando associado a CRN)
    - Cross-module integration: TDEE do treino → meta calórica auto (ADR 0070)
    - 10 planos modelo seedados por especialidade
    - Particionamento `meal_items` trimestral se volume validar (>2M/ano)
- **Item do roadmap:** #27

## Goal

Banco de dados nutricional nacional (TACO — Tabela Brasileira de Composição de Alimentos) + editor de plano alimentar interativo com cálculo em tempo real de kcal/macros/micros + lista automática de substituições + export PDF personalizado com branding da clínica. Núcleo técnico da vertical Nutri. **Integração cross-module (ADR 0070):** botão "Usar TDEE calculado" pré-preenche meta calórica com dados do treino do paciente (consome `member_insights.tdee`); card "Treino deste paciente" visível na aba Alimentar com consent `nutri_sees_training`; alertas automáticos quando balanço calórico incompatível com volume de treino.

## Critério de aceite

- Catálogo `foods` com ~3000 alimentos da TACO (atualização anual via seed migration) + ~8000 USDA opcional
- Cada alimento tem `nutrients jsonb` com 30+ nutrientes (kcal, proteína, lipídio, carbo, fibra, sódio, cálcio, ferro, vitamina A/C/D/B12, etc)
- **Medidas caseiras**: `food_measures` traduz "1 colher de sopa", "1 xícara", "1 unidade média" → gramas
- Busca full-text por nome + filtro por grupo (cereais, carnes, frutas, etc)
- Customização por tenant: criar `foods` próprios (alimento local ou preparação) com `tenant_id IS NOT NULL`; não sobrescreve catálogo global
- **Plano alimentar** (`meal_plans`) estrutura: refeições (café / almoço / jantar / lanches / ceia) com itens (food + quantidade)
- Editor drag-drop: nutri monta refeição arrastando alimento do catálogo
- **Cálculo em tempo real**: Soma de macros + micros da refeição + totais do dia atualizados enquanto monta
- **Lista de substituição automática**: para cada item, sistema sugere 5 equivalentes calóricos ("150g arroz branco ≡ 180g arroz integral ≡ 2 batatas médias")
- Export PDF com branding do tenant: logo, cores, nome do profissional, carimbo/assinatura opcional
- Versionamento: editar plano ativo cria nova versão; paciente vê histórico no portal (Sprint 26)
- Regra 25 respeitada (dado clínico em `topology=franchise`)
- Teste E2E: montar plano, verificar soma nutricional, gerar PDF, versionar
- Seed: TACO completa + 10 planos modelo (emagrecimento, ganho massa, vegetariano, cetogênico, low carb, diabético, renal, etc)
- **RIPD [`docs/compliance/ripd/v1.0-nutri-plano.md`](../compliance/ripd/v1.0-nutri-plano.md)** publicado e assinado pelo DPO antes do feature flag `nutri_plano_v1` ir a produção (regra 29 + ADR 0054); cobre plano alimentar (LGPD art. 11 — categoria saúde) + cruzamento cross-module com TDEE do treino (consent `nutri_sees_training`); retenção 20a (Lei 13.787 quando associado a CRN)

## Dependências

- Sprint 11 (`prescriptions` polimórficas — `kind='meal_plan'`)
- Sprint 02 (members)
- Sprint 20 (consultas `kind='nutri'` referenciam plano)
- Sprint 12 (avaliação antropométrica — base do plano)

## Decisões tomadas / ADRs esperados

- **[ADR 0080](../decisions/0080-banco-alimentos-taco-nutrients-jsonb.md)** (Proposed — 2026-05-18) — Banco de alimentos: TACO como seed global (domínio público via embrapa); estrutura `foods` + `food_nutrients` (1:N) OU `nutrients` em `jsonb` da própria row. Trade-off: jsonb mais simples, dedicated 1:N mais queryable. Decisão: **jsonb com schema validado via Zod** (≤30 nutrientes fixos, busca nutricional via operadores jsonb do Postgres). (Numeração ≥0080 conforme [roadmap §convenção fora-de-sprint](../roadmap.md) — 0035 já alocado a OCR boleto, 0036 a Sprint 16 rateio intercompany.)
- **[ADR 0081](../decisions/0081-meal-plans-versionado-estrutura.md)** (Proposed — 2026-05-18) — Plano alimentar: modelo `meal_plans` → `meal_plan_meals` → `meal_items`. Cálculo via função pura `calculateMealPlanNutrition(plan)` no servidor — reexecuta a cada mudança. Substituição via `food_equivalences` pré-calculadas por categoria + faixa calórica.

## Módulos entregues

Ver [`modulos.md` — Nutri](../modulos.md#nutri) (serão adicionados):

- Banco de alimentos nacional (TACO) + USDA stretch
- Medidas caseiras normalizadas
- Alimentos customizados por tenant
- Editor drag-drop de plano alimentar
- Cálculo nutricional em tempo real
- Lista de substituição automática
- Export PDF com branding
- Versionamento de plano alimentar

## Rotas Next.js

- `/app/nutri/alimentos` — catálogo global + tenant; busca + filtros
- `/app/nutri/alimentos/[id]` — detalhe nutricional + medidas caseiras + equivalências
- `/app/nutri/alimentos/new` — cadastrar alimento do tenant
- `/app/nutri/planos` — lista de planos
- `/app/nutri/planos/new?memberId=X` — wizard de criação
- `/app/nutri/planos/[id]/editar` — editor drag-drop
- `/app/nutri/planos/[id]/versoes` — histórico de versões
- `/app/nutri/planos/[id]/pdf` — preview + download
- `/app/settings/branding` — configurar logo/cores do tenant (usado no PDF)
- `/app/members/[id]/plano-alimentar` — resumo + downloads

## Server Actions + API Routes

Server Actions em `apps/web/app/nutri/actions.ts`:

- `searchFoods(query, filters)` — busca full-text
- `createTenantFood(input)` — alimento customizado do tenant
- `createMealPlan(memberId, name, meals[])` — plano novo (reusa `prescriptions` polimórfico `kind='meal_plan'`)
- `updateMealPlan(id, meals[])` — cria nova versão
- `calculateNutrition(mealPlanId)` — utilitário que retorna `{ kcal, macros, micros }` consolidado
- `listSubstitutions(mealItemId)` — retorna equivalentes calóricos + macros
- `generatePdf(mealPlanId)` — renderiza PDF com branding
- `updateBranding(input)` — configura logo/cores do tenant

## Schemas Drizzle (esperado)

Em `packages/db/schema/nutri.ts`:

- `foods` — `id`, `tenant_id nullable` (NULL=global TACO/USDA), `source` enum (`taco`, `usda`, `custom`), `name text`, `name_normalized text`, `category text`, `subcategory text`, `nutrients jsonb` (30+ campos Zod-validated), `active`. Índice GIN em `name_normalized` para full-text + `nutrients` para filtros.
- `food_measures` — `food_id`, `measure text` (ex: "colher de sopa", "xícara chá", "unidade média"), `grams numeric`. PK `(food_id, measure)`.
- `food_equivalences` — `food_id_a`, `food_id_b`, `grams_a numeric`, `grams_b numeric` (ex: 50g pão francês ≡ 100g pão forma), `category text` ("carbo", "proteina", "gordura"). Seed a partir da TACO.
- `meal_plans` — `id`, `tenant_id`, `member_id`, `prescription_id` (FK `prescriptions` Sprint 11 com `kind='meal_plan'`), `name`, `goal text` (emagrecimento, ganho massa, etc), `version int`, `parent_meal_plan_id nullable`, `active bool`, `created_by_user_id`, `created_at`, `archived_at`
- `meal_plan_meals` — `id`, `meal_plan_id`, `name text` ("café", "almoço"...), `expected_time time`, `order int`, `notes text`
- `meal_items` — `id`, `meal_id`, `food_id`, `measure text` (opcional, usa gramas diretamente se omitir), `grams numeric`, `notes text`, `order int`
- `tenant_branding` — `tenant_id pk`, `logo_storage_path nullable`, `primary_color text`, `signature_storage_path nullable`, `professional_name_default`, `updated_at`

**RLS:** tenant_id + scope (leitura por profissional nutri); regra 25 vale para `meal_plans` (dado clínico).

## Eventos de domínio emitidos

- `food.created` (tenant) / `food.updated`
- `meal_plan.created` / `meal_plan.new_version` / `meal_plan.archived`
- `meal_plan.pdf_generated` — audit

## Commit (checklist)

**Sprint 29a core (done 2026-05-18 + finalização local 2026-05-21):**

- [x] Schema Drizzle: `foods`, `food_measures`, `food_equivalences`, `meal_plans`, `meal_plan_meals`, `meal_items`, `tenant_branding`
- [x] Zod schema para `nutrients jsonb` com 30+ campos fixos + limites fisiológicos
- [x] RLS + testes (12 RLS tests)
- [x] Função pura `calculateMealPlanNutrition` em `packages/db/src/nutri/calc.ts`
- [x] Função `listEquivalents(foodId, targetKcal)` em `packages/db/src/nutri/equivalences.ts`
- [x] Server Actions (10) + busca full-text
- [x] Seed TACO core (48 alimentos canônicos + 57 medidas caseiras + 20 equivalências) — `pnpm db:seed:nutri-foods` idempotente
- [x] Testes unit: soma de macros + substituição isocalórica (49 tests passing)
- [x] Feature flag `nutri_plano_v1` (habilitada em dev 2026-05-21 via ADR 0098)
- [x] ADRs 0080 + 0081 publicados

**Sprint 29b futuro (escopo grande):**

- [ ] TACO completa ~3000 alimentos via scraping Embrapa NEPA/Unicamp
- [ ] USDA opcional (~8000 alimentos)
- [ ] Editor drag-drop fancy em `/app/nutri/planos/[id]/editar` com cálculo instantâneo React
- [ ] Gerador PDF com `@react-pdf/renderer` respeitando branding
- [ ] Widget "plano alimentar" em `/app/members/[id]` (slot `alimentar`)
- [ ] Integração com Sprint 26 Portal: `/meu/cardapio` paciente vê plano + download PDF
- [ ] Seeds: 10 planos modelo por especialidade
- [ ] Testes E2E: montar plano + versionar + exportar
- [ ] RIPD `v1.0-nutri-plano.md` + DPO sign-off (LGPD art. 11 + retenção 20a Lei 13.787)
- [ ] Cross-module integration: TDEE → meta calórica auto (ADR 0070)
- [ ] Particionamento `meal_items` trimestral se volume validar (>2M/ano)

## Stretch

- [ ] Importar plano alimentar de outro sistema (nutri migra de concorrente)
- [ ] Plano alimentar gerado por IA (integra Copilot Sprint 06 com prompt nutricional estruturado; profissional revisa)
- [ ] Templates rápidos: "similar ao Silvia Ribeiro", "dieta mediterrânea base"
- [ ] Integração com apps de delivery (Rappi/iFood) — escolher opções que batem o plano

## Log

- **2026-05-18 — Sprint 29a core entregue** (commit prévio): 7 schemas + RLS + libs puras + 9 Server Actions + 7 rotas UI + seed 47 alimentos + ADRs 0080 + 0081. **813 unit tests verdes** (era 787, +26 nutri).
- **2026-05-21 — Sprint 29a finalização local + feature flag**:
  - `pnpm db:seed:nutri-foods` rodado no DB local — 48 alimentos + 57 medidas + 20 equivalências populados (era 0/0/0)
  - Feature flag `nutri_plano_v1` habilitada via SQL `UPDATE feature_flags SET enabled=true` (ADR 0098 / Sprint 02b7)
  - Validação: typecheck 12/12 + lint-custom 784 + tests `@repo/db/src/nutri` 49 verdes
  - Sprint 29 done end-to-end no ambiente dev local — pages `/app/nutri/*` acessíveis (com auth staff)

## Definition of Done

- [ ] Feature flag `nutri_plano_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] RLS + franchise verificados
- [ ] TACO seed completa (validar contagem de alimentos)
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 29 → `done`
- [ ] ADRs 0080 e 0081 publicados

## Retro

- —
