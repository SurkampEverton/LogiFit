# Sprint 22 — Fisio · TISS/TUSS + Convênios (ANS)

- **Área:** fisio
- **Início:** planejado (depois do Sprint 21)
- **Fim planejado:** +4 semanas
- **Status:** planejado (futuro)
- **Item do roadmap:** #20

## Goal

Faturamento para planos de saúde no padrão TISS (Troca de Informações em Saúde Suplementar) + terminologia TUSS (Terminologia Unificada da Saúde Suplementar), conforme exigência ANS. Geração de guias XML, controle de autorizações, tratamento de glosas.

## Critério de aceite

- Cadastro de `insurance_plans` (Unimed, Bradesco Saúde, Amil, SUS/APS, etc) com versão TISS aceita e tabela TUSS local
- `insurance_agreements` vincula tenant/company a planos com condições (valor repasse por procedimento, prazo pagamento)
- Paciente tem `member_insurances` (carteirinha, validade, categoria)
- Solicitação de autorização: `authorizations` (procedimento, quantidade de sessões) submetida manualmente (Fase 2) ou via XML (Fase 3)
- Guia de consulta + guia de SP/SADT (serviços profissionais / auxiliar diagnóstico e terapia) geradas em XML **TISS 4.01** (versão vigente conforme Ofício-Circular ANS nº 1/2026 — atualização janeiro/2026)
- **Preenchimento automático dos campos obrigatórios do profissional executante a partir de `professional_registrations` (ADR 0055):** `NumeroConselhoProfissional`, `SiglaConselho` (CRM/CREFITO/CRN/CREF), `UF`, `CBOS` (campo `cbo_code`). Se o profissional não tem registro ativo com `cbo_code` preenchido → `generateGuide` bloqueia com erro "Profissional sem CBOS cadastrado — obrigatório TISS 4.01"
- Envio de lote de guias (XML de lote)
- Recebimento de retorno TISS (XML de pagamento) para conciliação
- Controle de glosas: `billing_glosas` com motivo, valor glosado, ação (recurso manual)
- Relatório por convênio: faturado × recebido × glosado
- Integração com `appointments` (procedimentos faturáveis geram guia automaticamente)
- Integração com `invoices` do Sprint 04 (co-participação do paciente, quando houver)
- Regra 8 respeitada (TISS webhooks idempotentes)
- Teste E2E: paciente com plano Unimed, autorização ok, consulta realizada, guia gerada, XML validado, glosa simulada, recurso registrado
- Seed: 3 planos ativos + 5 pacientes com carteirinha + 10 guias em estados variados

## Dependências

- Sprint 20 (prontuário — faturamento referencia consulta)
- Sprint 21 (evolução — guia SP/SADT para sessão)
- Sprint 04 (financeiro — co-participação vira invoice)
- Sprint 14 (DRE — faturamento de convênio é receita)

## Decisões tomadas / ADRs esperados

### ADR já publicado

- **[ADR 0079 — TISS 4.01 ANS como padrão vigente](../decisions/0079-tiss-401-ans-padrao-vigente.md)** (publicado 2026-04-25) — define **estratégia geral**: TISS 4.01 é versão padrão; pipeline de atualização semestral; validador proativo XSD + regras de negócio; submissão manual no MVP / automática SOAP em sprint posterior; RAG global indexa terminologia. Os ADRs esperados abaixo (0029/0030/0031) **detalham implementação técnica** dentro do framework definido por 0079; não substituem.

### ADRs a produzir nesta sprint

- **ADR 0029 (esperado)** — Estrutura TISS/TUSS: `insurance_plans`, `member_insurances`, `authorizations`, `billing_guides`, `billing_guide_items`, `billing_glosas`. Gerador de XML **TISS 4.01** via biblioteca (pré-built ou custom); versão vigente configurável por plano. Scripts de migration carregam tabela TUSS atualizada como seed. **Conforme [ADR 0079](../decisions/0079-tiss-401-ans-padrao-vigente.md).**
- **ADR 0030 (esperado)** — Pipeline de atualização semestral da terminologia ANS: job agendado puxa deltas de OPME (~26k termos), medicamentos (+334 novos no Ofício-Circular 1/2026), glosas, tabelas de procedimentos. Versionamento da terminologia por `tuss_catalog_version` para rastrear qual versão estava vigente quando a guia foi gerada. **Implementa fase 2 do [ADR 0079](../decisions/0079-tiss-401-ans-padrao-vigente.md).**
- **ADR 0031 (esperado)** — Validador TISS proativo: antes de envio, roda bateria de validações (XSD da ANS + regras de negócio comuns que causam glosa: procedimento × especialidade, autorização vigente, carteirinha válida, limite de sessões, co-participação correta). Bloqueia envio com erro conhecido antes da glosa acontecer. **Implementa fase 3 do [ADR 0079](../decisions/0079-tiss-401-ans-padrao-vigente.md).**
- **ADR 0042 (esperado, sprint posterior)** — Submissão automática SOAP por provider (Fase 2 do TISS); ADR 0079 antecipou pergunta aberta. Manual no MVP da Fisio.

### Gate MFA específico de TISS

- **Cancelamento de guia + ajuste de valor após envio = ações de alto risco fiscal/clínico** — exigem **MFA recente (<15min)** mesmo para role `recepcao` que normalmente tem MFA opcional. Wrapper `requireRecentMfa()` no handler valida claim `mfa_at` do JWT; expirado → forçar reauth com TOTP/WebAuthn antes de prosseguir. Audit log marca `mfa_required=true` + `mfa_at_action`. Coerente com **regra 43** (rules.md) e **regra 28** (CLAUDE.md).

## Módulos entregues

Ver [`modulos.md` — Fisio](../modulos.md#fisio):

- Cadastro de convênios e acordos
- Carteirinha do paciente
- Solicitação de autorização
- Geração de guias TISS (consulta + SP/SADT)
- Recebimento e conciliação
- Controle de glosas

## Rotas Next.js

- `/app/fisio/convenios` — planos + acordos
- `/app/fisio/convenios/[id]` — detalhe + tabela de procedimentos/valores
- `/app/members/[id]/convenios` — carteirinhas do paciente
- `/app/fisio/autorizacoes` — pedidos + status
- `/app/fisio/autorizacoes/[id]` — detalhe
- `/app/fisio/faturamento` — lista de guias + filtros por convênio, status, período
- `/app/fisio/faturamento/lote/new` — montar lote para envio
- `/app/fisio/faturamento/retornos` — XMLs de retorno processados
- `/app/fisio/glosas` — lista + recurso

## Server Actions + API Routes

Server Actions:

- `createInsurancePlan` / `updateInsurancePlan`
- `createInsuranceAgreement(tenantId, planId, procedureTable, terms)`
- `addMemberInsurance(memberId, planId, card, validUntil, category)`
- `requestAuthorization(memberId, procedure, quantity, planId)`
- `generateGuide(appointmentId | consultaId, kind)` — kind: `consulta` ou `sp_sadt`
- `createBatch(guidIds[])` — gera XML de lote
- `processReturnXml(xmlString)` — parse retorno TISS, concilia pagamentos, cria glosas se houver
- `fileGlosa(glosaId, recursoBody)` — registra recurso manual

## Schemas Drizzle (esperado)

Em `packages/db/schema/convenios.ts`:

- `insurance_plans` — `id`, `name`, `ans_code text`, `tiss_version text` (default `'4.01'`), `national bool`, `active`. Global (tenant_id NULL) curado pela LogiFit + editável por tenant para planos regionais.
- `tuss_catalog` — `code text`, `description`, `category` enum (`procedimento`, `opme`, `medicamento`, `taxa_diaria`, `gasoterapia`), `version text` (ex: `'2026.01'` para release do Ofício-Circular 1/2026), `active bool`, `effective_from date`, `effective_to date nullable`. PK `(code, version)`. Global.
- `tuss_catalog_imports` — `id`, `version text`, `source` enum (`ans_oficio_circular`, `manual`), `imported_at`, `items_added int`, `items_updated int`, `items_deactivated int`, `import_log text`. Rastreio auditável de atualizações semestrais.
- `insurance_agreements` — `id`, `tenant_id`, `company_id`, `plan_id`, `credentials_encrypted jsonb` (se automação futura), `effective_from`, `effective_to nullable`, `active`
- `insurance_procedure_prices` — `agreement_id`, `tuss_code`, `price_cents`, `patient_copay_cents nullable`, `auth_required bool`. PK `(agreement_id, tuss_code)`.
- `member_insurances` — `id`, `tenant_id`, `member_id`, `plan_id`, `card_number text`, `category text`, `valid_until date nullable`, `active`
- `authorizations` — `id`, `tenant_id`, `member_insurance_id`, `tuss_code`, `quantity_requested int`, `quantity_authorized int nullable`, `authorization_number text nullable`, `status` enum (`pending`, `approved`, `denied`, `expired`), `requested_at`, `approved_at nullable`, `valid_until nullable`
- `billing_guides` — `id`, `tenant_id`, `company_id`, `member_id`, `member_insurance_id`, `kind` enum (`consulta`, `sp_sadt`), `guide_number text unique`, `authorization_id nullable`, `total_cents`, `status` enum (`draft`, `ready`, `sent`, `paid`, `partially_paid`, `fully_glossed`, `cancelled`), `xml_sent text nullable`, `sent_at nullable`, `paid_at nullable`
- `billing_guide_items` — `guide_id`, `tuss_code`, `quantity`, `unit_price_cents`, `total_cents`, `appointment_id nullable`, `professional_user_id`
- `billing_batches` — `id`, `tenant_id`, `batch_number text`, `guide_ids uuid[]`, `xml text`, `status` enum (`draft`, `sent`, `returned`), `sent_at`, `returned_at`, `return_xml text nullable`
- `billing_glosas` — `id`, `guide_id`, `guide_item_id nullable`, `reason_code text`, `reason_description text`, `amount_glossed_cents`, `status` enum (`glossed`, `recurring`, `recovered`, `lost`), `recurso_body text nullable`, `recurso_at nullable`, `resolved_at nullable`

**RLS:** tenant_id + scope; permission `convenios.read`, `convenios.write`, `faturamento.read`, `faturamento.write`.

## Eventos de domínio emitidos

- `insurance_plan.linked` / `insurance_plan.unlinked`
- `authorization.requested` / `authorization.approved` / `authorization.denied`
- `billing_guide.created` / `billing_guide.sent` / `billing_guide.paid` / `billing_guide.partially_paid`
- `billing_glosa.received` / `billing_glosa.recovered` / `billing_glosa.lost`

## Commit (checklist)

- [ ] Schema Drizzle das 11 tabelas (incluindo `tuss_catalog_imports`)
- [ ] Seed: catálogo TUSS **versão 2026.01** (Ofício-Circular ANS nº 1/2026: OPME +26k termos, medicamentos +334 novos) + 3 planos + 5 carteirinhas
- [ ] RLS + audit
- [ ] Gerador de XML **TISS 4.01** em `packages/db/convenios/tiss/generator.ts` (guia consulta + SP/SADT + lote); consulta `professional_registrations` para popular `NumeroConselhoProfissional`, `SiglaConselho`, `UF`, `CBOS` do executante (ADR 0055)
- [ ] Teste unit: profissional sem `cbo_code` → erro bloqueia geração com mensagem acionável
- [ ] Teste E2E: fluxo completo exige profissional com registro ativo + `cbo_code`; guia gerada valida contra XSD TISS 4.01
- [ ] Validador TISS proativo: XSD oficial ANS + regras de negócio (procedimento × especialidade, autorização vigente, carteirinha válida, limite de sessões, co-participação correta). Bloqueia envio com erro conhecido antes da glosa.
- [ ] Pipeline de atualização semestral da terminologia (job agendado puxa delta ANS, cria registro em `tuss_catalog_imports`, alerta admin para revisão)
- [ ] Parser de XML de retorno + conciliador automático
- [ ] UI convênios, autorizações, faturamento, glosas
- [ ] Integração com `appointments` (auto-gera guia quando atendimento é realizado via convênio)
- [ ] Integração com `invoices` (co-participação vira invoice do Sprint 04)
- [ ] Card "Faturamento Convênios" no dashboard do gerente
- [ ] DRE (Sprint 14) segrega receita convênio × particular
- [ ] Testes unit do gerador de XML (casos mínimos: guia simples, guia com múltiplos itens, lote com N guias) validando contra XSD TISS 4.01
- [ ] Testes E2E: fluxo completo até pagamento e glosa + caso de erro bloqueado pelo validador proativo
- [ ] Feature flag `convenios_v1`
- [ ] **Pesquisa global** (ADR 0062): indexar `billing_guides` (kind=`billing_guide`, label=número + operadora + paciente, `required_permission='faturamento.read'`), `authorizations` (kind=`authorization`), `insurance_plans` (kind=`insurance_plan`)
- [ ] ADRs 0029, 0030, 0031 publicados
- [ ] **RIPD `docs/compliance/ripd/v1.0-tiss-convenios.md`** publicado e assinado pelo DPO antes do feature flag ir a produção (regra 29 + ADR 0054); cobre transmissão de dado clínico estruturado para operadoras de saúde (sub-controlador autorizado pelo titular via contrato de plano), retenção fiscal 5a, assinatura ICP-Brasil quando exigida; template em [`_template.md`](../compliance/ripd/_template.md)

## Stretch

- [ ] Integração SOAP automática com operadoras maiores (Unimed, Bradesco) — geralmente via WebServices proprietários
- [ ] OCR de carteirinha física (foto) para preenchimento automático
- [ ] Detecção de inconsistência antes de enviar (procedimento × especialidade)
- [ ] Dashboard de taxa de glosa por convênio

## Log

- —

## Definition of Done

- [ ] Feature flag `convenios_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] XML gerado valida contra XSD oficial da ANS (TISS 4.01)
- [ ] Validador proativo bloqueia envio com erro conhecido (teste adversarial com 10+ cenários de glosa comum)
- [ ] Pipeline de atualização semestral documentado (próxima janela: julho/2026)
- [ ] RLS verificada
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 22 → `done`
- [ ] ADRs 0029, 0030, 0031 publicados

## Retro

- —
