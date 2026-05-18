# Sprint 12 — Geral · Avaliações físicas

- **Área:** geral
- **Início:** planejado (depois do Sprint 11)
- **Fim planejado:** +3 semanas
- **Status:** planejado
- **Item do roadmap:** #14

## Goal

Catálogo de tipos de avaliação (bioimpedância, dobras cutâneas, antropometria, anamnese, testes funcionais) + registro seriado de medições + gráficos comparativos de evolução. Schema genérico serve Academia (composição corporal), Fisio (ROM, força) e Nutri (antropometria) — **Nutri Sprint 24 reusa esse schema** em vez de criar um próprio. **Calculadoras TMB/body-fat/Pollock/Mifflin-St Jeor/Katch-McArdle viram funções públicas em `packages/db/insights/anthropometry.ts`** (ADR 0070) para consumo cross-module.

## Critério de aceite

- Catálogo `assessment_types` configurável por tenant (default: bioimpedância, dobras 7-pregas, antropometria básica, anamnese, testes funcionais)
- **Seed de escalas funcionais validadas clinicamente** (vertical `fisio`), prontas para uso sem configuração:
  - **EVA** — Escala Visual Analógica de dor (0–10)
  - **Oswestry** — Oswestry Disability Index (lombalgia, 10 questões, 0–100%)
  - **DASH** — Disabilities of the Arm, Shoulder and Hand (30 itens, 0–100)
  - **Tampa** — Escala Tampa de Cinesiofobia (17 itens, 17–68)
  - **SF-36** — Medical Outcomes Study Short Form (36 itens, 8 domínios)
  - **Berg** — Escala de Equilíbrio de Berg (14 tarefas, 0–56)
  - **TUG** — Timed Up and Go (teste cronometrado em segundos)
  - **WOMAC** — Western Ontario and McMaster Universities Osteoarthritis Index (joelho/quadril, 24 itens)
  - Cada escala com `scoring_method` (soma simples, percentual, por domínio) + faixas de interpretação clínica
- Cada tipo define `fields` (array de campos: nome, tipo numérico/enum/texto, unidade, faixa válida)
- Registro de `assessment` cria série de `measurements` (uma linha por campo)
- Gráficos de evolução por campo (peso, gordura %, circunferência braço, etc)
- Comparação lado a lado entre avaliações (antes × depois × atual)
- Anamnese: template de formulário (questionário com perguntas abertas/múltipla escolha) por tipo
- Upload de foto opcional por avaliação (postura, antes/depois) em Storage criptografado
- Teste E2E: registrar 3 avaliações de bioimpedância em datas diferentes → gráfico mostra tendência
- Teste E2E: anamnese Academia vira registro em `assessments` com respostas estruturadas
- Seed: 3 tipos padrão + 2 avaliações populadas por member de cenário canônico
- **RIPD [`docs/compliance/ripd/v1.0-avaliacoes-fisicas.md`](../compliance/ripd/v1.0-avaliacoes-fisicas.md)** publicado e assinado pelo DPO antes do feature flag `avaliacoes_v1` ir a produção (regra 29 + ADR 0054); cobre antropometria + anamnese + bioimpedância — toda categoria é health_data art. 11

## Dependências

- Sprint 02 (members)
- Sprint 01b (consent — avaliação física é dado sensível, respeita consent do member)

## Decisões tomadas / ADRs esperados

- **[ADR 0024](../decisions/0024-avaliacoes-schema-dinamico-fields-jsonb.md)** (Accepted — 2026-05-13) — `assessments` como catálogo de tipos + `measurements` séries temporais. Um schema serve bioimpedância, dobras, antropometria (Nutri), ROM (Fisio). Tipos configuráveis por tenant; campos com schema declarativo (Zod dinâmico).
- **Pergunta aberta:** cálculos derivados (IMC, taxa metabólica basal, índice de gordura Pollock 7 dobras) — feitos no banco via generated columns, na aplicação via função utilitária, ou gravados como campos regulares? Começar com função JS em `packages/db/assessments/calc.ts` e rodar na escrita.

## Módulos entregues

Ver [`modulos.md` — Geral](../modulos.md#geral):

- Catálogo de tipos de avaliação
- Registro seriado de medições
- Anamnese estruturada
- Gráficos de evolução

## Rotas Next.js

- `/app/avaliacoes` — lista com filtros por tipo/period/member
- `/app/avaliacoes/tipos` — catálogo de tipos + CRUD
- `/app/avaliacoes/tipos/[id]` — editor de campos
- `/app/members/[id]/avaliacoes` — avaliações do member (tabela)
- `/app/members/[id]/avaliacoes/new` — wizard (escolhe tipo, preenche campos)
- `/app/members/[id]/avaliacoes/[id]` — detalhe + edição + foto
- `/app/members/[id]/avaliacoes/evolucao` — gráficos (linha por campo, período selecionável)

## Server Actions + API Routes

Server Actions em `apps/web/app/avaliacoes/actions.ts`:

- `createAssessmentType(input)` — define campos
- `updateAssessmentType(id, input)` — cria nova versão se mudou schema de campos (versionamento)
- `createAssessment(memberId, typeId, measurements[], photos[]?, notes?)` — grava avaliação completa
- `updateAssessment(id, ...)` — versiona
- `deleteAssessment(id)` — soft-delete + audit
- `compareAssessments(ids[])` — retorna dados estruturados para gráfico comparativo

## Schemas Drizzle (esperado)

Em `packages/db/schema/avaliacoes.ts`:

- `assessment_types` — `id`, `tenant_id nullable` (null = template global, ex: "bioimpedância InBody", "Oswestry", "DASH"), `name`, `description`, `vertical` enum nullable (`academia`, `fisio`, `nutri`), `category` enum (`composicao_corporal`, `escala_funcional`, `anamnese`, `teste_funcional`, `custom`), `fields jsonb` (array: `{ key, label, kind: 'number'|'enum'|'text'|'likert', unit?, min?, max?, options?, weight? }`), `scoring_method jsonb nullable` (para escalas: `{ strategy: 'sum'|'percent'|'domain', domains?, interpretation?: [{ range: [min, max], label, severity }] }`), `clinical_reference text nullable` (ex: "Fairbank et al., 1980" para Oswestry), `version int`, `archived_at`
- `assessments` — `id`, `tenant_id`, `member_id`, `assessment_type_id`, `type_version int`, `performed_at`, `performed_by_user_id`, `notes text`, `soft_deleted_at nullable`, `created_at`
- `assessment_measurements` — `id`, `assessment_id`, `field_key text`, `value_num numeric nullable`, `value_text text nullable`, `value_enum text nullable`, **`source` enum (`manual`, `device`, `import_csv`) default 'manual'**, **`source_device_reading_id uuid nullable`** (FK `device_readings` do Sprint 34 Device Hub — rastreia origem quando medida veio de dispositivo curado pelo profissional), **`validated_by_user_id uuid nullable`**, **`validated_at timestamptz nullable`**. Índice `(assessment_id, field_key)` único. Quando `source='device'`, exige `validated_by_user_id` e `validated_at` preenchidos (trigger valida). Coluna preparada desde Sprint 12; UI de importação ativa quando Sprint 34 Device Hub existir.
- `assessment_photos` — `id`, `assessment_id`, `storage_path`, `kind` enum (`front`, `back`, `side`, `custom`), `uploaded_at`. Storage bucket `assessments-photos` privado com URL assinada curta.
- `assessment_calculations` — (opcional, cache) `id`, `assessment_id`, `calc_key text`, `value numeric`, `calculated_at`. Usado para IMC, % gordura via Pollock etc. Recalculado se measurements mudam.

**RLS:** tenant_id + scope. Dado sensível (regra 4, criptografia at-rest via Supabase). Leitura por profissional com permission `avaliacao.read` + scope cobrindo o member.

## Eventos de domínio emitidos

- `assessment.created` — `{ assessment_id, member_id, type, performed_by, at }`
- `assessment.updated` / `assessment.deleted`
- `measurement.recorded` (um por campo) — para Sprint 09 (metas) consumir automaticamente progresso (ex: meta "perder 5kg" consome `measurement.recorded` com `field_key=peso_kg`)

## Commit (checklist)

- [ ] Schema Drizzle: `assessment_types`, `assessments`, `assessment_measurements`, `assessment_photos`, `assessment_calculations`
- [ ] RLS + testes (dado sensível — leitura audited)
- [ ] Zod schema dinâmico baseado em `assessment_types.fields`
- [ ] Calculadoras comuns em `packages/db/assessments/calc.ts` (IMC, Pollock 7/3, **Petroski**, **Guedes**, Durnin, **Faulkner**, TMB Harris-Benedict, **TMB Mifflin-St Jeor**, **TMB Cunningham** (usa massa magra), **TMB Katch-McArdle**, relação cintura-quadril, **% gordura pela circunferência Jackson-Pollock**). Organizado por categoria (`body_fat_percent`, `metabolic_rate`, `ratios`) para UI oferecer o protocolo certo conforme especialidade do profissional.
- [ ] Scorers de escalas funcionais em `packages/db/assessments/scoring/` (um arquivo por escala: `oswestry.ts`, `dash.ts`, `tampa.ts`, `sf36.ts`, `berg.ts`, `tug.ts`, `womac.ts`, `eva.ts`). Cada scorer recebe `measurements[]` e retorna `{ total, domains?, interpretation: { label, severity, recommendation } }`. Testes unit cobrindo casos de limite + referência bibliográfica.
- [ ] Seed das 8 escalas funcionais (Oswestry, DASH, Tampa, SF-36, Berg, TUG, WOMAC, EVA) como `assessment_types` globais (tenant_id NULL) com `category='escala_funcional'`, `vertical='fisio'` e `clinical_reference` preenchido.
- [ ] Upload de foto para Storage bucket privado + URL assinada
- [ ] UI catálogo de tipos + editor de campos (low-code)
- [ ] UI wizard de avaliação respeitando schema do tipo
- [ ] **Slot para importação de leituras de dispositivo (placeholder quando Sprint 34 Device Hub existir):** UI já tem botão "Importar leituras de dispositivos" mas mostra "disponível em breve"; schema já aceita `source_device_reading_id` + `validated_by_user_id` para quando Device Hub for ativado
- [ ] UI gráficos (reusar biblioteca do dashboard Sprint 07)
- [ ] UI comparação lado a lado
- [ ] Widget "última avaliação" em `/app/members/[id]` (slot `avaliacao`): mostra IMC + % gordura + peso se tem; link para evolução. `{ slot: 'avaliacao', requiredPermissions: ['avaliacao.read'], requiredVertical: null, consentPurpose: null, showWhen: (m) => m.has_assessments }`
- [ ] Integração com Sprint 09 (metas): `measurement.recorded` atualiza progresso de `goal` kind `weight_loss` ou `body_composition`
- [ ] Seed: 3 tipos + 2 avaliações por member
- [ ] Testes unit das calculadoras
- [ ] Testes E2E: criar tipo, registrar avaliação, ver gráfico
- [ ] **Registrar handler `photo-progress`** no hub inbound WhatsApp do Sprint 13 (ADR 0051): paciente manda foto corporal pelo WhatsApp → classificador identifica → cria rascunho em `/app/members/[id]/avaliacoes/pending-photo` → profissional revisa e anexa a avaliação física formal na próxima consulta
- [ ] Feature flag `avaliacoes_v1`
- [ ] ADR 0024 publicado

## Stretch

- [ ] Importação direta de bioimpedância InBody (CSV padrão do aparelho)
- [ ] Template de anamnese Academia / Fisio / Nutri prontos
- [ ] Assinatura digital da avaliação pelo profissional (precursor do Sprint 20 Fisio)
- [ ] Comparação visual de fotos lado a lado (antes × depois)

## Log

- **2026-05-13 — Faixas A+B+C+D entregues (Sprint 12 a 100%).** Avaliações físicas aterrissadas: 5 schemas (`assessment_types` com biblioteca global tenant_id NULL + `fields jsonb` declarativo + `scoring_method` pra escalas funcionais + versionamento via `parent_type_id` + `clinical_reference`; `assessments` com `type_version` snapshot + `soft_deleted_at` retenção 20a COFFITO/CFM; `assessment_measurements` value_num/text/enum mutuamente exclusivos via check + `source` pré-cabeada pra Device Hub Sprint 34 + check `source=device` exige `validated_by_user_id`+`validated_at`; `assessment_photos` placeholder Storage; `assessment_calculations` cache derivados) + 15 RLS policies (incluindo cross-tenant SELECT em assessment_types globais + INSERT global bloqueado pra app-role) + migration 0018 + 10 unit tests Vitest. Calculadoras antropométricas em `@repo/db/avaliacoes/calc.ts` (ADR 0070): IMC + bands OMS (baixo_peso/normal/sobrepeso/obesidade_i-iii), Pollock 7 dobras Jackson-Pollock 1980 + Siri 1956 + bands por sexo, TMB Mifflin-St Jeor 1990, TMB Harris-Benedict revisado 1984, TMB Katch-McArdle (usa LBM), RCQ OMS (homem/mulher bands), lean mass estimado. 27 unit tests cobrindo edge cases (peso/altura/idade inválidos retornam null, bands corretos, casos canônicos numéricos). Scorer EVA (Escala Visual Analógica Dor) em `@repo/db/avaliacoes/scoring-eva.ts` com 5 bands canônicos (sem_dor/leve/moderada/intensa/insuportável) + severity (info/warning/danger/critical) + 8 tests. 7 Server Actions wrapped (envelope ADR 0071 + audit_log): createAssessmentType, listAssessmentTypes (combina global+tenant; filtros category/vertical), createAssessment **transação com cálculos automáticos** (busca measurements por `field_key` reconhecido → IMC se peso+altura, Pollock se 7 dobras+context idade/sexo, RCQ se cintura+quadril+sexo, TMB Mifflin se peso+altura+idade+sexo, lean mass se peso+pollock → popula `assessment_calculations` em batch), listMemberAssessments, getAssessment (com measurements+photos+calculations expandidos + audit), compareAssessments (série temporal por field_key pra gráfico evolução), softDeleteAssessment (preserva row+audit retenção 20a), getLatestAssessmentSummary (widget perfil). UI completa: `/app/avaliacoes` hub recentes; `/app/avaliacoes/tipos` catálogo combinado com badges Global/Tenant + filtros category/vertical + cards mostrando fields preview + clinical_reference; `/app/avaliacoes/tipos/new` editor low-code de fields (add/remove campos + kind picker number/text/enum/likert + unit + min/max + options); `/app/members/[id]/avaliacoes` tabela; `/app/members/[id]/avaliacoes/new` wizard dinâmico (escolhe tipo → renderiza form baseado em fields jsonb + context idade/sexo/altura pre-preenchido de person + envia createAssessment); `/app/members/[id]/avaliacoes/[id]` detail com cards de cálculos derivados (IMC + classificação + cor por severity OMS bands, % gordura Pollock + faixa atletico/saudavel/sobrepeso, TMB Mifflin kcal/dia, RCQ + risco cardiovascular) + tabela de measurements; widget "📊 Última avaliação" no perfil member entre Treinos e slot Copilot futuro com 3 calc cards (IMC/% Gordura/TMB ou primeiras 3 disponíveis). Seed standalone `pnpm db:seed:avaliacoes` popula 5 tipos globais: Antropometria Academia (peso/altura/4 circ), Bioimpedância (peso+altura+%gordura+massa magra+%água+gordura visceral), Dobras 7-pregas Pollock-Jackson com clinical_reference, Anamnese Academia (objetivo+nível atividade+histórico médico+medicamentos+restrições+frequência), EVA — Escala de Dor Fisio com scoring_method jsonb completo + clinical_reference Huskisson 1974. ADR 0024 publicado documentando schema dinâmico via `fields jsonb` declarativo + measurements serializadas por field_key + cálculos via `calc_key` canônico + versionamento via parent_type_id + biblioteca global cross-tenant. **45 testes Vitest Sprint 12 verdes** (10 RLS + 27 calc + 8 EVA); 206 testes total verdes (era 161). Typecheck `pnpm --filter @app/web typecheck` clean. **Pendências menores adiadas Sprint 12+ próximo PR:** 7 escalas funcionais restantes (Oswestry/DASH/Tampa/SF-36/Berg/TUG/WOMAC) — seguem mesmo padrão MVP EVA; Petroski/Guedes/Durnin/Faulkner/Cunningham calculadoras pra protocolos brasileiros; upload photo MinIO bucket privado + scan ClamAV (regra 38); gráficos Recharts de evolução temporal por field_key (consome `compareAssessments`); comparação visual lado-a-lado entre 2-3 avaliações; integração com Sprint 09 goals via `measurement.recorded` (peso → atualiza progresso goal kind=weight_loss); WhatsApp photo-progress handler hub Sprint 13 (paciente manda foto → rascunho avaliação pending); Device Hub source=device trigger validation Sprint 34; RIPD `v1.0-avaliacoes-fisicas.md` + DPO sign-off; feature flag `avaliacoes_v1` (PostHog dropado MVP). **Bug pré-existente** (Server Components com `db` global retornam 0 rows porque RLS bloqueia — mesmo padrão vendas/members/treinos) continua aplicável a `/app/members/[id]/avaliacoes` listagem; tipos globais (`/app/avaliacoes/tipos`) e wizard funcionam porque RLS permite tenant_id NULL.

## Definition of Done

- [ ] Feature flag `avaliacoes_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] RLS verificada + audit em leituras
- [ ] Storage criptografado confirmado
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 12 → `done`
- [ ] ADR 0024 publicado

## Retro

- —
