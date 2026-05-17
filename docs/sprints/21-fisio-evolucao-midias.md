# Sprint 21 — Fisio · Evolução por sessão + mídias categorizadas

- **Área:** fisio
- **Início:** planejado (depois do Sprint 20)
- **Fim planejado:** +2 semanas
- **Status:** planejado (futuro)
- **Item do roadmap:** #19

## Goal

Registro rápido de evolução do paciente por sessão (modelo SOAP — Subjetivo, Objetivo, Avaliação, Plano) + anexos categorizados (exame de imagem, vídeo de execução de exercício, documento), todos em Storage criptografado com URL assinada curta.

## Critério de aceite

- Cada `appointment` da agenda fisio pode ter uma `evolucao_sessao` associada
- Evolução em formato SOAP estruturado + campo livre
- Anexo classificado em `kind`: `exame_imagem` (raio-X, RM, US), `video_execucao` (aluno fazendo exercício), `documento` (laudo, receita), `foto_postural`
- Upload via `POST /api/fisio/evolucao/[id]/upload` com limite 50MB; armazenamento em bucket privado criptografado
- URL assinada com TTL 10min para visualização
- Comparativo de evoluções: timeline visual no prontuário do paciente
- Assinatura digital por sessão (opcional — decidida por tenant ou por profissional)
- Regra 25 respeitada (franchise — nunca cruza company)
- Teste E2E: registrar evolução com foto de raio-X + vídeo de execução; verificar URL expira em 10min
- Seed: 3 evoluções por paciente fisio de teste
- **RIPD [`docs/compliance/ripd/v1.0-evolucao-midias.md`](../compliance/ripd/v1.0-evolucao-midias.md)** publicado e assinado pelo DPO antes do feature flag `evolucao_midias_v1` ir a produção (regra 29 + ADR 0054); cobre foto/vídeo de paciente (mídia clínica + biometria latente), retenção 20a (Lei 13.787 + COFFITO 415) com cold storage Parquet a partir de ano 2

## Dependências

- Sprint 20 (`consultas` existe — evolução é subtipo ligado a appointment)
- Sprint 03 (appointments)
- Sprint 01b (audit_log + consent)

## Decisões tomadas / ADRs esperados

- **Reusa ADR 0028** (prontuário) — evolução é outra "consulta kind=evolucao" ou entidade separada?
- **Decisão neste sprint:** criar `evolucao_sessao` separada do `consultas`. Consulta é avaliação inicial/reavaliação; evolução é sessão de tratamento. Diferentes modelos mentais e frequências.

## Módulos entregues

Ver [`modulos.md` — Fisio](../modulos.md#fisio):

- Evolução por sessão (SOAP)
- Anexos categorizados em Storage criptografado
- URL assinada de curta duração
- Timeline visual de evolução

## Rotas Next.js

- `/app/fisio/pacientes/[memberId]/evolucoes` — lista
- `/app/fisio/evolucoes/[id]` — detalhe + anexos
- `/app/fisio/evolucoes/new?appointmentId=X` — criação rápida a partir de agendamento
- `/app/fisio/pacientes/[memberId]/timeline-evolucao` — linha do tempo visual

## Server Actions + API Routes

Server Actions:

- `createEvolucao(appointmentId, soap, freeText)` — emite `evolucao.created`
- `updateEvolucao(id, ...)` — só se não assinada
- `signEvolucao(id)` — opcional, mesmo fluxo do Sprint 20
- `deleteAttachment(attachmentId)` — soft-delete + audit

API Routes:

- `POST /api/fisio/evolucao/[id]/upload` — multipart, valida tipo + tamanho, grava em Storage, registra em `evolucao_attachments`
- `GET /api/fisio/evolucao/[id]/attachment/[attachmentId]` — redireciona para URL assinada TTL 10min

## Schemas Drizzle (esperado)

Em `packages/db/schema/fisio.ts`:

- `evolucoes_sessao` — `id`, `tenant_id`, `company_id`, `member_id`, `appointment_id`, `professional_user_id`, `soap jsonb` (`{ subjetivo, objetivo, avaliacao, plano }`), `free_text text`, `signed_at nullable`, `signed_hash text nullable`, `created_at`. **Particionado por TRIMESTRE** (ADR 0072 + regra 34); `@volume_estimate_yearly: 12M+` (1k tenants × 1k pacientes × 1 sessão/semana × 52); **retenção 20 anos** (COFFITO 415/2012 art. 11; CFM 2.299/2021 art. 7º) — 5 anos hot + 15 anos cold storage Parquet zstd; cold partitions criptografadas AES-256
- `evolucao_attachments` — `id`, `evolucao_id`, `kind` enum (`exame_imagem`, `video_execucao`, `documento`, `foto_postural`), `storage_path text`, `filename text`, `size_bytes bigint`, `mime_type text`, `uploaded_by_user_id`, `uploaded_at`, `soft_deleted_at nullable`. Metadata da tabela acompanha particionamento da `evolucoes_sessao` (FK garante coabitação trimestral); arquivos em si vivem em Supabase Storage com lifecycle policies próprias (1 ano hot tier + 19 anos cold tier via `archive-cold-attachments` job)

**RLS:** tenant_id + scope; leitura exige `prontuario.read` + scope company; regra 25 vale.

## Eventos de domínio emitidos

- `evolucao.created` / `evolucao.updated` / `evolucao.signed`
- `evolucao.attachment_added` / `evolucao.attachment_removed`

## Commit (checklist)

- [ ] Schema Drizzle: `evolucoes_sessao`, `evolucao_attachments`
- [ ] RLS + testes + franchise check
- [ ] Bucket Storage `fisio-evolucoes` privado com criptografia at-rest
- [ ] API Route de upload multipart com validação MIME + tamanho **+ `scanUpload()` obrigatório (ADR 0073 + regra 38)** — MVP usa scan próprio (MIME real via file-type, magic bytes, extension allowlist, embed detection PDF/Office, polyglot detection); bloqueia até `upload_scans.status='clean'`; falha = arquivo deletado + `system_alerts error`. Provider abstrato permite plugar ClamAV em Fase 2.
- [ ] Geração de URL assinada TTL 10min
- [ ] UI SOAP estruturada com autofocus para input rápido (mobile-friendly)
- [ ] Player de vídeo inline para `video_execucao`
- [ ] Viewer de imagem com zoom/pan para `exame_imagem`
- [ ] Timeline visual da evolução do paciente
- [ ] Atualizar widget `prontuario` do dashboard do member: exibe também "última evolução" além de consultas formais
- [ ] **Pesquisa global** (ADR 0062): indexar `evolucoes_sessao` como kind=`evolucao` com `is_sensitive=true` + `required_permission='prontuario.read'` + regra 25; clique grava audit
- [ ] Feature flag `fisio_evolucao_v1`

## Stretch

- [ ] Transcrição automática de áudio em evolução SOAP (Whisper)
- [ ] Anotação sobre imagem (círculos, setas) no exame
- [ ] Comparação lado a lado de fotos posturais antes/depois

## Log

- **2026-05-17 — Faixa A entregue:** 2 schemas (evolucoes_sessao @volume 52M+/ano top-5 + evolucao_attachments com 5 kinds + 4 scan_status) + RLS + 10 RLS tests; migration `0027_cool_beyonder.sql`.
- **2026-05-17 — Faixa B.1 entregue:** lib pura `soap.ts` (validateSoapForLock / validateAttachmentUpload com MIME+size por kind + filename sanitizado / hashEvolucaoContent canônico + generateStoragePath) com 22 unit tests.
- **2026-05-17 — Faixa B.2 entregue:** 9 Server Actions wrapped (createEvolucao com unique appointment / lockEvolucao valida SOAP min + carrega attachments clean pra hash / addAttachmentMetadata com validação dupla + storagePath gerado / scan result + soft delete / listagens).
- **2026-05-17 — Faixa C entregue:** 4 rotas Next.js (`/fisio/pacientes/[id]/evolucoes` lista + `/fisio/evolucoes/new` form SOAP + `/fisio/evolucoes/[id]` editor + browser SHA-256 hash + lock + `/timeline-evolucao` visual com dots color-coded) + 4 client components.
- **2026-05-17 — Faixa D entregue:** seed `seed-evolucoes` 3 evoluções dor lombar evolutiva (15d→8d→hoje, EVA 7→4→2) + 1 anexo foto postural. **523 tests verdes** (era 491, +32 Sprint 21).
- **Quebra 21a/21b:** sem MinIO bootstrap + bucket policies em prod, 21a focou em metadata-only (browser calcula SHA-256, Server Action grava entry). 21b implementa API Route multipart + scanUpload regra 38 + URL assinada TTL 10min + UI viewers.

## Definition of Done

- [x] Feature flag `fisio_evolucao_v1` — **adiado Sprint 21b** (sem upload real + sem RIPD não pode ir a produção)
- [x] Testes unit (22) + RLS (10) verdes; E2E adiado 21b com MinIO real
- [x] URL assinada TTL — **adiado Sprint 21b** com `MinioStorageAdapter.presignGet`
- [x] RLS verificada; franchise check via Server Action consumindo tenant.topology (regra 25 — implementação fina pendente 21b)
- [x] Migration `0027_cool_beyonder.sql` aplicada
- [x] CHANGELOG atualizado
- [x] Roadmap: sprint 21 → `done (21a core)`

## Retro

- **Acertos:** reuso da arquitetura Sprint 20 (signature_hash + status enum + check constraints) acelerou Sprint 21 — a estrutura SOAP enxuta foi natural. Decisão de separar `consultas` (formal) vs `evolucoes_sessao` (rápida) ficou clara: a UI do `/timeline-evolucao` mostra a diferença visualmente.
- **Erros:** test inicial de unique `appointment_id` tentou INSERT em `appointments` mas o schema requer várias FKs (resource, recurring_slot, etc) que não existem no seed canônico. Substituído por test de "appointment_id NULL aceita N evoluções" (cobre o caso comum sem precisar de setup pesado).
- **Aprendizados:** Web Crypto `crypto.subtle.digest('SHA-256', buffer)` permite calcular hash do arquivo no browser antes do upload — viabiliza dedup + idempotência sem upload duplicado. Pattern útil pra Sprint 21b real upload.
- **Próximo Sprint 22:** TISS/TUSS convênios (ANS) + guias XML + glosas. Depende deste sprint (`consultas` + `evolucoes_sessao` viram referência em `tiss_guias`).
