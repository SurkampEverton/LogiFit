# Sprint 33 — Geral · Pipeline Inteligente de Exames Laboratoriais

- **Área:** geral (Nutri/Fisio/Academia consomem)
- **Início:** planejado (depois do Sprint 32 Device Hub)
- **Fim planejado:** +4 semanas
- **Status:** **done (33a core)** 2026-05-18 — backbone entregue (schemas+RLS+libs IA+SAs+UI mínima); pipeline real (OCR + IA + scanUpload + drag-drop + revisão completa) em Sprint 33b
- **Item do roadmap:** #35

## Goal

Transformar o registro de exames laboratoriais de digitação manual para pipeline automático: **upload → OCR → IA extração estruturada → IA interpretação preliminar → revisão profissional → `lab_results` oficial**. Aceita upload por profissional (durante consulta) ou paciente (portal com consent). Cross-vertical — Nutri, Fisio e Academia usam.

## Critério de aceite

**Upload:**

- Profissional sobe em `/app/members/[id]/exames/upload` (drag-drop PDF/imagem)
- Paciente sobe em `/meu/exames/upload` com `consent.self_upload_exam` ativo
- **Paciente envia por WhatsApp** com `consent.whatsapp_exchange` ativo — handler registrado no hub do Sprint 13 (ADR 0051) classifica anexo como `exam`, baixa, aplica pipeline e responde ao paciente; sem necessidade de abrir portal
- Storage criptografado em bucket dedicado `lab-documents`
- Validação: tipo MIME (PDF/JPG/PNG), tamanho (≤20MB), resolução mínima
- `exam_documents.source` identifica origem: `professional_upload` | `patient_portal` | `patient_whatsapp`

**OCR:**

- Reusa provider abstrato OCR (ADR 0035 — OCR.space default configurável em `/app/settings/financeiro/ocr`)
- Grava texto bruto em `exam_extractions.raw_text`
- Tempo alvo: <30s

**IA Extração estruturada:**

- Claude via AI SDK (infra do Sprint 06 Copilot)
- Prompt identifica tipo (hemograma, perfil lipídico, bioquímica, hormonal, urinálise, TGO/TGP, hepático, tireoidiano, ferro, glicêmico, coagulação, marcadores inflamatórios, hormônios sexuais, 25-OH vitamina D, PCR, etc)
- Mapeia cada analito extraído para `lab_analytes` via nome + sinonímia + LOINC quando disponível
- Retorna JSON validado por Zod: `{ examType, laboratory, collectedAt, analytes: [{ code, value, unit, referenceHint }] }`
- Cache semântico (Sprint 06) para exames similares reduz custo

**IA Interpretação preliminar:**

- Claude recebe valores extraídos + contexto do paciente (idade, sexo, medicamentos ativos, comorbidades conhecidas)
- Compara com `lab_reference_ranges` (Sprint 30)
- Gera `interpretation_draft` com:
  - `out_of_range[]` — analitos fora da faixa
  - `patterns[]` — padrões cross-analito (perfil aterogênico, padrão anêmico, etc.)
  - `hypotheses[]` — hipóteses (vocabulário conservador: "sugere", "compatível com", "pode indicar")
  - `follow_up_suggestions[]` — exames complementares que poderiam esclarecer
- **Nunca diagnostica** — classificador de output bloqueia palavras como "tem [doença]", "diagnóstico de", "apresenta [condição]"
- Prompt fixo + guardrails (reforça ADR 0015)

**Revisão profissional:**

- Fila em `/app/members/[id]/exames/pending` lista exames aguardando
- Detalhe em `/app/members/[id]/exames/pending/[id]` mostra:
  - PDF original (left pane)
  - Valores extraídos em tabela editável (right pane)
  - Interpretação IA em cards colapsáveis (bottom)
  - Gráficos de evolução desse analito se há histórico (reusa Sprint 30)
- Operações do profissional:
  - Editar value/unit de cada analito
  - Marcar analito como "ignorar" (descarta)
  - Concordar/editar/descartar cada hipótese IA
  - Adicionar observação livre
  - Clicar "Confirmar e adicionar ao histórico"
- Audit: toda edição registra `reviewed_by_user_id`, `reviewed_at`, `changes jsonb`

**Publicação oficial:**

- Para cada analito confirmado, cria linha em `lab_results` (Sprint 30)
- Interpretação validada grava em `exam_interpretations_final` (uma por exame)
- Exame completo vira `exam_documents.status='published'`
- Emite evento `lab_result.published` (régua Sprint 13 pode disparar alerta se valor crítico)
- Timeline do member ganha entrada "Exame de [tipo] adicionado por Dr. X em [data]"
- Notificação ao paciente (portal Sprint 26): "Seu exame foi analisado e adicionado ao histórico"

**Categorias sensíveis:**

- Exames HIV, psiquiátricos, genéticos, teste de paternidade ficam em `exam_documents.sensitivity='high'`
- Acesso exige permission específica `exam.sensitive.read`
- Audit reforçado em leituras

**Opt-out de IA:**

- Admin pode em `/app/settings/exames/ia` desabilitar interpretação IA (mantém só OCR + extração)
- Tenant sensível a LGPD ou com clientes que não autorizam uso de IA

**Testes:**

- Teste unit: classificador de output bloqueia frases proibidas
- Teste E2E: upload hemograma → OCR → extração correta ≥90% dos analitos comuns → IA gera padrões coerentes → profissional revisa + confirma → lab_results criados
- Teste E2E: paciente sobe via portal → aparece em fila do profissional → notificação ao publicar
- Teste: PDF ilegível → fallback para digitação manual com alerta "OCR falhou"

**Seed:** 10 exemplos de laudos de laboratórios diferentes (Sabin, DB, Hermes, Fleury, Delboni) + expected JSON de extração para CI.

## Dependências

- Sprint 06 (Copilot base — AI SDK + cache + rate-limit)
- Sprint 15 (OCR abstrato — ADR 0035)
- Sprint 30 (lab_analytes + lab_reference_ranges + lab_results)
- Sprint 26 (portal paciente — self-upload)
- Sprint 01b (consent + audit + permission `exam.sensitive.read`)
- [ADR 0050 — Pipeline de Exames Laboratoriais](../decisions/0050-pipeline-exames-laboratoriais.md)

## Decisões tomadas / ADRs esperados

- **ADR 0050 (accepted)** — Pipeline OCR → IA extração → IA interpretação → revisão profissional → `lab_results` oficial; IA conservadora, nunca diagnostica; paciente pode subir via portal com fila de revisão
- **Pergunta aberta:** padrão LOINC para codificar analitos — adotar nomes internacionais ou ficar só com nomes em português? Começar com nomes em português + mapeamento LOINC opcional para interoperabilidade futura
- **Pergunta aberta:** quantos laboratórios BR cobrir de início? Seed deve ter ≥5 variações de layout

## Módulos entregues

Ver [`modulos.md` — Geral](../modulos.md#geral):

- Pipeline OCR + IA de exames laboratoriais
- Revisão profissional com UI lado-a-lado (PDF + extração + interpretação)
- Fila de exames pendentes de revisão
- Self-upload do paciente via portal
- Classificador de output IA (guardrails clínicos)
- Categorização sensível (HIV/psiquiátrico/genético)
- Opt-out de IA por tenant

## Rotas Next.js

- `/app/members/[id]/exames/upload` — profissional sobe exame
- `/app/members/[id]/exames/pending` — fila aguardando revisão (por scope)
- `/app/members/[id]/exames/pending/[id]` — detalhe + revisão lado-a-lado
- `/app/exames/fila` — fila global do tenant filtrada por profissional logado
- `/app/settings/exames/ia` — admin configura (habilita/desabilita IA, opt-out)
- `/meu/exames/upload` — paciente sobe no portal
- `/meu/exames/pending` — paciente vê "seu exame em análise"
- `/meu/exames/historico` — exames já validados

## Server Actions + API Routes

Server Actions em `apps/web/app/exames/actions.ts`:

- `uploadExamDocument(input)` — validação + storage + cria `exam_documents` + dispara job de processamento
- `processExam(examDocumentId)` — interno (job): OCR → extração IA → interpretação IA → status pending_review
- `submitExamReview(examDocumentId, reviewedAnalytes[], acceptedInterpretations[], observations)` — profissional confirma; publica em `lab_results`
- `markSensitive(examDocumentId, sensitivity)` — categoriza
- `retriggerAiExtraction(examDocumentId)` — força reexecução (caso de erro)

API Routes:

- `POST /api/exames/upload` — recebe multipart, valida, grava
- `POST /api/jobs/exames/process-queue` — Vercel Cron; processa uploads em fila (OCR + IA) em background

## Schemas Drizzle (esperado)

Em `packages/db/schema/exames.ts`:

- `exam_documents` — `id`, `tenant_id`, `member_id`, `uploaded_by_user_id nullable` (nulo se paciente), `uploaded_by_member_id nullable` (se paciente), **`source` enum (`professional_upload`, `patient_portal`, `patient_whatsapp`, `lab_integration_future`)**, **`source_ref uuid nullable`** (ex: `whatsapp_inbound_messages.id` quando veio do WhatsApp — rastreabilidade), `storage_path`, `original_filename`, `mime_type`, `sensitivity` enum (`normal`, `high`), `exam_type_detected text nullable`, `laboratory text nullable`, `collected_at timestamptz nullable`, `status` enum (`uploaded`, `processing`, `pending_review`, `published`, `rejected`), `uploaded_at`, `processed_at nullable`, `reviewed_at nullable`, `reviewed_by_user_id nullable`. **Particionado por ANO** (ADR 0072 + regra 34); `@volume_estimate_yearly: 2M+` (1k tenants × 1k members × 2 exames/ano); **retenção 20 anos** (CFM 2.299/2021 art. 7º — exame integra prontuário) — 5 anos hot + 15 anos cold storage; PDF original em Supabase Storage criptografado AES-256 com lifecycle policy 1 ano hot tier + 19 anos cold tier (move para Storage class "Cold" via job `archive-cold-attachments`)
- `exam_extractions` — `id`, `exam_document_id`, `raw_text`, `ocr_provider`, `ocr_confidence numeric nullable`, `structured_data jsonb` (JSON normalizado dos analitos extraídos), `extraction_model`, `extraction_at`, `extraction_cost_cents int nullable`. Acompanha particionamento ANUAL do `exam_documents` (mesma chave de partição); `raw_text` (volumoso) migra para Storage cold após 5 anos preservando `structured_data` na partição quente para queries
- `exam_interpretations_draft` — `id`, `exam_document_id`, `out_of_range jsonb`, `patterns jsonb`, `hypotheses jsonb`, `follow_up_suggestions jsonb`, `model_used`, `generated_at`, `blocked_by_classifier bool` (se bloqueou termo proibido)
- `exam_interpretations_final` — `id`, `exam_document_id`, `accepted_patterns jsonb`, `accepted_hypotheses jsonb`, `professional_observations text`, `reviewed_by_user_id`, `reviewed_at`
- `exam_review_edits` — audit de edições durante review: `exam_document_id`, `field_key`, `before_value`, `after_value`, `edited_by_user_id`, `edited_at`
- `tenant_exam_ai_settings` — `tenant_id pk`, `ai_extraction_enabled bool default true`, `ai_interpretation_enabled bool default true`, `classifier_strictness enum` (`strict`, `moderate`) default `strict`

**RLS:** tenant_id + scope; permission `exam.read`, `exam.write`, `exam.review`, `exam.sensitive.read`. Regra 25 enforced (franchise bloqueia cross-company).

## Eventos de domínio emitidos

- `exam.uploaded` — `{ exam_id, uploaded_by_role }`
- `exam.extracted` — `{ exam_id, analytes_count, confidence }`
- `exam.interpretation_drafted` — `{ exam_id, patterns_count, hypotheses_count }`
- `exam.interpretation_blocked_by_classifier` — audit se classificador bloqueou
- `exam.reviewed` — `{ exam_id, reviewed_by, edits_count }`
- `exam.published` — dispara alertas se valores críticos
- `lab_result.published` (um por analito) — reusa evento do Sprint 30

## Commit (checklist)

- [ ] Schema Drizzle: `exam_documents`, `exam_extractions`, `exam_interpretations_draft`, `exam_interpretations_final`, `exam_review_edits`, `tenant_exam_ai_settings`
- [ ] Storage bucket `lab-documents` privado criptografado
- [ ] **`scanUpload()` obrigatório (ADR 0073 + regra 38)** em `uploadExamDocument` — paciente sobe PDF malicioso disfarçado de laudo via portal/WhatsApp = bloqueado antes de OCR; MVP usa scan próprio (MIME real, magic bytes, extension allowlist `.pdf|.jpg|.png|.heic`, embed detection — PDF JS é flag crítica em exame, rejeita imediato); documento só vira `processing` após `upload_scans.status='clean'`. Fase 2 plugar ClamAV (clínica médico-hospitalar contratante exigirá)
- [ ] **safeFetch() obrigatório (ADR 0073 + regra 37)** no OCR provider (allowlist por adapter — OCR.space, Google Vision, AWS Textract conforme ADR 0035)
- [ ] RLS + audit reforçado para sensitivity=high
- [ ] Server Actions + API Routes
- [ ] Job Vercel Cron de processamento de fila
- [ ] Wrapper OCR reusa `packages/ai/ocr/` (ADR 0035)
- [ ] Prompt + classificador em `packages/ai/exames/` (extraction.ts, interpretation.ts, classifier.ts)
- [ ] UI `/app/members/[id]/exames/*` — upload, fila, revisão lado-a-lado com PDF viewer + table editor
- [ ] UI `/meu/exames/*` — upload, status, histórico
- [ ] **Registrar handler `exam-upload`** no hub inbound do Sprint 13 (ADR 0051): recebe anexo classificado como exame + person_id já resolvido → chama `uploadExamDocument({ source: 'patient_whatsapp', source_ref: inboundMessageId })` → dispara pipeline normalmente; responde ao paciente "📄 Recebi seu exame. Em análise." e depois "✓ Seu exame foi analisado! Ver: {portal_link}"
- [ ] UI `/app/settings/exames/ia` — opt-out e config
- [ ] Integração com régua Sprint 13 para notificações
- [ ] Integração com Sprint 30 `lab_results` (publicação oficial)
- [ ] Integração com timeline member (novo evento)
- [ ] Permission `exam.read`, `exam.write`, `exam.review`, `exam.sensitive.read`
- [ ] Consent `self_upload_exam` para paciente
- [ ] Seed 10 exames de 5 labs diferentes + expected JSON
- [ ] Testes unit: classificador (bloqueia "diagnóstico de X", aceita "sugere X")
- [ ] Testes E2E: fluxo profissional + fluxo paciente portal
- [ ] **Pesquisa global** (ADR 0062): indexar `lab_results` como kind=`lab_result` com `is_sensitive=true` + `required_permission='exame.read'`; searchable_text = nome do exame + analito + valor; resultados exibidos com ícone de sensibilidade; clique grava audit; exames HIV/psiquiátrico/genético/paternidade exigem `exam.sensitive.read` (escalonamento de permission)
- [ ] Feature flag `exames_ia_v1`
- [ ] ADR 0050 publicado
- [ ] **RIPD [`docs/compliance/ripd/v1.0-exames-laboratoriais.md`](../compliance/ripd/v1.0-exames-laboratoriais.md)** publicado e assinado pelo DPO antes do feature flag ir a produção (regra 29 + ADR 0054); cobre OCR + IA generativa (Vertex AI Gemini SP) + classificador anti-prescrição + revisão humana obrigatória + retenção 20a (Lei 13.787). RIPD compartilhado com Sprint 30 (nutri exames).
- [ ] **Notificação ANVISA RDC 657/2022** (regra 28 + ADR 0053): pipeline interpretação é **SaMD Classe II** (apoio decisão clínica); criar `docs/compliance/anvisa-notifications/2026-{{mes}}-pipeline-exames.md` a partir do [`_template.md`](../compliance/anvisa-notifications/_template.md) + protocolo ANVISA via portal; feature não ativa em produção sem notificação aprovada

## Stretch

- [ ] Mapeamento LOINC completo para interoperabilidade internacional
- [ ] Extração de imagem do laudo (gráficos do próprio laboratório)
- [ ] Comparativo automático com exame anterior do mesmo analito ("LDL subiu 30mg/dl em 3 meses")
- [ ] Modelo local de OCR + IA para tenants que não aceitam enviar dado para Anthropic
- [ ] Watermark personalizado do tenant no PDF processado (quando reimprimir)

## Log

- **2026-05-18 — Faixa A backbone entregue (`done (33a core)`)**
  - 6 schemas Drizzle em `packages/db/src/schema/exames.ts` (4 enums + 6 tabelas: `exam_documents` particionável anual Sprint 33b @volume 2M+/ano com 5 índices incl. partial em `status=pending_review` e `sensitivity=high` + 2 CHECKs uploader_consistency/review_consistency; `exam_extractions` 1:1 com raw_text + structured_data jsonb Zod-validado + CHECK confidence 0-1; `exam_interpretations_draft` com `blocked_by_classifier` audit flag + classifier_blocked_terms jsonb + index partial em blocked=true; `exam_interpretations_final` revisada pelo profissional com rejected_hypotheses pra audit; `exam_review_edits` append-only sem UPDATE/DELETE policy; `tenant_exam_ai_settings` opt-out + classifier_strictness strict/moderate). Migration `0038_exames_pipeline.sql`. RLS `0051_exames_rls.sql` (FORCE em todas 6 + GRANT SELECT/INSERT/UPDATE diferenciado — `exam_review_edits` só SELECT+INSERT pra append-only + 10 policies cobrindo tenant scope + member portal via `app.member_id` em select de `exam_documents` e `exam_interpretations_final`).
  - 3 libs puras em `packages/ai/src/exames/`:
    - `classifier.ts` (113 linhas): `classifyInterpretationOutput()` + `classifyInterpretationFields()` + `getBlockedMessage()` com 11 patterns STRICT (diagnóstico de X, paciente tem X, você tem X, prescrever, tome XX mg, iniciar tratamento, comece a tomar, substituir medicamento, contraindicado para X) + 5 patterns MODERATE (confirma, garante que, certeza de, definitivamente, comprovadamente). Regex case-insensitive. Strictness configurável por tenant.
    - `extraction-schema.ts` (69 linhas): `ExamExtractionSchema` Zod `.strict()` + `ExamAnalyteSchema` + `parseExtractionJson()` + `safeParseExtractionJson()` non-throw discriminado. Força LLM seguir contrato com `examType`, `laboratory`, `collectedAt`, `analytes` (min 1 max 100), `overallConfidence` 0-1.
    - `interpretation.ts` (337 linhas): `compareWithRanges()` busca melhor reference range via scoring (condition match=1000pts > sex match=200pts > age range fit=100pts + bonus por amplitude curta) + classifica out_of_range `mild`/`severe` (threshold 20% além do limite); `detectPatterns()` cruza out_of_range com `PATTERN_CATALOG` (7 padrões: perfil aterogênico, anemia ferropriva, resistência insulina, disfunção hepática, hipotireoidismo, deficiência D, deficiência B12) + confidence base 0.85 + 0.1 por optional matchado; `getFollowUpSuggestions()` dicionário curado por padrão (apoB+Lp(a) pra aterogênico, ferro+B12 pra anemia, HOMA-IR+TOTG pra resistência insulina, etc).
  - 36 unit tests verdes em `@repo/ai` (era 145 → 181: +19 classifier + 17 interpretation):
    - `classifier.test.ts` 19 tests: STRICT bloqueia "diagnóstico de diabetes" / "diagnostico" sem acento / "tem diabetes" / "você tem" / "prescrever" / "tome 30 mg" / "iniciar tratamento" / "comece a tomar" / "substituir medicamento" / "contraindicado para Bob"; MODERATE adicional bloqueia "confirma X" / "garante que" / "certeza de" / "definitivamente" / "comprovadamente tem"; aceita allowlist conservadora ("sugere", "compatível com", "pode indicar"); `classifyInterpretationFields` agrega blocked across multi-string; `getBlockedMessage` formata pra UI.
    - `interpretation.test.ts` 17 tests: `compareWithRanges` retorna out_of_range correto (LDL=180 above; HDL=30 below; glicose normal in-range); scoring picks condition>sex>age; `classifyOutOfRange` severity threshold 20%; `detectPatterns` retorna perfil_aterogenico quando LDL+HDL match required + bonus por triglicérides optional; retorna anemia_ferropriva quando hemoglobina+ferritina baixas; padrão não match se direction errada; multiple patterns simultaneous; confidence cap 1; `getFollowUpSuggestions` retorna sugestões deduplicadas por padrão (apoB pra aterogênico, ferro pra anemia).
  - 9 Server Actions wrapped (`wrapServerAction` envelope ADR 0071):
    - Staff (`apps/web/app/app/exames/actions.ts` 685 linhas): `uploadExamDocument({memberId, storagePath, originalFilename, mimeType, fileSizeBytes?, sensitivity?, source})` valida member do tenant + cria `exam_documents` status=`uploaded`; `processExam({examDocumentId})` interno chamado pelo job — MVP usa `stubOcrAndExtraction()` determinístico retornando 5 analitos (glicose+hba1c+colesterol+hdl+triglicérides) → grava `exam_extractions` + carrega `lab_analytes`/`lab_reference_ranges` Sprint 30 + `compareWithRanges`/`detectPatterns`/`getFollowUpSuggestions` libs puras + `classifyInterpretationFields` guardrail → persiste `exam_interpretations_draft` com `blocked_by_classifier` flag + status=`pending_review`; `submitExamReview({examDocumentId, reviewedAnalytes[], acceptedPatterns[], acceptedHypotheses[], rejectedHypotheses[], observations?})` em transação cria `exam_interpretations_final` + audit `exam_review_edits` (1 por analito editado) + `lab_results` Sprint 30 (1 por analito não-ignorado) + status=`published`; `listPendingExams({limit, sensitivityFilter})` fila ASC por uploaded_at; `getExamDetail({examDocumentId})` retorna doc + última extraction + último draft; `markSensitive({examDocumentId, sensitivity})` permite escalar pra `high`; `rejectExam({examDocumentId, reason})` válido só em status não-terminal.
    - Member portal (`apps/web/app/meu/exames/actions.ts` 90 linhas): `selfUploadExam({storagePath, originalFilename, mimeType, fileSizeBytes?})` cria `exam_documents` source=`patient_portal` com `uploaded_by_member_id`; `listMyExams()` retorna últimos 50 do member via `withMemberContext` RLS-aware.
  - 5 rotas UI mínimas (Sprint 33b expande pra revisão completa lado-a-lado):
    - `/app/exames/fila` lista pendentes do tenant ASC por uploaded_at com colunas Paciente/Tipo/Lab/Origem (ícones 👨‍⚕️/📱/💬/🔌)/Sensibilidade (🔒 alta)/Status IA (✓ pronto / ⚠ IA bloqueou)/Idade horas.
    - `/app/exames/[id]` detalhe read-only: cabeçalho member + tipo + lab + sensitivity badge; metadados (arquivo+mime, origem, recebido, processado); tabela analitos extraídos com badge ⬆/⬇ + mild/severe por out_of_range; padrões detectados com cards confidence%; sugestões follow-up; banner amarelo quando `blocked_by_classifier=true` mostra termos bloqueados; nota "Sprint 33b adiciona table editor + submit review".
    - `/app/nutri/exames` rota nutri-específica (reaproveita backbone).
    - `/meu/exames` (portal mobile-first) lista exames do member com status badge amigável ("Recebido — aguardando análise" / "Em análise pela IA" / "Aguardando seu profissional" / "✓ Analisado e adicionado ao histórico").
    - `/meu/exames/upload` placeholder Sprint 33b (UI drag-drop + MinIO + scanUpload regra 38).
  - 8 RLS + check tests em `packages/db/tests/exames-rls.test.ts`: insert válido OK; uploader_consistency rejeita ambos NULL (errCode 23514); review_consistency rejeita status=published sem reviewed_at; patient_portal upload OK com `uploaded_by_member_id`; tenant isolation TENANT_REDE vê 1 / TENANT_FRANQUIA vê 0 do mesmo doc; confidence_range rejeita 1.5 (>1); blocked_by_classifier preserva texto bloqueado em jsonb pra audit; tenant_exam_ai_settings opt-out insert+update OK + isolation.
  - ADR 0050 já Accepted desde 2026-04-23.
  - **Pendências Sprint 33b/c** (não bloqueiam fechamento backbone): `processExam` stub → `resolveModelForTask('extraction')` Vertex AI Gemini real (regra 32) + OCR provider abstrato Sprint 15 ADR 0035 com `safeFetch` regra 37 + allowlist hosts; `scanUpload()` no `selfUploadExam` (regra 38 + ADR 0073 — paciente sobe PDF malicioso disfarçado de laudo = bloqueado antes do OCR + MIME real + magic bytes + PDF JS flag crítica); MinIO real bucket `lab-documents` cifrado AES-256 + URL assinada TTL 10min; UI drag-drop em `/app/members/[id]/exames/upload` + `/meu/exames/upload`; **table editor lado-a-lado completo** com PDF embed left pane + analytes editable right pane + interpretação IA cards colapsáveis + confirmar/rejeitar individual por hipótese; particionamento ANUAL `exam_documents` + `exam_extractions` (regra 34 + ADR 0072 + retenção 20a Lei 13.787 + 1 ano hot tier + 19 anos cold tier `archive-cold-attachments`); permissions RBAC `exam.read`/`exam.write`/`exam.review`/`exam.sensitive.read` + consent `self_upload_exam`; integração régua Sprint 13 alerta valores críticos (`lab_result.published`) + notificação portal `exam.uploaded`/`exam.published`; handler `exam-upload` no hub WhatsApp inbound Sprint 13 ADR 0051; UI super-admin `/app/settings/exames/ia` opt-out + classifier strictness; pesquisa global ADR 0062 indexar lab_results com `is_sensitive=true` + `required_permission='exame.read'`; **notificação ANVISA RDC 657/2022 SaMD Classe II** antes de feature flag prod (regra 28 + ADR 0053); **RIPD `v1.0-exames-laboratoriais`** com DPO sign-off antes de feature flag (regra 29 + ADR 0054 — cobre OCR + IA generativa + classifier + revisão humana + retenção 20a); feature flag `exames_ia_v1`; E2E Playwright fluxo profissional + paciente portal + classifier bloqueia 100% benchmark.

## Definition of Done

- [ ] Feature flag `exames_ia_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] Extração >90% dos analitos comuns em laudos dos 5 laboratórios do seed
- [ ] Classificador bloqueia 100% de frases diagnósticas no benchmark
- [ ] RLS + audit verificados para sensitivity=high
- [ ] LGPD revisada: contrato com provider IA vigente + opt-out funcional
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 33 → `done`
- [ ] ADR 0050 publicado

## Retro

- —
