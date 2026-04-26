# Acesso e Autorização

Modelo em 4 camadas. Cada camada é independente e reforça a anterior — se uma falha, a próxima ainda protege.

```
┌─────────────────────────────────────────────────────────────┐
│ 1. IDENTIDADE   Quem é você?              (Supabase Auth)   │
├─────────────────────────────────────────────────────────────┤
│ 2. TENANT       De qual tenant?           (RLS raiz)        │
├─────────────────────────────────────────────────────────────┤
│ 3. RBAC         O que seu scope pode?                       │
├─────────────────────────────────────────────────────────────┤
│ 4. CONSENT      Cross-module, cross-company, cross-tenant?  │
└─────────────────────────────────────────────────────────────┘
```

---

## Camada 1 — Identidade

- Autenticação via **Supabase Auth** (email + magic link, OAuth Google/Apple, senha).
- JWT assinado pelo Supabase, vida curta (1h), refresh token 30d.
- **MFA obrigatório** ([regra 43](rules.md)) para roles clínicos `medico`, `fisio`, `nutri`, `personal`, `enfermeiro` e administrativas críticas `tenant_owner`, `dpo`, `super_admin` (todos com `roles.requires_mfa=true`). TOTP via aplicativo autenticador ou WebAuthn.
- Roles operacionais (`recepcao`) e `member` (aluno/paciente): MFA **opcional** mas com badge incentivando ativação. Tenant pode escalar via `tenant_settings.mfa_extra_roles[]`.
- **Independente do role**, ações de alto-risco (cancelar guia TISS, anular invoice, alterar role de outro user, anonimizar member, etc — lista em `packages/security/high-risk-actions.ts`) exigem **MFA recente <15min** via gate `requireRecentMfa()` no wrapper. Ver [regra 43](rules.md) + [ADR 0073 camada 2](decisions/0073-postura-seguranca-defesa-em-profundidade.md).
- JWT viaja em cookie `httpOnly` (Next.js) + header `Authorization` (Supabase client direto).

### Dois caminhos para criar conta de paciente (ADR 0077)

Paciente entra no LogiFit por **2 paths paralelos** — ambos válidos desde o MVP:

| Path | Como começa | Quando acontece |
|---|---|---|
| **A — Reativo** | Profissional cadastra dados mínimos → invite por WhatsApp/email → paciente clica → cria conta + aceita pedido na sequência | Profissional onboarda paciente (caso comum B2B) |
| **B — Proativo** | Paciente vai em `app.logifit.com.br/cadastro` → cria conta sozinho (SMS + email + Turnstile + senha + MFA opcional) → conta ativa sem vínculo | Paciente chega via marketing, indicação, ou quer convidar profissional dele |

Path B permite paciente "solo" (sem vínculo) que pode: atualizar perfil, aceitar/recusar pedidos, **convidar profissional/empresa** (path inverso), subir documentos pessoais. Não pode: log de treino próprio sem vínculo, diário alimentar sem nutri vinculado, wearables (escopo MVP — Sprint 32 reavalia). Ver [ADR 0077 Parte 8](decisions/0077-passaporte-paciente-vinculo-cross-tenant.md).

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

### Três caminhos de autorização (ADR 0019 — esperado, Sprint 01b)

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

## Camada 4 — Consent (cross-module, cross-company, cross-tenant)

> **Hierarquia de fontes de verdade por tipo de cruzamento de dados** — leitor que precisa decidir "este dado pode ser lido aqui?" deve identificar **primeiro o tipo de cruzamento** abaixo, depois consultar a regra/ADR correspondente. Tipos são **mutuamente exclusivos** (mesmo tenant + mesma company = sem cruzamento; cross-company implica mesmo tenant; cross-tenant implica tenants distintos).

Camada 4 cobre **3 tipos de cruzamento de dados**, cada um com mecanismo próprio + regra dura própria:

| Tipo | Cenário canônico | Mecanismo técnico | Regra(s) | ADR | Sprint que ativa |
|---|---|---|---|---|---|
| **(1) Cross-module** (intra-tenant + intra-company) | Instrutor da academia vê lesão registrada pelo fisio do **mesmo tenant + mesma company** | `consents` por `purpose` (`alert_injury_to_training`, `share_diet_to_training`, etc) | **Regra 6** (consent cross-module) | [ADR 0005](decisions/0005-rbac-com-consent-cross-module.md) | Sprint 01b (schema + UI) |
| **(2) Cross-company** (intra-tenant, **inter**-company) | Recepção da Filial B vê histórico de check-in do aluno na Filial A do **mesmo tenant** | RLS via `tenant.cross_company_access` flag + `franchise_agreements` quando `topology=franchise` | **Regras 21-26** (companies + groups + franchise) — em particular **regra 25 bloqueia clínico cross-company quando topology=franchise** | [ADR 0006](decisions/0006-hierarquia-group-tenant-company-unit.md) + [ADR 0007](decisions/0007-topology-owned-vs-franchise.md) | Sprint 01a (schema + flag) + Sprint 02 (uso) |
| **(3) Cross-tenant** (donos comerciais **distintos**) | Personal da Academia X (tenant A) vê plano alimentar prescrito pela Nutri Y (tenant B autônoma) | `patient_company_links` + `patient_link_modules` ativos + `data_level_max` cobre + `has_cross_tenant_access()` SQL + `patient_data_access_log` síncrono | **Regra 42** (passaporte cross-tenant) | [ADR 0077](decisions/0077-passaporte-paciente-vinculo-cross-tenant.md) | Sprint 01b (schema + log) + Sprint 02 (fluxo + função SQL + lint) |

**Sintaxe rápida para identificar tipo:**

```
mesmo tenant_id + mesmo company_id ?
  → SIM: tipo (1) cross-module — checa Regra 6
  → NÃO: mesmo tenant_id ?
      → SIM: tipo (2) cross-company — checa Regras 21-26 (atenção: clínico em franchise é proibido pela Regra 25)
      → NÃO: tipo (3) cross-tenant — checa Regra 42 + função SQL has_cross_tenant_access() + log obrigatório
```

**Limites duros que valem em todos os tipos:**

- Dado financeiro **nunca** cruza tenant (limite duro Regra 42 — mesmo com vínculo passaporte)
- Dado clínico **nunca** cruza company quando `topology=franchise` (limite duro Regra 25 — mesmo com consent)
- Nível 5 (notas privadas profissional, hipóteses diagnósticas) **nunca** cruza tenant (limite duro Regra 42)
- Prontuário CFM original **nunca** cruza tenant (CFM 2.299 + Lei 13.787 — só resumo gerado pelo paciente pode cruzar via passaporte)

### Cross-module (intra-tenant) — tabela `consents`

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

### Cross-tenant — tabelas `patient_company_links` + `patient_link_modules` (ADR 0077)

Vínculo é entre **paciente e empresa** (Modelo C híbrido); cada vínculo libera **1+ módulos** (`academia`, `personal_training`, `fisioterapia`, `nutricao`, `pilates` — lookup table extensível).

**Constraint global:** 1 paciente tem no máximo **1 módulo do mesmo tipo ativo em toda a rede** (nova empresa do mesmo módulo dispara substituição com confirmação do paciente).

**Fluxo do vínculo:** profissional cadastra dados mínimos do paciente → invite por WhatsApp/email → paciente cria conta (ou loga se já existe) → vê pedido pendente → **aceita parcial ou total** (pode liberar só fisio e recusar nutri da mesma empresa) → vínculo ativo.

**5 níveis de dados** (resumo — fonte de verdade detalhada em [ADR 0077 §Parte 5](decisions/0077-passaporte-paciente-vinculo-cross-tenant.md)):

| Nível | Categorias | Default |
|---|---|---|
| 1 — Identidade | nome, foto, data nascimento, sexo, contato emergência, convênio (nome+nº — sem detalhes financeiros) | Sempre quando vínculo ativo |
| 2 — Antropometria + sinais | peso, altura, IMC, bioimpedância, dobras, circunferências, wearables (FC repouso, sono, passos) | Default todos os módulos |
| 3 — Treino e hábitos gerais | plano de treino ativo, RPE, cargas, modalidades, restrições motoras, frequência (presença sim/não), plano alimentar (macros + restrições — sem diário detalhado) | Default academia/personal/pilates |
| 4 — Clínico | lesões ativas (CID/CIF), alergias, medicações em uso, doenças crônicas relevantes, cirurgias relevantes (5 anos), exames lab alterados ou completos, diário alimentar detalhado | Default fisio/nutricao (opt-in granular) |
| 5 — Workspace interno do profissional | notas privadas, hipóteses diagnósticas, avaliação de aderência, anotações comportamentais | **Nunca cruza tenant** — nem é exibido pro paciente (acessos cross-tenant em `/meu/privacidade/acessos` mostram apenas quem leu seus dados, não o que pensaram) |

### Regras duras

- **Cross-module (intra-tenant)** exige consent explícito (Regra 6).
- **Dado clínico nunca cruza `company_id` em `tenant.topology = 'franchise'`** — nem com consent (regulatório CFM/CREFITO/CRN). Regra 25.
- **Cross-tenant SOMENTE via `patient_company_links` ativo + `patient_link_modules` autorizado + categoria coberta pelo `data_level_max`.** Regra 42 (NOVA — ADR 0077).
- **Limites duros que nunca cruzam tenant mesmo com vínculo:** dado financeiro, Nível 5 (workspace interno), prontuário CFM original (só resumo gerado pelo paciente pode), dado de outras pessoas mencionado no prontuário.
- **Cross-tenant entrega dado resumido**, não bruto — Tenant B recebe "lesão lombar ativa, restrição: sem deadlift", não SOAP completo do Tenant A.
- Toda leitura de dado cross-tenant grava em `patient_data_access_log` (síncrono, particionado por mês — Regra 34).

### UX de consentimento (intra e cross-tenant)

- Onboarding do paciente fluxo obrigatório com consents granulares por categoria.
- Paciente revoga ou pausa a qualquer momento em `/meu/privacidade/compartilhamento`. Efeito imediato (RLS bloqueia).
- Renovação periódica configurável por tenant (ex: revalidar consents a cada 12 meses).
- Paciente vê histórico completo de leituras cross-tenant em `/meu/privacidade/acessos` ("Dr. João leu seus exames em 23/04/2026 às 14:32").
- **Anti-pressão social:** UI nunca mostra "campo bloqueado pelo paciente" — simplesmente não aparece pro profissional. Evita coerção sutil.

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
| "Pode cruzar módulos do mesmo tenant?" | 4. Consent (regra 6, +25 se franchise) |
| "Pode cruzar tenants distintos?" | 4. `patient_company_links` ativo + módulo + nível (regra 42 — ADR 0077) |
| "Quem operou o quê quando?" | Audit log (append-only) + `patient_data_access_log` para cross-tenant |

---

## Referências

- [ADR 0002 — RLS como isolamento primário](decisions/0002-rls-como-isolamento-primario.md)
- [ADR 0005 — RBAC com consent cross-module](decisions/0005-rbac-com-consent-cross-module.md)
- [ADR 0077 — Passaporte do paciente cross-tenant + vínculo por módulo](decisions/0077-passaporte-paciente-vinculo-cross-tenant.md)
- [multiempresa.md](multiempresa.md) — hierarquia e scopes
- [rules.md](rules.md) — regras 1, 2, 5, 6, 25, 42
