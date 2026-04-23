# Acesso e Autorização

Modelo em 4 camadas. Cada camada é independente e reforça a anterior — se uma falha, a próxima ainda protege.

```
┌─────────────────────────────────────────────────────┐
│ 1. IDENTIDADE   Quem é você?         (Supabase Auth)│
├─────────────────────────────────────────────────────┤
│ 2. TENANT       De qual tenant?      (RLS raiz)     │
├─────────────────────────────────────────────────────┤
│ 3. RBAC         O que seu scope pode?               │
├─────────────────────────────────────────────────────┤
│ 4. CONSENT      Cross-module ou cross-company?      │
└─────────────────────────────────────────────────────┘
```

---

## Camada 1 — Identidade

- Autenticação via **Supabase Auth** (email + magic link, OAuth Google/Apple, senha).
- JWT assinado pelo Supabase, vida curta (1h), refresh token 30d.
- **MFA obrigatório** para roles profissionais (fisio, nutri, instrutor, admin, gerente, recepção). TOTP via aplicativo autenticador.
- Aluno/paciente: MFA opcional (recomendado).
- JWT viaja em cookie `httpOnly` (Next.js) + header `Authorization` (Supabase client direto).

### Claims customizados no JWT

Injetados via Supabase Auth Hook ao autenticar ou trocar contexto:

```ts
{
  sub: "uuid-do-user",
  tenant_id: "uuid-do-tenant-ativo",       // troca ao mudar contexto
  scopes: [                                 // roles + scopes do user no tenant ativo
    { role: "fisio", scope_type: "unit", scope_id: "uuid-unit-1" },
    { role: "fisio", scope_type: "unit", scope_id: "uuid-unit-2" },
  ],
  group_ids: ["uuid-group"],                // se user for group_owner (opcional)
  topology: "franchise",                    // topology do tenant ativo — útil para UI
  mfa: true,                                // MFA cumprido nesta sessão
}
```

### Sessão em múltiplos dispositivos

- Um usuário pode ter N sessões simultâneas (celular + notebook + tablet).
- Lista de sessões ativas em `/settings/sessions` — revogar individualmente.
- Logout global invalida todos os refresh tokens.
- Ações sensíveis (mudança de senha, adicionar MFA, acessar prontuário de outra company) exigem **re-prompt de MFA**.

---

## Camada 2 — Tenant (RLS raiz)

- Toda tabela de negócio tem `tenant_id uuid not null`.
- Toda tabela tem RLS policy:
  ```sql
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  ```
- Mesmo que código esqueça `WHERE tenant_id = ...`, o banco corta.
- **Usuário multi-tenant** (ex: fisio atende em 2 clínicas) tem uma linha em `user_tenants` por tenant. Ao logar, escolhe contexto ativo → Auth Hook injeta o `tenant_id` no JWT.
- **Trocar de contexto é sempre explícito** — volta para `/select-tenant`, onde o usuário escolhe o tenant ativo e o JWT é reassinado com o novo `tenant_id`. Nunca acontece silenciosamente. Cada troca é registrada em `audit_log`.

---

## Camada 3 — RBAC com scope

Tabelas:

```
roles               -- admin, recepcao, instrutor, fisio, nutri, diretor_rede,
                    -- gerente_filial, group_owner, aluno (roles base)
                    -- + roles custom do tenant (ex: contador_externo, recepcao_com_financeiro)
permissions         -- member.read, member.write, prontuario.read, prontuario.write,
                    -- financeiro.read, financeiro.write, copilot.use, agenda.write, ...
role_permissions    -- (tenant_id, role_id, permission) — editável por tenant (role custom)
user_roles          -- (user_id, role_id, scope_type, scope_id) — pacote de permissions via role
                    -- scope_type ∈ {group, tenant, company, unit}
user_permissions    -- (user_id, permission, scope_type, scope_id,
                    --  granted_by, granted_at, expires_at, revoked_at, reason)
                    -- grant direto pontual: uma permission específica, normalmente com validade
```

### Três caminhos de autorização (ADR 0019)

1. **Role base** — atribuir uma role existente (`recepcao`, `gerente_filial`, etc) em `user_roles`. Pacote fechado.
2. **Role custom do tenant** — admin do tenant edita `role_permissions` ou cria role nova (ex: `contador_externo` com `financeiro.read`). Perfil repetível.
3. **Grant direto em `user_permissions`** — exceção pontual ("Maria vê financeiro de `company:X` até 2026-12-31"). Sempre com `reason`; `expires_at` altamente recomendado.

As policies RLS fazem **union** de `user_roles` e `user_permissions` ativos: o user tem a permission se bater em QUALQUER das duas fontes. Função SQL centralizadora:

```sql
CREATE FUNCTION has_permission(
  p_user uuid, p_permission text, p_scope_type text, p_scope_id uuid
) RETURNS boolean AS $$
  SELECT EXISTS (
    -- via role
    SELECT 1 FROM user_roles ur
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    WHERE ur.user_id = p_user
      AND rp.permission = p_permission
      AND ur.scope_type = p_scope_type
      AND ur.scope_id = p_scope_id
    UNION ALL
    -- via grant direto
    SELECT 1 FROM user_permissions up
    WHERE up.user_id = p_user
      AND up.permission = p_permission
      AND up.scope_type = p_scope_type
      AND up.scope_id = p_scope_id
      AND up.revoked_at IS NULL
      AND (up.expires_at IS NULL OR up.expires_at > now())
  );
$$ LANGUAGE SQL STABLE;
```

Job noturno marca grants vencidos como `revoked_at = expires_at` para manter audit limpo.

### Exemplo de policy RLS combinando tenant + scope

```sql
CREATE POLICY "prontuario_visivel_por_scope"
  ON prontuarios FOR SELECT
  USING (
    -- Camada 2
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    AND (
      -- Camada 3: usuário tem permission com scope que cobre este registro
      EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN role_permissions rp ON rp.role_id = ur.role_id
        WHERE ur.user_id = auth.uid()
          AND rp.permission = 'prontuario.read'
          AND (
            (ur.scope_type = 'tenant' AND ur.scope_id = prontuarios.tenant_id)
            OR (ur.scope_type = 'company' AND ur.scope_id = prontuarios.company_id)
            OR (ur.scope_type = 'unit' AND ur.scope_id = prontuarios.unit_id)
          )
      )
    )
  );
```

### Matriz de roles × scopes

Ver [multiempresa.md — RBAC e scopes](multiempresa.md#rbac-e-scopes).

---

## Camada 4 — Consent (cross-module e cross-company)

Cross-module dentro do mesmo tenant (ex: instrutor ver lesão do aluno registrada pelo fisio) **não** é padrão — exige consentimento explícito do paciente.

### Tabela `consents`

```
consents (
  id,
  tenant_id,
  member_id,              -- quem consente
  purpose,                -- 'alert_injury_to_training', 'share_diet_to_training', ...
  scope_type,             -- 'cross_module' | 'cross_company'
  source_module,          -- 'fisio'
  target_module,          -- 'academia'
  granted_at,
  expires_at,             -- opcional; renovação periódica para LGPD
  revoked_at,             -- null se ativo
  legal_basis             -- 'consent' | 'vital_interest' | etc (LGPD)
)
```

### Regras duras (ver [rules.md](rules.md))

- **Dado clínico nunca cruza `company_id`** quando `tenant.topology = 'franchise'` — nem com consent (regulatório CFM/CREFITO/CRN). Regra 25.
- **Dado individual nunca cruza `tenant_id`** — mesmo com dono comum. Regra 26.
- Toda leitura de dado sensível que passou por `consents` grava em `audit_log` com referência ao consent usado.

### UX de consentimento

- Fluxo obrigatório de onboarding do aluno/paciente — consents granulares com opt-in explícito por categoria.
- Paciente pode revogar a qualquer momento em `/perfil/privacidade`. Efeito imediato (RLS passa a bloquear).
- Renovação periódica configurável por tenant (ex: revalidar consents a cada 12 meses).

---

## Audit log

- Append-only, particionado por mês.
- Registra: `user_id`, `tenant_id`, `company_id`, `unit_id`, `action`, `resource_type`, `resource_id`, `consent_id` (se aplicável), `ip`, `user_agent`, `at`.
- Leitura de dado sensível **sempre** grava audit — performance impact aceito (async write via trigger + partition).
- Audit é acessível apenas para role `audit_viewer` (super-admin do tenant ou LogiFit em suporte).

---

## Login contextual (usuário multi-tenant / group_owner)

Fluxo:

1. User loga com email + senha + MFA se aplicável.
2. Sistema verifica quantos contextos user tem: quantos `user_tenants` + se é `group_owner` de algum grupo.
3. Se **exatamente 1 contexto**: entra direto, JWT com `tenant_id` setado.
4. Se **múltiplos contextos**: tela de seleção "onde você quer entrar?" — lista tenants + dashboard de grupo (se for owner).
5. Ao escolher: Auth Hook reassina JWT com `tenant_id` e `scopes[]` daquele contexto.
6. Trocar contexto depois = botão "trocar tenant" leva de volta para `/select-tenant` e reassina o JWT no novo contexto. Nunca silencioso. Cada troca grava `audit_log`.

---

## Matriz resumida

| Ação | Camada que decide |
|---|---|
| "Quem é o usuário?" | 1. Identidade (Supabase Auth) |
| "Pode ver dados deste tenant?" | 2. RLS raiz |
| "Pode ler esta tabela/coluna?" | 3. RBAC (role + permission) |
| "Pode ler este registro específico?" | 3. Scope do user_role |
| "Pode cruzar módulos/companies?" | 4. Consent (+ regra 25 se franchise) |
| "Quem operou o quê quando?" | Audit log (append-only) |

---

## Referências

- [ADR 0002 — RLS como isolamento primário](decisions/0002-rls-como-isolamento-primario.md)
- [ADR 0005 — RBAC com consent cross-module](decisions/0005-rbac-com-consent-cross-module.md)
- [multiempresa.md](multiempresa.md) — hierarquia e scopes
- [rules.md](rules.md) — regras 1, 2, 5, 6, 25, 26
