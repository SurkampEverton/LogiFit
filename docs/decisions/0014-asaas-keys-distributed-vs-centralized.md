---
slug: asaas-keys-distributed-vs-centralized
status: accepted
date: 2026-05-13
---

# ADR 0014 — Chaves Asaas: por company (distributed) vs por tenant (centralized)

## Contexto

[ADR 0010](0010-financial-mode-centralized-usa-1-matriz-n-units.md) define
`tenant.financial_mode` enum `centralized | distributed`:

- **`centralized`** (default — rede própria): toda receita entra numa única
  conta jurídica (matriz). Filiais não têm CNPJ próprio operacional. Asaas é
  uma chave única do tenant via matriz.
- **`distributed`** (franquia clássica): cada company (CNPJ próprio) tem sua
  conta Asaas. Cobrança gerada por uma filial vai pra conta dessa filial.

Schema `asaas_keys` precisa modelar isso sem permitir estado inválido (ex:
ter chave centralized + chave por company simultaneamente).

## Decisão

Tabela `asaas_keys` com `company_id` **nullable**:

```sql
CREATE TABLE asaas_keys (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NULL REFERENCES companies(id),
  api_key text NOT NULL,  -- cifrado via envelope-crypto (Sprint 04 Faixa B)
  sandbox boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  ...
)
```

Regra:
- `tenant.financial_mode='centralized'` → 1 row com `company_id IS NULL`
- `tenant.financial_mode='distributed'` → N rows com `company_id IS NOT NULL`

### Enforcement

**1. Unique parcial em chave ativa**:

```sql
CREATE UNIQUE INDEX asaas_keys_tenant_company_active_uq
  ON asaas_keys (tenant_id, company_id)
  WHERE active = true;
```

Garante:
- No `centralized`: só 1 row ativa com `company_id NULL` por tenant (NULL =
  NULL no Postgres UNIQUE WHERE com expressão é tratado como distinto, então
  vamos ter no máximo 1 row `(tenant_id, NULL)` ativa)
- No `distributed`: só 1 row ativa por `(tenant_id, company_id)` pair

**2. Trigger AFTER INSERT/UPDATE (Sprint 04 Faixa D ou Sprint 05+)** valida
contra `tenants.financial_mode`:
- INSERT com `company_id IS NULL` quando `financial_mode='distributed'` → reject
- INSERT com `company_id IS NOT NULL` quando `financial_mode='centralized'` → reject

MVP Sprint 04 Faixa A: regra enforced em Server Action `setAsaasKey()` (Sprint
04 Faixa C). Trigger SQL como defesa em profundidade vira Sprint 05+ quando
houver clientes em produção.

### Resolução de chave em runtime

Server Action `getAsaasKeyForCompany(tenantId, companyId)`:

```typescript
// Tenta chave da company (distributed)
const distributed = await db.select().from(asaasKeys).where(
  and(eq(asaasKeys.tenantId, tenantId), eq(asaasKeys.companyId, companyId), eq(asaasKeys.active, true))
).limit(1)
if (distributed[0]) return distributed[0]

// Fallback: chave central (centralized)
const central = await db.select().from(asaasKeys).where(
  and(eq(asaasKeys.tenantId, tenantId), isNull(asaasKeys.companyId), eq(asaasKeys.active, true))
).limit(1)
if (central[0]) return central[0]

throw new ApiException({ code: 'CONFIG_ERROR', message: 'Asaas key não configurada' })
```

Lookup é O(1) com index `asaas_keys_tenant_idx`. Sprint 05+ cacheia 5min em
Redis.

### Criptografia

`api_key` armazenado cifrado via `@repo/security/envelope-crypto`:
```
enc:v1:{base64 iv (12 bytes)}:{base64 ciphertext+tag}
```

Chave-mestre em env `LOGIFIT_DATA_KEY` (32 bytes base64). Sprint 04+ Faixa D
migra pra per-tenant em KMS externo (AWS KMS, Cloud KMS GCP) quando houver
cliente Enterprise exigindo BYOK.

`decryptSecret()` tolera plain text legado (rows pré-Faixa B) sem prefix
`enc:` — migração progressiva ao salvar com `updateAsaasKey()`.

## Alternativas consideradas

### A. Tabela separada `tenant_asaas_keys` + `company_asaas_keys`

Duas tabelas, schema por modo financial:

- ❌ Drift garantido: lookup precisa decidir qual tabela consultar baseado em
  `tenant.financial_mode` → racing condition se tenant muda de modo mid-flight
- ❌ Duplica colunas (api_key, sandbox, active) entre tabelas
- ❌ Trigger pra trocar tabela quando `tenant.financial_mode` muda é absurdo

### B. JSONB column em `tenants.asaas_config`

```json
{
  "mode": "distributed",
  "keys": [
    { "company_id": "uuid1", "api_key": "enc:v1:..." },
    { "company_id": "uuid2", "api_key": "enc:v1:..." }
  ]
}
```

- ❌ Sem RLS nativa (a JSONB inteira é vista/escondida)
- ❌ UPDATE racing com 2 admins simultâneos sobrescreve um pelo outro
- ❌ Não dá pra deduplicar com index UNIQUE
- ❌ Difícil de auditar quem mudou qual chave (audit precisa diff jsonb manual)

### C. Modelo LogiFit (escolhido) — 1 tabela com company_id nullable

- ✅ Schema simples (1 tabela, regra clara em 1 unique index parcial)
- ✅ RLS nativa (row inteira é scoped per-tenant)
- ✅ Mudança de `financial_mode` é migration: arquiva chave antiga, cria nova
  (não muda schema)
- ✅ Trigger SQL de defesa em profundidade entra em sprint posterior sem migration

## Consequências

### Positivas

- **Lookup limpo em 2 queries** (distributed fallback central) — sem decision
  tree baseada em `financial_mode`
- **Audit completo**: cada chave tem `createdAt`/`updatedAt`/`active` — admin
  desativa chave antiga sem deletar (histórico fiscal preservado)
- **Migração de modo (`centralized` ↔ `distributed`) é operação simples**:
  arquivar chaves antigas via `active=false`; criar novas com novo escopo
- **Defesa em profundidade compatível**: Sprint 05+ adiciona trigger SQL +
  Zod validation no Server Action sem tocar no schema

### Negativas

- **2 queries pra resolver chave** (uma scoped na company, fallback central)
  — mitigado por cache Redis 5min (Sprint 05+)
- **NULL em UNIQUE WHERE** comporta-se como distinto no Postgres (cada NULL
  é considerado distinto de outro NULL na expressão WHERE). Pra centralized,
  isso permite tecnicamente 2 rows `(tenant_id, NULL)` ativas. Mitigação:
  trigger Sprint 05+ enforça hard. MVP usa convenção: admin só cria 1 chave
  centralized via Server Action que checa antes
- **Crypto envelope sync** com `LOGIFIT_DATA_KEY` — se chave vaza, todas as
  chaves Asaas viram plaintext. Mitigação: variável env em secret store
  Coolify; rotação manual via re-encryption batch (Sprint 05+)

## Migração futura

Sprint 04+ Enterprise tier:
1. Per-tenant `data_keys` table com chave-mestre própria criptografada com KEK
   externa (AWS KMS, Cloud KMS GCP)
2. `decryptSecret()` aceita `tenantId` arg pra buscar chave correta
3. Compatível com prefix `enc:v2:...` (rotação algorítmica futura)

## Referências

- [Sprint 04 — Geral · Financeiro Asaas](../sprints/04-geral-financeiro-asaas.md)
- [ADR 0010 — financial_mode centralized vs distributed](0010-financial-mode-centralized-usa-1-matriz-n-units.md)
- [ADR 0013 — Plano + Contrato + Cobrança entidades separadas](0013-plano-contrato-cobranca-entidades-separadas.md)
- [Regra 35 — Security defesa em profundidade](../rules.md#35)
- [`packages/security/src/envelope-crypto.ts`](../../packages/security/src/envelope-crypto.ts)
