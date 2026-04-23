# Sprint 17 — Geral · Bancos + Open Finance + Conciliação + Automação NF-e SEFAZ

- **Área:** geral
- **Início:** planejado (depois do Sprint 16)
- **Fim planejado:** +3 semanas
- **Status:** planejado
- **Item do roadmap:** #19

## Goal

Integração com bancos via Open Finance (ou importação OFX fallback) + conciliação automática de extratos bancários com AP/AR + automação de recepção de NF-e diretamente do SEFAZ via provider agregador (Arquivei/Sieg/similar).

## Critério de aceite

**Contas bancárias:**
- `bank_accounts` por company com banco, agência, conta, tipo (CC/poupança/conta-corrente PJ)
- Saldo inicial + histórico

**Open Finance (entrada automática):**
- Integração com provider (Pluggy/Belvo/similar conforme ADR 0037)
- Autorização via OAuth do cliente; tokens rotacionados
- Sincronização diária: traz transações novas em `bank_transactions`
- Fallback **OFX upload manual** se o banco não estiver integrado

**Conciliação:**
- `reconciliation_rules` por tenant: condições (descrição contém X, valor entre Y e Z, etc) → ação (match automático com AP Z ou criar entry contábil)
- Conciliação automática: extrato + AP/AR similares em valor+data → match sugerido
- Aprovação manual: operador vê sugestões e aceita/rejeita
- Audit: toda conciliação gera registro

**Devolução de compra — camada 1 (ADR 0058):**
- Linha da NF na inbox ganha ação **[🔄 Devolver]** quando status = `ap_created` ou `parsed`
- Modal de devolução: tipo (total/parcial) + seleção de itens (parcial) + categoria + motivo ≥20 chars
- Cria registro em `nfe_returns` com status `draft`
- Ação **[Gerar PDF controle]** → produz PDF formatado com chave original + itens + motivo para levar ao contador/sistema de emissão externo
- Ação **[Importar XML emitido]** → operador cola ou faz upload do XML da NF-e de devolução emitida externamente; valida `refNFe = chave_original`; marca `emitted` com `emission_mode='external_import'`
- Ciclo: `draft → awaiting_external_emission → emitted → confirmed_by_supplier | rejected_by_supplier | cancelled`
- Emissão direta via Focus NFe vem no Sprint 36 (`[Emitir via Focus]` — camada 2 da ADR 0058)
- Reconciler em `packages/db/erp-financeiro/return-reconciler.ts`: devolução total cancela AP se não paga / cria AR se já paga; devolução parcial reduz valor da AP ou cria AR pelo excedente
- Dashboard gerente ganha card "Devoluções pendentes" segmentado por status + alerta >7d em `awaiting_external_emission`

**NFs relacionadas e inbound direction (ADR 0060):**
- Inbox mostra badge contextual por linha: `🔄 Dev. venda #89` / `➕ Complem. NF 88` / `🔧 Ajuste NF 75` / `📤 NF-e própria` / (vazio para compra normal)
- Botão "Ver link" navega para NF original em `nfe_received` ou emissão em `fiscal_emissions`
- Filtro novo: **Tipo** (`Normal` / `Complementar` / `Ajuste` / `Devolução` / `Entrada própria`)
- Complementar recebida: `convertNfeToAp` **soma** valor à AP original em vez de criar nova
- Ajuste recebido: não cria AP (só rastro)
- Devolução de venda recebida: **estorna** AR da venda original (quando Sprint 36 ativo; requer linkagem `fiscal_emissions`)
- Job noturno `nfe-resolve-orphan-links`: resolve `related_nfe_id` quando NF original chega após a relacionada

**Manifestação do Destinatário (ADR 0057):**
- UI completa na inbox `/app/financeiro/nfe` (criada no Sprint 15):
  - Nova coluna **"Manifestação"** com status colorido: `⏳ D-25` / `✓ Confirmada` / `⚠ D-5 urgente` / `❌ Expirada` / `—` (quando `not_applicable`)
  - Badge `auto`/`manual` indicando modo
  - Botão **[Manifestar]** abre modal com 4 opções: Ciência (1 clique) · Confirmar · Desconhecer (exige justificativa ≥20 chars) · Não realizada (exige justificativa)
- **Ciência automática default ON** (ADR 0057 — decisão do usuário): handler ouve `nfe.received.*` e dispara evento 210210 automaticamente ao criar linha em `nfe_received` com `manifestation_status='pending'` (respeita toggle `company_settings.nfe_auto_ciencia_enabled`)
- **Confirmar/Desconhecer/Não realizada sempre manuais** — exigem `user_id` no audit; regra dura, sem exceção automatizada
- Gate por CNPJ: trigger do Sprint 15 já marca `not_applicable` quando `company.cnpj IS NULL`; UI esconde ações para essas linhas
- Job diário marca `expired` em linhas `pending` cujo `manifestation_deadline < now()`
- Retry automático até 3 tentativas em caso de erro SEFAZ; alerta admin após falhas repetidas
- Dashboard `/app/dashboard/gerente` ganha card "NFs a manifestar" com segmentos `> D-30` / `D-7 a D-30` / `vencendo hoje` / `vencidas`
- Alerta via cross-alert dispatcher (Sprint 07) D-7 antes do deadline

**NF-e recepção automática + download por chave (ADR 0056):**
- Reusa a **inbox unificada `/app/financeiro/nfe`** e a tabela `nfe_received` criadas no Sprint 15
- Ativa os 2 métodos que dependem de provider externo + certificado A1:
  - **Download automático:** toggle em `/app/settings/financeiro/nfe` passa a ser funcional; job diário busca NFs novas do CNPJ de cada company; popula `nfe_received.source='auto_sefaz'`
  - **Download por chave:** botão "🔎 Por chave" na inbox é habilitado; operador cola 44 dígitos → validador estrutural → provider busca XML → popula `nfe_received.source='manual_key'` com `fetched_by_user_id` do operador
- Via provider agregador (Arquivei/Sieg/Focus/similar conforme ADR 0038) usando certificado digital A1 do cliente
- Upload/configuração do certificado por company (seguro: criptografado + nunca exposto via API)
- Interface `NfeFetcher` do Sprint 15 ganha implementações concretas (`arquivei.ts`, `sieg.ts`, `focus.ts`, `sefaz-direct.ts` via cert)
- NF recebida cria AP draft automático (reusa `convertNfeToAp` + parser do Sprint 15)
- Evita duplicata via chave NF-e unique global (Sprint 15 já tem)
- Toggle por company: `company_settings.nfe_auto_download_enabled` — desligado não roda job, outros métodos continuam disponíveis

**Gerais:**
- Dashboard: extrato por conta + saldo consolidado por company
- Projeção de fluxo de caixa: saldo atual + AP próximas + AR próximas → saldo projetado
- Teste E2E: conectar conta fake, ver transação vindo, conciliar com AP, zerar pendência
- Teste E2E: job SEFAZ busca NFs, AP é criada, fluxo continua
- Seed: 2 contas bancárias por company + 20 transações + 5 regras de conciliação

## Dependências

- Sprint 15 (AP/AR core para conciliar)
- Sprint 16 (IC pode ser liquidado via transferência real)
- Sprint 01b (audit + certificate management)

## Decisões tomadas / ADRs esperados

- **ADR 0037 (esperado)** — Provider Open Finance: Pluggy vs Belvo vs API direta dos bancos. Critério: cobertura de bancos brasileiros, pricing (per-connection), latência, confiabilidade. POC no início do sprint.
- **ADR 0038 (esperado)** — Provider NF-e recepção: Arquivei (tier gratuito), Sieg, Nfe.io, Focus NFe (mesmo provider do NFS-e emissor pode ter recepção), SEFAZ direto com certificado. Critério: custo por NF, cobertura, gestão de certificado. POC no início do sprint.
- **Pergunta aberta:** certificado digital A1/A3 — como armazenar? A1 em HSM do Supabase/Vault próprio (A1 é arquivo .pfx com senha); A3 é hardware físico (não serve para automação server-side). Optar por A1 + Supabase Vault ou AWS KMS.

## Módulos entregues

- Cadastro de contas bancárias
- Open Finance provider com fallback OFX
- Conciliação automática com regras
- Projeção de fluxo de caixa
- Recepção automática de NF-e via SEFAZ
- Gestão segura de certificado digital A1 por company

## Rotas Next.js

- `/app/financeiro/bancos` — lista de contas bancárias + saldos
- `/app/financeiro/bancos/new` — adicionar (com fluxo OAuth Open Finance)
- `/app/financeiro/bancos/[id]/extrato` — transações + filtros
- `/app/financeiro/bancos/[id]/conciliar` — sugestões + aprovação
- `/app/financeiro/conciliacao/regras` — CRUD de rules
- `/app/financeiro/fluxo-caixa` — projeção 30/60/90 dias
- `/app/financeiro/ofx/upload` — fallback manual
- `/app/settings/certificados` — upload/rotação de certificado A1 por company
- `/app/settings/financeiro/nfe` (criada no Sprint 15) — toggle "Download automático" passa a ser **funcional** neste sprint; escolha de provider + credenciais
- `/app/financeiro/nfe` (criada no Sprint 15) — mesma inbox ganha **linhas novas** com `source='auto_sefaz'` e **botão "Por chave" habilitado**

## Server Actions + API Routes

Server Actions:
- `connectBankAccount(provider)` — inicia fluxo OAuth
- `refreshBankAccount(id)` — força sincronização manual
- `uploadOfx(file)` — parser OFX + import
- `createReconciliationRule`, `suggestMatches(bankTransactionId)`, `confirmMatch(bankTxId, apOrArId)`, `rejectMatch(...)`
- `uploadCertificate(companyId, pfxFile, password)` — criptografa e armazena
- `forecastCashFlow(companyId, days)`
- `fetchNfeByKey(chave, companyId)` — chama `NfeFetcher.fetchByKey()`, valida chave 44 dígitos + checksum, popula `nfe_received` com `source='manual_key'` (ADR 0056)
- `toggleNfeAutoDownload(companyId, enabled)` — implementação real do placeholder do Sprint 15; marca `company_settings.nfe_auto_download_enabled`
- `toggleNfeAutoCiencia(companyId, enabled)` — liga/desliga ciência automática (default ON; ADR 0057)
- `manifestNfe(nfeReceivedId, eventCode, justification?)` — envia evento SEFAZ via `NfeFetcher.sendManifestation()`; exige justificativa para `210220` e `210240`; grava protocolo retornado (ADR 0057)
- Handler interno `onNfeReceived` — escuta `nfe.received.*`, checa `nfe_auto_ciencia_enabled`, dispara 210210 com `manifestation_mode='automatic'` quando habilitado
- `createNfeReturn(nfeReceivedId, input)` / `markReturnAwaitingEmission(returnId)` / `linkEmittedReturnXml(returnId, xml)` / `markReturnConfirmed(returnId)` / `markReturnRejected(returnId, reason)` / `cancelReturn(returnId, reason)` — ADR 0058
- `generateReturnControlPdf(returnId)` — gera PDF formatado para operador levar ao contador
- Handler `resolveOrphanLinks()` (job noturno) — popula `related_nfe_id` em linhas órfãs quando NF original chega depois (ADR 0060)

API Routes:
- `POST /api/financeiro/openfinance/callback` — callback do provider OAuth
- `GET /api/jobs/openfinance/sync-daily` — job Vercel Cron
- `GET /api/jobs/nfe/sefaz-sync` — job diário busca NFs
- `POST /api/financeiro/nfe/received` — webhook do provider NF-e (quando aplicável)

## Schemas Drizzle (esperado)

Em `packages/db/schema/bancos.ts`:

- `bank_accounts` — `id`, `tenant_id`, `company_id`, `bank_code text`, `bank_name`, `agency`, `account_number`, `kind` enum (`checking`, `savings`, `business`), `current_balance_cents numeric`, `last_synced_at`, `openfinance_connection_id nullable`, `active`
- `openfinance_connections` — `id`, `tenant_id`, `company_id`, `provider text` (do ADR), `access_token_encrypted`, `refresh_token_encrypted`, `expires_at`, `status` enum (`active`, `error`, `revoked`)
- `bank_transactions` — `id`, `tenant_id`, `bank_account_id`, `external_id text` (do provider, unique), `posted_at timestamptz`, `amount_cents` (negativo = saída), `description text`, `raw_payload jsonb`, `reconciled_with_ap_id nullable`, `reconciled_with_ar_id nullable`, `reconciled_at nullable`, `reconciled_by_user_id nullable`
- `reconciliation_rules` — `id`, `tenant_id`, `condition jsonb` (ex: `{description_contains: "aluguel", amount_min: 5000, amount_max: 5500}`), `action` enum (`auto_match_ap`, `auto_match_ar`, `auto_create_entry`, `flag_for_review`), `target_supplier_id nullable`, `target_chart_account_id nullable`, `active`, `priority int`

Em `packages/db/schema/certificados.ts`:
- `company_certificates` — `id`, `tenant_id`, `company_id`, `kind` enum (`a1`), `encrypted_pfx bytea`, `encrypted_password text`, `expires_at`, `uploaded_at`, `last_used_at`, `revoked_at`

Em `packages/db/schema/nfe-recepcao.ts`:
- `nfe_sefaz_cursors` — `id`, `company_id`, `provider text`, `last_nsu text` (número sequencial único do SEFAZ), `last_synced_at` — **criada neste sprint** (não existia no 15)
- `nfe_received` — **já existe (Sprint 15, ADR 0056)**; neste sprint passa a receber linhas com `source='auto_sefaz'` (via job cursor) e `source='manual_key'` (via `fetchNfeByKey`)

**RLS:** tenant_id + scope company + permission (`financeiro.bank.*`, `financeiro.nfe.*`). Certificado = acesso somente a `financeiro.admin`.

## Eventos de domínio emitidos

- `bank_account.connected`, `bank_account.disconnected`
- `bank_transaction.imported`
- `reconciliation.matched`, `reconciliation.rejected`
- `nfe.received_from_sefaz`, `nfe.parsed_to_ap`
- `nfe.manifestation.ciencia` — `{ chave, mode: 'automatic'|'manual', user_id?, at, protocol }`
- `nfe.manifestation.confirmada` / `.desconhecida` / `.nao_realizada` (ambas com `justification` quando aplicável)
- `nfe.manifestation.expired` — job diário
- `nfe.manifestation.deadline_approaching` — D-7
- `nfe.manifestation.send_failed` — após retry exaurido
- `cashflow.forecast_generated`
- `certificate.uploaded`, `certificate.expiring_soon`

## Commit (checklist)

- [ ] Schema Drizzle: `bank_accounts`, `openfinance_connections`, `bank_transactions`, `reconciliation_rules`, `company_certificates`, `nfe_sefaz_cursors` (novo aqui); `nfe_received` **já existe do Sprint 15** — só alter para garantir `source='auto_sefaz'` e `'manual_key'` no enum
- [ ] Implementações de `NfeFetcher` em `packages/ai/nfe/providers/`: `arquivei.ts`, `sieg.ts`, `focus.ts`, `sefaz-direct.ts` (com certificado A1) — cada uma implementa `fetchByKey`, `fetchByCnpjCursor` E `sendManifestation` (ADR 0057)
- [ ] Habilitar botão "🔎 Por chave" na inbox do Sprint 15 + validador mod 11 da chave
- [ ] Habilitar toggle "Download automático" em `/app/settings/financeiro/nfe` (Sprint 15 tinha placeholder) + toggle "Ciência automática" (default ON, ADR 0057)
- [ ] **UI de manifestação na inbox** (ADR 0057): coluna "Manifestação" + botão [Manifestar] + modal com 4 opções + validação de justificativa mínima
- [ ] **Handler `onNfeReceived`** em `packages/ai/nfe/ciencia-handler.ts`: dispara 210210 automático respeitando toggle
- [ ] **Job `nfe-manifestation-expiry`** (Vercel Cron diário): marca `expired` + emite `nfe.manifestation.expired`
- [ ] **Job `nfe-manifestation-deadline-warn`** (Vercel Cron diário): emite `nfe.manifestation.deadline_approaching` para linhas em D-7
- [ ] **Retry automático** em `sendManifestation` (até 3x, exponential backoff) + alerta admin após falha definitiva
- [ ] **Card "NFs a manifestar"** no dashboard gerente (Sprint 07 estendido)
- [ ] Testes E2E: (a) admin liga toggle + cadastra cert → job roda → NFs aparecem na inbox com `source='auto_sefaz'`; (b) operador cola chave → NF aparece com `source='manual_key'`; (c) admin desliga toggle → job skippa company; (d) **NF baixada com ciência ON → evento 210210 automático dispara em <5s e `manifestation_status='ciencia'`**; (e) **operador desconhece NF com justificativa → evento 210220 enviado + audit com user_id**; (f) **NF sem manifestação por 180d → job marca `expired`**; (g) **company sem CNPJ → linhas marcadas `not_applicable`, UI esconde ações**
- [ ] RLS + audit + criptografia at-rest dos tokens e certificados
- [ ] Wrapper Open Finance em `packages/ai/openfinance/provider.ts` com interface comum (Pluggy/Belvo adapters)
- [ ] Parser OFX (fallback) em `packages/db/bancos/ofx-parser.ts`
- [ ] Motor de conciliação em `packages/db/bancos/reconcile.ts` (aplica rules + sugere matches por similaridade valor+data)
- [ ] Wrapper NF-e recepção em `packages/ai/nfe/sefaz-provider.ts`
- [ ] Upload de certificado com criptografia (Supabase Vault ou próprio)
- [ ] Jobs: sync daily Open Finance + SEFAZ NFs
- [ ] Projeção de fluxo de caixa em `packages/ai/financeiro/cashflow-forecast.ts`
- [ ] UI todas as telas acima
- [ ] Card "saldo consolidado" e "próximas vencendo" no dashboard
- [ ] Alerta de certificado expirando (30 dias antes)
- [ ] Seed + testes unit (parser OFX, motor conciliação)
- [ ] Testes E2E: sandbox Open Finance + conciliação + NF-e sandbox
- [ ] Feature flag `bancos_nfe_v1`
- [ ] ADRs 0037 e 0038 publicados

## Stretch

- [ ] Pagamento via Open Finance (iniciar TED/PIX pela API)
- [ ] Multi-banco por company
- [ ] Conciliação por IA (sugestões usando Copilot com contexto)
- [ ] Alerta de transação suspeita (fraude)

## Log

- —

## Definition of Done

- [ ] Feature flag `bancos_nfe_v1` ligada em dev
- [ ] Testes unit + E2E verdes
- [ ] POCs de Open Finance + NF-e provider funcionais em sandbox
- [ ] Certificado criptografado confirmado
- [ ] RLS verificada
- [ ] Migrations aplicadas
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 17 → `done`
- [ ] ADRs 0037 e 0038 publicados

## Retro

- —
