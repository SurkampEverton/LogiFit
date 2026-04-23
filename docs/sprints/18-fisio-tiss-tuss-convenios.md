# Sprint 18 — Fisio · TISS/TUSS + Convênios (ANS)

- **Área:** fisio
- **Início:** planejado (depois do Sprint 17)
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
- Guia de consulta + guia de SP/SADT (serviços profissionais / auxiliar diagnóstico e terapia) geradas em XML TISS v3.05.00+ (versão vigente em 2026)
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

- Sprint 16 (prontuário — faturamento referencia consulta)
- Sprint 17 (evolução — guia SP/SADT para sessão)
- Sprint 04 (financeiro — co-participação vira invoice)
- Sprint 14 (DRE — faturamento de convênio é receita)

## Decisões tomadas / ADRs esperados

- **ADR 0029 (esperado)** — Estrutura TISS/TUSS: `insurance_plans`, `member_insurances`, `authorizations`, `billing_guides`, `billing_guide_items`, `billing_glosas`. Gerador de XML TISS via biblioteca (pré-built ou custom); versão vigente configurável por plano. Scripts de migration carregam tabela TUSS atualizada como seed.
- **Pergunta aberta:** submissão de guia — manual (operador copia XML) ou automática (integração via SOAP com operadoras)? Manual no MVP da Fisio; automática pode virar Sprint separado depois.

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

- `insurance_plans` — `id`, `name`, `ans_code text`, `tiss_version text`, `national bool`, `active`. Global (tenant_id NULL) curado pela LogiFit + editável por tenant para planos regionais.
- `tuss_catalog` — `code text pk`, `description`, `category`, `version text`. Global.
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

- [ ] Schema Drizzle das 10 tabelas
- [ ] Seed: catálogo TUSS atualizado + 3 planos + 5 carteirinhas
- [ ] RLS + audit
- [ ] Gerador de XML TISS v3.05 em `packages/db/convenios/tiss/generator.ts` (guia consulta + SP/SADT + lote)
- [ ] Validador de XML (xsd schema da ANS) antes de envio
- [ ] Parser de XML de retorno + conciliador automático
- [ ] UI convênios, autorizações, faturamento, glosas
- [ ] Integração com `appointments` (auto-gera guia quando atendimento é realizado via convênio)
- [ ] Integração com `invoices` (co-participação vira invoice do Sprint 04)
- [ ] Card "Faturamento Convênios" no dashboard do gerente
- [ ] DRE (Sprint 14) segrega receita convênio × particular
- [ ] Testes unit do gerador de XML (casos mínimos: guia simples, guia com múltiplos itens, lote com N guias)
- [ ] Testes E2E: fluxo completo até pagamento e glosa
- [ ] Feature flag `convenios_v1`
- [ ] ADR 0029 publicado

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
- [ ] XML gerado valida contra XSD oficial da ANS
- [ ] RLS verificada
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 18 → `done`
- [ ] ADR 0029 publicado

## Retro

- —
