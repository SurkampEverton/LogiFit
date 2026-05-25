# ADR 0100 — Apuração fiscal mensal de receita (Grupo C) — motor próprio + memorial sem emissão oficial

- **Status:** Proposed
- **Date:** 2026-05-23

## Context

[ADR 0061](0061-motor-retencoes-e-cobertura-fiscal-faseada.md) (Accepted 2026-04-23) mapeou 7 grupos fiscais e definiu cobertura **faseada**:

- **Fase atual** (Sprints 15/23/36): Grupos A (NF emitida via Focus NFe), B (retenções em AP), G (retenções comissão/RPA) + portal `contador_externo` read-only.
- **Fases futuras**: Grupos C (apuração mensal), D (guias DAS/DARF/DAM), E (obrigações acessórias SPED/ECD/ECF), F (folha CLT + eSocial).

Sprint 37 entra em planejamento ativo agora — primeiro grupo da Fase 2 fiscal. Precisa de ADR próprio (≥0080 conforme [convenção de numeração do roadmap](../roadmap.md#convenção-de-numeração-de-adrs); ADR 0100 é o próximo livre).

### Por que entrar em Sprint 37 agora

Cobertura B/G atual mostra valor líquido por AP individual e por comissão individual — mas operador olha o painel mensal pra responder pergunta diferente:

> "Quanto vou pagar de DAS/DARF este mês?"

Hoje a resposta é "consulte seu contador" ou "exporte XMLs e pergunte". Sprint 37 fecha esse gap **antes** de emitir a guia oficial (Sprint 38 cuida disso).

### Restrições conhecidas

- **Tabela do Simples Nacional atualiza anualmente** (LC 123/2006 + alterações pela LC 155/2016) — Anexos III/V mudam alíquotas e faixas; 2026 vigente.
- **Lucro Presumido tem 4 alíquotas-base de presunção** (8%/12%/16%/32%) conforme atividade + IRPJ adicional 10% sobre excedente R$ 60.000/trimestre + adicional CSLL.
- **Lucro Real depende de demonstrativos contábeis** (receitas - despesas) → não calculamos automático sem despesas completas; entregamos memorial parcial e remetemos ao contador.
- **PGDAS-D oficial** (Receita Federal) exige login GOV.BR + assinatura digital ICP-Brasil — não automatizamos isso no MVP; queremos só **pré-cálculo** que serve de check com o contador.
- **MEI** apura R$ 67,50 (comércio/indústria) ou R$ 71,50 (serviços) ou R$ 72,50 (ambos) mensais em 2026 — fixo independente de receita até R$ 81k/ano; LogiFit valida teto e alerta se ultrapassou.

## Decision

### Princípio guia

LogiFit calcula a **apuração operacional** com motor próprio — sem delegação a provider tributário externo no MVP. Emite **memorial detalhado** (passo a passo do cálculo) que o operador valida com o contador antes de pagar. **Não emite DAS/DARF oficial** nesta sprint — Sprint 38 cobre.

Critério para "operacional": valor calculado dentro de ±5% do oficial nas faixas típicas (rede saúde ≤R$ 1M/mês de receita).

### Escopo Sprint 37a (core MVP)

#### 1. Schema `fiscal_revenue_aggregations`

Agregação 1:1 por `(tenant_id, company_id, year_month)`. Permite recálculo (status='draft' permite UPDATE) e fechamento (status='closed' bloqueia UPDATE via trigger). Memorial em jsonb pra preservar passo-a-passo.

```sql
fiscal_revenue_aggregations
  id uuid pk
  tenant_id uuid not null
  company_id uuid not null fk companies
  year_month text not null         -- 'YYYY-MM'
  tax_regime fiscal_tax_regime not null
                                   -- snapshot de companies.regime_tributario na hora do cálculo
                                   -- (regime troca virada de ano; aggregation preserva o regime vigente)

  -- Receita bruta (soma fiscal_emissions.valor_total_cents WHERE status='completed' AND kind IN (...))
  receita_servicos_cents bigint not null default 0  -- NFS-e
  receita_mercadorias_cents bigint not null default 0  -- NF-e modelo 55 + NFC-e modelo 65
  receita_total_cents bigint not null default 0     -- soma das 2 acima

  -- Cálculo aplicado (depende do regime)
  rbt12_cents bigint                -- Simples: receita bruta últimos 12 meses (acumulada)
  aliquota_efetiva_bp integer       -- basis points: 1075 = 10.75%; null pra Real
  imposto_apurado_cents bigint      -- valor estimado pré-DAS/pré-DARF
  
  -- Memorial — array jsonb de "linhas" do cálculo
  -- Cada linha: { step: 1, label: '...', formula: '...', value_cents: ..., note: '...' }
  memorial jsonb not null default '[]'::jsonb

  -- Workflow
  status text not null default 'draft'  -- 'draft' (editável, regerável) | 'closed' (imutável)
  computed_at timestamptz not null defaultNow
  closed_at timestamptz
  closed_by_user_id uuid

  -- Audit
  created_at timestamptz default now
  updated_at timestamptz default now
  
  unique (tenant_id, company_id, year_month)
```

#### 2. Schema `fiscal_revenue_breakdown`

Quebra detalhada da receita do mês por `fiscal_emissions.kind` (NFS-e × NF-e × NFC-e × …). Permite drill-down na UI sem releer `fiscal_emissions`.

```sql
fiscal_revenue_breakdown
  id uuid pk
  aggregation_id uuid not null fk fiscal_revenue_aggregations on delete cascade
  emission_kind fiscal_emission_kind not null
  count integer not null              -- quantas notas
  total_cents bigint not null         -- soma valor_total_cents do mês neste kind
  created_at timestamptz default now
  
  unique (aggregation_id, emission_kind)
```

#### 3. Schema `fiscal_simples_brackets`

Lookup global das tabelas Anexos III + V do Simples Nacional vigentes 2026. Tenant **não edita** — atualização anual via migration data nova. Histórico via `valid_from`/`valid_to` pra cálculo retroativo correto se contador questiona apuração de mês anterior.

```sql
fiscal_simples_brackets
  id uuid pk
  anexo text not null               -- 'III' | 'V' (III = serviços comuns; V = serviços intelectuais/saúde com Fator R)
  bracket integer not null          -- 1..6
  rbt12_from_cents bigint not null  -- faixa inferior receita 12m
  rbt12_to_cents bigint              -- faixa superior; null = última faixa
  aliquota_nominal_bp integer not null  -- alíquota nominal da faixa
  parcela_deduzir_cents bigint not null  -- parcela a deduzir
  valid_from date not null
  valid_to date                     -- null = vigente
  
  unique (anexo, bracket, valid_from)
```

**Fórmula efetiva Simples:**

```
aliquota_efetiva = (rbt12 × aliquota_nominal - parcela_deduzir) / rbt12
imposto = receita_mes × aliquota_efetiva
```

Anexo III default pra clínicas + Anexo V quando atividade tem Fator R < 28% (folha < 28% receita).

#### 4. Libs puras em `@repo/ai/fiscal/apuracao`

Função pura `computeAggregation(input)` recebendo `{ regime, receita_servicos, receita_mercadorias, rbt12, fator_r? }` e retornando `{ imposto_apurado, aliquota_efetiva_bp, memorial }`. Sem side effect; testável isoladamente.

- `simples-tables.ts` — Anexos III + V 2026 hardcoded como `const SIMPLES_TABLES = { III: [...], V: [...] }` (mesma estrutura que vai pra `fiscal_simples_brackets` na seed)
- `compute.ts` — `aggregateMonthlyRevenue(tenantId, companyId, year, month)` SQL pra coletar receita + `calculateSimplesNacional` + `calculateLucroPresumido` + `calculateLucroReal` (parcial) + `calculateMEI`
- `memorial.ts` — `buildSimplesMemorial(input, output)` constrói array de linhas explicativas; reusado pela UI no detalhe e pela export PDF (Sprint 37b)
- 25+ unit tests cobrindo cada regime + casos de borda (RBT12=0 / RBT12 estourou teto Simples / receita zero / Fator R borderline)

#### 5. Server Actions wrapped (5 mínimas)

- `aggregateMonthlyRevenue(year, month, companyId)` — agrega + persist transacional; ON CONFLICT atualiza se draft, rejeita se closed
- `getAggregation(id)` — read com breakdown
- `listAggregations(filters)` — read paginado
- `regenerateAggregation(id)` — re-roda compute (rejeita se closed)
- `closeAggregation(id)` — marca closed_at + closed_by_user_id (trigger SQL bloqueia UPDATE pós-closed)

#### 6. UI mínima (2 rotas)

- `/app/fiscal/apuracao` — hub com filtros (year, companyId) + lista cards + 4 KPI (Aguardando × Fechadas × Receita 12m × Imposto 12m)
- `/app/fiscal/apuracao/[id]` — detalhe com header + breakdown emission_kind × valor + memorial expandido linha-a-linha + ações regenerar/fechar (com `<ConfirmDialog>` no fechar — irreversível)

### O que fica pra Sprint 37b/c

- **Job cron mensal** `aggregate-fiscal-monthly` (dia 5 do mês seguinte) que pré-calcula todos os companies ativos automático
- **DARF/DAS preenchido** com código de barras (Sprint 38 cobre — fora do escopo)
- **PGDAS-D consulta tabela real** via API RFB (avaliar custo/benefício pós-piloto; hoje hardcoded basta)
- **Lucro Real completo** — integração com `cost_entries` Sprint 14 + balancete + adições/exclusões fiscais (escopo Sprint 37c)
- **Memorial PDF** via `@react-pdf/renderer` com branding tenant (template ADR 0097)
- **Permissions RBAC** `fiscal.apuracao.read/write/close`
- **Pesquisa global** ADR 0062 (aggregations não-sensíveis)
- **Cross-alert** receita estourou teto Simples (R$ 4.8M/ano em 2026) → alerta upgrade pra Presumido
- **RIPD apuração** + DPO sign-off (dado fiscal não-clínico; risco LGPD baixo mas exige)
- **Feature flag** `fiscal_apuracao_v1` (segue padrão ADR 0098)
- **E2E Playwright** completo
- **Integração régua Sprint 13** — alerta WhatsApp 7 dias antes vencimento DAS (vencimento dia 20)
- **Permissão `contador_externo`** (Sprint 01b) ganha `fiscal.apuracao.read` automático

### Alternativas rejeitadas

| Alternativa | Motivo |
|---|---|
| **Delegar pra Contabilizei API** | Lock-in prematuro + Contabilizei é forte em micro/pequeno; tenant médio/grande não usa; ADR 0061 mencionou como opção, mas avaliar com piloto |
| **Não fazer nada, só apontar pro export Sprint 36** | Operador precisa do número estimado pro fluxo de caixa; export bruto não responde "quanto pago de DAS"; gap real |
| **Cobrir Real completo já no 37a** | Depende de balancete completo + adições/exclusões fiscais; explode escopo; entregar parcial (só receita) + remeter ao contador é mais honesto |
| **Calcular via fórmulas hardcoded sem `fiscal_simples_brackets`** | Atualização anual da tabela vira mudança de código + deploy — quebra fluxo; tabela em DB com `valid_from/valid_to` permite migration data limpa |
| **Não persistir aggregations — recalcular sempre que UI abre** | Perde audit trail + impossível "fechar" mês como ponto-no-tempo; também perde performance (query agregada > 50k notas por tenant grande) |
| **Snapshot do `tax_regime` direto no agg sem coluna** | Trocar regime virada de ano apaga histórico → contador questiona apuração antiga; coluna explícita preserva auditoria |

### Aliquota update process

Job manual Sprint 37c (dezembro/ano) — admin LogiFit:

1. Bota nova tabela Anexos III+V em migration data nova (`packages/db/migrations/<NNNN>_simples_2027.sql`)
2. INSERT com `valid_from='2027-01-01'`; UPDATE row antiga com `valid_to='2026-12-31'`
3. Cache `simples-tables.ts` lê DB no boot (ou recompila se hardcoded)
4. Apurações de janeiro/2027+ usam novas faixas automaticamente

## Consequences

### Positivas

- **Operador tem "quanto pago de DAS estimado" em 1 clique** — gap real do MVP fiscal
- **Memorial = documento de auditoria** — contador valida em 5 minutos vs reconstruir do zero
- **Snapshot do regime preserva histórico** — apuração de 2025 não muda quando tenant troca pra Presumido em 2026
- **Tabela em DB com valid_from/to** — atualização anual via migration data, sem deploy de código
- **Motor próprio = sem dependência externa** — Sprint 37 não bloqueia se Contabilizei/Conube cair (regra 46 soberania)
- **Status workflow draft → closed** — operador re-roda quanto quiser até fechar; closed vira ponto-no-tempo imutável

### Negativas (mitigáveis)

- **Atualização anual da tabela é responsabilidade LogiFit** — esquecer = todos os tenants apuram com alíquota errada; mitigação: alerta em produção quando ano vira sem nova tabela seedada
- **Lucro Real parcial** — UI mostra "apuração parcial; complete com contador"; transparência mata expectativa
- **Não bate 100% com PGDAS-D oficial** — declaração oficial pode usar deduções específicas (ICMS-ST etc); operador valida 1×/mês manualmente vs DAS real; meta ±5%
- **Fator R automation** — depende de folha (Sprint 40); MVP usa `fator_r` informado pelo operador (UI form) com warning se ele não soube preencher
- **Closed irreversível** — operador erra no fechamento → criar nova aggregation com `year_month` adjusted é hack; aceito MVP, abrir reopenAggregation pós-piloto

### Riscos não endereçados

- **Mudança de regime mid-year** — tenant trocou de Simples pra Presumido em junho; apurações jan-mai usam Simples, jun-dez usam Presumido; `tax_regime` snapshot resolve, mas memorial pode confundir; doc UI explicará
- **Receita retroativa** (NFS-e emitida em maio mas competência fevereiro) — não é cenário comum em saúde; assumir `competência = mês de emissão` MVP; abrir issue se piloto pegar
- **Tenant multi-company com regimes distintos** — companies têm regime próprio (matriz Simples + filial MEI raro mas existe); agg por company resolve naturalmente, dashboard agrega no front-end

## Alternativas rejeitadas em mais detalhes

### A) Provider tributário externo (Contabilizei API / Omie Contabilidade / Alterdata API)

**Por quê não**: Lock-in (regra 46 LogiFit soberania perpétua). Contabilizei tem API mas força tenant a ter conta com eles (não acoplável); Omie cobra R$ 0,30+/cálculo; Alterdata é enterprise heavyweight. Motor próprio com tabela hardcoded é trivial (< 200 linhas de TS) — overkill delegar.

### B) Cálculo direto na UI sem persistir

**Por quê não**: Audit. Operador precisa fechar apuração e parar de mexer. Recalcular cada visita = números mudam quando dado fiscal antigo é corrigido (ex: cancelamento de NFS-e em mês passado). Snapshot resolve.

### C) Memorial em texto livre (não estruturado)

**Por quê não**: Memorial estruturado (`memorial jsonb` array) permite:
- Renderização consistente UI ↔ PDF
- Diff entre 2 apurações (debug pra entender por que mudou)
- I18n no MVP só em pt-BR mas estrutura aceita en-US/es-419 sem refactor
- Migration future pra "memorial multi-linguagem" sem perder dado

## Related

- **Estende** [ADR 0061 — Motor de retenções e cobertura fiscal faseada](0061-motor-retencoes-e-cobertura-fiscal-faseada.md) — implementa o slot "Sprint 37" descrito na seção "Fases futuras"
- **Reforça** [ADR 0059 — Ciclo fiscal emissão via Focus NFe](0059-ciclo-fiscal-emissao-focus-nfe.md) — apuração consome `fiscal_emissions` autorizadas
- **Reforça** [ADR 0091 — Self-host total Oracle SP](0091-self-host-total-oracle-sp.md) regra 46 — motor próprio = sem dependência externa nova
- **Bloqueia** ADR futuro Sprint 38 (Grupo D) — guias DAS/DARF dependem da apuração calculada aqui
- **Fontes**: LC 123/2006 (Simples Nacional) + LC 155/2016 (alterações Anexos), Lei 9.430/1996 (Lucro Presumido), Decreto 9.580/2018 (RIR), Resolução CGSN 140/2018 (regulamento Simples), Portaria RFB anual (atualização tabela Simples)
