# Sprint 36 — Geral · Módulo fiscal — emissão completa via Focus NFe

- **Área:** fiscal (aplicável a todas as verticais)
- **Início:** planejado (Fase 3)
- **Fim planejado:** +4 semanas — candidato à quebra em 36a (NFS-e + eventos) + 36b (NF-e produto + NFC-e + devolução/transferência/conserto) se estourar 3 semanas (regra 9)
- **Status:** planejado (futuro)
- **Item do roadmap:** #38

## Goal

Entregar o **ciclo fiscal completo de emissão** via Focus NFe, cobrindo 8 tipos de operação (NFS-e serviço, NF-e venda produto, NFC-e varejo, NF-e devolução, NF-e transferência entre filiais, NF-e remessa/retorno conserto, NF-e de entrada própria) + 3 eventos (cancelamento, CC-e, inutilização). Implementa a [ADR 0059](../decisions/0059-ciclo-fiscal-emissao-focus-nfe.md).

## Contexto

Sprint anteriores preparam recepção (ADR 0056), manifestação (ADR 0057), devolução interna (ADR 0058) e NFs relacionadas (ADR 0060). Schemas de `fiscal_emissions`, `fiscal_events`, `fiscal_numbering_sequences` nascem no Sprint 15. Este sprint conecta tudo via provider único **Focus NFe** + UI de emissão + webhooks de callback.

Regra fundamental: **LogiFit não toca em motor tributário**. Focus NFe cuida de ICMS/IPI/PIS/COFINS/CST/CFOP/ISS por UF/município. Interface `FiscalProvider` abstrai para trocas futuras.

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

- **ADR 0059** (accepted) — Ciclo fiscal de emissão completo via Focus NFe
- **Pergunta aberta:** certificado A1 — usar da company (Sprint 17) ou Focus NFe gerencia o próprio? Começar com Focus (eles têm infra); tenant pode escolher "cert próprio" se precisar isolar.
- **Pergunta aberta:** NFC-e exige CSC (Código de Segurança do Contribuinte) por UF — configurado por company no wizard de onboarding.

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

// Eventos
cancelEmission(emissionId, justification)
issueCCe(emissionId, correction)
inutilizeRange(companyId, kind, serie, from, to, justification)

// Consulta/retry
queryEmissionStatus(emissionId)
retryEmission(emissionId)
```

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
- [ ] Feature flag `fiscal_focus_v1`
- [ ] **Pesquisa global** (ADR 0062): indexar `fiscal_emissions` como kind=`fiscal_emission` (label=número+tipo+destinatário, subtitle=valor+data+status, `required_permission='fiscal.read'`); permite operador achar "NFS-e 1234" direto
- [ ] ADR 0059 publicado (já accepted)

## Stretch

- [ ] Validação local dos payloads antes de enviar ao Focus (reduz rejeições)
- [ ] Dashboard de reconciliação fiscal: NFS-e emitidas vs `invoices` pagas (detecta gaps)
- [ ] Provider alternativo `enotas.ts` como fallback ou escolha do tenant
- [ ] Modo contingência MOC (SEFAZ offline) com re-envio automático

## Log

- —

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
