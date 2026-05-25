# Sprint 37 — Fiscal · Apuração mensal de receita (Grupo C)

- **Área:** fiscal
- **Início:** 2026-05-23
- **Fim planejado:** Sprint 37a (backbone) entregue 2026-05-23
- **Status:** **done (37a core + 37b produção-ready)** 2026-05-23 — backbone Grupo C operacional: schemas + RLS + libs puras + 5 SAs + 2 rotas UI + memorial estruturado + ADR 0100 Proposed. **37b 2026-05-23**: feature flag `fiscal_apuracao_v1` gate (rota + 5 SAs) + 3 permissions RBAC `fiscal.apuracao.read/write/close` (tenant_owner/gerente write, contador_externo read) + cron `aggregate-fiscal-monthly` dia 5 + memorial PDF render server via @react-pdf/renderer + dispatch cross-alert teto Simples (warning ≥87%, critical ≥95%) + banner inline na detail page.
- **Item do roadmap:** #40

## Goal

Operador responde "quanto vou pagar de DAS/DARF este mês?" sem consultar contador. LogiFit calcula receita bruta consolidada por company + aplica fórmula do regime tributário vigente (Simples/Presumido/Real/MEI) + gera memorial detalhado passo-a-passo. **Não emite guia oficial** — Sprint 38 cuida disso.

Backbone Sprint 37a entrega motor próprio com tabelas Simples Anexo III + V vigentes 2026 hardcoded como seed; Lucro Presumido + Real parcial; MEI fixo. Sprint 37b/c amadurece via piloto.

## Critério de aceite

- Schema `fiscal_revenue_aggregations` com unique `(tenant_id, company_id, year_month)` + status workflow draft→closed + memorial jsonb estruturado preservando regime snapshot
- Schema `fiscal_revenue_breakdown` 1:N pra quebra por `fiscal_emission_kind` (NFS-e/NF-e/NFC-e/etc) com count + total
- Schema `fiscal_simples_brackets` global com Anexos III+V 2026 seedados + `valid_from`/`valid_to` pra cálculo retroativo
- RLS tenant-scope nas 2 tabelas mutáveis + global SELECT em `fiscal_simples_brackets`; trigger bloqueia UPDATE em closed
- Lib pura `@repo/ai/fiscal-apuracao` cobre:
  - `calculateSimplesNacional(rbt12, receita_mes, anexo)` retornando `{ aliquota_efetiva_bp, imposto_apurado_cents, parcela_deduzir_cents }`
  - `calculateLucroPresumido(receita_mes, atividade)` retornando estimativa IRPJ + CSLL + PIS + COFINS
  - `calculateLucroReal(receita_mes)` retornando memorial parcial (sem despesas — UI explica gap)
  - `calculateMEI(receita_mes, atividade)` retornando valor fixo + valida teto R$ 81k/ano
  - `buildMemorial(input, output)` constrói array jsonb canônico
- 5 Server Actions wrapped: `aggregateMonthlyRevenue` + `getAggregation` + `listAggregations` + `regenerateAggregation` + `closeAggregation`
- 2 rotas UI: `/app/fiscal/apuracao` hub + `/app/fiscal/apuracao/[id]` detalhe
- Teste E2E (opcional 37a; obrigatório 37b): tenant Simples Anexo III com R$ 100k receita 12m + R$ 12k mês → calcula aliquota efetiva 11.55% → imposto R$ 1.386
- Validação ±5%: 3 cenários canônicos batem com cálculo manual via planilha do contador
- ADR 0100 publicado **antes** de iniciar (gate operacional § roadmap)

## Dependências

- Sprint 36 ([ADR 0059](../decisions/0059-ciclo-fiscal-emissao-focus-nfe.md)) — `fiscal_emissions` é a fonte de receita autorizada (`status='completed'`)
- Sprint 01a — `companies.regime_tributario` cadastrado (decisão do operador no onboarding)
- Sprint 14 (Sprint 37c) — `cost_entries` pra Lucro Real completo (escopo futuro)
- [ADR 0061](../decisions/0061-motor-retencoes-e-cobertura-fiscal-faseada.md) — escopo Grupo C definido + ADR esperado alocado em 0100

## Decisões tomadas / ADRs

- **[ADR 0100](../decisions/0100-apuracao-fiscal-mensal-grupo-c.md)** (Proposed 2026-05-23) — Motor próprio + memorial estruturado + tabela Simples em DB com valid_from/to + status workflow draft→closed
- Sprint 38 (Grupo D, guias oficiais) bloqueado por Sprint 37 estar maduro; revisão pós-piloto antes de prometer ADR

## Schemas (3 novas tabelas)

### `fiscal_revenue_aggregations`

Agregação 1:1 por `(tenant_id, company_id, year_month)`. Snapshot do regime na coluna `tax_regime` preserva histórico — trocar regime virada de ano não muda apurações antigas. Memorial em jsonb permite re-render UI/PDF consistente.

### `fiscal_revenue_breakdown`

1:N filha — quebra por `emission_kind` (NFS-e/NF-e/NFC-e/etc) com count + total. Permite drill-down UI sem reler `fiscal_emissions` (que tem milhares de rows em tenant grande).

### `fiscal_simples_brackets`

Lookup GLOBAL (sem `tenant_id`, sem RLS — só GRANT SELECT pra `logifit_app`). Seed inicial 2026 com 6 brackets × 2 anexos = 12 rows. `valid_from`/`valid_to` permite cálculo retroativo de meses passados se contador questiona alíquota.

## Rotas Next.js

- `/app/fiscal/apuracao` — hub:
  - 4 KPI cards: Aguardando (draft) × Fechadas (closed) × Receita 12m × Imposto 12m
  - Filtros GET `?year=` + `?companyId=` (pré-selecionado se 1 só)
  - Lista cards por (company × year_month) com status badge + valores resumidos
  - CTA "Calcular apuração" → modal de seleção year+month → `aggregateMonthlyRevenue`

- `/app/fiscal/apuracao/[id]` — detalhe:
  - Header com company + year_month + tax_regime + status badge
  - 3 KPI cards: Receita Bruta × Imposto Apurado × Alíquota Efetiva
  - Breakdown table por emission_kind (count + total)
  - Memorial expandido linha-a-linha (`memorial[]`) com formula renderizada
  - Actions: "Regenerar" (rejeita se closed) + "Fechar apuração" (`<ConfirmDialog>` irreversível)
  - Link "Voltar pro hub"

## Server Actions

| Action | Quando usar | Side effect | Permissions |
|---|---|---|---|
| `aggregateMonthlyRevenue(year, month, companyId)` | Operador clica "Calcular" | INSERT or UPDATE if draft | `fiscal.apuracao.write` |
| `getAggregation(id)` | UI detalhe | — | `fiscal.apuracao.read` |
| `listAggregations(filters)` | UI hub | — | `fiscal.apuracao.read` |
| `regenerateAggregation(id)` | Operador "Regenerar" | UPDATE se draft; rejeita se closed | `fiscal.apuracao.write` |
| `closeAggregation(id)` | Operador "Fechar" | UPDATE status=closed; closed_at/by | `fiscal.apuracao.close` |
| `exportMemorialPdf(id)` | Stub Sprint 37b | — | `fiscal.apuracao.read` |

Permissions RBAC adicionadas Sprint 37b — MVP roda em `tenant_owner` por padrão.

## Eventos / integrações

- Sprint 37a não emite domain_events; Sprint 37b dispara `fiscal.apuracao.closed` consumido por Sprint 13 régua "lembrete vencimento DAS dia 20"
- Sprint 37c integra com `cost_entries` (Sprint 14) pro Lucro Real real (não apenas estimativa)

## Estratégia de testes ([ADR 0090](../decisions/0090-estrategia-de-testes.md))

**Categoria de risco:** ☑ cálculo financeiro + ☑ fiscal + multi-tenant base

**Linha-base transversal** (default): T1 T2 T3 T5 T6 T14 T16 T17 T19 T20 — todos aplicados via padrão monorepo + lints existentes

**Obrigatórios extras** (CI bloqueia):
- **T8 (cálculo determinístico canônico)** — unit tests com 12+ casos cobrindo: Simples Anexo III bracket 1-6 + Anexo V + Lucro Presumido 4 alíquotas-base + MEI 3 valores + casos de borda (RBT12=0 / RBT12 acima do teto / receita zero / Fator R borderline 28%)
- **T6 (RLS isolation real)** — `twoConnectionsTest` confirma tenant A não vê apuração de tenant B em 3 tabelas

**Recomendados aplicados:**
- T11 (UI smoke) — `/app/fiscal/apuracao` carrega + `/[id]` carrega + actions disparam sem erro

**Recomendados em débito** (Sprint 37b/c):
- T9 (Playwright happy path) — operador entra → calcula apuração → fecha → vê valor batido com planilha manual; issue `test-debt-sprint-37-e2e`
- T15 (memorial PDF visual) — comparar output PDF Sprint 37b com referência estática

**Opcionais avaliados:**
- T12 (fuzz cálculo Simples) — descartado MVP; faixas são lineares + dedução fixa, testes deterministas cobrem 100% caminhos
- T18 (load) — descartado MVP; volume apuração é 1×/mês/company (≤ 100/dia em escala grande)

## Stretch (se sobrar tempo)

- [ ] Cron `aggregate-fiscal-monthly` dia 5 do mês seguinte pré-calcula tudo automático
- [ ] Cross-alert receita estourou teto Simples (R$ 4.8M/ano) → banner "considere migrar pra Presumido"
- [ ] Fator R automático lendo `commission_entries` Sprint 23 + folha estimada Sprint 40 (futuro)

## Definition of Done (checklist 37a core)

- [x] **ADR 0100 publicado em docs/decisions/ antes de iniciar** (gate operacional)
- [x] 3 schemas Drizzle definidos + migration 0050 manual + 12 unit tests `compute.test.ts` verdes
- [x] RLS policy 0062 aplicada com isolamento tenant-scope validado via `twoConnectionsTest`
- [x] 5 Server Actions wrapped + Zod validation no input + ApiException tipado no error path
- [x] 2 rotas UI mobile-first (responsividade default via componentes `@repo/ui/responsive-*`)
- [x] Memorial estruturado jsonb canônico (array de linhas com `{ step, label, formula, value_cents, note }`)
- [x] CHANGELOG.md atualizado
- [x] docs/roadmap.md atualizado (status → done 37a core)
- [x] Zero violação de regras de docs/rules.md (regra 1 RLS + regra 7 Zod + regra 34 — esta tabela ≤ 100k rows/ano, particionamento dispensável)

## Sprint 37b — produção-ready (entregue 2026-05-23)

Refinamento que torna Sprint 37 utilizável em piloto fechado. Cobertura entregue:

- ✓ Feature flag `fiscal_apuracao_v1` (ADR 0098) gate na rota + 5 SAs; `<FeatureGatedNotice>` amigável quando off; detail page redireciona pro hub
- ✓ 3 permissions RBAC canônicas `fiscal.apuracao.{read,write,close}` + grants pra `tenant_owner`/`gerente` (todas) + `contador_externo` (read) + `super_admin` (todas); helper TS `requirePermission` wrapping `has_permission()` SQL function (ADR 0019)
- ✓ Cron `POST /api/jobs/aggregate-fiscal-monthly` dia 5 do mês seguinte; itera companies ativas; UPSERT em draft, pula closed; logs estruturados pino com counters created/updated/skipped/errors; gate `fiscal_apuracao_v1` no início
- ✓ Memorial PDF via @react-pdf/renderer (instalado): componente `MemorialPdfDocument` A4 retrato (header + 3 KPI + breakdown table + memorial linha-a-linha + rodapé legal); SA `exportMemorialPdf` substituiu stub Sprint 37a retornando base64; download trigger no client component via Blob
- ✓ Cross-alert teto Simples: `dispatchSimplesCeilingAlert` integrado em `aggregateMonthlyRevenue` quando regime=`simples_nacional` (warning ≥87% R$ 4.176k, critical ≥95% R$ 4.560k); UPSERT em `system_alerts` com fingerprint `simples_ceiling:{companyId}` (ring buffer 20); banner inline na detail page colorido por severity

## Sprint 37c futuro (pós-piloto)

- Lucro Real completo integrando `cost_entries` Sprint 14
- E2E Playwright completo (operador entra → calcula → fecha → exporta PDF)
- Régua Sprint 13 alerta WhatsApp 7d antes vencimento DAS (dia 20)
- RIPD apuração + DPO sign-off
- Pesquisa global ADR 0062 (aggregations indexáveis) — depende ADR 0062 schema implementado
- Branding tenant no PDF (logo + cor primária via `tenant_branding` Sprint 29)
- Reabertura de aggregations closed via super_admin (registra trilha)

## Retro

- **Entregue:** Backbone 37a — schemas + libs puras + 5 SAs + 2 rotas UI + ADR 0100 Proposed
- **Aprendi:** Snapshot do `tax_regime` na aggregation é crítico — sem isso, trocar regime virada de ano apaga histórico fiscal; padrão "snapshot na hora do cálculo" é genérico (memorial preserva)
- **Continuar:** Manter motor próprio sem provider externo; tabela Simples vigente em DB com valid_from/to é template pra outras tabelas vigentes (IRRF, INSS) futuras
- **Começar:** Avaliar piloto pós-3 meses pra decidir Sprint 37c — manter motor ou delegar Lucro Real pra Contabilizei
