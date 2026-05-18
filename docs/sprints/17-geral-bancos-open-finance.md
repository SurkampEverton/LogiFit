# Sprint 17 — Geral · Bancos + Open Finance + Conciliação + Automação NF-e SEFAZ

- **Área:** geral
- **Início:** 2026-05-15
- **Fim:** 2026-05-15
- **Status:** done (17a core; 17b OAuth/NF-e SEFAZ real/certificado/manifestação UI fica para POC com credenciais)
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

- **[ADR 0037](../decisions/0037-open-finance-provider-pluggy-belvo.md)** (Proposed — 2026-05-15) — Provider Open Finance: Pluggy vs Belvo vs API direta dos bancos. Critério: cobertura de bancos brasileiros, pricing (per-connection), latência, confiabilidade. POC no início do sprint.
- **[ADR 0038](../decisions/0038-nfe-recepcao-provider-arquivei-sieg-focus.md)** (Proposed — 2026-05-15) — Provider NF-e recepção: Arquivei (tier gratuito), Sieg, Nfe.io, Focus NFe (mesmo provider do NFS-e emissor pode ter recepção), SEFAZ direto com certificado. Critério: custo por NF, cobertura, gestão de certificado. POC no início do sprint.
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
- `/app/financeiro/nfe/[id]/manifestar` — modal/drawer de manifestação (ADR 0057): 4 botões — [Ciência] (1 clique) / [Confirmar] (1 clique) / [Desconhecer] (exige textarea ≥20 chars de justificativa) / [Não realizada] (idem); exibe prazo restante + histórico de tentativas
- `/app/financeiro/nfe/[id]/devolver` — modal de devolução (ADR 0058): tipo total/parcial + seleção de itens (quando parcial) + categoria do motivo (defeito/divergência/atraso/cancelamento/outro) + textarea ≥20 chars + botões [Gerar PDF controle] + [Marcar como aguardando emissão externa]
- `/app/financeiro/nfe/[id]/importar-devolucao` — upload do XML da NF-e de devolução emitida externamente (valida `refNFe = chave_original`); fecha ciclo `awaiting_external_emission → emitted`
- `/app/financeiro/devolucoes` — lista consolidada de `nfe_returns` com filtros status/fornecedor/período; segmento "aguardando emissão > 7d" destacado

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
- `bank_transactions` — `id`, `tenant_id`, `bank_account_id`, `external_id text` (do provider, unique), `posted_at timestamptz`, `amount_cents` (negativo = saída), `description text`, `raw_payload jsonb`, `reconciled_with_ap_id nullable`, `reconciled_with_ar_id nullable`, `reconciled_at nullable`, `reconciled_by_user_id nullable`. **Particionado por TRIMESTRE** (ADR 0072 + regra 34); `@volume_estimate_yearly: 6M+` (1k tenants × 500 transações/mês × 12); retenção 5 anos (compliance fiscal) + cold storage Parquet zstd após 2 anos
- `reconciliation_rules` — `id`, `tenant_id`, `condition jsonb` (ex: `{description_contains: "aluguel", amount_min: 5000, amount_max: 5500}`), `action` enum (`auto_match_ap`, `auto_match_ar`, `auto_create_entry`, `flag_for_review`), `target_supplier_id nullable`, `target_chart_account_id nullable`, `active`, `priority int`

Em `packages/db/schema/certificados.ts`:
- `company_certificates` — `id`, `tenant_id`, `company_id`, `kind` enum (`a1`), `encrypted_pfx bytea`, `encrypted_password text`, `expires_at`, `uploaded_at`, `last_used_at`, `revoked_at`

Em `packages/db/schema/nfe-recepcao.ts`:
- `nfe_sefaz_cursors` — `id`, `company_id`, `provider text`, `last_nsu text` (número sequencial único do SEFAZ), `last_synced_at` — **criada neste sprint** (não existia no 15)
- `nfe_received` — **já existe (Sprint 15, ADR 0056)**; neste sprint passa a receber linhas com `source='auto_sefaz'` (via job cursor) e `source='manual_key'` (via `fetchNfeByKey`). **Alter neste sprint para particionamento ANUAL** (ADR 0072 + regra 34); `@volume_estimate_yearly: 12M+` (1k tenants × 1k NFs/mês × 12); retenção fiscal 5 anos hot + 5 anos cold storage Parquet (total 10 anos para auditoria fiscal); job `archive-cold-partitions` move XML completo para Storage após 2 anos preservando metadata na partição quente

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
- [ ] Implementações de `NfeFetcher` em `packages/ai/nfe/providers/`: `arquivei.ts` (allowlist `api.arquivei.com.br`), `sieg.ts` (allowlist `api.sieg.com`), `focus.ts` (allowlist `api.focusnfe.com.br`), `sefaz-direct.ts` (allowlist por UF — `nfe.fazenda.sp.gov.br`, `nfe.svrs.rs.gov.br`, etc com certificado A1) — cada uma implementa `fetchByKey`, `fetchByCnpjCursor` E `sendManifestation` (ADR 0057); **toda chamada HTTP via `safeFetch()` (ADR 0073 + regra 37)**
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
- [ ] Wrapper Open Finance em `packages/ai/openfinance/provider.ts` com interface comum (Pluggy adapter `api.pluggy.ai` / Belvo adapter `api.belvo.com`); **toda chamada HTTP via `safeFetch()` (ADR 0073 + regra 37)** com allowlist por adapter; webhook callback valida HMAC + IP source
- [ ] Parser OFX (fallback) em `packages/db/bancos/ofx-parser.ts`
- [ ] Motor de conciliação em `packages/db/bancos/reconcile.ts` (aplica rules + sugere matches por similaridade valor+data)
- [ ] Wrapper NF-e recepção em `packages/ai/nfe/sefaz-provider.ts`
- [ ] Upload de certificado A1 com criptografia (Supabase Vault); **`scanUpload()` (regra 38)** valida que arquivo é `.pfx`/`.p12` real (magic bytes) antes de cifrar; **AES-256-GCM com KEK por company** (ADR 0073 camada 4) — `master_key_certificates` LogiFit + `kek_company_id` por company; senha do cert cifrada separadamente da pfx (defesa em profundidade)
- [ ] Jobs: sync daily Open Finance + SEFAZ NFs
- [ ] Projeção de fluxo de caixa em `packages/ai/financeiro/cashflow-forecast.ts`
- [ ] UI todas as telas acima
- [ ] Card "saldo consolidado" e "próximas vencendo" no dashboard
- [ ] **Pesquisa global** (ADR 0062): indexar `nfe_received` (label=chave últimos 6 dígitos + emitente, subtitle=valor+status+data, kind=`nfe_received`, `required_permission='financeiro.nfe.read'`), `bank_transactions` (label=descrição, subtitle=valor+data, kind=`bank_tx`), `nfe_returns` (kind=`nfe_return`, label=chave original)
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

### 2026-05-15 — Sprint 17a core MVP done

**Decisão de quebra 17a/17b:** sprint original cobria 9 features (bancos + OFX + conciliação + cashflow + cert A1 + NF-e SEFAZ + manifestação + devolução + NFs relacionadas). Sem credenciais de provider real (Pluggy/Belvo/Arquivei) e sem certificado A1 piloto, dividir em:
- **17a (entregue agora)**: tudo que executa sem provider externo — bancos CRUD, OFX upload+parser, conciliação rules+heurística, cashflow forecast, schemas certificados + nfe_sefaz_cursors prontos, ADRs 0037 + 0038 Proposed documentando trade-offs
- **17b (futuro)**: POCs OAuth Pluggy/Belvo, download SEFAZ Arquivei/Sieg/Focus, upload cert A1 cifrado, UI manifestação destinatário (ADR 0057), devolução de compra (ADR 0058), NFs relacionadas (ADR 0060)

Schemas pré-cabeados garantem que 17b não exige nova migration.

**Faixa A entregue (Schemas + RLS + 9 tests):**

- **`packages/db/src/schema/bancos.ts`** — 4 tabelas: `bank_accounts` (kind enum + opening/current balance + openfinanceConnectionId nullable + unique per company); `openfinance_connections` (provider enum pluggy/belvo/direct + access_token_encrypted + status enum); `bank_transactions` (external_id unique quando NOT NULL + amount negativo=saída/positivo=entrada + reconciledWith ApId/ArId + raw_payload jsonb; `@volume_estimate_yearly: 6000000` particionamento por trimestre em migration futura — regra 34 + ADR 0072); `reconciliation_rules` (DSL jsonb condition + 4 actions + priority asc + hitsCount + unique tenant/name).
- **`packages/db/src/schema/certificados.ts`** — 2 tabelas: `company_certificates` (kind a1 + bytea encrypted_pfx + text encrypted_password chave separada — defesa em profundidade ADR 0073 camada 4 + subjectCnpj + expiresAt + status enum + lastUsedAt) + `nfe_sefaz_cursors` (provider enum + last_nsu + consecutive_failures pra alerta + unique company/provider).
- **`packages/db/src/policies/0036_bancos_certificados_rls.sql`** — RLS tenant-scoped + FORCE em 6 tabelas (4 bancos + 2 certificados).
- Migration `0023_curved_ser_duncan.sql` gerada + aplicada (18 policy drops).
- **`packages/db/tests/bancos-rls.test.ts`** — 9 tests verdes: bank_accounts unique per company + isolation; bank_transactions unique external_id quando NOT NULL (importação manual com NULL aceita N rows); reconciliation_rules unique name; nfe_sefaz_cursors unique (company, provider); bytea round-trip do PFX cifrado.
- Bonus: corrigida idempotência de triggers do Sprint 16 (`DROP TRIGGER IF EXISTS` antes de `CREATE TRIGGER`).

**Faixa B.1 entregue (Libs puras — 30 tests):**

- **`packages/db/src/bancos/ofx-parser.ts`** — `parseOfx(content)` suporta OFX 2.x (XML) + 1.x (SGML); extrai bank_id/account/period/ledger_balance + transações STMTTRN com fitId/postedAt/amountCents/description/memo/type; rejeita tx sem FITID. **9 tests** cobrindo XML/SGML/edge cases (sem `<OFX>` retorna vazio; vírgula brasileira; data com hora; FITID ausente).
- **`packages/db/src/bancos/reconcile.ts`** — `matchRules(tx, rules)` aplica priority asc + skip inativas; `conditionMatches(tx, conditionRaw)` valida DSL via Zod (descriptionContains/Regex + amountMin/MaxCents valor absoluto + amountSign + postedFrom/To); `suggestMatches(tx, candidates, options)` heurística top-N com score = valor 50% + data 30% + token overlap 20%; filtra por kind (tx negativa → AP, tx positiva → AR). **13 tests** cobrindo todos os predicates + priority + filtro kind + edge cases.
- **`packages/db/src/bancos/cashflow.ts`** — `forecastCashflow({currentBalance, futureAps, futureArs, daysAhead, startDate})` projeta N dias (clamp 1-180); overdue absorvido dia 0; retorna pontos com openingBalance/inflow/outflow/closingBalance + apCount/arCount; `validateNfeKey(chave)` mod 11 nos 43 primeiros dígitos retorna `{ok, uf, aamm, cnpj}` ou `{ok: false, reason}`; limpa formatação (espaços/pontos) antes. **8 tests** cobrindo forecast + overdue + clamp + chave válida/inválida/DV errado/formatada.
- **`packages/db/package.json`** novo export `./bancos`.

**Faixa B.2 entregue (14 Server Actions):**

- **`apps/web/app/app/financeiro/bancos/actions.ts`** — 7 actions: `createBankAccount` (captura código 23505 → VALIDATION_ERROR claro), `listBankAccounts` (filtro includeArchived/companyId), `archiveBankAccount`, `importOfx` (parseia OFX → INSERT idempotente por external_id; INSERT-conflict-ignore counta skipped; atualiza currentBalance via ledgerBalance OU agregação local), `listBankTransactions` (filtros reconciled/from/to), `confirmMatch(bankTxId, target ap|ar, targetId)` (valida AP/AR existe no tenant + marca reconciled), `suggestMatchesAction` (carrega AP/AR ±30d + chama heurística + resolve nomes via JOIN persons), `connectBankAccount` stub retorna INTERNAL_ERROR "Open Finance POC pendente (ADR 0037). Use OFX como fallback".
- **`apps/web/app/app/financeiro/conciliacao/regras/actions.ts`** — 3 actions: `createReconciliationRule` (valida condition via RuleConditionSchema + captura unique 23505), `listReconciliationRules`, `archiveReconciliationRule`.
- **`apps/web/app/app/financeiro/fluxo-caixa/actions.ts`** — 1 action: `forecastCashflowAction(companyId?, daysAhead)` agrega balance + APs pendentes + ARs pendentes + invoices Sprint 04 mensalidades, chama `forecastCashflow` pure e retorna pontos + summary (totalInflow/Outflow/min/max/finalBalance).

**Faixa C entregue (7 rotas Next.js):**

- **`/app/financeiro/bancos`** — cards por conta com saldo + última sync + badge Open Finance ✓ se aplicável; KPI saldo consolidado.
- **`/app/financeiro/bancos/new`** — form com dropdown 13 bancos brasileiros comuns + auto-fill name ao selecionar code + opção "Outro…" pra customizado + kind (CC PJ/PF/Poupança/Caixa) + saldo inicial em BRL + nickname.
- **`/app/financeiro/bancos/[id]/extrato`** — 4 KPIs (saldo/entradas/saídas/última sync) + `<OfxImportForm>` client component expansível com FileReader + filtro reconciled (yes/no/all) + tabela com badges source + status conciliação (✓ verde / Pendente amarelo).
- **`/app/financeiro/bancos/[id]/conciliar`** — server lista pendentes + `<ConciliacaoList>` cliente: por transação botão "Buscar sugestões" chama `suggestMatchesAction` → renderiza top-3 com match% color-coded (>90 verde / >70 azul / >50 amarelo) + reasons (valor idêntico/próximo; mesma data; ±Nd; descrição match) + botão "Conciliar" chama `confirmMatch`.
- **`/app/financeiro/conciliacao/regras`** — lista tabular sorted by priority asc + badges action + JSON condition truncado.
- **`/app/financeiro/conciliacao/regras/new`** — form com 4 actions select + priority + condições agrupadas (descriptionContains + amountMin/Max em BRL + amountSign).
- **`/app/financeiro/fluxo-caixa`** — server page + `<CashflowChart>` client: 4 botões 7/30/60/90d que chamam `forecastCashflowAction` em background; 5 KPIs (saldo atual / entradas previstas / saídas previstas / saldo projetado color-coded / saldo mínimo); alerta dramático se mínimo < 0; tabela diária dia/inicial/entradas/saídas/final com row vermelho quando closingBalance < 0; conta apCount/arCount em parênteses pra contextualizar.
- Hub `/app/financeiro` atualizado: cards 🏦 Bancos + 💹 Fluxo de caixa.

**Faixa D entregue (ADRs + seed):**

- **`docs/decisions/0037-open-finance-provider-pluggy-belvo.md` Proposed** — interface abstrata `OpenFinanceProvider` (startConnection/exchangeCode/listAccounts/syncTransactions/refreshToken/revokeConnection) + Pluggy default (BR-focused, R$ 0,30/conexão, free tier dev) + Belvo alternativa LatAm + adapter mock pra testes + segurança regra 35/37/38 (allowlist + HMAC webhook + tokens cifrados envelope AES-256-GCM); alternativas rejeitadas (SEFAZ direto = 1000+h dev; Plaid sem cobertura BR; sem abstração viola regra 46). Promove pra Accepted quando POC Sprint 17b validar.
- **`docs/decisions/0038-nfe-recepcao-provider-arquivei-sieg-focus.md` Proposed** — interface abstrata `NfeFetcher` (fetchByKey + fetchByCnpjCursor + sendManifestation com 4 eventos 210210/210200/210220/210240) + Focus default quando tenant já é cliente Sprint 36 emissor (reuse sem custo extra) + Arquivei alternativa free tier 50/mês + Sieg fallback + sefaz_direct futuro com cert A1; manifestação ciência automática default ON (Sprint 17b implementa handler `onNfeReceived` com retry exponential + cross-alert Sprint 07 D-7); segurança certificado AES-256-GCM com KEK por company + senha separada; alternativas rejeitadas (vendor lock-in único provider; só Focus força clientes recepção a também emitir; sem recepção automática = operador esquece NFs).
- **`packages/db/scripts/seed-bancos.ts`** + `pnpm db:seed:bancos` — por tenant: 2 contas (1 Bradesco CC PJ matriz com saldo inicial R$ 15k + 1 caixa físico R$ 800) + 20 transações OFX-style realistas últimos 60 dias (aluguel, energia, internet, mensalidades, tarifas, PIX recebidos, suplementos, GCP, marketing) atualizando saldo conforme insere; 5 reconciliation_rules canônicas (auto-match aluguel/energia/mensalidades; auto-create tarifa; flag >R$ 50k). Idempotente via unique constraints + count check.

**Pendências Sprint 17b (futuro):**

- POC Pluggy sandbox + adapter real `pluggy.ts` + webhook callback HMAC
- Adapter `arquivei.ts` com `fetchByKey` + `fetchByCnpjCursor` + `sendManifestation`
- Server Action `fetchNfeByKey(chave, companyId)` habilitando botão "Por chave" inbox Sprint 15
- Server Action `toggleNfeAutoDownload` real (placeholder hoje)
- Job cron diário `/api/jobs/openfinance/sync-daily` + `/api/jobs/nfe/sefaz-sync`
- Upload UI certificado A1 `/app/settings/certificados` com `scanUpload` magic bytes pfx + AES-256-GCM
- UI `/app/settings/financeiro/nfe` toggle Download automático + escolha provider + credenciais cifradas
- Handler `onNfeReceived` ciência automática (ADR 0057) com retry exponential
- UI `/app/financeiro/nfe/[id]/manifestar` modal 4 botões (ADR 0057)
- Job `nfe-manifestation-expiry` diário + alerta D-7 cross-alert Sprint 07
- UI devolução compra `/app/financeiro/nfe/[id]/devolver` (ADR 0058)
- NFs relacionadas inbound direction (ADR 0060): badges contextuais + filtro Tipo
- Card "NFs a manifestar" + "Certificados expirando" no dashboard gerente
- Feature flag `bancos_nfe_v1`
- E2E completo (sandbox Pluggy + Arquivei)
- RIPD bancos + NF-e

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
