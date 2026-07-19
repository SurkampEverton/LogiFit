# Sprint 36 — Geral · Módulo fiscal — emissão completa via Focus NFe

- **Área:** fiscal (aplicável a todas as verticais)
- **Início:** planejado (Fase 3)
- **Fim planejado:** +4 semanas — candidato à quebra em 36a (NFS-e + eventos) + 36b (NF-e produto + NFC-e + devolução/transferência/conserto) se estourar 3 semanas (regra 9)
- **Status:** doing — 36a backbone done 2026-05-18 · 36b.1-36b.6 (provider real, lookup/detalhe, catálogo, NFS-e avulsa, design system + PDF/XML, portal contador fase 1) done 2026-07-19 · 36b.7/c pendente (ver Log)
- **Item do roadmap:** #38

## Goal

Entregar o **ciclo fiscal completo de emissão** via Focus NFe, cobrindo 8 tipos de operação (NFS-e serviço, NF-e venda produto, NFC-e varejo, NF-e devolução, NF-e transferência entre filiais, NF-e remessa/retorno conserto, NF-e de entrada própria) + 3 eventos (cancelamento, CC-e, inutilização). Implementa a [ADR 0059](../decisions/0059-ciclo-fiscal-emissao-focus-nfe.md).

## Contexto

Sprint anteriores preparam recepção (ADR 0056), manifestação (ADR 0057), devolução interna (ADR 0058) e NFs relacionadas (ADR 0060). Schemas de `fiscal_emissions`, `fiscal_events`, `fiscal_numbering_sequences` nascem no Sprint 15. Este sprint conecta tudo via provider único **Focus NFe** + UI de emissão + webhooks de callback.

Regra fundamental: **LogiFit não toca em motor tributário**. Focus NFe cuida de ICMS/IPI/PIS/COFINS/CST/CFOP/ISS por UF/município. Interface `FiscalProvider` abstrai para trocas futuras (ver [ADR 0076](../decisions/0076-nfse-nacional-provider-complementar.md) — NFS-e Nacional como provider complementar pós-MVP).

**Modelo de cobrança fiscal (revisão ADR 0066 em 2026-04-25):** custo Focus NFe é repassado proporcionalmente ao tenant via overage (Pro 200/Business 1.000/Enterprise 5.000 notas inclusas; excedente cobrado a R$ 0,25-0,40/nota). Este sprint precisa garantir que a contagem de emissões alimenta `tenant_usage_snapshots.fiscal_emissions_count` corretamente.

## Critério de aceite

**Cobertura (ADR 0059):**
- [ ] Emissão NFS-e (serviço municipal) — a partir de `invoices` (mensalidade academia, consulta fisio, consulta nutri) e `billing_guides` pagos (Sprint 22 convênio)
- [ ] Emissão NF-e produto (modelo 55) — venda de mercadoria (suplemento, órtese, revenda do Sprint 24)
- [ ] Emissão NFC-e (modelo 65) — venda varejo balcão sem identificação do cliente (Sprint 24 POS)
- [ ] Emissão NF-e devolução (`finNFe=4`) — a partir de `nfe_returns` (ADR 0058)
- [ ] Emissão NF-e transferência — entre filiais com CNPJs diferentes (Sprint 16 intercompany)
- [ ] Emissão NF-e remessa para conserto — equipamento vai ao fabricante (Sprint 25)
- [ ] Emissão NF-e retorno de conserto — quando equipamento volta
- [ ] Emissão NF-e de entrada própria — compra de PF sem inscrição (CFOP 1.917); espelha em `nfe_received` via ADR 0060

**Eventos:**
- [ ] Cancelamento de emissão (janela de 24h, ou prazo por UF)
- [ ] Carta de Correção Eletrônica (CC-e) — corrige campos não-fiscais (endereço, transportadora); até 30 eventos por chave
- [ ] Inutilização de número — para números pulados por falha técnica na emissão

**Integrações:**
- [ ] `invoices` (Sprint 04) ganha `nfse_chave` linkando emissão fiscal quando virou NFS-e; evento `invoice.nfse_emitted` / `.rejected`
- [ ] `billing_guides` (Sprint 22) pagos disparam NFS-e opcionalmente (toggle por tenant)
- [ ] `nfe_returns.emission_mode='focus_nfe'` popula com chave da NF-e de devolução emitida (fecha ciclo ADR 0058)
- [ ] `equipment_maintenance` (Sprint 25) com `external_location=true` oferece botão "Emitir NF-e remessa" e "Emitir NF-e retorno" no ciclo de manutenção
- [ ] Transferências intercompany (Sprint 16) oferece "Emitir NF-e de transferência" quando cruza CNPJs distintos
- [ ] POS Sprint 24 emite NFC-e automaticamente na venda de balcão

**Infra:**
- [ ] `FiscalProvider` interface em `packages/ai/fiscal/provider.ts`
- [ ] `packages/ai/fiscal/providers/focus-nfe.ts` — implementação primária (10 métodos: 7 emissões + 3 eventos); **toda chamada HTTP via `safeFetch()` (ADR 0073 + regra 37)** com `allowedHosts: ['focusnfe.com.br', 'homologacao.focusnfe.com.br']`; rate limit respeitando Focus (HTTP 429 → `RATE_LIMITED`)
- [ ] `packages/ai/fiscal/providers/mock.ts` — testes
- [ ] Payload builders em `packages/ai/fiscal/emissions/*.ts` por tipo
- [ ] Resolver CFOP em `packages/ai/fiscal/resolvers/cfop.ts` (operação + UF origem + UF destino + tipo → CFOP correto)
- [ ] Resolver CBOS/CNAE em `packages/ai/fiscal/resolvers/cbos-cnae.ts` (serviço → código ABRASF/CNAE)
- [ ] Catálogo `fiscal_service_catalog` populado pelo admin com serviços tributáveis do tenant (código LC 116/2003, alíquota ISS do município, retenções)
- [ ] Webhook receiver `POST /api/fiscal/focus-nfe/callback` com HMAC + idempotência **+ validação de IP source Focus NFe (allowlist documentada)**
- [ ] Credenciais Focus por tenant em `tenant_settings.fiscal_provider_credentials` (AES-256-GCM, KEK por tenant; ADR 0073 camada 4)
- [ ] Certificado A1 por company (reusa infra Sprint 17) — Focus usa quando configurado para transmissão direta

**UI:**
- [ ] Rota `/app/fiscal` — inbox de emissões com filtros (tipo, status, período, company)
- [ ] Botões de emissão contextualizados: `[+ Emitir NFS-e]` / `[+ Emitir NF-e produto]` / `[+ NFC-e]` / `[+ Evento]`
- [ ] Ações inline por linha: baixar PDF/XML, cancelar (dentro da janela), CC-e, rever erro, tentar novamente
- [ ] Tela `/app/settings/fiscal` — wizard de onboarding: credenciais Focus + regime tributário + catálogo de serviços + série/numeração + teste com NF homologação
- [ ] Tela `/app/settings/fiscal/catalogo` — CRUD de `fiscal_service_catalog`

**Testes:**
- [ ] Teste unit do resolver de CFOP (20+ casos: dentro de UF, entre UFs, devolução, transferência, conserto, bonificação)
- [ ] Teste E2E com Focus NFe sandbox: emitir NFS-e + NF-e + NFC-e + devolução + cancelar + CC-e
- [ ] Teste E2E de reconciliação: `invoices.nfse_chave` populado após webhook callback
- [ ] Teste E2E de retry: emissão rejeitada por erro transient → retry → sucesso
- [ ] Seed: 5 emissões de cada tipo em ambiente homologação + 1 evento de cada

## Dependências

- Sprint 04 (`invoices` — NFS-e consome)
- Sprint 15 (schemas `fiscal_emissions`/`fiscal_events`/`fiscal_numbering_sequences` preparados; `accounts_receivable`)
- Sprint 16 (transferência intercompany — fonte de NF-e transferência)
- Sprint 17 (certificado A1 por company + inbox devolução)
- Sprint 22 (`billing_guides` — fonte de NFS-e convênio)
- Sprint 24 (POS + revenda — fonte de NF-e produto e NFC-e)
- Sprint 25 (`equipment_maintenance` — fonte de NF-e conserto)

## Decisões tomadas / ADRs esperados

- **[ADR 0059](../decisions/0059-ciclo-fiscal-emissao-focus-nfe.md)** (accepted) — Ciclo fiscal de emissão completo via Focus NFe
- **[ADR 0066](../decisions/0066-plano-comercial-pricing-trial.md)** (accepted, revisado 2026-04-25) — modelo de cobrança fiscal repassado ao tenant via overage (50/200/1.000/5.000 inclusas + R$ 0,50/0,40/0,35/0,25 por nota extra; **eventos não contam**); Sprint 36 popula `tenant_usage_snapshots.fiscal_emissions_count` (Sprint 04 cria schema)
- **[ADR 0076](../decisions/0076-nfse-nacional-provider-complementar.md)** (accepted 2026-04-25) — NFS-e Nacional como provider complementar; **não implementa neste sprint**, apenas mantém `FiscalProvider` apto a receber adapter futuro (`provider` column em `fiscal_emissions` já registra qual provider emitiu)
- **[ADR 0079](../decisions/0079-tiss-401-ans-padrao-vigente.md)** (accepted 2026-04-25) — TISS 4.01 ANS é tema relacionado mas **fora do escopo deste sprint**: faturamento de convênio é Sprint 22 (TISS gera guia XML para operadora; Sprint 36 trata apenas de notas fiscais SEFAZ via Focus NFe). Coexistência operacional: serviços faturados via TISS podem **também** gerar NFS-e (co-participação do paciente, repasse de operadora) — tratamento dual coberto em Sprint 22 + 36
- **Pergunta aberta:** certificado A1 — usar da company (Sprint 17) ou Focus NFe gerencia o próprio? Começar com Focus (eles têm infra); tenant pode escolher "cert próprio" se precisar isolar.
- **Pergunta aberta:** NFC-e exige CSC (Código de Segurança do Contribuinte) por UF — configurado por company no wizard de onboarding.

## Pré-Sprint — Negociação comercial Focus NFe

**Antes de iniciar Sprint 36** (idealmente 30-60 dias antes), o fundador deve abrir conversa comercial com Focus NFe para tabela escalonada por volume. Detalhes:

- **Target:** R$ 0,12/nota acima de 10.000 emissões/mês agregado LogiFit
- **Argumento:** crescimento esperado pós-PMF; multi-tenant SaaS com volume previsível e crescente
- **Pedidos secundários:** SLA escrito, rate limit dedicado, suporte priority, sandbox enterprise sem expirar
- **Resultado documentado em** `docs/contratos/focus-nfe.md` (criar pasta) com versão assinada do contrato
- **Gatilho de re-negociação:** a cada 50% de aumento de volume mensal LogiFit; revisão obrigatória anual

## Módulos entregues

Ver [`modulos.md` — Emissão Fiscal](../modulos.md#emiss%C3%A3o-fiscal):

- Inbox unificada de emissões `/app/fiscal`
- Emissão NFS-e (serviço)
- Emissão NF-e produto
- Emissão NFC-e (varejo)
- Emissão NF-e devolução (camada 2 da ADR 0058)
- Emissão NF-e transferência entre filiais
- Emissão NF-e remessa/retorno conserto
- Emissão NF-e entrada própria
- Cancelamento / CC-e / Inutilização
- Catálogo de serviços tributáveis por company
- Wizard de onboarding fiscal

## Rotas Next.js

- `/app/fiscal` — inbox de emissões
- `/app/fiscal/[id]` — detalhe + ações (cancelar/CC-e)
- `/app/fiscal/emitir/nfse` — form NFS-e avulsa
- `/app/fiscal/emitir/nfe-produto` — form NF-e produto
- `/app/fiscal/emitir/nfce` — form NFC-e (normalmente acionado via POS)
- `/app/fiscal/inutilizacao` — inutilizar faixa de numeração
- `/app/settings/fiscal` — wizard de configuração
- `/app/settings/fiscal/catalogo` — CRUD catálogo de serviços
- `/app/settings/fiscal/numeracao` — séries e numeração por tipo
- `/app/fiscal/retencoes` — relatório mensal de retenções agrupado por tributo (ADR 0061); filtros por período/company/tributo; export PDF/CSV
- `/app/contador` — **portal do contador externo** (role `contador_externo` do Sprint 01b — ADR 0061), tudo read-only, layout distinto (sem sidebar operador, sem acesso a members/agenda/prontuário). Navegação lateral inclui:
  - **`/app/contador/dashboard`** — home com KPIs agregados: receita total mês/ano + NFSe emitidas × recebidas + APs pagos × pendentes + retenções pendentes de guia
  - **`/app/contador/xmls`** — download em massa de XMLs (recebidos + emitidos) por período com filtros (tipo, emitente, status); export ZIP assinado TTL 1h
  - **`/app/contador/ap-ar`** — CSV/OFX de AP/AR por período; incluindo `no_invoice=true` (entradas sem NF)
  - **`/app/contador/retencoes`** — link para `/app/fiscal/retencoes` (compartilhado)
  - **`/app/contador/dre`** — **acesso ao DRE** (Sprint 14) read-only por período + company + consolidado (decisão explícita: contador precisa do DRE para fechar balanço; aba inclui breakdown de receita × custos + comparativo mês/anterior + export PDF/XLSX)
  - **`/app/contador/kpis`** — KPIs **agregados** (nunca individuais — regra 26 group_owner se aplica igual): receita por modalidade, inadimplência, ticket médio, MRR, overdue por método; para sanity check do contador
  - **`/app/contador/fiscal-emissions`** — lista read-only de `fiscal_emissions` emitidas (NFS-e + NF-e + NFC-e) por período; filtro por tipo/status/chave; download individual PDF/XML
  - **`/app/contador/certificados`** (read-only) — visualiza certificados A1 ativos + vencimento (não pode alterar; admin altera)
- `/app/contador/convidar` — admin do tenant convida contador via magic link (Sprint 01b tem o schema; aqui fica a UI detalhada: form email + nome + empresa contábil + permissions padrão `contador_externo`; revogação)

## Server Actions + API Routes

Server Actions em `apps/web/app/fiscal/actions.ts`:

```ts
// Emissão
emitNfseFromInvoice(invoiceId)
emitNfseFromBillingGuide(guideId)
emitNfseManual(input)
emitNfeProductFromSale(saleId)
emitNfeReturn(nfeReturnId)             // Consome ADR 0058
emitNfeTransfer(transferId)             // Consome Sprint 16
emitNfeConsertoOut(maintenanceId)
emitNfeConsertoReturn(maintenanceId)
emitNfce(saleId)
emitNfeSelfEntry(input)                 // Comprador emite própria; popula nfe_received via ADR 0060

// Eventos — alto risco fiscal: gate `requireRecentMfa(maxAgeMin=15)` no wrapper (regra 43)
cancelEmission(emissionId, justification)         // requireRecentMfa() — `cancelNfe` em high-risk-actions.ts
issueCCe(emissionId, correction)                   // requireRecentMfa() — correção fiscal pós-emissão
inutilizeRange(companyId, kind, serie, from, to, justification)  // requireRecentMfa() — afeta numeração

// Consulta/retry
queryEmissionStatus(emissionId)
retryEmission(emissionId)
```

**Gate MFA específico de Fiscal (regra 43, igual ao padrão Sprint 22 TISS):**

- Cancelar emissão fiscal + emitir CC-e + inutilizar faixa de numeração = **ações de alto risco fiscal** — exigem **MFA recente (<15min)** mesmo para roles com MFA opcional. Wrapper `requireRecentMfa()` no handler valida claim `mfa_at` do JWT; expirado → forçar reauth com TOTP/WebAuthn antes de prosseguir. Audit log marca `mfa_required=true` + `mfa_at_action`. Coerente com **regra 43** ([rules.md](../rules.md)) e **`packages/security/high-risk-actions.ts`** (cancelNfe + voidPaidInvoice + updateInvoiceAmount).

API Routes:
- `POST /api/fiscal/focus-nfe/callback` — webhook idempotente (HMAC); atualiza `fiscal_emissions.status`, preenche `chave`, `xml_storage_path`, `pdf_storage_path`; emite domain events
- `GET /api/fiscal/emissions/[id]/pdf` — serve PDF assinado com URL TTL 10min
- `GET /api/fiscal/emissions/[id]/xml` — serve XML assinado com URL TTL 10min

## Schemas Drizzle

Schemas principais já existem (Sprint 15 preparou): `fiscal_emissions`, `fiscal_events`, `fiscal_numbering_sequences`. Este sprint adiciona:

- `fiscal_service_catalog` — `id`, `tenant_id`, `company_id`, `municipality_code text` (IBGE), `nbs_code nullable`, `lc116_code nullable`, `cnae nullable`, `description text`, `tax_regime` enum (`simples_nacional`/`lucro_presumido`/`lucro_real`), `iss_rate_percent numeric`, `pis_rate_percent nullable`, `cofins_rate_percent nullable`, `retention_rules jsonb nullable`, `active bool default true`
- `fiscal_provider_credentials` — `tenant_id pk`, `provider text default 'focus_nfe'`, `api_token_encrypted text`, `environment` enum (`homologacao`, `producao`), `last_validated_at`

`invoices` (Sprint 04) ganha:
- `nfse_chave text nullable`
- `nfse_emission_id uuid nullable` fk `fiscal_emissions`

**RLS:** tenant_id + company_id + permissions (`fiscal.read`, `fiscal.emit`, `fiscal.cancel`, `fiscal.admin`).

## Eventos de domínio emitidos

- `fiscal.emission.created` (draft) / `.queued` (enviado) / `.completed` (chave recebida) / `.rejected` (erro)
- `fiscal.emission.cancelled`
- `fiscal.event.cce_issued`
- `fiscal.event.inutilizacao_issued`
- `invoice.nfse_emitted` (linka com Sprint 04)
- `nfe_return.emitted` (fecha ciclo ADR 0058)

Consumidores:
- `accounts_receivable` (Sprint 15) — NFS-e emitida com tomador pagando separado cria AR
- Dashboard gerente — card "Emissões com erro" (Sprint 07 estendido)
- Timeline do member (Sprint 02) — quando NFS-e é emitida contra pessoa física, aparece no histórico

## Commit (checklist)

- [ ] Schema Drizzle: `fiscal_service_catalog`, `fiscal_provider_credentials`; colunas em `invoices`
- [ ] Interface `FiscalProvider` + implementação `focus-nfe.ts`
- [ ] Payload builders por tipo de emissão (7 tipos)
- [ ] Resolvers de CFOP e CBOS/CNAE
- [ ] Server Actions de emissão (10 métodos) + eventos (3 métodos)
- [ ] Webhook callback Focus NFe com HMAC + idempotência
- [ ] UI inbox `/app/fiscal` + ações inline
- [ ] Wizard `/app/settings/fiscal` de onboarding
- [ ] UI catálogo de serviços tributáveis
- [ ] Integração com `invoices` (botão "Emitir NFS-e" na AR/invoice)
- [ ] Integração com `billing_guides` (Sprint 22) — emissão automática por toggle
- [ ] Integração com `nfe_returns` (Sprint 17) — botão "Emitir via Focus"
- [ ] Integração com intercompany (Sprint 16) — sugere emissão quando cruza CNPJs
- [ ] Integração com `equipment_maintenance` (Sprint 25) — emissão remessa/retorno
- [ ] Integração com POS (Sprint 24) — NFC-e automática
- [ ] Fila de retry em emissões `rejected` por erro transient (até 3x, backoff)
- [ ] Dashboard card "Emissões com erro" + alerta via cross-alert dispatcher (Sprint 07)
- [ ] Permissions `fiscal.read`, `fiscal.emit`, `fiscal.cancel`, `fiscal.admin`, `retencoes.read`
- [ ] **Portal `/app/contador`** (ADR 0061): download ZIP em massa de XMLs recebidos + emitidos por período (URL assinada TTL 1h); CSV/OFX de AP/AR; relatório de retenções por tributo; **cabeçalho sempre mostra "Leitura somente — dados fiscais e financeiros; sem acesso clínico"**
- [ ] Aba **`/app/fiscal/retencoes`** (ADR 0061): tabela agrupada por tributo (IRRF/PIS/COFINS/CSLL/INSS/ISS) × período; total por tributo; export PDF (contador gera DARF separado) + CSV; campo `guide_reference` colável na linha para rastrear DARF pago
- [ ] Convite de contador: `createContadorInvite({ email, tenantId })` — gera magic link via Resend + force MFA setup no 1º acesso; admin controla revogação em `/app/settings/contador`
- [ ] Seed: ambiente homologação com emissões de cada tipo
- [ ] Testes unit + E2E cobrindo 8 tipos + 3 eventos
- [ ] **Teste E2E MFA (regra 43)**: `cancelEmission`/`issueCCe`/`inutilizeRange` sem `mfa_at` recente → `MFA_RECENT_REQUIRED` no envelope; após `requireRecentMfa()` (re-TOTP), executa OK; lint custom `high-risk-action-must-require-recent-mfa` verde em CI
- [ ] Feature flag `fiscal_focus_v1`
- [ ] **Pesquisa global** (ADR 0062): indexar `fiscal_emissions` como kind=`fiscal_emission` (label=número+tipo+destinatário, subtitle=valor+data+status, `required_permission='fiscal.read'`); permite operador achar "NFS-e 1234" direto
- [ ] ADR 0059 publicado (já accepted)

**Integração com modelo de cobrança LogiFit (ADR 0066 revisado 2026-04-25):**

- [ ] Coluna `provider text NOT NULL DEFAULT 'focus_nfe' CHECK (provider IN ('focus_nfe','nfse_nacional','enotas','mock'))` em `fiscal_emissions` — **prepara ADR 0076** sem implementar
- [ ] Job mensal `/api/jobs/aggregate-fiscal-usage-snapshot` agrega `count(*) FROM fiscal_emissions WHERE tenant_id=? AND completed_at BETWEEN ? AND ? AND status='completed' AND kind IN ('nfse','nfe','nfce','nfe_return','nfe_transfer','nfe_conserto')` no fechamento do mês e popula `tenant_usage_snapshots.fiscal_emissions_count`
- [ ] **Eventos (cancelamento, CC-e, inutilização) NÃO contam** no overage — só `fiscal_emissions` com `status='completed'` na primeira emissão
- [ ] UI `/app/settings/tenant/plan` (Sprint 04) mostra preview "Notas emitidas: X / Y inclusas; overage estimado: R$ Z"
- [ ] Teste E2E: emite 5 notas em tenant Pro com 200 inclusas → snapshot do mês registra 5; emite 250 → snapshot registra 250 e fatura calcula (50 × R$ 0,40) = R$ 20 overage

**Negociação comercial Focus NFe (pré-Sprint, externo):**

- [ ] Conversa comercial Focus NFe registrada em `docs/contratos/focus-nfe.md` com tabela negociada por volume (target: R$ 0,12/nota acima de 10k/mês)
- [ ] SLA escrito + rate limit dedicado + sandbox enterprise documentados no contrato
- [ ] Gatilho de re-negociação registrado (a cada 50% aumento de volume)

## Stretch

- [ ] Validação local dos payloads antes de enviar ao Focus (reduz rejeições)
- [ ] Dashboard de reconciliação fiscal: NFS-e emitidas vs `invoices` pagas (detecta gaps)
- [ ] Provider alternativo `enotas.ts` como fallback ou escolha do tenant
- [ ] Modo contingência MOC (SEFAZ offline) com re-envio automático
- [ ] **Preparação para NFS-e Nacional (ADR 0076)** — sem implementar, apenas:
  - Documentar pontos de plug-in do `FiscalProvider` para futuro adapter `nfse-nacional.ts`
  - Anotar requisitos de roteamento (`pickNfseProvider(emission)`) em `packages/ai/fiscal/routing/README.md`
  - Tabela `nfse_nacional_municipalities` deferida ao Sprint 36c quando gatilhos de ADR 0076 forem atingidos

## Log

- **2026-07-19 — 36b.1 (core provider real) entregue:**
  - `FocusNfeProvider` real em `packages/ai/src/fiscal/focus-nfe.ts` — safeFetch (regra 37) com allowlist `api.focusnfe.com.br` + `homologacao.focusnfe.com.br`, Basic auth, refs determinísticas `lf-{kind}-{cnpj}-{serie}-{numero}` (Focus deduplica por ref = idempotência de emissão), mapeamento de status Focus → canônico, erros tipados (429 `FiscalProviderRateLimitError` / 401-403 `FiscalProviderAuthError` / 5xx-timeout `FiscalProviderUnavailableError`; 400/422 vira `rejected` — resultado de negócio, não exceção). 16 unit tests com fetch injetável.
  - Payload builders puros em `emissions/` — `buildNfsePayload` (prestador/tomador/servico, centavos→decimal, bp→percent), `buildNfePayload` (cobre os 6 kinds modelo 55 via natureza+finNFe+CFOP+notas_referenciadas; tax defaults Simples CSOSN 102 substituíveis), `buildNfcePayload` (formas_pagamento obrigatórias, CPF opcional). 13 unit tests.
  - Interface `FiscalProvider` estendida: `emitNfce` + `kind` em `CancellationInput`/`queryStatus` (roteamento de recurso por tipo). Mock atualizado.
  - Crypto columnar `encryptSecretParts`/`decryptSecretParts` em `@repo/security` (AES-256-GCM, formato 3 colunas de `fiscal_provider_credentials`). 5 unit tests.
  - `resolveFiscalProvider(tenantId)` em `apps/web/app/lib/fiscal-provider.ts` — decifra credentials, instancia provider real; **mock bloqueado em produção** (FORBIDDEN sem credentials, FORBIDDEN com env homologação em prod). Substitui o mock fixo nas 5 SAs.
  - CRUD de credenciais no wizard `/app/settings/fiscal` — token write-only (nunca ecoado), webhook secret gerado no client e exibido uma única vez com a URL de callback, botão "Testar conexão" via `healthCheck()`. Gate `fiscal.admin`.
  - Webhook `POST /api/fiscal/focus-nfe/callback` — token na URL verificado timingSafeEqual contra secret cifrado, idempotente (replay converge), sem downgrade de status (completed nunca volta pra processing; cancelled terminal), 401 uniforme sem vazar existência de ref.
  - Feature flag `fiscal_focus_v1` (migration `0054_fiscal_focus_flag.sql`, disabled por default) + gate nas 6 SAs de emissão/evento (leitura livre).
  - **Gap 36a corrigido:** permissions `fiscal.read/emit/cancel/admin` nunca tinham sido seedadas (RLS referenciava catálogo vazio) — seed + grants (tenant_owner/gerente tudo; contador_externo read; super_admin tudo) na mesma migration 0054.
  - **Bug 37b corrigido:** `requirePermission(session.user.id, ...)` passava o id BetterAuth; `has_permission()` resolve `users.id` LogiFit — todas as SAs de apuração retornavam FORBIDDEN pra qualquer usuário. Corrigido pra `session.logifit.userId` (apuração + credenciais) + docstring de alerta em `permissions.ts`.
  - Validado E2E em dev: salvar credenciais → row cifrada (nonce 12B/tag 16B) → secret one-time na UI → webhook 401 com token inválido. 438 tests verdes nos pacotes tocados (234 @repo/ai + 204 @repo/security); typecheck + biome limpos.
- **2026-07-19 — 36b.2 (lookup real + detalhe) entregue:**
  - `resolveCompanyFiscal(tenantId, companyId)` — CNPJ real via `companies.person_id → persons.document` (regra 22) + inscrição municipal; lança VALIDATION_ERROR se company sem CNPJ de 14 dígitos. Consumido por `emitNfseFromInvoice` + `inutilizeRange` (placeholders `00000000000000` eliminados).
  - `resolveServiceCatalog(...)` — serviço tributável do `fiscal_service_catalog` (id explícito do operador ou primeiro ativo da company); NFS-e agora usa `municipality_code`/`lc116_code`/`cnae`/`iss_rate_bp`/`description` reais do catálogo; erro claro se catálogo vazio ("configure em Configurações → Fiscal"). Tomador sem CPF/CNPJ também bloqueia com mensagem acionável.
  - `NfseEmissionInput` ganhou `inscricaoMunicipal` + `issRetido` (provider repassa ao builder).
  - Rota `/app/fiscal/[id]` (o inbox já linkava): detalhe completo (badge de status color-coded, valor BRL, chave, ref+provider, origem polimórfica, timestamps, janela de cancelamento) + banner de rejeição com contador de retry + lista de eventos fiscais + `<EmissionActions>` client com ações condicionais (cancelar se janela aberta; CC-e só modelo 55; retry se rejected e retry_count<3; re-consultar se providerRef) e prompt dialog regra 45 (sem window.prompt) pra justificativa/correção com mínimo 15 chars.
  - Validado E2E em dev: emissão de teste → página renderiza tudo → dialog de cancelamento → SA responde `MFA_RECENT_REQUIRED` (regra 43 íntegra pra sessão magic-link sem MFA) e erro aparece inline na UI.
- **2026-07-19 — 36b.3 (CRUD catálogo de serviços) entregue:**
  - Rota `/app/settings/fiscal/catalogo` (Step 2 do wizard linka): form de criação/edição (empresa emitente via dropdown, descrição, código IBGE 7 dígitos validado, item LC 116 formato X.YY, CNAE normalizado pra dígitos, regime tributário, alíquota ISS em % na UI ↔ basis points no banco com range 2-5% LC 116 art. 8-A) + tabela com editar/desativar/reativar.
  - 3 SAs em `catalogo/actions.ts` (`listServiceCatalog`/`saveServiceCatalogItem`/`toggleServiceCatalogItem`) — gate `fiscal.admin`, company validada contra o tenant além da RLS, **sem DELETE físico** (desativar preserva histórico de emissões que referenciam o serviço).
  - Validado E2E em dev: cadastro "Mensalidade academia" (3550308 · 8.02 · CNAE 8591100 · 2,00%) → aparece na tabela → desativar/reativar → row conferida no banco. Com isso o fluxo NFS-e completo destrava (resolveServiceCatalog encontra o serviço).
- **2026-07-19 — 36b.4 (NFS-e avulsa + permissions nas SAs) entregue:**
  - **Descoberta de escopo:** emissão a partir de venda (NF-e produto/NFC-e) está **bloqueada por dependência** — não existe tabela de vendas/POS com itens no schema (Sprint 24 entregou estoque; `nfe_returns` está anotado como "Sprint 15b" e nunca nasceu). Registrado pra decisão de roadmap.
  - SA `emitNfseManual` — emissão avulsa (caso de uso Solo: consulta/sessão sem invoice): company + serviço do catálogo + tomador digitado (CPF/CNPJ validado) + valor + observações; sourceKind='manual'; reusa resolveCompanyFiscal/resolveServiceCatalog/reserveNextNumero.
  - Form `/app/fiscal/emitir/nfse` — dropdown de empresa → serviços filtrados por company (com LC 116 + ISS% no label), tomador, valor em R$ (→ centavos na borda), observações; sucesso redireciona pro detalhe `/app/fiscal/[id]`; aviso com link pro catálogo quando não há serviço ativo. Botão `+ Emitir NFS-e` no header do inbox.
  - **Permissions RBAC aplicadas às SAs fiscais** (catálogo seedado no 36b.1 agora enforced): `fiscal.emit` em emitNfseFromInvoice/emitNfseManual/retryEmission; `fiscal.cancel` em cancelEmission/issueCce/inutilizeRange (além do MFA recente regra 43).
  - Validado E2E em dev (flag ligada + credencial inativa → mock): form → emissão autorizada série 1 nº 2 com chave + redirect pro detalhe. Bônus de validação: colisão de numeração com emissão de teste manual produziu gap de numeração — cenário real que a inutilização (já implementada) cobre.
- **2026-07-19 — 36b.5 (design system + download PDF/XML) entregue:**
  - **Fix regra 44 (cross-sprint):** primitivos `.ev-*` portados do protótipo pro app — `packages/ui/src/base.css` novo (botões/cards/badges/inputs/tabelas/banner/toast/modal/utilities + headings) + aliases de tokens semânticos em `tokens.css` (`--ev-space-xs..xl`, `--ev-fg`, `--ev-info-bg`, etc). Todas as telas staff renderizavam sem formatação desde o Sprint 07 (só tokens tinham sido portados). Modificadores em duas grafias (BEM `--mod` + traço simples). Commit `3eb370e`.
  - `downloadFiscalFile(tenantId, path)` em `lib/fiscal-provider.ts` — busca PDF/XML no host Focus com Basic auth do token decifrado via safeFetch (paths `caminho_danfe`/`caminho_xml_nota_fiscal` são relativos e autenticados).
  - Route `GET /api/fiscal/emissions/[id]/{pdf|xml}` — sessão + `fiscal.read`, streaming com Content-Disposition + cache privado 10min (TTL do sprint doc); 404 acionável pra emissões mock; 400 pra asset inválido; 502 se provider cair.
  - SAs de emissão + queryStatus agora persistem `xml_storage_path`/`pdf_storage_path` (antes só o webhook populava).
  - Botões ⬇ PDF / ⬇ XML no header do detalhe quando os paths existem.
  - Validado E2E dev: emissão nº 3 via form → botões visíveis → endpoint responde 404 mock-aware / 400 asset inválido.
  - **Gap adicional registrado:** `tenant_usage_snapshots` (ADR 0066 — Sprint 04 deveria ter criado) não existe; job `aggregate-fiscal-usage-snapshot` bloqueado até o schema de billing nascer.
- **2026-07-19 — 36b.6 (portal contador fase 1 + palette fiscal) entregue:**
  - Layout `/app/contador` próprio: **banner obrigatório "leitura somente — dados fiscais e financeiros; sem acesso clínico"** (ADR 0061) + nav enxuta (Visão geral / Notas emitidas) + gate `fiscal.read` com redirect.
  - Dashboard do contador (página do Sprint 01b) ganhou seção **Emissões fiscais do mês** (emitidas/autorizadas/valor autorizado agregados) + links pra lista de notas e apuração mensal.
  - `/app/contador/fiscal-emissions` — lista read-only de até 500 notas com filtros (período 30/90/365d, tipo, status), chave truncada e **download individual PDF/XML** via route 36b.5 (contador tem `fiscal.read`). Zero ações de escrita.
  - Command Palette: 5 rotas fiscais + portal contador + ação "Emitir NFS-e avulsa" adicionadas à lista canônica.
  - **Gap registrado (ADR 0062/regra 30):** tabela `search_index` nunca foi criada — o palette do Sprint 07 é lista estática; FTS de pessoas/members/emissões continua pendente de infra (Faixa D do Sprint 07 fantasma).
  - Validado E2E dev: banner + KPIs fiscais reais (3 notas, R$ 569,00) + lista com filtros + botões PDF/XML só onde há arquivo.
  - **36b.7/c restante:** fontes de emissão pendentes de schema (venda/POS → decidir sprint que cria `sales`; `nfe_returns` 15b; conserto via equipment_maintenance; transferência via intercompany) + person picker no form avulso + cbos-cnae-resolver + PDF/XML URL assinada TTL 10min + IP allowlist runbook + portal contador + job usage snapshot + E2E Focus sandbox + negociação comercial. (`emitNfeProductFromSale`/`emitNfce` POS/`emitNfeReturn`/`emitNfeTransfer`/conserto/self-entry) + lookup real de company (CNPJ/município nas SAs — hoje placeholder) + cbos-cnae-resolver + CRUD catálogo de serviços + `/app/fiscal/[id]` detalhe + PDF/XML TTL 10min + portal contador + `/app/fiscal/retencoes` + job aggregate-fiscal-usage-snapshot + cron validate-credentials + IP allowlist runbook + E2E Focus sandbox + negociação comercial.

## Definition of Done

- [ ] Feature flag `fiscal_focus_v1` ligada em dev + homologação
- [ ] Sandbox Focus NFe funcional com todos os 8 tipos emitidos
- [ ] XML/PDF servidos via URL assinada TTL 10min
- [ ] Retry de erro transient funcionando
- [ ] Webhook idempotente testado com replays
- [ ] Migrations aplicadas
- [ ] RLS verificada (certificado nunca exposto a usuário sem `fiscal.admin`)
- [ ] CHANGELOG atualizado
- [ ] Roadmap: sprint 36 → `done`
- [ ] ADR 0059 referenciado nas entregas

## Retro

- —
