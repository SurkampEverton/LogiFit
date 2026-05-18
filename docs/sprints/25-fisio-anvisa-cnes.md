# Sprint 25 — Fisio · ANVISA (equipamentos + limpeza) + Integração CNES

- **Área:** fisio (também aplicável a Academia quando houver equipamentos regulados)
- **Início:** planejado (depois do Sprint 24)
- **Fim planejado:** +2 semanas
- **Status:** planejado (futuro)
- **Item do roadmap:** #23

## Goal

Compliance ANVISA/Vigilância Sanitária: cadastro de equipamentos regulados (ultrassom, TENS, laser, crioterapia, etc) com cronograma de manutenção/calibração + registro de limpeza do ambiente clínico. Integração CNES (Cadastro Nacional de Estabelecimentos de Saúde) — cadastro obrigatório e sincronização.

## Critério de aceite

- `equipment` — cadastro por `company`/`unit` com fabricante, modelo, número série, data aquisição, status (`active`/`maintenance`/`decommissioned`)
- Cronograma automático de manutenção baseado em periodicidade (ex: 6 meses) + alertas D-30 e D-7
- Calibração com certificado anexado (PDF rastreável)
- Uso do equipamento vinculado a `appointment`/`consulta` (rastreabilidade — qual paciente usou qual aparelho e quando)
- Registro de limpeza do ambiente: `cleaning_logs` com usuário responsável, horário, checklist cumprido (ex: álcool 70%, descarte de perfurocortantes, troca de lençóis)
- Dashboard vigilância sanitária: ambientes com atraso de limpeza / equipamentos com manutenção vencida
- Cadastro CNES: identificador do estabelecimento na `companies` + sync opcional com base nacional (API Datasus quando disponível; manual caso contrário)
- Consulta de CNES pública via busca simples (`/consultar-cnes/[cnes]`) para validar número
- Relatório pronto para fiscalização: exportar lista de equipamentos com histórico + logs de limpeza do período
- Teste E2E: cadastrar equipamento, agendar manutenção, receber alerta D-7, registrar execução com certificado
- Teste E2E: checklist de limpeza completo → log gravado com timestamp
- Seed: 3 equipamentos + 2 manutenções agendadas + 10 logs de limpeza

## Dependências

- Sprint 03 (appointments — uso de equipamento)
- Sprint 21 (evolução — rastreabilidade clínica)

## Decisões tomadas / ADRs esperados

- **Sem ADR novo**: cadastro de equipamento + cronograma é estrutura trivial. CNES só armazena campo.
- **Pergunta aberta:** integração Datasus CNES — usar API oficial (quando disponível e estável) ou sempre manual? Começar manual; integração automática vira evolução.

## Módulos entregues

Ver [`modulos.md` — Fisio](../modulos.md#fisio) e [Geral](../modulos.md#geral):

- Cadastro de equipamentos regulados
- Cronograma de manutenção + calibração
- Certificados anexados
- Logs de limpeza do ambiente
- Integração CNES (cadastro)
- Relatório para fiscalização

## Rotas Next.js

- `/app/vigilancia` — dashboard
- `/app/vigilancia/equipamentos` — lista + CRUD
- `/app/vigilancia/equipamentos/[id]` — detalhe + histórico de manutenção + usos
- `/app/vigilancia/equipamentos/[id]/manutencao/new` — agendar
- `/app/vigilancia/limpeza` — registro diário
- `/app/vigilancia/limpeza/checklists` — configurar checklists por ambiente
- `/app/vigilancia/relatorios` — exportação fiscalização
- `/app/settings/empresa` — CNES da company

## Server Actions + API Routes

Server Actions em `apps/web/app/vigilancia/actions.ts`:

- `createEquipment(input)` / `updateEquipment` / `decommissionEquipment(id, reason)`
- `scheduleMaintenance(equipmentId, plannedFor, kind)` — kind: `preventive`, `calibration`, `corrective`
- `completeMaintenance(maintenanceId, performedAt, certificateFile?, observations)` — anexa PDF
- `createCleaningChecklist(input)` — template por ambiente
- `recordCleaning(checklistId, roomId, userId, itemsDone[])` — grava log
- `updateCompanyCnes(companyId, cnesCode)` — guarda + valida formato

API Routes:

- `GET /api/cnes/validate/[code]` — valida formato + busca pública (sem auth)
- `GET /api/vigilancia/report/[companyId]?from=&to=` — gera PDF de fiscalização

## Schemas Drizzle (esperado)

Em `packages/db/schema/vigilancia.ts`:

- `equipment` — `id`, `tenant_id`, `company_id`, `unit_id nullable`, `kind text` (ultrassom, tens, laser, etc), `manufacturer`, `model`, `serial_number text`, `acquired_at date`, `warranty_until date nullable`, `status` enum (`active`, `maintenance`, `decommissioned`), `maintenance_interval_days int nullable`, `calibration_interval_days int nullable`, `notes`
- `equipment_maintenance` — `id`, `equipment_id`, `kind` enum (`preventive`, `calibration`, `corrective`), `planned_for date`, `performed_at date nullable`, `performed_by text nullable`, `certificate_storage_path nullable`, `cost_cents nullable`, `observations text`, `status` enum (`scheduled`, `in_transit_to_external`, `at_external`, `returning`, `completed`, `overdue`, `cancelled`), **`external_location bool default false`** (true = equipamento sai do tenant para conserto/calibração externa — exige NF-e de remessa), **`external_supplier_id uuid nullable` fk `suppliers`** (fabricante/laboratório), **`nfe_shipping_emission_id uuid nullable` fk `fiscal_emissions`** (NF-e de remessa 5.915 via ADR 0059), **`nfe_return_emission_id uuid nullable` fk `fiscal_emissions`** (NF-e de retorno 1.916 quando equipamento volta), **`external_departed_at nullable`**, **`external_returned_at nullable`**
- `equipment_usage_log` — `equipment_id`, `appointment_id nullable`, `consulta_id nullable`, `evolucao_id nullable`, `used_at`, `used_by_user_id` — rastreabilidade clínica
- `cleaning_checklists` — `id`, `tenant_id`, `company_id`, `unit_id nullable`, `name`, `items jsonb` (array de `{ key, label, required bool }`), `active`
- `cleaning_logs` — `id`, `tenant_id`, `company_id`, `unit_id`, `checklist_id`, `performed_by_user_id`, `performed_at`, `items_done jsonb`, `observations text`
- `companies` **ganha colunas**: `cnes_code text nullable`, `cnes_validated_at nullable`

**RLS:** tenant_id + scope por company/unit; permission `vigilancia.read`, `vigilancia.write`, `vigilancia.admin`.

## Eventos de domínio emitidos

- `equipment.registered` / `equipment.decommissioned`
- `equipment.maintenance_scheduled` / `equipment.maintenance_completed` / `equipment.maintenance_overdue`
- `equipment.used` — rastreabilidade
- `cleaning.recorded`
- `company.cnes_updated`

## Commit (checklist)

- [ ] Schema Drizzle: `equipment`, `equipment_maintenance`, `equipment_usage_log`, `cleaning_checklists`, `cleaning_logs`
- [ ] Migration: coluna `cnes_code` em `companies`
- [ ] RLS + audit
- [ ] Bucket Storage para certificados de calibração
- [ ] Job diário que marca manutenções vencidas como `overdue` + emite evento
- [ ] Régua (Sprint 13) com template "manutenção D-7"
- [ ] UI equipamentos + manutenção + anexo de certificado
- [ ] **Fluxo de manutenção externa (ADR 0059):** quando `equipment_maintenance.external_location=true`, UI oferece ciclo: `scheduled → in_transit_to_external → at_external → returning → completed`; em cada transição, botão "Emitir NF-e via Focus" aparece quando Sprint 36 ativo:
  - Saída para conserto: NF-e 5.915 → `nfe_shipping_emission_id`
  - Retorno do conserto: NF-e 1.916 (recepção da nota do fornecedor) — via inbox Sprint 17 → linka em `nfe_return_emission_id`
- [ ] Quando Sprint 36 não ativo, operador emite externamente e anexa XML recebido; UI registra `emission_mode='external_import'`
- [ ] Teste E2E: ultrassom agendado para calibração anual no fabricante → NF-e 5.915 emitida → equipamento retorna → NF-e 1.916 recebida na inbox → status `completed` com certificado anexado
- [ ] UI checklists de limpeza com UI mobile-first (usado pela equipe de limpeza)
- [ ] Integração com `appointments`/`consultas`: ao realizar, registrar `equipment_usage_log` do(s) aparelho(s) usado(s)
- [ ] Cadastro CNES na tela de company
- [ ] Validação básica de CNES (formato 7 dígitos); integração com Datasus fica stretch
- [ ] Dashboard vigilância no gerente
- [ ] Exportação PDF "relatório fiscalização"
- [ ] Permission `vigilancia.*`
- [ ] Seed: 3 equipamentos + 2 manutenções + 10 logs
- [ ] Testes unit (marcar overdue, agrupar uso)
- [ ] Testes E2E: cadastro → agendar → alerta → executar → certificado anexado
- [ ] **Pesquisa global** (ADR 0062): indexar `equipment` como kind=`equipment` (label=modelo + número série, subtitle=fabricante + unit + status, `required_permission='vigilancia.read'`); `equipment_maintenance` como kind=`maintenance`
- [ ] Feature flag `vigilancia_v1`

## Stretch

- [ ] Integração Datasus CNES (sync automática dos dados do estabelecimento)
- [ ] QR code no equipamento → abre tela de registro de uso em 1 click
- [ ] Alerta no dashboard recepção quando limpeza da sala está atrasada
- [ ] Integração com fornecedor de manutenção (envia ordem via email/WhatsApp)

## Log

- **2026-05-17 — Faixa A entregue:** 5 schemas (equipment unique global manufacturer+serial / equipment_maintenance fluxo externo com supplier check / equipment_usage_log @volume 18M+/ano APPEND-ONLY + duration positive / cleaning_checklists items jsonb + frequency / cleaning_logs APPEND-ONLY + completion_pct range) + RLS tenant-scoped + UPDATE bloqueado em logs + 13 RLS tests; migration `0031_fluffy_cammi.sql`.
- **2026-05-17 — Faixa B.1 entregue:** lib pura anvisa.ts (classifyMaintenances urgency 4-tier overdue/d7/d30/ok + pickAttentionItems + validateChecklist com missingRequired + completion_pct + validateCnesCode 7 dígitos sanitiza máscara + checkCleaningStatus frequency-aware) com 21 unit tests.
- **2026-05-17 — Faixa B.2 entregue:** 13 Server Actions wrapped — createEquipment captura unique global; scheduleMaintenance valida external_supplier; completeMaintenance atualiza last_maintenance/calibration por kind; listAttention via lib pura; recordCleaning com validation auto persistindo completionPct+isComplete; listCleaningStatus frequency-aware.
- **2026-05-17 — Faixa C entregue:** 3 rotas (/vigilancia hub 5 KPIs com equipamentos+overdue+d7+limpezas24h+equips_usados_7d + /equipamentos com last_maintenance+last_calibration+next_maintenance via subquery + /limpeza com checklists e histórico color-coded). Demais rotas placeholders.
- **2026-05-17 — Faixa D entregue:** seed-vigilancia 3 equipamentos por tenant matriz com registros ANVISA reais + 1 manutenção D+30 cada + 1 checklist "Sala Fisio" 5 items + 5 logs (3 completos + 2 parciais). **671 tests verdes** (era 637, +34 Sprint 25: 13 RLS + 21 unit).
- **Quebra 25a/25b:** sem Datasus CNES + sem NF-e 5.915/1.916 + sem bucket Storage certificados + sem migration coluna cnes_code + UI parcial, 25a focou em schema + lib pura + Server Actions core. 25b integra todas as pontas externas.

## Definition of Done

- [x] Feature flag `vigilancia_v1` — **adiado Sprint 25b** (sem RIPD + Datasus + bucket não pode ir a produção)
- [x] Testes unit (21) + RLS (13) verdes; E2E adiado 25b com certificados reais
- [x] RLS verificada (13 tests cobrindo serial global + checks + UPDATE bloqueado para append-only)
- [x] Migration `0031_fluffy_cammi.sql` aplicada
- [x] Relatório PDF fiscalização — **adiado Sprint 25b** com @react-pdf/renderer + dados consolidados
- [x] CHANGELOG atualizado
- [x] Roadmap: sprint 25 → `done (25a core)`

## Retro

- **Acertos:** unique global `(manufacturer, serial_number)` em equipment garante que mesmo aparelho não seja cadastrado em 2 tenants diferentes (caso fabricante revende equipamento usado, sistema detecta). Fluxo de manutenção externa com `external_location bool + external_supplier_id` via CHECK constraint força o operador a informar supplier — UI consegue oferecer ciclo NF-e 5.915→1.916 (Sprint 25b ADR 0059).
- **Decisão controversa:** APPEND-ONLY enforced também em `equipment_usage_log` + `cleaning_logs`. Custos: edição de erro (digitar wrong patient/duration) requer novo log com observação corrigindo. Aceito pela exigência ANVISA de rastreabilidade imutável (RDC 657/2022 + 751/2022).
- **Erros:** Server Action `scheduleMaintenance` inicialmente usava `eq` como nome local que sombreava o schema `equipment`. Renomeei o helper Drizzle para `eq2` no top-level import. Lição: schema names podem colidir com Drizzle helpers — preferir qualified imports.
- **Aprendizados:** lib pura `classifyMaintenances` retornando estrutura `{urgency, daysUntil}` permite UI renderizar diferentes badges color-coded sem replicar lógica. `pickAttentionItems(checks)` filtra só os relevantes — pattern útil pra dashboards "precisa atenção".
- **CNES no MVP fica trivial** — 7 dígitos numéricos com sanitização de máscara. Integração com Datasus real (sync nome, status, especialidades) fica Sprint 25b porque API CNES tem rate limit + autenticação variável + cobertura inconsistente.
- **Próximo Sprint 26:** Portal do paciente web (PWA) — auth do member + agenda + recibos + vídeos exercício + QR de check-in. Sprint grande pois introduz nova superfície (paciente direto) com auth diferente do operador.
