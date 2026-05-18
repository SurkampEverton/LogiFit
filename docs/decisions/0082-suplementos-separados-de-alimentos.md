---
slug: suplementos-separados-de-alimentos
status: proposed
date: 2026-05-18
---

# ADR 0082 — Suplementação separada de alimentos (catálogo + prescrição) + exames laboratoriais

## Contexto

Sprint 30 estende a Fase 3 entregando **catálogo de suplementos + prescrição** + **catálogo de analitos laboratoriais + valores de referência + registro de exames**. Decisões fundamentais:

1. **Suplementos como entidade separada de `foods`** (Sprint 29 / ADR 0080) ou misturar no mesmo catálogo com flag?
2. **Prescrição de suplemento** — usa polimórfico `prescriptions` (Sprint 11 / ADR 0023) ou tabela própria?
3. **Interações** — pares curados (rows) ou jsonb com lista?
4. **Faixas de referência laboratoriais** — segmentadas como (1:N por analito) ou jsonb?
5. **`lab_results.out_of_range`** — calculado em runtime ou denormalizado?
6. **Valores de referência: fonte** — SBAC, Mayo, Manual Merck, curado LogiFit?

## Decisão

### 1. `supplements` **separada de `foods`**

Tabelas distintas no schema:
- `foods` (Sprint 29) — composição nutricional por 100g + medidas caseiras
- `supplements` (Sprint 30) — posologia + registro ANVISA + indicação + interações

**Por quê separar** (rejeitada a alternativa "foods com `kind='supplement'` flag"):

- **Posologia diferente**: alimento é "X gramas em refeição Y"; suplemento é "X mg, N vezes ao dia, via Z, por D dias"
- **Regulamentação distinta**: alimentos seguem TACO/RDC 360 (rotulagem nutricional); suplementos seguem **RDC 243/2018 ANVISA** (registro + alegações controladas)
- **Fluxo de prescrição**: alimentos vão para `meal_plans` (Sprint 29); suplementos têm `supplement_prescriptions` própria com dose/frequência/duração
- **Interações medicamentosas**: domínio relevante só pra suplementos (alimento ≠ medicamento) — `supplement_interactions` table específica
- **Linguagem clínica**: nutri/médico pensam "vou prescrever Vit D" — não "alimento Vit D" — separação reflete vocabulário

Trade-off aceito: aplicativos com cobertura nutri completa precisam consultar 2 catálogos. Resolvido em runtime com tabs/filtros na UI; sem custo arquitetural relevante.

### 2. `supplement_prescriptions` **separada de `prescriptions` Sprint 11**

NÃO usa `prescriptions kind='supplement'` (ADR 0023 polimórfico). Razões:

- **Posologia rica**: dose + frequência + via + duração não cabem em `prescriptions.notes` text
- **Fluxo de descontinuação**: tem `discontinued_reason` + cron auto-encerra (Sprint 30b) baseado em `started_at + duration_days`
- **Constraint de duração**: `duration_days > 0` específica ao domínio
- **`consulta_id` direto**: vínculo com Sprint 20 fica mais natural via FK do que via polimorfismo + ref_id

Mantemos polimorfismo Sprint 11 (ADR 0023) pra workouts/meal_plans/fisio_protocols — fluxos de prescrição clínica. Suplementação é fluxo paralelo (mais próximo de medicação) — mais simples e seguro modelar como tabela própria.

### 3. **`supplement_interactions` como tabela 1:N**

Rows com `(supplement_id, interacts_with, severity, description, source)`. Não jsonb de lista por:

- **Filtros**: queries "todos os suplementos que interagem com varfarina" precisam de coluna indexada — jsonb é menos performante e menos óbvio
- **Curadoria**: cada interação tem `source` (Mayo/BNF/WHO/SBEM) — auditável por row
- **Tenant override**: tenant pode adicionar/sobrescrever (mesmo padrão de `food_equivalences` ADR 0081)
- **Severidade enum**: `info` / `caution` / `avoid` — categorização precisa pra UI

Server Action `listSupplementInteractions(supplementId)` retorna ordenadas por severity DESC.

### 4. `lab_reference_ranges` **como 1:N com segmentação**

Múltiplas faixas por analito (sexo + idade + condição):

```ts
lab_reference_ranges (
  analyte_id (FK),
  sex (any | male | female),
  age_min_years?, age_max_years?,
  condition? (gestante / diabetico / atleta),
  min_value?, max_value?,
  notes, source
)
```

**Por quê 1:N e não jsonb**:
- Médico pediátrico precisa de range diferente do adulto
- Mulher gestante tem TSH diferente de não-gestante (0.1–2.5 vs 0.4–4.5)
- Atleta tem ferritina alta como normal (range diferente)
- Server Action `matchReferenceRange(ranges, ctx)` escolhe a faixa mais específica via scoring (condition match > sex match > age match)

`min_value` e `max_value` ambos nullable — alguns analitos só têm "ideal abaixo de X" ou "ideal acima de Y" (HDL: só min; LDL: só max). Check constraint exige pelo menos um dos dois.

### 5. **`lab_results.out_of_range` denormalizado** (calculado no INSERT)

Server Action `registerLabResult`:
1. Carrega ranges do analito
2. Carrega idade + sexo do member via `persons.birth_date + persons.sex`
3. Chama `classifyLabResult(value, ranges, ctx)` lib pura
4. Grava `out_of_range bool + direction (above|below) + reference_range_id_used` na row

**Por quê denormalizado** (rejeitada a alternativa "calcular em runtime via VIEW"):

- **Queries quentes** `WHERE out_of_range = true` em dashboards "exames alterados" — JOIN com ranges + cálculo a cada query é caro
- **Audit estável**: registra qual range foi usada (`reference_range_id_used` FK) — se range for atualizada depois, histórico do exame permanece consistente
- **Member portal Sprint 26**: `/meu/exames` mostra "✓ normal" / "⚠ alto" — paciente não pode esperar JOIN cada vez
- **Filtro composto**: `lab_results_out_of_range_idx WHERE out_of_range = true` cobre dashboard "exames alterados nos últimos 30 dias"

Check constraint `out_of_range_direction_consistent` garante:
- `out_of_range = false` → `direction IS NULL`
- `out_of_range = true` → `direction IS NOT NULL`

Atualização: re-rodar `registerLabResult` em um update force recalcula (Sprint 30b: cron diário valida integridade de todos os out_of_range vs ranges atuais).

### 6. **Fonte dos valores de referência: curadoria LogiFit + revisão semestral**

MVP popula `lab_reference_ranges` com **20 analitos canônicos** baseados em:
- **SBD 2024** (glicemia, HbA1c) — Sociedade Brasileira de Diabetes
- **SBC 2024** (lipidograma) — Sociedade Brasileira de Cardiologia
- **SBPC** (vitaminas/minerais) — Sociedade Brasileira de Patologia Clínica
- **SBEM** (hormonais) — Sociedade Brasileira de Endocrinologia
- **OMS** (hemoglobina/anemia) — World Health Organization
- **SBAC** (renal/hepático) — Sociedade Brasileira de Análises Clínicas
- **AHA** (PCR risco CV) — American Heart Association
- **Mayo Clinic** + **BNF** (validação cruzada)

`source` text em cada range — auditável. Sprint 30b: revisão semestral via job que dispara `system_alerts` quando uma sociedade publica atualização (manual no MVP). Tenant override planejado quando paciente real exigir (ex: "minha equipe usa range custom para atleta de alto rendimento"); MVP só global.

## Esquema persistido

6 tabelas em `packages/db/src/schema/nutri-labs.ts`:

```
supplements (global + tenant)
  - id, tenant_id?, name, name_normalized, kind (enum 11 valores), brand?,
  - concentration?, anvisa_registration?, indication?, contraindications?,
  - notes, active

supplement_interactions
  - id, tenant_id?, supplement_id (FK), interacts_with text,
  - interacts_with_normalized, severity (info|caution|avoid),
  - description, source

supplement_prescriptions (tenant)
  - id, tenant_id, member_id, supplement_id, consulta_id?,
  - professional_user_id, dose text, frequency text,
  - route (oral|sublingual|topical|injectable|other),
  - duration_days?, started_at, ended_at?,
  - status (active|completed|discontinued), notes, discontinued_reason

lab_analytes (global)
  - id, code (unique), name, category (enum 11 valores), unit, description,
  - methods, active

lab_reference_ranges (global, 1:N por analyte)
  - id, analyte_id, sex (any|male|female),
  - age_min_years?, age_max_years?, condition?,
  - min_value?, max_value?, notes, source

lab_results (tenant + member)
  - id, tenant_id, member_id, analyte_id, value, unit,
  - collected_at, laboratory?, consulta_id?,
  - attachment_storage_path?,
  - out_of_range bool, out_of_range_direction (above|below)?,
  - reference_range_id_used? (FK), notes, entered_by_user_id
```

Migration `0035_nutri_labs_suplementos.sql`. RLS `0048_nutri_labs_rls.sql`.

## Lib pura `lab.ts`

3 funções canônicas:

- `matchReferenceRange(ranges, ctx)` — scoring por especificidade:
  - +1000 condition exato
  - +200 sex exato (não 'any')
  - +50 sex 'any'
  - +100 dentro da faixa etária (+50 bonus por estreiteza)
  - +20 sem faixa etária
  - rejeita se condition/sex/age não bate → score negativo

- `isOutOfRange(value, range)` — 4 casos:
  - min só + value < min → below
  - max só + value > max → above
  - min + max + fora → above ou below
  - nenhum bound → false

- `classifyLabResult(value, ranges, ctx)` — combina os dois + severity:
  - mild: até 20% além do limite
  - severe: > 20%

`ageYearsAt(birthDate, atDate)` helper pra resolver idade no momento da coleta.

## Consequências

✅ **Positivas:**
- Domínios separados: suplementos têm posologia/ANVISA própria, sem misturar com alimentos
- Interações curadas com sources auditáveis (Mayo/BNF/WHO/etc)
- Ranges com segmentação rica (sex × age × condition); scoring transparente
- `out_of_range` denormalizado cobre dashboards quentes
- Lib pura testável (23 unit tests cobrem matching + classification + severity)

⚠️ **Trade-offs aceitos:**
- 2 catálogos (foods + supplements) — apps com cobertura nutri completa fazem 2 queries; mínimo overhead
- 20 analitos no MVP — Sprint 30b expande pra ~50 analitos comuns + faixas pediátricas + geriátricas
- Sem OCR de laudo PDF MVP (Sprint 33 pipeline exames cobre)
- Sem comparação cross-laboratório (Sprint 30b: ajuste por método de análise)
- Member portal Sprint 26 ainda não tem `/meu/exames` (Sprint 30b conecta)
- `lab_results` particionado anual fica Sprint 30b (MVP single table)

⚠️ **Decisões adiadas (Sprint 30b/c):**
- ~50 analitos extras (eletrólitos completos, hormônios sexuais, marcadores tumorais, vitaminas/minerais minoritários, urinálise expandida)
- Faixas pediátricas (0-1, 1-5, 5-12, 12-18 anos) + geriátricas (>65)
- Cron diário valida integridade `out_of_range` vs ranges atuais
- Job semanal recompacta resultado em snapshot mensal por member
- OCR de laudo PDF (Sprint 33 Pipeline Exames)
- Comparação entre laboratórios diferentes (ajuste por método)
- Tenant override pra ranges (clínicas com protocolo próprio)
- Predição: nutri-agent Sprint 28 consulta evolução de analitos
- Widget `<MealPlanCard />` GenUI mostra exames alterados recentes
- Integração `/meu/exames` Sprint 26 portal (member vê próprios exames)
- Régua Sprint 13: `lab_result.alert_raised` notifica profissional via WhatsApp
- RIPD `v1.0-exames-laboratoriais.md` + DPO sign-off
- Feature flag `nutri_suplementos_exames_v1`
- Particionamento anual `lab_results` (volume validation)
- E2E Playwright (cadastrar 3 exames + 2 alterados + ver gráfico de evolução)

## Alternativas consideradas

| Opção | Rejeitada por |
|---|---|
| `foods` com flag `kind='supplement'` | Mistura dois domínios distintos com regras regulatórias diferentes; query "alimentos pra dieta" precisa filtrar suplementos toda vez |
| Suplementação via Sprint 11 `prescriptions.kind='supplement'` | Posologia rica (dose + frequência + via + duração) não cabe em polimorfismo; fluxo de descontinuação específico |
| `lab_reference_ranges` jsonb por analyte | Perde indexação + check constraints + tenant override |
| Cálculo `out_of_range` em runtime VIEW | Dashboard "exames alterados" fica lento; histórico de qual range foi usada não preserva (se range muda, histórico fica errado) |
| Sources externos via API (ex: LabCorp, Mayo) | Acoplamento + custo + latência; curadoria interna + revisão semestral é suficiente |
| Permitir cadastrar paciente sem `birth_date` | Sem idade não há matching de range; default 30 anos quando ausente é trade-off aceitável MVP (Sprint 30b: warning na UI) |

## Cenário de uso

1. Nutricionista vai em `/app/nutri/suplementos` → busca "Vitamina D" → vê catálogo global + tenant
2. Clica detalhe → vê concentração + indicação + interações conhecidas (3 interações de Vit D3: tiazídicos caution, corticoides caution)
3. Em `/app/members/[id]` → "Prescrever suplemento" → `prescribeSupplement({memberId, supplementId, dose='2000UI', frequency='1x ao dia', durationDays=90})`
4. Em `/app/nutri/exames` → catálogo de 20 analitos (filtra por categoria)
5. Em `/app/members/[id]/exames` → "Registrar exame" → `registerLabResult({memberId, analyteId='glicose_jejum', value=112, unit='mg/dL', collectedAt='2026-05-18'})`
6. Server Action: idade=42, sex=male → matchReferenceRange retorna range default (70–99); isOutOfRange(112, range) → `{above, mild}` (112 vs 99 = +13% < 20%) → `out_of_range=true, direction=above, severity=mild`
7. UI mostra badge ⬆ amarelo "112 mg/dL (alto leve)"
8. Gráfico de evolução temporal via `compareAnalyteOverTime(memberId, analyteId)`

## Status

Proposed — promove para **Accepted** quando Sprint 30b implementar OCR + particionamento + portal member + feature flag em produção piloto com ≥50 exames reais registrados.

## Referências

- [Sprint 30 — Suplementos + Exames laboratoriais](../sprints/30-nutri-suplementos-exames.md)
- [ADR 0080 — Banco TACO nutrients jsonb](0080-banco-alimentos-taco-nutrients-jsonb.md)
- [ADR 0081 — meal_plans versionado](0081-meal-plans-versionado-estrutura.md)
- [ADR 0023 — Prescrições polimórficas (workouts/meal_plans/fisio_protocols)](0023-prescricoes-polimorficas-base.md)
- [ADR 0028 — CID-11 / CIF catálogo global (mesmo pattern de curadoria global)](0028-cid-cif-catalogos-globais.md)
- ANVISA RDC 243/2018 — suplementos alimentares
- SBAC + SBPC + SBD + SBC + SBEM + OMS (sources das faixas de referência)
- [regra 7 — Zod boundary](../rules.md#7-zod-boundary)
- [regra 29 — RIPD dados saúde](../rules.md#29-ripd-dados-saude)
- Lei 13.787/2018 — retenção 20a (laudos de exame quando consulta CRN/CRM)
