# ADR 0060 — Tratamento avançado de recepção NF-e (NFs relacionadas + finalidades + entrada própria)

- **Status:** Accepted
- **Date:** 2026-04-23

## Context

Inbox de recepção do ADR 0056 trata toda NF recebida como evento independente: uma linha por NF em `nfe_received`, sem conhecer relações entre notas. Essa simplificação funciona para a maioria dos casos (compra normal), mas quebra em 4 cenários reais:

1. **Devolução de venda recebida** — tenant emitiu NF-e de venda ao cliente A; cliente A devolveu a mercadoria e emitiu NF-e de devolução de volta; esta chega na inbox sem ligação com a venda original no LogiFit
2. **NF complementar** — fornecedor corrige valor/imposto de uma NF emitida anteriormente; sem linkar, operador contabiliza em duplicidade no DRE
3. **NF de ajuste** (`finNFe=3`) — regularização contábil sem movimento físico; precisa diferenciada das normais
4. **NF-e de entrada** (emitida pelo próprio tenant) — quando compra de PF/produtor rural sem inscrição, tenant emite a NF da compra contra si mesmo (`finNFe=1` CFOP 1.917 por exemplo); chega no sistema pelo lado da recepção mas foi emitida pelo Focus NFe (Sprint 36)

Hoje `nfe_received` tem só `source` e `status`; `raw_payload` guarda XML bruto mas não expõe metadados relevantes.

Verificação sistemática (2026-04-23) mostrou que esses 4 cenários acontecem no dia-a-dia e exigem tratamento específico.

## Decision

Ampliar `nfe_received` com metadados do XML + estabelecer **relações entre NFs** via FK self-referencing + diferenciar NFs emitidas pelo próprio tenant.

### Colunas adicionadas em `nfe_received`

```sql
nfe_received
  ...
  -- ADR 0060:
  finality text not null default 'normal'
    -- enum extraído do XML:
    -- 'normal' (finNFe=1), 'complementar' (finNFe=2),
    -- 'ajuste' (finNFe=3), 'devolucao' (finNFe=4)
  cfop_primary text nullable        -- CFOP predominante (1º item ou mais representativo)
  related_nfe_id uuid nullable fk nfe_received
    -- link para NF "pai" quando há refNFe no XML:
    -- devolução → NF de venda original
    -- complementar → NF que está sendo complementada
    -- ajuste → NF que está sendo ajustada
  related_chave text nullable        -- chave original extraída do refNFe (cache)
  is_self_issued_entry bool default false
    -- true quando foi emitida pelo próprio tenant via Focus NFe e
    -- entra na inbox de recepção (NF-e de entrada, CFOP 1.xxx)
  self_issue_emission_id uuid nullable fk fiscal_emissions
    -- quando is_self_issued_entry=true, aponta para registro em fiscal_emissions
  inbound_direction text not null default 'purchase'
    -- enum: 'purchase' (compra normal), 'sales_return' (devolução de venda),
    --       'complement_received' (complementar recebida),
    --       'adjustment_received' (ajuste recebido),
    --       'self_entry' (NF-e de entrada emitida pelo próprio tenant)
```

### Resolução automática no parser

Ao parsear XML (no Sprint 15) ou receber via provider (Sprint 17), extrair:

1. **`finNFe`** do XML → preenche `finality`
2. **CFOP do 1º item** → preenche `cfop_primary`
3. **`refNFe`** (referência a NF anterior) → busca `nfe_received` do mesmo tenant com `chave = refNFe`:
   - Se encontra → popula `related_nfe_id` e `related_chave`
   - Se não encontra → só popula `related_chave` (orphan link; pode resolver depois se a original chegar)
4. **Emitente igual ao destinatário** (CNPJ da company emitente = CNPJ da company destinatária) → `is_self_issued_entry = true`
5. **CFOP + finalidade** determinam `inbound_direction`:
   - `finNFe=4` + CFOP 1.2xx → `sales_return`
   - `finNFe=2` → `complement_received`
   - `finNFe=3` → `adjustment_received`
   - `is_self_issued_entry=true` → `self_entry`
   - resto → `purchase`

### UI na inbox — badges contextuais

Cada linha ganha prefixo visual quando não é compra comum:

```
│ Status │ Origem │ Contexto         │ Fornecedor/Ref  │ Valor    │ Ações      │
│ ○ Nova │ auto   │ —                │ Fornec. X       │ R$ 1.234 │ Converter  │
│ ✓ AP   │ chave  │ 🔄 Dev. venda #89│ Cliente A       │ R$   500 │ [Ver link] │
│ ○ Nova │ auto   │ ➕ Complem. NF 88│ Fornec. Y       │ R$    50 │ [Ver link] │
│ ✓ AP   │ auto   │ 🔧 Ajuste NF 75  │ Fornec. Z       │ R$     0 │ [Ver link] │
│ ○ Nova │ auto   │ 📤 NF-e própria  │ (emitida aqui)  │ R$   120 │ Converter  │
```

Clicar no "Ver link" abre a NF relacionada na mesma inbox (ou a emissão original em `fiscal_emissions` para NFs próprias).

Filtro novo na inbox: **Tipo** (`Normal`, `Complementar`, `Ajuste`, `Devolução`, `Entrada própria`).

### Impacto em cada cenário

#### 1. Devolução de venda recebida

- NF-e de venda emitida via Focus NFe (Sprint 36) → `fiscal_emissions` registra chave
- Cliente devolve → NF-e de devolução chega na inbox
- Parser vê `finNFe=4` + `refNFe = chave da venda` → resolve `related_nfe_id` apontando para outra linha em `nfe_received` (se a devolução também foi cadastrada ali) OU para `fiscal_emissions` via coluna adicional `related_self_emission_id`
- Conversão para AP/AR: **estorna** `accounts_receivable` da venda original
- Dashboard alerta "Devolução recebida de venda #89"

#### 2. Complementar recebida

- Fornecedor emite NF complementar → `finNFe=2` + `refNFe = chave da NF original`
- Parser resolve link
- Ao converter em AP: **soma** ao AP existente (não cria AP duplicada); atualiza `accounts_payable.amount_cents`
- Auditoria: event `nfe.complement.merged`

#### 3. Ajuste recebido

- Fornecedor emite NF de ajuste (`finNFe=3`) — regularização sem movimento físico
- Parser detecta e marca `adjustment_received`
- **Não** cria AP nova (não há valor a pagar — é só ajuste contábil); linka à original para rastro
- Opcional: admin decide se reflete no DRE (depende da natureza do ajuste)

#### 4. NF-e de entrada própria (comprador emite)

- Tenant compra de PF sem inscrição ou produtor rural
- Via Sprint 36 (`emitNfeSelfEntry`), emite NF-e com `emit.CNPJ = dest.CNPJ = próprio tenant`
- Focus NFe emite; XML assinado volta
- Linha em `fiscal_emissions` com `document_kind='nfe_self_entry'`
- **Também** entra em `nfe_received` com `is_self_issued_entry=true`, `inbound_direction='self_entry'`, `self_issue_emission_id` apontando para `fiscal_emissions.id`
- Fluxo de AP normal a partir daí

### Job de resolução retroativa

Quando nova NF entra na inbox, ela pode ser **pai** de linhas antigas que chegaram antes:

```sql
-- Pseudocódigo: após inserir NF nova, buscar órfãs:
UPDATE nfe_received
SET related_nfe_id = <id_da_nova>
WHERE related_chave = <chave_da_nova>
  AND related_nfe_id IS NULL
  AND tenant_id = <tenant>
```

Job noturno `nfe-resolve-orphan-links` varre linhas com `related_chave NOT NULL AND related_nfe_id IS NULL` e tenta reresolver.

### Eventos de domínio

```
nfe.received.complement_linked — {complement_chave, original_chave}
nfe.received.sales_return_linked
nfe.received.adjustment_linked
nfe.received.self_entry_imported
nfe.received.orphan_link_resolved — {chave, resolved_at}
```

## Consequences

### Positivas

- **DRE correto** — complementares não contam em duplicata
- **Auditoria fiscal rastreável** — toda NF recebida tem origem clara; devoluções linkam venda original
- **Entrada própria integrada** — NF-e de entrada não vira cadastro manual errado
- **Inbox continua única** — ADR 0056 preservado; mais inteligência, não mais tabelas
- **Link orphan** — sistema resiliente a ordem de chegada (original pode vir depois da devolução)

### Negativas (mitigáveis)

- **Parser fica mais complexo** — extrai 5 campos a mais do XML; testes unit cobrem 10+ casos (NF normal, devolução, complementar, ajuste, self-entry, órfã, cfop múltiplo, etc.)
- **Schema cresce** — 6 colunas novas em `nfe_received`; migração fácil
- **Ambiguidade de CFOP múltiplo** — NF com itens de CFOPs diferentes; decidimos usar o "predominante" (1º item ou maior valor); aceita simplificação

### Riscos não endereçados

- **NF-e com múltiplas referências (`refNFe`)** — raro; usamos a primeira ref
- **refNFe apontando para NF de OUTRO tenant** — não resolvemos link cross-tenant (isolamento RLS); só grava `related_chave` sem `related_nfe_id`
- **NF-e que chega antes da venda ser registrada** — `fiscal_emissions` pode não ter a chave ainda; orphan link resolve quando emissão completa

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Tabela separada `nfe_relationships` | Over-engineering; FK self-referencing é suficiente |
| Ignorar finalidade e tratar tudo como compra | Quebra DRE; complementares viram duplicação; devoluções ficam órfãs |
| Apenas detectar no parser sem persistir | Perde auditoria; UI precisa do dado persistido para mostrar badges sem reparsear |
| Criar tabela `sales_returns_received` espelho de `nfe_returns` | Nome confunde; uma linha só em `nfe_received` com `inbound_direction='sales_return'` e link para `fiscal_emissions` é mais limpo |

## Escopo de impacto

**Novo ADR:** este (0060).

**Sprints ajustados:**
- **15** — parser NF-e estende para extrair `finNFe`, CFOP primário, `refNFe`; adiciona colunas em `nfe_received`
- **17** — UI da inbox mostra badge contextual + filtro por tipo + ação "Ver link" que navega para NF original; job `nfe-resolve-orphan-links`
- **36** — emissão via Focus NFe também popula `nfe_received` para NF-e de entrada própria (`emitNfeSelfEntry`)

**Docs:**
- `docs/modulos.md` — atualizar descrição de "Inbox unificada" mencionando NFs relacionadas
- `CHANGELOG.md` — entrada desta mudança

## Related

- Estende [ADR 0056 — Inbox unificada de NF-e](0056-nfe-inbox-unificada-e-metodos-ingestao.md)
- Complementa [ADR 0057 — Manifestação](0057-manifestacao-destinatario-nfe.md) (conceitos fiscais adjacentes)
- Integra com [ADR 0058 — Devolução de compra](0058-devolucao-de-compra-nfe.md) (devoluções emitidas pelo tenant, este trata as recebidas)
- Integra com [ADR 0059 — Ciclo fiscal emissão](0059-ciclo-fiscal-emissao-focus-nfe.md) (NF-e de entrada própria é emissão + recepção espelhadas)
