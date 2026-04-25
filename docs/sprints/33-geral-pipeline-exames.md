# Sprint 33 — Geral · Pipeline Inteligente de Exames Laboratoriais

- **Área:** geral (Nutri/Fisio/Academia consomem)
- **Início:** planejado (depois do Sprint 32 Device Hub)
- **Fim planejado:** +4 semanas
- **Status:** planejado (futuro)
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

## Stretch

- [ ] Mapeamento LOINC completo para interoperabilidade internacional
- [ ] Extração de imagem do laudo (gráficos do próprio laboratório)
- [ ] Comparativo automático com exame anterior do mesmo analito ("LDL subiu 30mg/dl em 3 meses")
- [ ] Modelo local de OCR + IA para tenants que não aceitam enviar dado para Anthropic
- [ ] Watermark personalizado do tenant no PDF processado (quando reimprimir)

## Log

- —

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
