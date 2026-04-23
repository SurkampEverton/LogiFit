# Sprint 20 — Fisio · Prontuário eletrônico + CID/CIF + assinatura ICP-Brasil

- **Área:** fisio
- **Início:** planejado (início da Fase 2, depois do MVP)
- **Fim planejado:** +3 semanas
- **Status:** planejado (futuro)
- **Item do roadmap:** #18

## Goal

Prontuário eletrônico polimórfico atendendo regulamentações profissionais — COFFITO 414/415 para Fisio (assinatura ICP-Brasil obrigatória), **CFN 594/2017 para Nutri** (guarda indeterminada, assinatura opcional). Catálogos CID-11 + CIF vinculados ao atendimento, templates por especialidade (ortopedia, neuro, respiratória, pediatria, uroginecologia; nutri via Sprint 29). Entidade `consultas` compartilhada com coluna `kind` — Sprint 29 (Nutri) **reusa a infra**.

## Critério de aceite

- Prontuário versionado por paciente (múltiplas consultas; cada consulta é uma linha imutável após assinatura)
- Assinatura digital ICP-Brasil (A1 em HSM ou A3 via token) — status `draft`/`signed`/`archived`
- Entrada obrigatória de ao menos 1 CID-11 principal por consulta
- CIF opcional com componentes: Funções do Corpo (b), Estruturas (s), Atividades/Participação (d), Fatores Ambientais (e)
- Templates de avaliação prontos por especialidade fisio (reusa `assessment_types` do Sprint 12)
- Prontuário NÃO pode ser deletado após assinatura (regra 5 — append-only); correções viram "nota corretiva" linkada
- Acesso auditado: toda leitura de prontuário grava `audit_log` com motivo opcional
- Regra 25 respeitada: dado clínico não cruza `company_id` em `topology=franchise` — widget some no dashboard do outro franqueado
- Export PDF assinado para dar ao paciente (com carimbo ICP)
- Teste E2E: criar prontuário, assinar, tentar editar (falha), criar nota corretiva, exportar PDF, validar assinatura
- Seed: catálogo CID-11 + CIF carregados; 3 templates por especialidade (ortopedia, neuro, respiratória)

## Dependências

- MVP completo
- Sprint 02 (members)
- Sprint 03 (appointments)
- Sprint 12 (assessment_types — reusa infra)
- Sprint 01b (consent + audit_log)

## Decisões tomadas / ADRs esperados

- **ADR 0028 (esperado)** — CID-11 + CIF como catálogos globais versionados; update anual via LogiFit admin (seed de release), não editáveis por tenant. Vinculação via `consulta_cids` (M:N) e `consulta_cifs`.
- **Pergunta aberta:** biblioteca de assinatura digital — Cert.Sign vs Bry vs Vaultsign (HSM) vs A3 via extensão do navegador? Fechar no início do sprint.

## Módulos entregues

Ver [`modulos.md` — Fisio](../modulos.md#fisio):

- Prontuário eletrônico COFFITO
- Catálogo CID-11 + CIF
- Assinatura ICP-Brasil
- Templates de avaliação por especialidade fisio
- Nota corretiva
- Export PDF assinado

## Rotas Next.js

- `/app/fisio/pacientes/[memberId]/prontuario` — lista de consultas + botão novo
- `/app/fisio/consultas/[id]` — visão editável enquanto draft; readonly após assinatura
- `/app/fisio/consultas/[id]/assinar` — fluxo ICP-Brasil
- `/app/fisio/consultas/[id]/pdf` — preview + download
- `/app/fisio/templates` — CRUD de templates especializados
- `/app/catalogos/cid` · `/app/catalogos/cif` — visão read-only dos catálogos

## Server Actions + API Routes

Server Actions em `apps/web/app/fisio/consultas/actions.ts`:

- `createConsulta(memberId, appointmentId?, template?)` — status `draft`
- `updateConsulta(id, fields)` — só se status `draft`
- `linkCid(consultaId, cidCode, kind)` — kind: `principal`/`secundario`
- `linkCif(consultaId, cifCode, qualifier)` — qualifier 0–4 conforme escala CIF
- `signConsulta(id, certificateMeta)` — dispara processo assinatura ICP-Brasil; grava hash + timestamp; status → `signed`
- `createCorrectionNote(consultaId, body, reason)` — nota corretiva linkada
- `exportPdf(consultaId)` — gera PDF assinado com carimbo

API Routes:

- `POST /api/fisio/sign` — ponte com provider ICP-Brasil (Cert.Sign ou Bry conforme ADR)

## Schemas Drizzle (esperado)

Em `packages/db/schema/fisio.ts`:

- `cid_catalog` — `code text pk`, `description text`, `chapter text`, `version text`, `active bool`, `release_date`. Global (tenant_id NULL), leitura por todos.
- `cif_catalog` — similar a CID. Componentes: `component` enum (`body_functions`, `body_structures`, `activities_participation`, `environmental_factors`).
- `consultas` — `id`, `tenant_id`, `company_id`, `member_id`, `appointment_id nullable`, `professional_user_id`, **`kind` enum (`fisio`, `nutri`, `custom`)** — polimórfica entre verticais; cada kind ganha regras próprias (CFM/COFFITO para `fisio`, CFN 594 para `nutri`), `template_type_id nullable` (ref `assessment_types`), `content jsonb` (estrutura do formulário preenchido conforme template), `status` enum (`draft`, `signed`, `archived`), `signed_at nullable`, `signed_hash text nullable`, `signature_provider text nullable`, `signature_required bool` — `true` para `fisio` (COFFITO exige); `false` para `nutri` (CFN não exige mas permite), `created_at`, `updated_at`
- `consulta_cids` — `consulta_id`, `cid_code`, `kind` enum (`principal`, `secundario`), `notes nullable`. PK `(consulta_id, cid_code, kind)`.
- `consulta_cifs` — `consulta_id`, `cif_code`, `qualifier int`, `notes nullable`.
- `consulta_correction_notes` — `id`, `consulta_id`, `body text`, `reason text`, `author_user_id`, `created_at` — append-only.

**RLS:** tenant_id + scope; leitura exige `prontuario.read` + scope que cobre `company_id`; regra 25 aplicada (franchise bloqueia).

## Eventos de domínio emitidos

- `consulta.created` / `consulta.signed` / `consulta.correction_added`
- `cid.linked` / `cif.linked`

## Commit (checklist)

- [ ] Schema Drizzle: `cid_catalog`, `cif_catalog`, `consultas`, `consulta_cids`, `consulta_cifs`, `consulta_correction_notes`
- [ ] Migration: seed de CID-11 (~15000 códigos) + CIF
- [ ] RLS + testes incluindo franchise (regra 25)
- [ ] Zod schemas
- [ ] Integração ICP-Brasil (provider do ADR 0028)
- [ ] Templates seed: ortopedia, neuro, respiratória (reusa `assessment_types`)
- [ ] UI prontuário com editor SOAP + picker de CID/CIF (autocomplete)
- [ ] Gerador PDF com `@react-pdf/renderer` incluindo hash da assinatura visível
- [ ] Widget `prontuario` no dashboard do member: `{ slot: 'prontuario', requiredPermissions: ['prontuario.read'], requiredVertical: 'fisio', consentPurpose: 'cross_module_fisio', showWhen: (m) => m.has_consultas }`; cross-module (instrutor/academia) exige consent
- [ ] Audit em toda leitura de consulta assinada
- [ ] Feature flag `fisio_prontuario_v1`
- [ ] ADR 0028 publicado

## Stretch

- [ ] OCR em anexos de exames (laudos em PDF → texto extraído)
- [ ] Sugestão automática de CID com base na descrição textual (Copilot)
- [ ] Comparativo com consultas anteriores (highlights das mudanças)

## Log

- —

## Definition of Done

- [ ] Feature flag `fisio_prontuario_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] PDF assinado valida externamente (verificador ITI)
- [ ] RLS verificada incluindo regra 25
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 16 → `done`
- [ ] ADR 0028 publicado

## Retro

- —
