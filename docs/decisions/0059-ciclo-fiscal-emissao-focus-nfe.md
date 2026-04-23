# ADR 0059 — Ciclo fiscal de emissão completo via Focus NFe

- **Status:** Accepted
- **Date:** 2026-04-23

## Context

O roadmap listava o Sprint 36 como "Módulo fiscal Focus NFe (NFS-e por company)" — escopo estreito, focado só em emissão de **NFS-e** (nota de serviço municipal) porque o core LogiFit é serviço (academia = mensalidade, fisio = sessão, nutri = consulta).

A verificação sistemática de todas as operações NF-e contra os módulos LogiFit (feita em 2026-04-23) expôs que **7+ operações fiscais** acontecem no dia-a-dia real dos tenants e não são cobertas:

| # | Operação | Onde acontece | Módulo relacionado |
|---|---|---|---|
| 1 | **NFS-e (serviço)** | Academia emite mensalidade, fisio emite sessão, nutri emite consulta | Base do negócio (todos os sprints de faturamento) |
| 2 | **NF-e venda produto** | Academia revende suplemento, fisio revende órtese | Sprint 24 Estoque (revenda) |
| 3 | **NFC-e varejo** | Venda de balcão sem identificação do cliente | Sprint 24 POS |
| 4 | **NF-e de devolução** | Devolve equipamento defeituoso ao fornecedor | ADR 0058 |
| 5 | **NF-e de transferência entre filiais** | Matriz manda esteira para filial (cruza CNPJs) | Sprint 16 Intercompany |
| 6 | **NF-e de remessa para conserto** | Ultrassom vai para calibração do fabricante | Sprint 25 ANVISA |
| 7 | **NF-e de retorno de conserto** | Ultrassom volta calibrado | Sprint 25 ANVISA |
| 8 | **Eventos: Cancelamento / CC-e / Inutilização** | Erro na emissão; correção não-fiscal; número pulado | Todos que emitem |

Problema concreto: operador hoje precisa de **sistema do contador + planilha + ERP genérico** para qualquer dessas operações — fragmentação que o ERP integrado deveria resolver.

**Decisão estruturante: LogiFit não toca em motor tributário.** ICMS/IPI/PIS/COFINS/CST/CFOP variam por UF + produto + regime + classificação; manter tabela fiscal própria é competência distinta e exige atualização constante. Delegamos ao **Focus NFe** (provider brasileiro maduro, cobre ~5.570 municípios para NFS-e + transmissão SEFAZ nacional para NF-e + NFC-e, cobra por documento emitido). Há alternativas (eNotas, Omie, NFe.io, WebmaniaBR) mas Focus é referência de mercado.

## Decision

Ampliar escopo do **Sprint 36** de "NFS-e por company" para **"Ciclo fiscal de emissão completo via Focus NFe"**, cobrindo os 8 tipos de operação listados. Única fachada de emissão fiscal no LogiFit.

### Arquitetura

```
packages/ai/fiscal/
  provider.ts            # Interface FiscalProvider
  providers/
    focus-nfe.ts         # Implementação primária (NFS-e + NF-e + NFC-e + eventos)
    enotas.ts            # stretch futuro
    mock.ts              # Para testes
  emissions/
    nfse.ts              # Montagem de payload NFS-e (serviço)
    nfe-product.ts       # Montagem NF-e venda produto
    nfe-return.ts        # Montagem NF-e devolução (consome ADR 0058)
    nfe-transfer.ts      # Montagem NF-e transferência filial (Sprint 16)
    nfe-conserto.ts      # Montagem remessa/retorno conserto (Sprint 25)
    nfce.ts              # Montagem NFC-e varejo
  events/
    cancel.ts            # Cancelamento
    cce.ts               # Carta de correção
    inutilizacao.ts      # Inutilização de número
  resolvers/
    cfop.ts              # Mapping operação + UF origem/destino + tipo → CFOP
    cbos-cnae.ts         # Mapping serviço → CBO/CNAE (NFS-e)
```

### Interface `FiscalProvider`

```ts
interface FiscalProvider {
  readonly name: 'focus_nfe' | 'enotas' | 'mock';
  
  // Emissão de documentos
  emitNfse(input: NfseInput): Promise<EmissionResult>;       // Serviço municipal
  emitNfeProduct(input: NfeProductInput): Promise<EmissionResult>;  // Produto
  emitNfeReturn(input: NfeReturnInput): Promise<EmissionResult>;    // Devolução
  emitNfeTransfer(input: NfeTransferInput): Promise<EmissionResult>; // Transferência CNPJ
  emitNfeConserto(input: NfeConsertoInput): Promise<EmissionResult>; // Remessa/retorno
  emitNfce(input: NfceInput): Promise<EmissionResult>;       // Varejo consumidor final
  
  // Eventos
  cancel(chave: string, justification: string): Promise<EventResult>;
  correctLetter(chave: string, correction: string): Promise<EventResult>;  // CC-e
  inutilize(serie: number, numberFrom: number, numberTo: number, justification: string): Promise<EventResult>;
  
  // Consulta
  queryStatus(chave: string): Promise<DocumentStatus>;
}
```

### Tabelas de apoio

```sql
-- Emissões feitas pelo tenant (cross-document)
fiscal_emissions
  id uuid pk
  tenant_id uuid not null
  company_id uuid not null
  document_kind text not null       -- 'nfse','nfe_product','nfe_return',
                                    --  'nfe_transfer','nfe_conserto_out',
                                    --  'nfe_conserto_return','nfce'
  chave text unique nullable        -- preenchido após emissão bem-sucedida
  serie int nullable
  number int nullable
  status text not null              -- 'draft','processing','emitted',
                                    --  'rejected','cancelled','inutilizada'
  source_ref_type text nullable     -- ex: 'invoice','sale','nfe_return','transfer_order'
  source_ref_id uuid nullable       -- id do registro original
  provider text not null default 'focus_nfe'
  provider_payload_sent jsonb nullable
  provider_response jsonb nullable
  xml_storage_path text nullable
  pdf_storage_path text nullable
  emitted_at timestamptz nullable
  cancelled_at timestamptz nullable
  cancel_reason text nullable
  total_amount_cents bigint nullable
  issued_by_user_id uuid not null
  created_at timestamptz default now()

-- Eventos fiscais (cancelamento, CC-e, inutilização)
fiscal_events
  id uuid pk
  tenant_id uuid not null
  emission_id uuid nullable fk fiscal_emissions
  kind text not null                -- 'cancel','cce','inutilizacao'
  protocol text nullable
  justification text not null       -- mínimo 15 chars para cancelamento, 15 para CC-e
  payload_sent jsonb
  provider_response jsonb
  status text not null              -- 'pending','accepted','rejected'
  issued_by_user_id uuid not null
  created_at timestamptz default now()

-- Série + numeração por company + tipo (SEFAZ exige rastreio)
fiscal_numbering_sequences
  company_id uuid not null
  document_kind text not null
  serie int not null default 1
  last_number int not null default 0
  updated_at timestamptz
  primary key (company_id, document_kind, serie)

-- Catálogo de serviços tributáveis (NFS-e) por company
fiscal_service_catalog
  id uuid pk
  tenant_id uuid
  company_id uuid
  municipality_code text not null   -- IBGE
  nbs_code text nullable            -- Nomenclatura Brasileira de Serviços
  lc116_code text nullable          -- Lei Complementar 116/2003 (tipo de serviço)
  cnae text nullable
  description text not null
  tax_regime text                   -- 'simples_nacional','lucro_presumido','lucro_real'
  iss_rate_percent numeric          -- % ISS municipal
  pis_rate_percent numeric nullable
  cofins_rate_percent numeric nullable
  retention_rules jsonb nullable    -- retenção de ISS quando tomador é PJ específico
  active bool default true
```

**RLS:** tenant_id + company_id + permission (`fiscal.read`, `fiscal.emit`, `fiscal.cancel`, `fiscal.admin`).

### UI — rota `/app/fiscal`

Inbox de **emissões**, análogo à inbox de recepção (ADR 0056). Operadores vêm aqui para:

```
┌─────────────────────────────────────────────────────────────────┐
│  Emissões Fiscais                                               │
│                                                                 │
│  Filtros: [Tipo ▾] [Status ▾] [Período ▾] [Company ▾]          │
│                                                                 │
│  [+ Emitir NFS-e] [+ Emitir NF-e produto] [+ NFC-e] [+ Evento] │
├─────────────────────────────────────────────────────────────────┤
│ Kind      │ Nº  │ Valor    │ Destinatário │ Status   │ Ações    │
│ NFS-e     │ 1234│ R$   300 │ Cliente X    │ ✓ Emit.  │ PDF/XML  │
│ NF-e prod.│ 0089│ R$ 1.200 │ Cliente Y    │ ✓ Emit.  │ [CC-e]   │
│ NF-e dev. │ 0090│ R$   500 │ Fornec. Z    │ ⏳ Proc.  │ Aguardar │
│ NFC-e     │ 0091│ R$    80 │ Consumidor   │ ✓ Emit.  │ DANFE    │
│ Evento    │ —   │ —        │ NFe 0089     │ ✓ CC-e   │ —        │
└─────────────────────────────────────────────────────────────────┘
```

Cada "tipo" tem fluxo de emissão contextualizado:

- **NFS-e** — fonte: `invoices` (Sprint 04) ou `billing_guides` (Sprint 22 convênio); 1 clique converte
- **NF-e produto** — fonte: venda em POS (Sprint 24) ou ordem de venda; mostra itens do estoque
- **NF-e devolução** — fonte: `nfe_returns` (ADR 0058); 1 clique "Emitir via Focus"
- **NF-e transferência** — fonte: ordem de transferência entre filiais (Sprint 16); sistema sugere ao criar transfer
- **NF-e conserto** — fonte: `equipment_maintenance` (Sprint 25) com `kind='corretiva_externa'` ou `calibracao_externa`
- **NFC-e** — fonte: POS Sprint 24 (venda de balcão)
- **Eventos** — botão em cima de emissão existente: `[Cancelar]` / `[CC-e]`; Inutilização é tela separada para números pulados

### Server Actions

```ts
// Emissão
emitNfseFromInvoice(invoiceId): Promise<fiscal_emissions.id>
emitNfseFromBillingGuide(guideId): Promise<id>
emitNfeProductFromSale(saleId): Promise<id>
emitNfeReturn(nfeReturnId): Promise<id>       // Consome ADR 0058
emitNfeTransfer(transferId): Promise<id>       // Consome Sprint 16
emitNfeConsertoOut(maintenanceId): Promise<id>
emitNfeConsertoReturn(maintenanceId): Promise<id>  // Quando equipamento volta
emitNfce(saleId): Promise<id>

// Eventos
cancelEmission(emissionId, justification): Promise<fiscal_events.id>
issueCCe(emissionId, correction): Promise<id>
inutilizeRange(companyId, kind, serie, from, to, justification): Promise<id>

// Consulta/reconciliação
queryEmissionStatus(emissionId)      // Pergunta ao Focus
retryEmission(emissionId)            // Em caso de erro transient
```

### Webhooks

Focus NFe envia callbacks quando documento sai do processamento:

```
POST /api/fiscal/focus-nfe/callback
  — valida HMAC (idempotência via Sprint 04 webhook pattern)
  — atualiza fiscal_emissions.status + preenche chave/xml/pdf paths
  — emite domain event 'fiscal.emission.completed' ou '.rejected'
```

### Eventos de domínio

```
fiscal.emission.created (draft)
fiscal.emission.queued (enviado ao Focus)
fiscal.emission.completed (chave recebida)
fiscal.emission.rejected (erro na transmissão)
fiscal.emission.cancelled
fiscal.event.cce_issued
fiscal.event.inutilizacao_issued
```

Consumidores:
- `accounts_receivable` (Sprint 15) — NFS-e emitida pode gerar AR se tomador paga em boleto separado
- `invoices` (Sprint 04) — quando invoice vira NFS-e, marca `invoice.nfse_chave` para rastreabilidade
- Dashboard gerente — card "Emissões com erro" alerta

## Consequences

### Positivas

- **Single source of truth fiscal** — toda emissão passa por `fiscal_emissions`
- **Zero motor tributário** no LogiFit — Focus cuida de ICMS/ISS/PIS/COFINS/CFOP por UF/município
- **Cobertura nacional NFS-e** — Focus suporta ~5.570 municípios; tenant em qualquer cidade funciona
- **Provider abstrato** — troca futura (eNotas, WebmaniaBR) sem refactor da aplicação
- **Ciclo fiscal fechado** — recepção (ADR 0056) + manifestação (ADR 0057) + devolução (ADR 0058) + emissão (este) compõem ERP fiscal completo

### Negativas (mitigáveis)

- **Custo por documento** (~R$ 0,10-0,50 por NF emitida conforme Focus) — repassado ao tenant no plano; transparente no pricing
- **Dependência externa** — Focus NFe fica off-line, emissão para; mitigado por fila `fiscal_emissions` com retry automático + Focus tem SLA de 99.5%
- **Complexidade dos payloads** — cada tipo (NFS-e/NFe/NFC-e) tem schema distinto; encapsulado em `emissions/*.ts`
- **Cadastro inicial pesado** — tenant precisa configurar: certificado A1 por company (Sprint 17 já cadastra), credenciais Focus, regime tributário, catálogo de serviços tributáveis, série + numeração. Wizard de onboarding em `/app/settings/fiscal` reduz atrito.
- **CT-e / MDF-e** — não cobertos neste ADR; se tenant precisar (caso raro em saúde), ADR próprio

### Riscos não endereçados

- **Rejeição por erro de cadastro** — NCM errado, CBO errado, ISS fora da alíquota correta → Focus rejeita; UI mostra erro bruto para operador corrigir. Validação local antes de enviar é stretch.
- **Emissão em contingência (SEFAZ offline)** — Focus NFe tem modo MOC; repassamos estado ao UI
- **Substituição tributária (ST)** e regimes especiais (drawback, suspensão) — Focus cobre; configuração avançada em `fiscal_service_catalog`; pode exigir consultor externo no onboarding

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| LogiFit emite direto SEFAZ com certificado A1 próprio | Complexidade tributária + manutenção tabela fiscal por UF é competência inteira; rejeitada |
| Manter escopo "só NFS-e" no Sprint 36 | 7 operações reais ficariam órfãs; tenant precisa ir e voltar de sistema do contador |
| Vários provedores fiscais paralelos (Focus + eNotas + NFe.io simultâneos) | Multiplica complexidade; Focus é suficiente; abstração permite troca futura |
| Motor próprio com consultor terceirizando tabela fiscal | Custo operacional contínuo + risco regulatório; delegar para quem é especialista é mais barato |
| Adiar emissão completa para Fase 4 | Tenants do Sprint 04 em diante já precisam emitir NFS-e da mensalidade; sem isso, sistema não fecha |

## Escopo de impacto

**Novo ADR:** este (0059).

**Sprints ajustados:**
- **36** — renomeado de "Módulo fiscal Focus NFe (NFS-e por company)" para "**Módulo fiscal — emissão completa via Focus NFe**"; escopo expande para NFS-e + NF-e produto + NFC-e + devolução + transferência + remessa conserto + eventos
- **04** — `invoices` ganha coluna `nfse_chave text nullable` para linkar emissão fiscal
- **15** — preparação de `fiscal_emissions`, `fiscal_events`, `fiscal_numbering_sequences` (schema; sem UI no 15)
- **16** — quando transferência entre filiais (CNPJs diferentes) é criada, oferece emitir NF-e via Focus (Sprint 36 habilita)
- **22** — `billing_guides` pagos de convênio geram NFS-e automática (Sprint 36)
- **24** — POS gera NFC-e automática na venda; revenda pode gerar NF-e produto
- **25** — quando `equipment_maintenance.external_location=true`, oferece emitir NF-e de remessa conserto e retorno (Sprint 36)

**Docs:**
- `docs/modulos.md` — novo bloco "Emissão Fiscal" com 8 operações cobertas
- `docs/roadmap.md` — Sprint 36 escopo atualizado
- `CHANGELOG.md` — entrada desta mudança
- `CLAUDE.md` — Focus NFe confirmado como provider fiscal oficial

## Related

- Fundamenta o [Sprint 36 — Módulo fiscal](../sprints/36-geral-fiscal-focus-nfe.md) (criado por este ADR)
- Habilita a camada 2 do [ADR 0058 — Devolução de compra](0058-devolucao-de-compra-nfe.md)
- Espelha arquitetura de provider abstrato dos ADRs 0035 (OCR), 0038 (NFe recepção), 0048 (CNPJ), 0050 (pipeline exames)
- Fonte: documentação Focus NFe (https://focusnfe.com.br/doc/) + NT 2013/005 SEFAZ (NFC-e) + NT 2011/004 SEFAZ (CC-e) + RTC 1.400/2016 ABRASF (NFS-e)
