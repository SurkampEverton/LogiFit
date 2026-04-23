# ADR 0057 — Manifestação do Destinatário de NF-e

- **Status:** Accepted
- **Date:** 2026-04-23

## Context

A **Manifestação do Destinatário** é obrigação fiscal estabelecida pela **Nota Técnica 2012/002 da SEFAZ** (coordenação ENCAT). Quando alguém emite NF-e contra o CNPJ de um tenant, o destinatário precisa responder ao SEFAZ com um dos **4 eventos** dentro do prazo legal (geralmente **180 dias**, varia por UF):

| Evento | Código | Quando usar | Risco se não manifestar |
|---|---|---|---|
| **Ciência da Operação** | `210210` | "Recebi a notificação do SEFAZ sobre essa NF" — ato passivo | Baixo; é só reconhecimento |
| **Confirmação da Operação** | `210200` | "Mercadoria/serviço recebido; operação válida" | Médio; contador precisa para créditos fiscais |
| **Desconhecimento** | `210220` | "Essa NF não é minha; não reconheço emissão contra meu CNPJ" | **Alto**; sem desconhecer, fraude pode colar |
| **Operação Não Realizada** | `210240` | "NF emitida mas operação não se concretizou (cancelamento/devolução)" | Médio; diverge a contabilidade |

**Riscos concretos** de não manifestar:

1. **Fraude contra o CNPJ** — terceiros emitem NFs falsas contra o tenant; sem desconhecimento explícito, RFB entende que operação ocorreu e cobra tributos
2. **Divergência na apuração** — contador perde crédito de ICMS/PIS/COFINS de NFs que deveria confirmar
3. **Conformidade** — SPED Fiscal exige relação com manifestações; ausência gera inconsistência
4. **Multa estadual** — algumas UFs penalizam não-manifestação após prazo

Sprint 17 entrega inbox unificada (ADR 0056) com 4 métodos de ingestão, mas **para depois de parsear a nota**. Falta o ciclo de vida fiscal pós-recepção.

Usuário explicitou:
1. **Ciência automática default ON** — tenant pequeno sem contador valoriza "funciona sozinho"; ato de ciência é o mais inofensivo dos 4 (não confirma operação, só reconhece notificação)
2. **Funcionalidade gated por tipo de destinatário** — tenant/company sem CNPJ (PF, cenário raro) não vê a UI de manifestação

## Decision

Ampliar o ciclo de vida de `nfe_received` com **4 eventos de manifestação** + **gate por CNPJ da company** + **ciência automática habilitada por padrão**. Implementação entregue no Sprint 17 (mesmo provider/certificado do download automático), com **colunas de schema preparadas no Sprint 15** para não exigir migration complexa depois.

### Colunas adicionadas em `nfe_received`

```sql
nfe_received
  ...
  -- Manifestação (ADR 0057):
  manifestation_status text not null default 'pending'
    -- enum: 'pending', 'ciencia', 'confirmada', 'desconhecida',
    --        'nao_realizada', 'expired', 'not_applicable'
  manifestation_protocol text nullable         -- protocolo retornado pelo SEFAZ
  manifestation_at timestamptz nullable         -- quando foi enviado ao SEFAZ
  manifestation_deadline date nullable          -- issue_date + 180d (ou regra UF)
  manifestation_by_user_id uuid nullable        -- quem decidiu (null = automático)
  manifestation_mode text nullable              -- 'automatic' | 'manual'
  manifestation_justification text nullable     -- obrigatório para desconhecer / não-realizada
  manifestation_attempts int default 0          -- nº tentativas de envio (retry)
  manifestation_last_error text nullable        -- último erro do SEFAZ (p/ debug)
```

**Estado `not_applicable`** — aplicado via trigger quando `company.cnpj IS NULL` (destinatário sem CNPJ). UI esconde ações de manifestação para essas linhas.

**Estado `expired`** — job diário marca linhas `pending` cujo `manifestation_deadline < now()`. Gera alerta para admin mas não envia automaticamente (por segurança — decisão explícita do usuário).

### Configuração em `company_settings` (ou `companies`)

```sql
company_settings
  ...
  -- ADR 0057:
  nfe_manifestation_enabled bool default true
    -- false quando company.cnpj IS NULL (gate automático)
  nfe_auto_ciencia_enabled bool default true
    -- ADR 0057: DEFAULT ON conforme decisão do usuário
    -- dispara evento 210210 assim que nfe_received é criada
  nfe_manifestation_deadline_days int default 180
    -- regra geral; futuro: override por UF
```

### Automação vs Manual — matriz

| Evento | Pode ser automático? | Default |
|---|---|---|
| **Ciência** (210210) | Sim | **ON** (novo tenant liga automático sem configurar) |
| **Confirmação** (210200) | Não | Sempre manual — exige decisão "a mercadoria chegou?" |
| **Desconhecimento** (210220) | Não | Sempre manual — exige justificativa escrita + audit pesado |
| **Não Realizada** (210240) | Não | Sempre manual — exige motivo + contexto do cancelamento |

**Regra dura:** só **ciência** pode ser automática; **qualquer outro evento exige clique humano + audit com `user_id`**. Isso evita que script malicioso "confirme" NFs fraudulentas.

### UI na inbox (Sprint 17)

Cada linha em `/app/financeiro/nfe` ganha:

- **Coluna "Manifestação"** com status colorido: `⏳ D-25` / `✓ Confirmada` / `⚠ D-5 urgente` / `❌ Expirada` / `—` (se `not_applicable`)
- **Badge de modo:** `auto` (ciência automática) vs `manual` (usuário clicou)
- **Botão `[Manifestar]`** abre modal com 4 opções:
  - Ciência (1 clique, confirma)
  - Confirmar
  - Desconhecer (exige justificativa min 20 chars)
  - Não realizada (exige justificativa min 20 chars)
- **Transições permitidas:**
  - `pending → ciencia` (automático ou manual)
  - `pending → confirmada` (manual)
  - `pending → desconhecida` (manual)
  - `pending → nao_realizada` (manual)
  - `ciencia → confirmada` (depois de dar ciência, confirma efetivamente)
  - `ciencia → desconhecida` (depois de dar ciência, descobre fraude)
  - `ciencia → nao_realizada` (depois de dar ciência, operação cancelada)
  - Terminais: `confirmada`, `desconhecida`, `nao_realizada`, `expired`

### Dashboard

- **Card "NFs a manifestar"** em `/app/dashboard/gerente` (Sprint 07 estendido):
  - Total com `manifestation_status='pending'`
  - Segmentado: `> D-30` · `D-7 a D-30` · `vencendo hoje` · `vencidas (expired)`
- **Alerta via cross-alert dispatcher** (Sprint 07): job diário emite `nfe.manifestation.deadline_approaching` D-7 antes do prazo → instala handler no dashboard + WhatsApp opcional

### Provider `NfeFetcher` ganha método

A interface criada no Sprint 15 (ADR 0056) ganha:

```ts
interface NfeFetcher {
  fetchByKey(chave: string, ctx: FetcherCtx): Promise<NfeXmlResult>;
  fetchByCnpjCursor(cnpj: string, lastNsu: string | null, ctx: FetcherCtx): Promise<...>;
  // ADR 0057:
  sendManifestation(input: {
    chave: string;
    eventCode: '210210' | '210200' | '210220' | '210240';
    justification?: string;  // obrigatório para 220 e 240
    cnpj: string;            // do destinatário
    certificate: CertRef;    // A1 via Supabase Vault
  }): Promise<ManifestationResult>;
}
```

Implementações concretas (`arquivei.ts`, `sieg.ts`, `focus.ts`, `sefaz-direct.ts`) todas implementam — Sprint 17 entrega.

### Eventos de domínio

- `nfe.manifestation.ciencia` — payload: `{ chave, mode: 'automatic'|'manual', user_id?, at, protocol }`
- `nfe.manifestation.confirmada`
- `nfe.manifestation.desconhecida` — payload inclui `justification`
- `nfe.manifestation.nao_realizada` — payload inclui `justification`
- `nfe.manifestation.expired` — job diário
- `nfe.manifestation.deadline_approaching` — 7 dias antes do deadline
- `nfe.manifestation.send_failed` — erro na tentativa (retry automático até 3x)

## Consequences

### Positivas

- **Tenant pequeno sem contador tem conformidade fiscal** sem configurar nada (ciência automática ON)
- **Fraude via CNPJ fica detectável** — operador vê "Nova NF contra seu CNPJ" na inbox e pode desconhecer
- **Provider e certificado reusados** — mesma infra do Sprint 17 cobre download + manifestação (zero custo marginal de infra)
- **Auditoria fiscal pronta** — cada manifestação grava `audit_log` com quem/quando/por quê
- **Diferencial comercial** — "seu sistema manifesta NFs automaticamente; concorrente te deixa vulnerável a fraude fiscal"

### Negativas (mitigáveis)

- **Ciência automática pode encobrir fraude** se operador não revisar — mitigado: dar ciência **não confirma operação**; só reconhece notificação; alertas D-30 forçam revisão antes da confirmação implícita
- **Prazo varia por UF** — MVP usa 180d universal; override por UF entra como evolução (tabela `manifestation_rules_by_uf`)
- **Sincronização SEFAZ falha** — retry automático até 3x + alerta admin se todos falham; operador pode "tentar novamente" manualmente; após 7 dias em erro, escalona para admin do tenant
- **Cert A1 obrigatório** — tenant sem certificado não consegue manifestar automaticamente; UI mostra "Configure certificado em /app/settings/certificados" (já existe do Sprint 17)
- **Desconhecimento errado gera problema real** com fornecedor legítimo — UI pede confirmação dupla + audit robusto; histórico visível ao fornecedor via portal (futuro)

### Riscos não endereçados

- **Prazos por UF divergentes** — atender futuramente via tabela de regras
- **NF-e em MOC (modo offline contingência)** — manifestação só depois que entrar no SEFAZ regular
- **CT-e (Conhecimento de Transporte)** — mesma lógica de manifestação, mas fora do MVP; modelo comporta expansão
- **NFS-e municipal** — não tem manifestação; fluxo só para NF-e (produto) e eventualmente CT-e

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Ciência automática OFF por padrão | Usuário escolheu ON; tenant pequeno sem contador valoriza automatização segura (ciência é o evento mais inofensivo) |
| Permitir confirmação automática por regra (ex: "se fornecedor está na whitelist, confirma") | Risco fiscal alto; confirmar sem decisão humana cria rastro problemático em caso de fraude; deixar como evolução pós-produção |
| Manifestação obrigatória para todos os tenants | Tenant só-PF (sem CNPJ) não tem dever legal de manifestar; gate automático por presença de `company.cnpj` |
| Sprint separado para manifestação | Reusa 100% do provider + certificado + inbox do Sprint 17; custo marginal baixo; separar só introduz coordenação |
| Rodar job de envio hourly | Ciência automática cresce para evento por NF recebida; job hourly acumularia latência; disparar evento ao criar linha em `nfe_received` é mais responsivo e cabe no Realtime do Supabase |

## Escopo de impacto

**Novo ADR:** este (0057).

**Sprints ajustados:**
- **15** — adiciona colunas de manifestação em `nfe_received` + campos em `company_settings` (nfe_manifestation_*) + trigger que marca `not_applicable` quando company sem CNPJ (sem UI no Sprint 15; schema preparado)
- **17** — entrega UI completa (coluna na inbox + modal + dashboard D-30 + 4 ações) + `sendManifestation()` em `NfeFetcher` + handler de ciência automática disparado em `nfe.received.*` + job de expiração + retry automático

**Docs:**
- `docs/modulos.md` — módulo "Manifestação do Destinatário NF-e" com sprint alvo 17
- `CHANGELOG.md` — entrada desta mudança
- `CLAUDE.md` — adicionar ao bloco "Marcos regulatórios": NT 2012/002 SEFAZ

## Related

- Estende [ADR 0056 — Inbox unificada de NF-e](0056-nfe-inbox-unificada-e-metodos-ingestao.md) — mesma tabela `nfe_received` ganha colunas de ciclo fiscal
- Depende de certificado A1 (Sprint 17) e provider escolhido no [ADR 0038 esperado no Sprint 17]
- Integra com Sprint 07 (dashboard) via cross-alert dispatcher para alerta de prazo
- Fonte: NT 2012/002 SEFAZ / ENCAT + documentação dos provedores Arquivei/Sieg/Focus (consultam por chave e enviam eventos de manifestação com mesmo certificado)
