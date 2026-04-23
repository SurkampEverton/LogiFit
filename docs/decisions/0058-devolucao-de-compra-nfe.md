# ADR 0058 — Devolução de compra: registro interno + emissão integrada

- **Status:** Accepted
- **Date:** 2026-04-23

## Context

Depois que o tenant recebe uma NF-e de compra (ADR 0056) e manifesta (ADR 0057), pode precisar **devolver** a mercadoria ao fornecedor:

- Equipamento defeituoso (esteira com motor falhando, ultrassom sem calibrar)
- Mercadoria errada (vieram pesos de 10kg em vez de 5kg)
- Excesso de quantidade (fornecedor enviou 100, pedido era 50)
- Descumprimento de prazo / especificação

**Devolução ≠ Manifestação "Não Realizada"**:
- **Não Realizada (210240)** = a operação **não aconteceu** (carga cancelada antes da entrega)
- **Devolução (finNFe=4)** = a operação **aconteceu**, a mercadoria foi recebida, e agora é emitida **uma NF nova saindo** devolvendo

O ciclo fiscal de devolução é:

1. Tenant recebe NF-e de compra → confirma manifestação
2. Descobre problema na mercadoria
3. Emite **NF-e de devolução** (`finNFe=4`, CFOP 5.202/6.202/5.208/6.208) com `refNFe` apontando para chave original
4. Imposto espelha o da entrada (mesma base, mesmo CST); gera crédito/débito de ICMS simétrico
5. Fornecedor recebe a devolução, processa crédito, emite NF-e de retorno ou ajuste

Hoje LogiFit **não tem nenhum fluxo de devolução**. Operador teria que fazer fora do sistema e reconciliar manualmente — gap concreto para tenants que compram mercadoria (academia com suplementos/equipamentos, fisio com equipamentos).

Duas dimensões independentes:
- **Registro interno** (controle do tenant) — quais devoluções estão em andamento, motivo, status
- **Emissão fiscal da NF-e** (ato SEFAZ) — complexidade tributária que queremos delegar a provider

## Decision

Cobertura **em duas camadas** entregues em sprints diferentes:

### Camada 1 — Registro interno de devolução (Sprint 17)

Entra junto com manifestação, pequeno custo marginal:

```sql
nfe_returns
  id uuid pk
  tenant_id uuid not null              -- RLS
  company_id uuid not null
  nfe_received_id uuid not null fk nfe_received  -- NF original
  kind text not null                   -- enum: 'total', 'partial'
  items jsonb nullable                 -- quais itens e quantidades (null se total)
                                       -- shape: [{ item_index, quantity_returned, value_cents }]
  return_amount_cents bigint not null
  reason_category text not null        -- enum: 'defeito','divergencia_quantidade',
                                       --  'divergencia_especificacao','atraso',
                                       --  'cancelamento','outro'
  reason_description text not null     -- texto livre ≥20 chars, obrigatório
  status text not null default 'draft'
    -- enum: 'draft','awaiting_external_emission','emitted','confirmed_by_supplier',
    --        'rejected_by_supplier','cancelled'
  external_chave text nullable         -- chave da NF-e de devolução emitida
  external_xml_storage_path text nullable  -- XML importado de volta
  external_issue_date date nullable
  emitted_at timestamptz nullable
  emission_mode text nullable          -- enum: 'external_import','focus_nfe'
  created_by_user_id uuid not null
  created_at timestamptz default now()
  updated_at timestamptz
```

**Ciclo de estados:**

```
draft (criado)
  ↓ [gerar PDF controle]
awaiting_external_emission
  ↓ [operador emite no Focus NFe externo ou no sistema do contador]
  ↓ [importa XML emitido via Upload XML da inbox]
emitted (chave vinculada)
  ↓ [fornecedor aceita / emite NF de retorno ou ajuste]
confirmed_by_supplier  OR  rejected_by_supplier
```

**UI na inbox `/app/financeiro/nfe`** — linha da NF recebida ganha ação `[🔄 Devolver]`:

```
Modal "Devolver NF":
  Tipo:       ○ Total     ○ Parcial
  Itens:      [seleção de itens + quantidade quando parcial]
  Categoria:  Defeito ▾
  Motivo:     [textarea min 20 chars]
  
  [Gerar PDF controle]  [Salvar como rascunho]  [Criar e emitir externamente]
```

**Server Actions (Sprint 17):**
- `createNfeReturn(nfeReceivedId, input)` — cria em `draft`
- `markReturnAwaitingEmission(returnId)` — após gerar PDF
- `linkEmittedReturnXml(returnId, xmlContent)` — import do XML emitido externamente; valida `refNFe = chave original`
- `markReturnConfirmed(returnId)` / `markReturnRejected(returnId, reason)` — após fornecedor processar
- `cancelReturn(returnId, reason)` — cancelamento antes de emitir

**Dashboard:** card "Devoluções pendentes" em `/app/dashboard/gerente` segmentado por status; alerta quando devolução fica em `awaiting_external_emission` > 7 dias (fornecedor espera agilidade).

### Camada 2 — Emissão automática via Focus NFe (Sprint 36)

Quando Sprint 36 entregar integração Focus NFe (ADR 0059), botão `[Emitir via Focus]` aparece na tela de devolução:

- Sistema monta payload: `finNFe=4`, `refNFe=chave_original`, CFOP espelhado (5.202/6.202 etc.), items do `nfe_returns.items`, impostos copiados da NF original
- Focus NFe calcula tributação correta por UF + assina + transmite SEFAZ
- Retorna chave da devolução + XML assinado
- `nfe_returns.status → emitted`, `emission_mode='focus_nfe'`, `external_chave` preenchido

Tenant pode optar por `external_import` (manual via contador) OU `focus_nfe` (automático, pago por NF emitida).

### Integração com estoque (Sprint 24)

Quando `nfe_returns.status = 'emitted'` ou `'confirmed_by_supplier'`, baixa do estoque os itens devolvidos — se Sprint 24 já estiver ativo. Se não, só registro financeiro.

### Integração com financeiro

- **Devolução total:** AP associada (caso já paga) gera `accounts_receivable` (fornecedor deve o valor); caso não paga, cancela AP
- **Devolução parcial:** reduz valor da AP original OU cria AR pelo excedente se já paga
- Lógica em `packages/db/erp-financeiro/return-reconciler.ts` — testes unit cobrem total/parcial/já-paga/não-paga

## Consequences

### Positivas

- **Fluxo fiscal completo** sem expor o LogiFit a cálculo tributário (delegado ao Focus NFe)
- **Registro auditável** mesmo quando emissão é externa — operador importa o XML de volta
- **Gradação** — tenant pequeno faz emissão externa; tenant grande usa Focus NFe automático
- **Integra com estoque e financeiro** — devolução não fica órfã

### Negativas (mitigáveis)

- **Atrito de fluxo externo** — operador precisa ir e voltar do sistema do contador; mitigado por PDF de controle bem estruturado + import de XML simples
- **Risco de desalinhamento** — operador esquece de importar XML da emitida; mitigado por job diário que alerta admin de devoluções `awaiting_external_emission` > 7 dias
- **Devolução parcial de item composto** — se NF tem kit de 3 produtos e 1 é defeituoso, operador precisa desdobrar; UI suporta mas exige cuidado
- **Fornecedor pode rejeitar** — gestão do conflito é fora do sistema; LogiFit só registra `rejected_by_supplier` como status

### Riscos não endereçados

- **Devolução para fornecedor PF** (autônomo) — complica porque fornecedor PF não emite NF contra si; operador emite NF-e de entrada reversa (`1.202` CFOP); caso raro, fora do MVP
- **Devolução cross-UF com ICMS diferenciado** — Focus NFe cuida; se emissão externa, é problema do contador do tenant

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Apenas registro interno, sem emissão integrada | Tenant grande com muitas devoluções precisa de automação; Focus NFe cobre |
| Apenas emissão via Focus NFe (pular registro interno) | Tenant pequeno não paga Focus NFe; precisa do registro + PDF de controle |
| LogiFit emite direto no SEFAZ com certificado | Complexidade tributária altíssima; rejeitada por design (ADR 0059) |
| Marcar devolução como manifestação "Não Realizada" | Conceitualmente errado; manifestação é sobre recepção, devolução é operação nova |

## Escopo de impacto

**Novo ADR:** este (0058).

**Sprints ajustados:**
- **15** — adiciona schema `nfe_returns` (preparação; sem UI)
- **17** — entrega UI completa de registro interno + PDF controle + import XML emitido + reconciler com AP/AR + card dashboard
- **24** — integração com estoque quando devolução é `emitted`
- **36 (fiscal)** — habilita emissão via Focus NFe (ADR 0059 detalha)

**Docs:**
- `docs/modulos.md` — novo módulo "Devolução de compra (NF-e)"
- `CHANGELOG.md` — entrada desta mudança

## Related

- Depende de [ADR 0056 — Inbox unificada de NF-e](0056-nfe-inbox-unificada-e-metodos-ingestao.md)
- Complementa [ADR 0057 — Manifestação do Destinatário](0057-manifestacao-destinatario-nfe.md) (conceitos distintos)
- Habilitado pelo [ADR 0059 — Ciclo fiscal de emissão via Focus NFe](0059-ciclo-fiscal-emissao-focus-nfe.md) (para a camada automática)
