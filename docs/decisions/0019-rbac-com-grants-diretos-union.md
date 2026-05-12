---
slug: rbac-com-grants-diretos-union
status: accepted
date: 2026-05-12
---

# ADR 0019 — RBAC com grants diretos + union em policies RLS

## Contexto

LogiFit precisa de modelo de autorização que suporte **3 padrões de uso reais**:

1. **Atribuição via role** — caso comum. Operador é `fisio`, role traz pacote
   canônico de permissions (`evolucao.write`, `prontuario.read`, etc).
2. **Role custom por tenant** — algumas redes querem variações: "recepção
   com financeiro" (recepção + `financeiro.read`) sem afetar a role canônica.
3. **Grant direto pontual** — exceções com tempo de vida: "Mariana vai cobrir
   férias da gerente; precisa de `financeiro.write` por 30 dias". Não vira
   role (não é permanente; não vai herdar promoções da role).

Modelos rejeitados:

- **Só roles** (sem grants diretos): força criar role "Mariana_substituindo_gerente"
  que nunca mais é reutilizada — explosion de roles e nenhuma rastreabilidade
  de quem teve acesso temporário.
- **Só grants diretos** (sem roles): atribuir 25 permissions individualmente
  em cada novo fisio que entrar é insustentável + erros de "esqueceu permission
  X em alguém".
- **Sem expiração obrigatória em grants**: vira via lateral pra acesso
  permanente sem audit; grant fica esquecido na DB pra sempre.

## Decisão

**Modelo híbrido RBAC + Grants** com **union em policies RLS**:

### Camadas de permission

```
user → user_roles → roles → role_permissions → permissions ─┐
                                                            ├→ has_permission(user_id, perm, scope) → boolean
user → user_permission_grants ─→ permissions ───────────────┘
```

Função SQL `has_permission(user_id uuid, permission text, scope_type text, scope_id uuid)`:

```sql
RETURNS boolean AS $$
BEGIN
  -- Permission vem via role?
  IF EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    WHERE ur.user_id = p_user_id
      AND rp.permission_key = p_permission
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
      AND (
        -- Sem scope no user_role = vale pro tenant inteiro (todos os escopos)
        (ur.scope_company_id IS NULL AND ur.scope_unit_id IS NULL)
        -- Match exato de scope
        OR (p_scope_type = 'company' AND ur.scope_company_id = p_scope_id)
        OR (p_scope_type = 'unit' AND ur.scope_unit_id = p_scope_id)
      )
  ) THEN
    RETURN true;
  END IF;

  -- Permission vem via grant direto?
  IF EXISTS (
    SELECT 1 FROM user_permission_grants upg
    WHERE upg.user_id = p_user_id
      AND upg.permission_key = p_permission
      AND upg.revoked_at IS NULL
      AND (upg.expires_at IS NULL OR upg.expires_at > now())
      AND (
        (upg.scope_company_id IS NULL AND upg.scope_unit_id IS NULL)
        OR (p_scope_type = 'company' AND upg.scope_company_id = p_scope_id)
        OR (p_scope_type = 'unit' AND upg.scope_unit_id = p_scope_id)
      )
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;
```

### UX obrigatória pra grants

- Formulário `/app/settings/users/[id]/grants` exige:
  - `permission` (select do catálogo)
  - `scope` (`tenant` | `company:id` | `unit:id`)
  - `expires_at` **obrigatório default**; "sem expiração" exige dropdown de
    justificativa (3 opções: `permanent_role_replacement`, `temporary_audit`,
    `regulatory_requirement`)
  - `reason text` ≥20 chars
  - `granted_by` = `session.user.id` automático
- Job cron noturno (`mark-grants-expired`) marca `revoked_at = expires_at`
  quando `expires_at < now()`. Idempotente.
- Audit log entry `grant.created` + `grant.revoked` (regra 5 + 39 hash chain).

### Policies RLS com union

Toda policy de write em `tenant`-scoped tables consulta `has_permission`:

```sql
CREATE POLICY persons_write ON persons
  FOR INSERT
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id')::uuid
    AND has_permission(
      current_setting('app.user_id')::uuid,
      'person.write',
      'tenant',
      tenant_id
    )
  );
```

Sprint 01a Faixa A já fez RLS por tenant_id. Faixa B do 01b **estende** as
policies de write com `has_permission()` call.

### Roles vs grants — quando usar cada

| Critério | Usar role | Usar grant direto |
|---|---|---|
| Permanente | ✅ | ❌ (grant sempre expira) |
| Aplica a múltiplos users | ✅ | ❌ (1 grant = 1 user) |
| Padrão da indústria (CRM, CRN, CREFITO) | ✅ (system role) | ❌ |
| Cobertura temporária (férias, substituição) | ❌ | ✅ |
| Audit exige rastro nominal | ❌ (todos da role têm) | ✅ (granted_by + reason) |
| Acesso emergencial DPO | ❌ | ✅ (PAM Sprint 07 amplia) |

### Constraint: roles canônicas vs custom

- **System roles** (`roles.system=true`, `tenant_id IS NULL`) — não editáveis,
  vêm de seed migration. Roles canônicas LGPD/CFM/CFN/COFFITO ficam aqui.
- **Custom roles** (`roles.system=false`, `tenant_id NOT NULL`) — tenant pode
  criar/editar/deletar via `/app/settings/roles`. Útil pra variações tipo
  "recepcao_com_financeiro".
- `role_permissions` permite WRITE em custom roles, READ-ONLY em system.

## Alternativas consideradas

### Modelo Casbin (Go) / OPA Rego

- ✅ DSL externa pra políticas complexas
- ❌ **Acoplamento com runtime externo** (Casbin DSL parser ou OPA daemon) —
  Sprint 01a optou por self-host total (ADR 0091); evitar yet-another-service
- ❌ Debugging em policy DSL é mais difícil que SQL puro
- ❌ Cache de decisões precisa Redis (já temos) mas adiciona latência

### Permission-on-resource (Postgres `pg_authid` + GRANT)

- ✅ Native Postgres — leva RLS pro próximo nível
- ❌ Postgres GRANT é tabela-level (não row-level); RLS continua sendo a
  ferramenta certa, mas usar pg_authid pra simular RBAC vira spaghetti
- ❌ Não suporta scope (company_id/unit_id) sem hack — precisa criar role
  por scope, explosion combinatorial
- ❌ Migrate de roles via SQL puro (sem Drizzle migration) quebra regra 3

### CASL (TypeScript runtime check em código)

- ✅ Boa DX em Server Action (`ability.can('person.write', personId)`)
- ❌ **Check em código não substitui RLS** — atacante com DB direct skip do
  CASL; precisa de defesa em profundidade (CASL + RLS). LogiFit mantém RLS
  como guarda raiz; CASL como nice-to-have UX em UI.

## Consequências

### Positivas

- Modelo simples (2 tabelas: `user_roles` + `user_permission_grants`) cobre
  3 padrões de uso reais
- Função `has_permission` centraliza lógica — Sprint 02+ que adiciona
  permissions novas não precisa duplicar checks
- RLS continua sendo guarda raiz; check em policy SQL é defensa em
  profundidade contra app-bug
- Audit trail rico: `granted_by` + `reason` + `expires_at` permite forensics
  retroativo ("quem deu permission X pra Y?")
- Expiração obrigatória default elimina grants "fantasma" (criados pra
  emergência + esquecidos pra sempre)

### Negativas

- 1 query extra por policy de write (lookup `has_permission`). Mitigação:
  função é `STABLE` (Postgres cacheia dentro do mesmo statement); roles
  ativas via `user_roles.expires_at IS NULL` cobrem >95% dos casos.
- Modelo exige 2 tabelas em vez de 1 (`user_permissions` unificada). Aceito
  porque a distinção semântica (via role ≠ grant direto) é importante pra
  UX + audit.
- `has_permission` retorna bool — sem detalhes de POR QUE acesso negado.
  Sprint 02+ adiciona variante `explain_permission()` que retorna jsonb
  com diagnostic (para suporte resolver "por que recepção não vê
  financeiro").

### Decisões derivadas

1. **`user_permission_grants`** (Sprint 01a Faixa C já criou o schema; Sprint
   01b apenas usa) — colunas `id`, `tenant_id`, `user_id`, `permission_key`,
   `scope_company_id`, `scope_unit_id`, `granted_by`, `granted_at`,
   `expires_at nullable`, `revoked_at nullable`.
2. **`expires_at` é canônico** — se NULL, exige `reason` que inclua palavra
   `permanent` (validação Zod no Server Action).
3. **`role_permissions` é editável pra `system=false`** — UI `/app/settings/roles`
   permite tenant criar role custom; system roles ficam visualizadas read-only.
4. **Job `mark-grants-expired`** roda diariamente 03:00 UTC junto com
   `process-trial-lifecycle` (compartilha daemon node-cron Sprint 03+).
5. **Permission canon namespace** continua sendo `resource.action`
   (`person.read`, `invoice.cancel`). Permission nova vem via migration
   `seed-permission-X` + adiciona em roles relevantes.

## Status

**Accepted** — 2026-05-12.

## Referências

- [Sprint 01a Faixa C](../sprints/01a-identidade-e-topology.md) — schema RBAC base
- [Sprint 01b](../sprints/01b-rbac-e-consent.md) — implementação completa
- [Regra 42](../rules.md) — passaporte cross-tenant (`has_permission` chamada quando dado cruza tenant)
- [Regra 43](../rules.md) — MFA obrigatório em roles profissionais (`roles.requires_mfa=true`)
- [ADR 0005 — RBAC com consent cross-module](0005-rbac-com-consent-cross-module.md) — base conceitual
