---
slug: workflow-aprovacao-ap-declarativo
status: accepted
date: 2026-05-14
---

# ADR 0034 — Workflow de aprovação AP declarativo (`approval_rules` + `approval_trace`)

## Contexto

Sprint 15 entrega Contas a Pagar (AP) com pipeline `draft → pending_approval → approved → scheduled → paid → reconciled`. Operador financeiro lança uma AP, alguém (que **não** é quem lançou — segregação de funções) aprova ou rejeita. Quem aprova depende do **valor**:

- Até R$ 500: gasto operacional pequeno → auto-aprovação (gerente já registrou)
- R$ 500–R$ 5.000: gerente financeiro precisa aprovar
- Acima de R$ 5.000: gerente financeiro + diretor (em série)

Esses limiares variam por empresa. Rede com 10 filiais pode ter teto diferente em cada uma. Tenant Enterprise pode customizar workflow completo.

Sem um modelo declarativo, isso vira `if amount > X then ...` codificado, com regras espalhadas em N arquivos e nenhum jeito de adminis tenant criar/alterar.

## Decisão

### Tabela `approval_rules` com DSL JSON declarativa

```sql
CREATE TABLE approval_rules (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  scope approval_rule_scope NOT NULL, -- ap | ar | both
  company_id uuid NULL,                -- regra específica por filial
  min_amount_cents bigint NOT NULL,    -- inclusivo
  max_amount_cents bigint NULL,        -- inclusivo; NULL = sem teto
  required_approvers jsonb NOT NULL,   -- { mode, approvers[] }
  active bool NOT NULL DEFAULT true,
  ...,
  CHECK (max_amount_cents IS NULL OR max_amount_cents >= min_amount_cents)
);
```

**`required_approvers jsonb`** validado por Zod `RequiredApproversSchema`:

```json
{
  "mode": "series" | "parallel",
  "approvers": [
    { "role": "gerente_financeiro" },
    { "role": "diretor", "companyId": "uuid-opcional" },
    { "userId": "uuid-pessoa-especifica" }
  ]
}
```

- **`mode='series'`** (default) — aprovadores na ordem do array; estado avança quando o último aprovou
- **`mode='parallel'`** — todos os aprovadores precisam aprovar mas em qualquer ordem
- **`approvers: []`** — auto-aprovação (lançamento abaixo do limite operacional)

### `approval_trace jsonb` na AP (append-only histórico)

```json
[
  { "at": "2026-05-14T10:00", "byUserId": "...", "action": "submitted" },
  { "at": "2026-05-14T14:00", "byUserId": "...", "byRole": "gerente_financeiro",
    "action": "approved", "comment": "OK, alugue maio matriz" }
]
```

Cada ação (submitted/approved/rejected/comment) vira entrada com timestamp ISO + autor.

### Engine puro `packages/db/src/erp-financeiro/approval.ts`

3 funções principais:

1. **`pickApprovalRule(amountCents, companyId, rules)`** — dentre as ativas que englobam o valor, retorna a de **menor max_amount_cents** (rule mais específica). Prioriza rule com `companyId` específico antes de global ao tenant. Retorna `null` se nenhuma engloba (AP sem aprovação requerida = passa direto).

2. **`decideNextState({amount, company, rules, trace})`** — máquina de estado retorna:
   - `{state: 'approved', reason: 'no_rule_required'}` — sem rule matching
   - `{state: 'approved', reason: 'auto_approved', ruleId}` — rule com approvers vazio
   - `{state: 'approved', reason: 'all_approvers_done', ruleId}` — todos os approvers já aprovaram
   - `{state: 'pending_approval', nextApprover, ruleId}` — series, próximo da fila
   - `{state: 'pending_approval', remainingApprovers, ruleId}` — parallel, lista pendentes
   - `{state: 'rejected', reason}` — trace contém rejeição

3. **`canUserApprove({userId, userRoles, ...})`** — valida que o user é o próximo aprovador (series) ou está na lista de pendentes (parallel) antes de Server Action `approveAP` aceitar. Bloqueia tentativa de "aprovar fora de ordem".

### Server Actions consomem o engine

- `submitForApproval` — passa de draft pra pending_approval E roda `decideNextState` (rule sem approvers = direto pra approved)
- `approveAP` — chama `canUserApprove` antes; adiciona entrada no trace; roda `decideNextState`; transiciona estado
- `rejectAP` — adiciona rejeição no trace; transiciona pra 'rejected'

### Rules canônicas no seed por tenant

```typescript
[
  { name: 'Auto-aprovação até R$ 500',
    min: 0, max: 50000, approvers: [] },
  { name: 'Gerente financeiro até R$ 5.000',
    min: 50001, max: 500000, approvers: [{role: 'gerente_financeiro'}] },
  { name: 'Gerente + Diretor acima de R$ 5.000',
    min: 500001, max: null, approvers: [{role: 'gerente_financeiro'}, {role: 'diretor'}] }
]
```

Operador admin pode customizar via `/app/settings/financeiro/aprovacao` (UI Sprint 15+ próximo PR).

## Consequências

**Positivas:**
- Workflow sem código duplicado em cada cliente
- Tenant Enterprise customiza tetos via UI (sem deploy)
- Audit completo via `approval_trace` (regra 5 + LGPD)
- `canUserApprove()` é função pura testável (21 unit tests cobrem matrix de casos)
- Engine cobre series/parallel sem mudar schema
- Próximo aprovador é determinístico (UI mostra "aguardando role X")

**Negativas:**
- Rules com sobreposição podem confundir (rule R$ 1k-5k vs rule R$ 2k-10k). Mitigação: `pickApprovalRule` escolhe menor `max_amount_cents` (mais específica); UI mostra preview "AP de R$ X cairá em rule Y".
- Sem escalada por timeout — AP fica pending indefinidamente se aprovador não age. Adiado pra Sprint 15+: job cron que dispara reminder via Sprint 13 régua após N dias.
- Rejeição revoga aprovações parciais? **Sim** — trace.find(rejected) curto-circuita `decideNextState` antes de checar approvals. Isso é intencional pra evitar dúvida ("foi aprovada mas tem rejeição mistura?"). Sprint 15+ pode adicionar `revokeRejection`.

**Neutras:**
- Mode 'parallel' implementado mas no MVP só 'series' é usado nos seeds canônicos
- `userId` específico (vs `role`) suportado pra casos especiais (CEO aprova todas acima de X), mas seed canônico usa só role

## Alternativas consideradas

**Workflow engine externo (Temporal, Camunda)** — overkill pra ~5 estados + 3-5 rules por tenant. Adiciona infra. Rejeitado.

**Stored procedures Postgres** — boa idea pra atomicidade, mas torna debugging horrível. Função pura TS + Drizzle UPDATE em transação cobre. Rejeitado.

**Hardcode tetos no código** (`if amount > 5000 then require gerente`) — não escala pra customização per-tenant nem per-company. Rejeitado.

**Sem workflow, todo lançamento vira `approved` direto** — perde segregação de funções (quem lança = quem aprova = quem paga). Rejeitado: ERP precisa do controle.

**Rule via SQL `CASE WHEN amount > X`** — funciona mas perde audit visual (operador admin não consegue ver/editar rule). Rejeitado.

## Status

Accepted (2026-05-14, Sprint 15 Faixa A + B).

## Referências

- [Sprint 15 — ERP Financeiro Core](../sprints/15-geral-erp-financeiro-core.md)
- [ADR 0033](0033-plano-contas-hierarquico-erp-financeiro.md) — plano de contas que cada AP referencia
- [ADR 0071](0071-sistema-tratamento-erros-alertas-tempo-real.md) — envelope `wrapServerAction` que consome o engine
- `packages/db/src/erp-financeiro/approval.ts` — engine puro com 21 unit tests
