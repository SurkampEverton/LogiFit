# Sprint 20 — Fisio · Prontuário eletrônico + CID/CIF + assinatura digital por profissão

- **Área:** fisio
- **Início:** planejado (início da Fase 2, depois do MVP)
- **Fim planejado:** +3 semanas
- **Status:** planejado (futuro)
- **Item do roadmap:** #18

## Goal

Prontuário eletrônico polimórfico atendendo regulamentações profissionais com **política de assinatura digital configurável por profissão**:

| Profissão | Regulação | Assinatura ICP-Brasil |
|---|---|---|
| Médico (CRM) | CFM 1.821/2007 + 2.299/2021 | **Obrigatória** (nível mínimo A3) |
| Fisioterapeuta (CREFITO) | COFFITO 414/2012 + 415/2012 | **Não obrigatória** — prontuário eletrônico permitido sem ICP-Brasil desde que haja sistema de autenticação + trilha de auditoria equivalente (SBIS ou similar) |
| Nutricionista (CRN) | CFN 599/2018 (revoga 594/2017) | **Não obrigatória** — registro eletrônico permitido com autenticação + trilha |

Catálogos CID-11 + CIF vinculados ao atendimento, templates por especialidade (ortopedia, neuro, respiratória, pediatria, uroginecologia; nutri via Sprint 29). Entidade `consultas` compartilhada com coluna `kind` — Sprint 29 (Nutri) **reusa a infra**.

## Critério de aceite

- Prontuário versionado por paciente (múltiplas consultas; cada consulta é uma linha imutável após assinatura/lacre)
- **Política de fechamento configurável por `kind` da consulta** (`signature_mode` enum: `icp_brasil_required`, `icp_brasil_optional`, `authenticated_lock`):
  - `kind=medico` → `icp_brasil_required` (CFM 2.299/2021): A1 em HSM ou A3 via token/extensão
  - `kind=fisio` → `icp_brasil_optional` (COFFITO 414/2012): aceita ICP-Brasil OU lacre autenticado (MFA + hash + audit)
  - `kind=nutri` → `authenticated_lock` (CFN 599/2018): lacre autenticado suficiente
  - Status: `draft`/`locked`/`signed`/`archived`
- **Gate de registro profissional ativo (ADR 0055):** `signConsulta` / `lockConsulta` verificam que o profissional tem ao menos 1 `professional_registrations` com `situation='active'` (ou `pending_verification` com `created_at > now() - interval '30 days'`) e `council_body` coerente com `kind` da consulta (`medico→CRM`, `fisio→CREFITO`, `nutri→CRN`). Sem registro compatível → erro 403 "Profissional sem registro ativo no conselho X; cadastre em /app/pessoas/[id]/registros".
- PDF e XML do prontuário incluem no rodapé: `{nome do profissional} — {council_body}-{council_state} {council_number}` (dado obrigatório CFM 2.299/2021 art. 3º, COFFITO 414/2012 art. 7º III, CFN 599/2018 art. 5º)
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
- Sprint 01b (consent + audit_log + `professional_registrations`)

## Decisões tomadas / ADRs esperados

- **ADR 0028 (esperado)** — CID-11 + CIF como catálogos globais versionados; update anual via LogiFit admin (seed de release), não editáveis por tenant. Vinculação via `consulta_cids` (M:N) e `consulta_cifs`.
- **ADR 0032 (esperado)** — Política de fechamento de prontuário por profissão: ICP-Brasil obrigatório (CFM), opcional (COFFITO) ou lacre autenticado (CFN). Matriz `signature_policies (profession, mode, min_cert_level, requires_mfa)`. Referencia CFM 2.299/2021, COFFITO 414/2012, CFN 599/2018.
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
- `consultas` — `id`, `tenant_id`, `company_id`, `member_id`, `appointment_id nullable`, `professional_user_id`, **`kind` enum (`medico`, `fisio`, `nutri`, `custom`)** — polimórfica entre verticais; cada kind ganha regras próprias (CFM 2.299/2021 para `medico`, COFFITO 414/2012 para `fisio`, CFN 599/2018 para `nutri`), `template_type_id nullable` (ref `assessment_types`), `content jsonb`, `status` enum (`draft`, `locked`, `signed`, `archived`), `signature_mode` enum (`icp_brasil_required`, `icp_brasil_optional`, `authenticated_lock`) — resolvido por `kind` na criação, `signed_at nullable`, `signed_hash text nullable`, `signature_provider text nullable` (ICP provider quando aplicável), `lock_method` enum nullable (`icp_brasil_a1`, `icp_brasil_a3`, `authenticated_mfa`), `locked_by_user_id nullable`, `created_at`, `updated_at`
- `signature_policies` — `profession text pk` (`medico`, `fisio`, `nutri`), `mode` (`icp_brasil_required`, `icp_brasil_optional`, `authenticated_lock`), `min_cert_level text nullable` (`A1`, `A3`), `requires_mfa bool`, `regulatory_reference text`. Seed alimenta CFM/COFFITO/CFN.
- `consulta_cids` — `consulta_id`, `cid_code`, `kind` enum (`principal`, `secundario`), `notes nullable`. PK `(consulta_id, cid_code, kind)`.
- `consulta_cifs` — `consulta_id`, `cif_code`, `qualifier int`, `notes nullable`.
- `consulta_correction_notes` — `id`, `consulta_id`, `body text`, `reason text`, `author_user_id`, `created_at` — append-only.

**RLS:** tenant_id + scope; leitura exige `prontuario.read` + scope que cobre `company_id`; regra 25 aplicada (franchise bloqueia).

## Eventos de domínio emitidos

- `consulta.created` / `consulta.signed` / `consulta.correction_added`
- `cid.linked` / `cif.linked`

## Commit (checklist)

- [ ] Schema Drizzle: `cid_catalog`, `cif_catalog`, `consultas`, `consulta_cids`, `consulta_cifs`, `consulta_correction_notes`, `signature_policies`
- [ ] Migration: seed de CID-11 (~15000 códigos) + CIF
- [ ] Seed de `signature_policies`: `medico` (icp_brasil_required, A3, mfa), `fisio` (icp_brasil_optional, mfa), `nutri` (authenticated_lock, mfa)
- [ ] RLS + testes incluindo franchise (regra 25)
- [ ] Zod schemas
- [ ] Integração ICP-Brasil (provider do ADR 0028) + fluxo de lacre autenticado (MFA + hash SHA-256 do conteúdo + timestamp + audit)
- [ ] Gate em `signConsulta`/`lockConsulta`: query `professional_registrations` ativa coerente com `consultas.kind`; erro explícito se ausente (ADR 0055)
- [ ] Rodapé do PDF com `{council_body}-{council_state} {council_number}` do profissional executante
- [ ] Teste E2E: fisio sem CREFITO ativo tenta assinar → bloqueado; admin marca CREFITO como ativo → assinatura prossegue
- [ ] Teste E2E: fisio com CREFITO `suspended` → bloqueado mesmo com ICP-Brasil válido
- [ ] **Pesquisa global** (ADR 0062): indexar `consultas` como kind=`consulta` com `is_sensitive=true` + `required_permission='prontuario.read'` + `required_vertical='fisio'` + regra 25 (`company_id`); searchable_text = queixa + SOAP resumido + CIDs vinculados; clique grava audit
- [ ] Templates seed: ortopedia, neuro, respiratória (reusa `assessment_types`)
- [ ] UI prontuário com editor SOAP + picker de CID/CIF (autocomplete)
- [ ] Gerador PDF com `@react-pdf/renderer` incluindo hash da assinatura visível
- [ ] Widget `prontuario` no dashboard do member: `{ slot: 'prontuario', requiredPermissions: ['prontuario.read'], requiredVertical: 'fisio', consentPurpose: 'cross_module_fisio', showWhen: (m) => m.has_consultas }`; cross-module (instrutor/academia) exige consent
- [ ] Audit em toda leitura de consulta assinada
- [ ] **Registrar handler `receipt`** no hub inbound WhatsApp do Sprint 13 (ADR 0051): paciente manda receita médica pelo WhatsApp → classificador identifica → cria rascunho linkado ao member → profissional anexa ao prontuário na próxima consulta
- [ ] Feature flag `fisio_prontuario_v1`
- [ ] ADRs 0028 e 0032 publicados

## Stretch

- [ ] OCR em anexos de exames (laudos em PDF → texto extraído)
- [ ] Sugestão automática de CID com base na descrição textual (Copilot)
- [ ] Comparativo com consultas anteriores (highlights das mudanças)

## Log

- —

## Definition of Done

- [ ] Feature flag `fisio_prontuario_v1` ligada em dev
- [ ] Testes unit + E2E verdes (incluindo cenários: médico com ICP, fisio com lacre, fisio com ICP opcional, nutri com lacre)
- [ ] PDF assinado com ICP-Brasil valida externamente (verificador ITI)
- [ ] PDF com lacre autenticado mostra hash + timestamp + usuário autenticado (sem pretensão de ICP)
- [ ] RLS verificada incluindo regra 25
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 20 → `done`
- [ ] ADRs 0028 e 0032 publicados

## Retro

- —
