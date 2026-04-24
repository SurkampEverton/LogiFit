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

- `evolucoes_sessao` — `id`, `tenant_id`, `company_id`, `member_id`, `appointment_id`, `professional_user_id`, `soap jsonb` (`{ subjetivo, objetivo, avaliacao, plano }`), `free_text text`, `signed_at nullable`, `signed_hash text nullable`, `created_at`
- `evolucao_attachments` — `id`, `evolucao_id`, `kind` enum (`exame_imagem`, `video_execucao`, `documento`, `foto_postural`), `storage_path text`, `filename text`, `size_bytes bigint`, `mime_type text`, `uploaded_by_user_id`, `uploaded_at`, `soft_deleted_at nullable`

**RLS:** tenant_id + scope; leitura exige `prontuario.read` + scope company; regra 25 vale.

## Eventos de domínio emitidos

- `evolucao.created` / `evolucao.updated` / `evolucao.signed`
- `evolucao.attachment_added` / `evolucao.attachment_removed`

## Commit (checklist)

- [ ] Schema Drizzle: `evolucoes_sessao`, `evolucao_attachments`
- [ ] RLS + testes + franchise check
- [ ] Bucket Storage `fisio-evolucoes` privado com criptografia at-rest
- [ ] API Route de upload multipart com validação MIME + tamanho
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

- —

## Definition of Done

- [ ] Feature flag `fisio_evolucao_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] URL assinada TTL funcionando (teste: URL expirada retorna 403)
- [ ] RLS + franchise verificados
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 17 → `done`

## Retro

- —
