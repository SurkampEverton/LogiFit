# Multi-empresa: group → tenant → company → unit

Modelo hierárquico em 4 níveis que cobre loja avulsa, rede própria, franquia, holding/grupo organizacional e mixes dos anteriores — tudo com o mesmo schema.

---

## Os 4 níveis

```
┌───────────────────────────────────────────────────────────────┐
│ GROUP    "Grupo João Holdings"   (organizacional, sem CNPJ)   │
│  │                                                             │
│  ├── TENANT  "Rede Fit Pro"    (contrato SaaS 1)              │
│  │    ├── COMPANY Matriz Fit Pro   CNPJ 11.111                │
│  │    │    └── UNIT Sede, Shopping                            │
│  │    ├── COMPANY Filial SP        CNPJ 22.222                │
│  │    │    └── UNIT Pinheiros                                 │
│  │    └── COMPANY Filial RJ        CNPJ 33.333                │
│  │         └── UNIT Copa                                      │
│  │                                                             │
│  └── TENANT  "Academia do Centro"   (contrato SaaS 2, avulsa) │
│       └── COMPANY Matriz           CNPJ 44.444                │
│            └── UNIT Centro                                    │
└───────────────────────────────────────────────────────────────┘
```

| Nível | É o quê | CNPJ | RLS primária | Dado sensível cruza? | Billing |
|---|---|---|---|---|---|
| `group` | Conjunto organizacional do mesmo dono | Não | Não (só agregados) | **Nunca** cruza tenants | Não cobra |
| `tenant` | Contrato SaaS (rede/empresa contratante) | Indireta | **Sim, raiz** | Isolado | **Aqui cobra** |
| `company` | Pessoa jurídica (matriz ou filial) | **Sim, 1 por company** | Não (autorização) | Isolado em franchise | Emite NF-e |
| `unit` | Local físico (endereço) | Não | Não (autorização) | Operacional | — |

---

## Regra base: matriz obrigatória, filial opcional

- Todo tenant tem **exatamente 1** `company` com `type='matriz'`. Enforced por constraint.
- Filiais são **0..N** — podem não existir.
- **Loja avulsa = 1 tenant + 1 matriz + 1 unit.** Não cria nível extra.
- Crescer virando rede = `INSERT INTO companies (type='filial', ...)`. Zero migração.

---

## Flags do tenant

Três flags em `tenants` definem o comportamento:

### `topology`: `owned` | `franchise`

- **`owned`** — todas as companies pertencem ao mesmo dono. Admin da matriz tem scope operacional automático nas filiais. Dashboard consolidado é natural.
- **`franchise`** — companies têm donos distintos. Admin da matriz **não** tem scope operacional nas filhas; vê só agregados anonimizados. Cada filial é autônoma.

### `financial_mode`: `centralized` | `distributed`

- **`centralized`** — só a matriz tem CNPJ/Asaas ativos; filiais são operacionais, não fiscais. Na prática, cliente modela como "1 matriz + N units" sem companies filiais.
- **`distributed`** — cada company tem CNPJ próprio, conta Asaas própria, emite NF-e própria. DRE consolidado é relatório que soma companies.

### `cross_company_access`: `true` | `false`

- **`true`** — aluno pode fazer check-in em qualquer unit da rede (respeitado RBAC).
- **`false`** — aluno só acessa units da sua company contratual.

---

## Os 4 cenários canônicos (obrigatórios no seed de dev/teste)

### 1. Rede própria com múltiplos CNPJs
`owned` + `distributed` + `cross=true`

Dono tem matriz + filiais, cada uma com CNPJ próprio, alunos circulam livre. DRE consolidado. Exemplo: "Rede Fit Pro".

### 2. Franquia clássica
`franchise` + `distributed` + `cross=false`

Cada franquia é autônoma, alunos não circulam. Admin da matriz não opera filiais, só vê agregados. Exemplo: Smart Fit-like.

### 3. Franquia com passaporte
`franchise` + `distributed` + `cross=true` com `franchise_agreements`

Franqueados aceitam aluno de outras franquias mediante acordo bilateral. Tabela `franchise_agreements` define pares, split, condições. Exemplo: rede de academias com "plano rede nacional".

### 4. Mix loja avulsa + rede no mesmo group
`group` agrega 2+ tenants de perfis diferentes. Dono vê dashboard consolidado de todos seus negócios. Exemplo: "Grupo João" com 1 rede grande + 1 loja avulsa independente.

CI roda teste de RLS contra os 4 cenários. Se um quebra, pipeline falha.

---

## Mobilidade do aluno

| Caso | Regra |
|---|---|
| Aluno dentro da **mesma company** | Sempre pode |
| Aluno cross-company **mesmo tenant** | Respeita `tenant.cross_company_access` |
| Aluno cross-tenant **mesmo group** | **Nunca** (são empresas juridicamente distintas) |
| Aluno cross-group | **Nunca** |
| Transferência de aluno entre filiais | `UPDATE members SET company_id = X` + `audit_log`. Nunca deletar/recriar |

Em franchise com passaporte, check-in cross-company dispara regra de billing/split conforme `franchise_agreements`.

---

## RBAC e scopes

Roles têm **escopo**. `user_roles` tem `scope_type` (`group | tenant | company | unit`) + `scope_id`.

| Role típica | Scope típico em `owned` | Scope típico em `franchise` |
|---|---|---|
| `super_admin_rede` | `tenant` (vê tudo) | `tenant` mas só agregados |
| `diretor_matriz` | `tenant` | `company:matriz` |
| `gerente_filial` | `company:X` | `company:X` (super-admin da franquia) |
| `recepcao` | `unit:Y` | `unit:Y` |
| `fisio` / `nutri` | `unit:Y,Z` (várias) | `unit:Y,Z` dentro da mesma company |
| `instrutor` | `unit:Y` | `unit:Y` |
| `aluno` | próprios dados + check-in conforme `cross_company_access` | idem |
| `group_owner` | `group:G` — agregados, nunca dado individual | idem |

---

## Dono do grupo (role `group_owner`)

- Vê dashboard `/group/:id` com KPIs consolidados (alunos ativos, faturamento 30d, ticket médio) via **views agregadas** (`group_metrics`).
- **Nunca** acessa CPF, prontuário, apontamento individual só com scope de grupo.
- Para operar qualquer tenant do grupo, precisa de role adicional explícito naquele tenant (`diretor_rede`, `admin_loja`).
- Troca de contexto via botão "entrar em [Tenant]" — JWT é reassinado com `tenant_id` do contexto e o usuário passa a ver dados operacionais conforme scope.
- Toda operação em cada tenant fica registrada em `audit_log` do tenant.

---

## Árvore de decisão: várias lojas do mesmo dono

| Situação | Modelagem correta |
|---|---|
| Alunos circulam, agenda compartilhada, operação integrada | **1 tenant, N companies** (rede com múltiplos CNPJs, `cross=true`) |
| Negócios separados operacionalmente, dono quer só consolidado | **N tenants, mesmo `group`** |
| Em dúvida | **N tenants, mesmo `group`** (padrão conservador: unir 2 tenants depois é fácil; separar 1 tenant em 2 é quase impossível) |

---

## Referências

- [ADR 0006 — Hierarquia group → tenant → company → unit](decisions/0006-hierarquia-group-tenant-company-unit.md)
- [ADR 0007 — Topology owned vs franchise](decisions/0007-topology-owned-vs-franchise.md)
- [ADR 0008 — Group como camada agregada](decisions/0008-group-como-camada-agregada.md)
- [ADR 0009 — Loja avulsa não vira nível próprio](decisions/0009-loja-avulsa-nao-vira-nivel-proprio.md)
- [Regras 21–26 em rules.md](rules.md)
