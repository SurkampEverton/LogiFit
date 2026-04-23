# Sprint 25 — Nutri · Banco de Alimentos (TACO) + Plano Alimentar interativo

- **Área:** nutri
- **Início:** planejado (início da Fase 3, depois do MVP + Fase 2)
- **Fim planejado:** +4 semanas
- **Status:** planejado (futuro)
- **Item do roadmap:** #27

## Goal

Banco de dados nutricional nacional (TACO — Tabela Brasileira de Composição de Alimentos) + editor de plano alimentar interativo com cálculo em tempo real de kcal/macros/micros + lista automática de substituições + export PDF personalizado com branding da clínica. Núcleo técnico da vertical Nutri.

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
- Versionamento: editar plano ativo cria nova versão; paciente vê histórico no portal (Sprint 22)
- Regra 25 respeitada (dado clínico em `topology=franchise`)
- Teste E2E: montar plano, verificar soma nutricional, gerar PDF, versionar
- Seed: TACO completa + 10 planos modelo (emagrecimento, ganho massa, vegetariano, cetogênico, low carb, diabético, renal, etc)

## Dependências

- Sprint 11 (`prescriptions` polimórficas — `kind='meal_plan'`)
- Sprint 02 (members)
- Sprint 16 (consultas `kind='nutri'` referenciam plano)
- Sprint 12 (avaliação antropométrica — base do plano)

## Decisões tomadas / ADRs esperados

- **ADR 0035 (esperado)** — Banco de alimentos: TACO como seed global (domínio público via embrapa); estrutura `foods` + `food_nutrients` (1:N) OU `nutrients` em `jsonb` da própria row. Trade-off: jsonb mais simples, dedicated 1:N mais queryable. Decisão: **jsonb com schema validado via Zod** (≤30 nutrientes fixos, busca nutricional via operadores jsonb do Postgres).
- **ADR 0036 (esperado)** — Plano alimentar: modelo `meal_plans` → `meal_plan_meals` → `meal_items`. Cálculo via função pura `calculateMealPlanNutrition(plan)` no servidor — reexecuta a cada mudança. Substituição via `food_equivalences` pré-calculadas por categoria + faixa calórica.

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

- [ ] Schema Drizzle: `foods`, `food_measures`, `food_equivalences`, `meal_plans`, `meal_plan_meals`, `meal_items`, `tenant_branding`
- [ ] Migration: seed TACO completa (~3000 alimentos + medidas caseiras); seed 300 equivalências calóricas comuns
- [ ] Zod schema para `nutrients jsonb` com 30+ campos fixos + limites fisiológicos
- [ ] RLS + testes (incluindo franchise)
- [ ] Função pura `calculateMealPlanNutrition` em `packages/db/nutri/calc.ts` (soma ponderada por gramas)
- [ ] Função `listEquivalents(foodId, targetKcal)` em `packages/db/nutri/equivalences.ts`
- [ ] Server Actions + busca full-text
- [ ] Editor drag-drop em `/app/nutri/planos/[id]/editar` com cálculo instantâneo via React
- [ ] Gerador PDF com `@react-pdf/renderer` respeitando branding
- [ ] Widget "plano alimentar" em `/app/members/[id]` (slot `alimentar`): `{ slot: 'alimentar', requiredPermissions: ['nutri.read'], requiredVertical: 'nutri', consentPurpose: 'cross_module_nutri' (p/ cross), showWhen: (m) => m.has_active_meal_plan }`
- [ ] Integração com Sprint 22 Portal: paciente vê plano + download PDF em `/meu/cardapio`
- [ ] Seeds: 10 planos modelo por especialidade
- [ ] Testes unit: soma de macros em plano com 20+ itens; substituição isocalórica
- [ ] Testes E2E: montar plano + versionar + exportar
- [ ] Feature flag `nutri_plano_v1`
- [ ] ADRs 0035 e 0036 publicados

## Stretch

- [ ] Importar plano alimentar de outro sistema (nutri migra de concorrente)
- [ ] Plano alimentar gerado por IA (integra Copilot Sprint 06 com prompt nutricional estruturado; profissional revisa)
- [ ] Templates rápidos: "similar ao Silvia Ribeiro", "dieta mediterrânea base"
- [ ] Integração com apps de delivery (Rappi/iFood) — escolher opções que batem o plano

## Log

- —

## Definition of Done

- [ ] Feature flag `nutri_plano_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] RLS + franchise verificados
- [ ] TACO seed completa (validar contagem de alimentos)
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 25 → `done`
- [ ] ADRs 0035 e 0036 publicados

## Retro

- —
