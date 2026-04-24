# ADR 0062 — Pesquisa global (Command Palette Ctrl+K)

- **Status:** Accepted
- **Date:** 2026-04-23

## Context

LogiFit tem ~218 rotas mapeadas (auditoria 2026-04-23) e módulos com volume alto: members (potencialmente milhares por tenant), agendamentos diários, fornecedores, NFs recebidas/emitidas, AP/AR. Navegação por sidebar + paginação é inviável na operação real — recepcionista com paciente chegando precisa de 2 segundos para achar, não 5+ cliques.

Hoje temos:
- `<PersonPicker>` — autocomplete em telas de cadastro (Sprint 01a, ADR 0047)
- Picker de CID/CIF no prontuário (Sprint 20)
- Buscas por filtros em cada listagem (`/app/members`, `/app/agenda`, etc.)

**Gap:** não existe busca universal no header. Operador precisa saber em qual módulo procurar antes de buscar. É o item de UX que mais impacta NPS operacional em ERPs modernos (Linear/Notion/Slack estabeleceram o padrão Cmd+K há anos).

## Decision

Entregar **pesquisa global via Command Palette** com atalho **`Ctrl+K` (Windows/Linux) / `Cmd+K` (Mac)** em qualquer lugar do app. Busca cross-module respeitando RLS + permissions + consent (regra 6) + audit (regra 5).

### Backend

**Materialized view `search_index`** alimentada por triggers das tabelas-fonte:

```sql
search_index (
  id uuid pk,                    -- uuid sintético
  tenant_id uuid not null,       -- RLS
  source_table text not null,    -- ex: 'persons', 'members', 'appointments'
  source_id uuid not null,       -- id original
  kind text not null,            -- 'person','member','lead','supplier','user',
                                 --  'professional','appointment','ap','ar',
                                 --  'nfe_received','fiscal_emission','consulta',
                                 --  'evolucao','equipment','setting','quick_action'
  label text not null,           -- texto primário mostrado
  subtitle text,                 -- contexto secundário
  url text not null,             -- rota para navegar ao clicar
  searchable_text text not null, -- concatenação de campos buscáveis
  search_vector tsvector,        -- tsvector gerado
  required_permission text,      -- permission mínima para ver (ex: 'prontuario.read')
  required_vertical text,        -- 'fisio'/'nutri'/'academia'/null
  required_consent_purpose text, -- consent cross-module quando aplicável (regra 6)
  company_id uuid,               -- scope (quando aplicável)
  is_sensitive bool default false, -- dado clínico → audit obrigatório ao visualizar
  updated_at timestamptz
)

CREATE INDEX ON search_index USING gin (search_vector);
CREATE INDEX ON search_index USING gin (searchable_text gin_trgm_ops);
CREATE INDEX ON search_index (tenant_id, kind);
```

**Refresh estratégia:**
- Trigger `AFTER INSERT/UPDATE/DELETE` em cada tabela-fonte → função `search_index_sync()` que upserta linha correspondente
- Extensão `pg_trgm` habilitada (trigram para fuzzy match de nomes com typo)
- Extensão `unaccent` para buscar "Jose" achar "José"

**API route:**

```
GET /api/search?q=<query>&kinds=<csv>&limit=50
```

Server Action `globalSearch(query, { kinds?, limit })` retorna resultados categorizados, **já filtrados por**:
1. `tenant_id` (RLS padrão)
2. `required_permission` (intersecção com permissions do user via `has_permission()`)
3. `required_vertical` (tenant tem a vertical ativa?)
4. `required_consent_purpose` (quando cross-module, consent ativo?)
5. Regra 25 (dado clínico não cruza `company_id` em `topology=franchise` — resultado some)

**Query SQL** (pseudocódigo):

```sql
SELECT kind, label, subtitle, url, is_sensitive,
  ts_rank(search_vector, websearch_to_tsquery('portuguese', :q)) AS rank,
  similarity(searchable_text, :q) AS trgm_rank
FROM search_index
WHERE tenant_id = :tenant
  AND (
    search_vector @@ websearch_to_tsquery('portuguese', :q)
    OR searchable_text % :q    -- trigram fuzzy
  )
  AND (required_permission IS NULL OR has_permission(:user_id, required_permission, ...))
  AND (required_vertical IS NULL OR :tenant_verticals @> ARRAY[required_vertical])
ORDER BY rank DESC, trgm_rank DESC
LIMIT :limit
```

### Frontend

Componente `<CommandPalette>` em `packages/ui`:

- Overlay fullscreen com blur
- Input com foco automático
- Resultados categorizados (Pessoas · Agendamentos · Financeiro · Configurações · Ações)
- Navegação por setas ↑↓ + Enter abre
- Esc fecha
- Modificadores no input:
  - **`>`** no início → filtra só Ações ("Novo member", "Emitir NFS-e", "Nova AP")
  - **`/`** no início → filtra só rotas/settings
  - **`@`** no início → só pessoas
  - **`#`** no início → só tags
  - Sem modificador → todos os tipos
- TanStack Query + debounce 200ms + cache LRU
- Histórico dos últimos 10 buscas por user em `localStorage` (aparece vazio-query)
- Shortcut hint no header: `[⌘K]` / `[Ctrl K]` clicável

### Dado sensível (LGPD + regra 5)

Quando resultado tem `is_sensitive=true` (prontuário, evolução, exame):
- Render com ícone de alerta visual + tooltip "Dado clínico sensível"
- Clicar registra `audit_log` com `{ user_id, term, result_id, result_kind, accessed_at }` antes de navegar
- Regra 6 enforced: cross-module (ex: instrutor clicando em evolução fisio) exige consent ativo — se não tem, mostra "Acesso bloqueado: consent cross-module necessário"

### Ações rápidas (`kind='quick_action'`)

Popular estaticamente no boot da app, registradas via `registerQuickAction({ label, icon, url, shortcut?, requiredPermission? })`:

```ts
registerQuickAction({ label: 'Novo member', icon: 'user-plus', url: '/app/members/new', shortcut: 'G M N', requiredPermission: 'member.write' })
registerQuickAction({ label: 'Novo agendamento', icon: 'calendar-plus', url: '/app/agenda/novo', requiredPermission: 'agenda.write' })
registerQuickAction({ label: 'Emitir NFS-e', icon: 'file-text', url: '/app/fiscal/emitir/nfse', requiredPermission: 'fiscal.emit' })
registerQuickAction({ label: 'Nova AP', icon: 'receipt', url: '/app/financeiro/contas-pagar/new', requiredPermission: 'financeiro.ap.write' })
// ... ~20 ações comuns cadastradas pelos sprints
```

### Escopo MVP vs expansão

**MVP (Sprint 07):** 7 tipos indexados:
1. `person`, `member`, `lead`, `supplier`, `user`, `professional` (do Sprint 01a/02)
2. `appointment` (Sprint 03)
3. `ap`, `ar` (Sprint 15)
4. `setting` (rotas de `/app/settings/*` cadastradas estaticamente)
5. `quick_action` (~20 ações comuns registradas por cada sprint)

**Expansão por sprint** (cada sprint registra seus tipos no `search_index`):

| Sprint | Tipos adicionados |
|---|---|
| 17 | `nfe_received` (por chave, emitente) |
| 20 | `consulta` (sensível — audit obrigatório; requer `prontuario.read`) |
| 21 | `evolucao` (idem) |
| 22 | `billing_guide` (faturamento convênio) |
| 25 | `equipment` (serial, model) |
| 26 | rotas `/meu/*` (só quando user é member autenticado no portal) |
| 32 | `device_reading` (agregado; não leitura individual) |
| 33 | `lab_result` (sensível — audit) |
| 36 | `fiscal_emission` (chave, destinatário) |

### Sem semântica no MVP

Full-text (tsvector) + trigram (pg_trgm) cobre ~95% dos casos. **Embeddings (pgvector)** ficam para ADR futuro quando busca por sinônimos clínicos virar dor real (ex: "lombalgia" achar prontuários com CID M54.5) — provavelmente sprint pós-33 Pipeline Exames.

## Consequences

### Positivas

- **NPS operacional alto** — recepção encontra paciente em 2s; gerente encontra AP/fornecedor sem sair da tela atual
- **UX moderna** — atalho `Ctrl+K` é padrão da indústria; aumenta percepção de "ERP profissional"
- **Auditoria nativa** — cada busca em dado clínico grava `audit_log` (regra 5); ANPD/CFM fiscalizam com rastro
- **Permissions respeitadas** — recepção nunca vê prontuário no resultado, mesmo buscando paciente que tem
- **Expansão gradual** — cada sprint adiciona seus tipos; zero refactor do core
- **Reusa infra existente** — Postgres já instalado; `pg_trgm` + `unaccent` são extensões padrão Supabase

### Negativas (mitigáveis)

- **Custo de write amplificado** — cada INSERT/UPDATE em tabela-fonte dispara trigger + upsert em `search_index`; mitigado por índice + deduplicação; se latência p95 ficar >50ms, virar **materialized view refreshed por job** (10min) em vez de trigger síncrono
- **Trigger em tabela sensível (consultas, evoluções)** — `search_index` também é dado sensível; tem `tenant_id` + RLS + `required_permission`; testes E2E cobrem que recepção não acha prontuário
- **Sensibilidade de ranking** — full-text score nem sempre é o que operador espera; ajuste iterativo via telemetria (termos buscados + resultado clicado)
- **Index grande** — ~10M linhas em tenants enterprise; particionar `search_index` por `tenant_id` hash quando passar de 5M
- **Atualização de permissões** — se user perde permission, resultados que tinha favoritado no histórico local ainda aparecem; mitigado por validação server-side (click re-checa permission)

### Riscos não endereçados

- **Performance multi-tenant** — busca cross-tenant nunca acontece; RLS garante; testes de isolamento cobrem
- **Typo em idiomas não-pt-BR** — stemming do tsvector usa `portuguese`; operador em tenant es-419 ou en-US precisa config locale-aware; decisão: MVP só `portuguese`, outros idiomas stretch
- **Busca em evolução SOAP (texto livre grande)** — `searchable_text` trunca em 10k chars; evolução longa perde cauda; aceitar trade-off

## Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| Sem busca global no MVP | UX fundamental de ERP; rejeitada |
| Algolia / Meilisearch / Elasticsearch externo | Custo mensal + complexidade operacional + dado clínico sai do Supabase (problema LGPD); Postgres nativo é suficiente |
| Busca apenas em cada listagem (status quo) | Insuficiente — operador não sabe onde procurar |
| Apenas full-text sem trigram | Typo em nome (comum: "Jaão" vs "João") não acha; trigram resolve |
| Embeddings pgvector desde MVP | Complexidade desproporcional ao ganho; 95% dos casos cobertos por full-text+trigram |
| Materialized view refreshed por cron (sem trigger) | Resultado "atrasado" (até 10min) frustra operador que acabou de cadastrar aluno e não acha; trigger sync é a escolha |
| Index único sem `required_permission` | Vazaria dado ao atravessar boundary (ex: recepção vê prontuário); filter no server é obrigatório |

## Escopo de impacto

**Novo ADR:** este (0062).

**Sprints ajustados:**
- **00** — componente base `<CommandPalette>` em `packages/ui` + extensões `pg_trgm` + `unaccent` habilitadas no Supabase
- **07** — entrega MVP: materialized view `search_index` + triggers para 7 tipos + API `/api/search` + atalho `Ctrl+K`/`Cmd+K` no layout + UI de command palette + registro de quick actions + telemetria (termos + cliques)
- **15, 17, 20, 21, 22, 25, 26, 32, 33, 36** — cada sprint adiciona registro de seus tipos no `search_index` (trigger + `registerSearchable` no boot)

**Docs:**
- `docs/modulos.md` — novo módulo "Pesquisa global (Cmd+K)" em Fundação
- `CHANGELOG.md` — entrada desta mudança
- `CLAUDE.md` — menciona atalho como parte do UX padrão
- `docs/rules.md` — regra 30 (nova): módulo novo com dado pesquisável **deve** registrar-se em `search_index` com `required_permission` explícita

## Related

- Complementa [ADR 0047 — Cadastro central persons](0047-cadastro-central-persons.md) — `<PersonPicker>` continua existindo para formulários; command palette é busca universal
- Reforça [regra 5 — audit append-only](../rules.md) — busca em dado sensível grava audit
- Reforça [regra 6 — consent cross-module](../rules.md) — resultados respeitam consent
- Reforça [regra 25 — dado clínico em franchise](../rules.md) — index por `company_id` + filter
- Fonte: padrão Linear (linear.app), Notion, Slack command palette; pg_trgm docs (https://www.postgresql.org/docs/current/pgtrgm.html); websearch_to_tsquery (https://www.postgresql.org/docs/current/textsearch-controls.html)
