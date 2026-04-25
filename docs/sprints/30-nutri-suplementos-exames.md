# Sprint 30 — Nutri · Suplementação + Exames Laboratoriais

- **Área:** nutri
- **Início:** planejado (depois do Sprint 29)
- **Fim planejado:** +3 semanas
- **Status:** planejado (futuro)
- **Item do roadmap:** #28

## Goal

Prescrição de suplementos (vitaminas, minerais, fitoterápicos) como entidade separada de alimentos — por conta de posologia/regulamentação ANVISA. Análise de exames laboratoriais com tabela de referência por analito + alertas de alterações para facilitar conduta clínica.

## Critério de aceite

**Suplementação:**

- Catálogo `supplements` com nome, tipo (`vitamin`, `mineral`, `fitoterápico`, `aminoacid`, `blend`), unidades padrão, concentração típica
- Prescrição de suplemento tem dose + frequência + via + duração + observação (ex: "Vitamina D3 2000UI, 1x ao dia via oral, por 90 dias, junto ao almoço")
- Vincula à `consulta` Nutri (Sprint 20 polimórfico)
- Alerta de interação medicamentosa simples (Vitamina K vs varfarina, por ex) via catálogo curado
- Export no PDF do plano (junto ao plano alimentar do Sprint 29 ou PDF próprio)

**Exames laboratoriais:**

- Catálogo `lab_analytes` (glicose, colesterol total, HDL, LDL, triglicerídeos, ferritina, vitamina D, TSH, etc) com valores de referência por sexo/idade/condição
- `lab_results` registra resultado de exame por paciente: `analyte`, `value`, `unit`, `collected_at`, `laboratory text`
- Upload de laudo PDF (reusa infra Sprint 21)
- Destaque automático: resultado fora da faixa → cor visual (vermelho alto, azul baixo) + tag
- Gráfico de evolução por analito (reusa componente do Sprint 12)
- Relatório agregado: últimos exames ordenados por categoria
- Integração com `consulta` (nutri vincula exames interpretados na consulta)
- Teste E2E: cadastrar 3 exames, alterados 2 destacados, ver gráfico de evolução ao longo de 6 meses
- Seed: 20 analitos comuns + 10 suplementos com interações conhecidas

## Dependências

- Sprint 02 (members)
- Sprint 20 (consultas nutri)
- Sprint 21 (Storage para laudo PDF)
- Sprint 29 (PDF branding para incluir prescrição suplemento)

## Decisões tomadas / ADRs esperados

- **ADR 0037 (esperado)** — Suplementação separada de alimentos: tabelas distintas (`supplements`, `supplement_prescriptions`) por posologia diferente, regulamentação ANVISA e flux de prescrição próprio.
- **Pergunta aberta:** fonte dos valores de referência laboratorial — SBAC (Sociedade Brasileira de Análises Clínicas)? Manual curado pela LogiFit? Começar com curado + revisão semestral.

## Módulos entregues

Ver [`modulos.md` — Nutri](../modulos.md#nutri):

- Catálogo de suplementos
- Prescrição de suplemento (posologia + duração + interações)
- Catálogo de analitos laboratoriais + valores de referência
- Registro de exames laboratoriais
- Alerta visual de alteração
- Gráfico de evolução de analito

## Rotas Next.js

- `/app/nutri/suplementos` — catálogo global + tenant
- `/app/nutri/suplementos/[id]` — detalhe + interações
- `/app/members/[id]/suplementacao` — prescrições ativas
- `/app/nutri/exames` — catálogo de analitos
- `/app/nutri/exames/referencias` — valores de referência por sexo/idade
- `/app/members/[id]/exames` — lista + gráficos
- `/app/members/[id]/exames/novo` — registro manual (ou upload laudo)
- `/app/members/[id]/exames/[id]` — detalhe + comparação com anteriores

## Server Actions + API Routes

Server Actions:

- `createSupplement(input)` / `updateSupplement` — catálogo
- `prescribeSupplement(memberId, supplementId, posology, durationDays, notes)` — cria entry em `supplement_prescriptions`
- `stopSupplementPrescription(id, reason)` — encerra
- `registerLabResult(memberId, analyteId, value, unit, collectedAt, labName?, attachment?)`
- `importLabResultsFromPdf(file)` — (stretch) OCR + parser
- `compareAnalyteOverTime(memberId, analyteId, fromDate, toDate)` — dados pro gráfico

## Schemas Drizzle (esperado)

Em `packages/db/schema/nutri.ts`:

- `supplements` — `id`, `tenant_id nullable` (NULL=global), `name`, `kind` enum (`vitamin`, `mineral`, `fitoterapico`, `aminoacid`, `blend`, `omega`), `brand text nullable`, `concentration text`, `anvisa_registration text nullable`, `notes text`, `active`
- `supplement_interactions` — `supplement_id`, `interacts_with text` (nome medicamento ou outro suplemento), `severity` enum (`info`, `caution`, `avoid`), `description`
- `supplement_prescriptions` — `id`, `tenant_id`, `member_id`, `supplement_id`, `consulta_id nullable`, `professional_user_id`, `dose text`, `frequency text`, `route` enum (`oral`, `sublingual`, `topical`, `other`), `duration_days int nullable`, `started_at`, `ended_at nullable`, `notes`, `status` enum (`active`, `completed`, `discontinued`)
- `lab_analytes` — `id`, `code text unique` (ex: `glicose_jejum`), `name text`, `category text` (bioquímico, hormonal, etc), `unit text`, `description text`
- `lab_reference_ranges` — `analyte_id`, `sex` enum (`any`, `male`, `female`), `age_min_years`, `age_max_years`, `condition text nullable` (ex: "gestante"), `min_value numeric nullable`, `max_value numeric nullable`, `notes text`. Permite múltiplas faixas por analito.
- `lab_results` — `id`, `tenant_id`, `member_id`, `analyte_id`, `value numeric`, `unit text`, `collected_at date`, `laboratory text nullable`, `consulta_id nullable`, `attachment_storage_path nullable`, `out_of_range bool` (calculado), `out_of_range_direction` enum nullable (`above`, `below`), `created_at`. **Particionado por ANO** (ADR 0072 + regra 34); `@volume_estimate_yearly: 6M+` (1k tenants × 1k members × 30 analitos × 2 exames/ano); **retenção 20 anos** (CFM 2.299/2021 — exame integra prontuário) — 5 anos hot + 15 anos cold storage Parquet zstd

**RLS:** tenant_id + scope; dado sensível (regra 4); audit em leitura.

## Eventos de domínio emitidos

- `supplement.prescribed` / `supplement.discontinued`
- `lab_result.recorded` — `{ result_id, member_id, analyte, out_of_range, at }`
- `lab_result.alert_raised` — quando valor está fora da faixa (para régua/dashboard)

## Commit (checklist)

- [ ] Schema Drizzle: `supplements`, `supplement_interactions`, `supplement_prescriptions`, `lab_analytes`, `lab_reference_ranges`, `lab_results`
- [ ] RLS + audit
- [ ] Seed: 20 analitos + faixas + 10 suplementos + 30 interações
- [ ] Calculadora `isOutOfRange(result, memberAge, memberSex, condition?)` em `packages/db/nutri/lab.ts`
- [ ] Server Actions de suplemento + exame
- [ ] Upload de laudo reusa pipeline do Sprint 21 (bucket `nutri-exames`)
- [ ] UI catálogo + prescrição + registro de exame
- [ ] Componente de gráfico de evolução (reusa Sprint 12)
- [ ] Widget "exames alterados" em `/app/members/[id]` (slot `exames`): alerta se há `lab_result` recente `out_of_range`. `{ slot: 'exames', requiredPermissions: ['nutri.read'], requiredVertical: 'nutri', consentPurpose: null, showWhen: (m) => m.has_recent_lab_alerts }`
- [ ] Integração com régua (Sprint 13): `lab_result.alert_raised` pode disparar notificação ao profissional
- [ ] PDF do plano (Sprint 29) inclui seção de suplementação
- [ ] Feature flag `nutri_suplementos_exames_v1`
- [ ] ADR 0037 publicado

## Stretch

- [ ] OCR de laudo PDF (extração automática de valores)
- [ ] Comparação entre laboratórios diferentes (ajuste por método de análise)
- [ ] Export do conjunto de exames para o paciente (Portal Sprint 26)
- [ ] Predição: nutri-agent (Sprint 28) consulta evolução de analitos para sugerir ajuste

## Log

- —

## Definition of Done

- [ ] Feature flag `nutri_suplementos_exames_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] RLS verificada
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 26 → `done`
- [ ] ADR 0037 publicado

## Retro

- —
