# ADR 0056 — Inbox unificada de NF-e + 4 métodos de ingestão

- **Status:** Accepted
- **Date:** 2026-04-23

## Context

O LogiFit tinha 2 sprints tocando NF-e sem coordenação:

- **Sprint 15** — upload manual de XML em `/app/financeiro/nf-e/upload` → parser → cria AP draft.
- **Sprint 17** — recepção automática via provider (Arquivei/Sieg/Focus) + certificado A1 → inbox `/app/financeiro/nfe/recebidas` separada, com tabela `nfe_received` própria.

Problemas concretos:

1. **Duas inboxes** — operador teria que olhar em dois lugares, o que reinventa a bagunça que o ERP deveria resolver.
2. **Falta download por chave** — fornecedor manda só os 44 dígitos pelo WhatsApp/email; operador hoje teria que pedir o XML pra poder fazer upload. Provider (Arquivei/Sieg) e SEFAZ expõem consulta por chave — só precisa do fluxo.
3. **Entrada manual (sem NF)** tem que ser clara** — compra de autônomo sem NF-e / adiantamento / aluguel: operador cria AP direto. Hoje existe mas fica em outra tela, sem conversar com o inbox.
4. **Configuração pulverizada** — admin não tem um lugar único pra ver "como está nossa ingestão de NF-e".

O usuário pediu explicitamente: "preciso de uma tela centralizada onde posso ver quais notas foram enviadas para mim por download automático, na mesma tela possa fazer download por chave e upload por xml e dar entrada" — e depois simplificou: "só preciso de liga/desliga para download automático".

## Decision

Centralizar em **uma única rota `/app/financeiro/nfe`** (inbox) todos os 4 métodos de ingestão, com **um único toggle global** de download automático em settings. Os 3 métodos manuais ficam sempre disponíveis como ações na inbox.

### Os 4 métodos

| Método | Quem dispara | Depende de | Quando está disponível |
|---|---|---|---|
| **1. Download automático SEFAZ** | Job diário (cron) | Provider externo + certificado A1 da company | A partir do Sprint 17; toggle admin on/off |
| **2. Download por chave** | Operador cola 44 dígitos | Provider externo (consulta por chave) ou certificado A1 | A partir do Sprint 17 (botão fica desabilitado no MVP se provider não configurado) |
| **3. Upload XML** | Operador faz upload de arquivo `.xml` | — | Sprint 15 (sempre ativo) |
| **4. Entrada manual (sem NF)** | Operador digita AP sem XML | — | Sprint 15 (sempre ativo) |

### Tela única `/app/financeiro/nfe`

Layout:

```
┌─────────────────────────────────────────────────────────────┐
│  NF-e · Inbox                                               │
│                                                             │
│  [🔎 Por chave] [📄 Upload XML] [✍ Entrada manual]          │
│                                                             │
│  Filtros: [Status ▾] [Origem ▾] [Período ▾] [Fornecedor ▾] │
├─────────────────────────────────────────────────────────────┤
│  ○ Nova    Fornecedor X      R$ 1.234    [auto]  Converter  │
│  ✓ Em AP   Fornecedor Y      R$    500   [chave] Ver AP     │
│  ⚠ Dup.    Fornecedor Z      R$  2.800   [upload] Descartar │
│  ○ Nova    Compra balcão     R$    120   [manual] Ver AP    │
└─────────────────────────────────────────────────────────────┘
```

**Cada linha** tem: status, emitente (resolvido via persons/suppliers), valor, data de emissão, **badge do método de origem** (`auto`/`chave`/`upload`/`manual`), ação primária contextual (converter em AP, ver AP criada, descartar duplicata).

**Ações no topo:**

- **[🔎 Por chave]** — modal com input de 44 dígitos (validador estrutural: só dígitos, checksum mod 11); se provider configurado, busca e cria linha `source='manual_key'`; se não configurado, botão mostra tooltip "Configure provider em /app/settings/financeiro/nfe".
- **[📄 Upload XML]** — upload direto; parser lê e cria linha `source='upload_xml'`.
- **[✍ Entrada manual]** — modal com campos mínimos (fornecedor via PersonPicker, valor, vencimento, categoria do plano de contas, descrição) → cria direto `accounts_payable` **sem** criar linha em `nfe_received` (não é nota fiscal; é lançamento manual); opcional flag `no_invoice=true` para relatório fiscal saber que essa AP não tem NF associada.

**Filtros persistentes:** status (`new`, `parsed`, `ap_created`, `duplicate`, `rejected`), origem (`auto_sefaz`, `manual_key`, `upload_xml`), período, fornecedor, empresa (quando usuário tem acesso a múltiplas).

**Banner topo do dashboard do gerente** (opcional): "Você tem N NFs novas para processar" com link direto.

### Tabela `nfe_received` (criada no Sprint 15, ampliada no Sprint 17)

```sql
nfe_received
  id uuid pk
  tenant_id uuid not null           -- RLS
  company_id uuid not null
  chave text not null               -- 44 dígitos; unique quando presente
  source text not null              -- enum: 'auto_sefaz','manual_key','upload_xml'
                                    -- (manual sem NF NÃO entra aqui)
  xml_storage_path text nullable    -- Storage bucket privado
  emitter_cnpj text nullable
  emitter_person_id uuid nullable fk persons     -- resolvido pelo parser
  supplier_id uuid nullable fk suppliers          -- idem
  amount_cents bigint nullable
  issue_date date nullable
  received_at timestamptz default now()
  fetched_by_user_id uuid nullable  -- quem iniciou o fetch (chave ou upload)
  fetch_duration_ms int nullable    -- métrica de saúde do provider
  ap_id uuid nullable fk accounts_payable  -- linkada após conversão
  status text not null default 'new' -- enum: 'new','parsed','ap_created','duplicate','rejected'
  error_reason text nullable        -- quando rejected
  raw_payload jsonb nullable        -- backup bruto do XML parseado (auditoria)
```

**Constraints:**
- Unique `(chave)` global — garante que a mesma NF não entra 2× mesmo se o provider duplicar evento ou upload manual coincidir com automático.
- Unique `(tenant_id, chave)` é redundante dado unique global; manter só o global.
- Check: `source='auto_sefaz' → xml_storage_path IS NOT NULL`.

**RLS:** tenant_id + scope por company + permission `financeiro.nfe.read/write`.

### Provider abstrato `NfeFetcher`

Interface compartilhada entre os 2 métodos externos (automático e por chave):

```ts
interface NfeFetcher {
  readonly name: string;                              // 'arquivei', 'sieg', 'focus', 'sefaz_direct'
  fetchByKey(chave: string, ctx: FetcherCtx): Promise<NfeXmlResult>;
  // Usado só pelo método automático (pós-Sprint 17):
  fetchByCnpjCursor(cnpj: string, lastNsu: string | null, ctx: FetcherCtx): Promise<{ items: NfeXmlResult[]; nextNsu: string }>;
}
```

- Implementações escolhidas no ADR 0038 (esperado no Sprint 17) — mesma pergunta pro MVP do método por chave: qual provider oferece consulta por chave mais barata/confiável.
- `sefaz_direct` exige certificado A1 da company (também cadastrado no Sprint 17).
- MVP do Sprint 15 não traz nenhuma impl — o botão "Por chave" existe mas está desabilitado até Sprint 17 configurar provider.

### Configuração

Rota única **`/app/settings/financeiro/nfe`** (admin):

```
┌──────────────────────────────────────────────────────────┐
│  NF-e · Configuração                                     │
│                                                          │
│  Download automático do SEFAZ                            │
│  [ ON ]  ← toggle único                                  │
│                                                          │
│  Provider: Arquivei ▾   [Editar credenciais]             │
│  Certificado A1: [Upload] (exp. 12/2026)                 │
│                                                          │
│  Última sincronização: 23/04/2026 08:12 · 3 NFs novas    │
│  [Rodar agora]                                           │
│                                                          │
│  ─────────────────────────────────────────────────────   │
│                                                          │
│  Métodos manuais (sempre ativos):                        │
│  • Download por chave — {disponível / indisponível}      │
│  • Upload de XML — ativo                                 │
│  • Entrada manual (sem NF) — ativo                       │
└──────────────────────────────────────────────────────────┘
```

**Regra:** os 3 métodos manuais **não têm toggle** — não há motivo para desligar (são ações do operador sem custo recorrente).

**Toggle único** controla `company_settings.nfe_auto_download_enabled bool`. Quando desligado, job diário simplesmente não busca nada para essa company (outras companies do tenant podem estar ligadas).

### Campos adicionais em `company_settings`

```sql
company_settings  -- ou colunas em companies
  nfe_auto_download_enabled bool default false  -- admin liga no Sprint 17
  nfe_provider text nullable                    -- 'arquivei','sieg','focus','sefaz_direct'
  nfe_provider_credentials jsonb nullable       -- criptografado; API key ou cert pointer
  nfe_last_sync_at timestamptz nullable
  nfe_last_sync_count int default 0
```

## Consequences

### Positivas

- **Uma tela resolve tudo** — operador abre `/app/financeiro/nfe` e tem os 4 caminhos visíveis.
- **Progressão natural MVP → pós-MVP** — MVP entrega upload + manual; pós-MVP (Sprint 17) pluga automático + por chave **na mesma inbox** sem refactor.
- **Auditoria uniforme** — `source` + `fetched_by_user_id` registra como cada nota entrou, mesmo as manuais (quem subiu o XML).
- **Configuração simples** — 1 toggle em vez de 4; menos chance de usuário confundir.
- **Fornecedor sem NF** (autônomo, aluguel, adiantamento) fica tratado sem forçar criar NF fictícia — só AP com `no_invoice=true`.

### Negativas (mitigáveis)

- **Duplicata possível entre métodos** — automático trouxe a nota X, e operador também subiu por upload. Mitigado pelo unique global de `chave` + status `duplicate` para a segunda tentativa.
- **Inbox pode crescer muito** em tenant grande — paginação + filtros; job de arquivamento automático de NFs já convertidas em AP > 90 dias (move para tabela fria).
- **Botão "Por chave" desabilitado confunde** — tooltip explicativo + link direto para `/app/settings/financeiro/nfe`.
- **Migração no Sprint 17** — `nfe_received` criada no Sprint 15 sem coluna de `nsu` (cursor do SEFAZ); Sprint 17 adiciona. Sem migração de dados (tabela vazia até Sprint 17 ativar automático).

### Riscos não endereçados

- **NF cancelada pelo fornecedor após baixa** — job separado de verificação de status (ADR futuro no Sprint 17).
- **NF complementar / substitutiva** — regra TISS-like; cada situação é um fluxo próprio, fora do escopo do MVP.
- **Tabela `nfe_received` cresce indefinidamente** — estratégia de particionamento por `issue_date` quando passar de 10M linhas; decisão futura.

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Manter 2 inboxes (upload vs recebidas) | Usuário pediu tela única; 2 inboxes é a "bagunça que o ERP deveria resolver" |
| 4 toggles independentes | Usuário simplificou ("só liga/desliga do automático"); 3 métodos manuais não têm razão de serem desligados |
| Download por chave sem provider abstrato (implementação direta SEFAZ) | Certificado A1 é complexo; provider abstrai; manter interface permite escolha no Sprint 17 |
| Inbox só no Sprint 17 (adiar MVP) | MVP perderia ponto de ancoragem para os dois métodos manuais; criar inbox vazia no 15 é quase zero custo |

## Escopo de impacto

**Novo ADR:** este (0056).

**Sprints ajustados:**
- **15** — cria `nfe_received` + rota única `/app/financeiro/nfe` com **Upload XML** e **Entrada manual** ativos; botão "Por chave" presente mas desabilitado (tooltip explicativo); rota `/app/settings/financeiro/nfe` com toggle mostrando "configure provider (Sprint 17)"; schema do Provider `NfeFetcher` preparado
- **17** — ativa **Download automático** (toggle funcional, job cursor SEFAZ) e **Download por chave** (botão habilitado) usando certificado A1; popula `nfe_received.source='auto_sefaz'` ou `'manual_key'`; reusa a mesma inbox do Sprint 15

**Docs:**
- `docs/modulos.md` — novo módulo "NF-e Inbox unificada" em Geral com sprint alvo 15; métodos automático/por chave listados com sprint alvo 17
- `CHANGELOG.md` — entrada desta mudança

## Related

- Consolida decisão anterior do [Sprint 17](../sprints/17-geral-bancos-open-finance.md) (recepção automática) com o [Sprint 15](../sprints/15-geral-erp-financeiro-core.md) (upload manual) — antes isoladas
- Reforça [ADR 0047 — Cadastro central de persons](0047-cadastro-central-persons.md) — emitente da NF é resolvido contra `persons` (criado ou linkado)
- Habilita decisão futura do ADR 0038 (provider NF-e; esperado no Sprint 17)
