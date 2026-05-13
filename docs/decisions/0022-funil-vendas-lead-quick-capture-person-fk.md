---
slug: funil-vendas-lead-quick-capture-person-fk
status: accepted
date: 2026-05-13
---

# ADR 0022 — Lead com captura rápida + FK persons opcional (mesmo person_id na conversão)

## Contexto

Sprint 10 entrega funil de vendas (CRM pré-matrícula). O modelo de dados de
lead tem duas tensões opostas:

### Tensão 1: captura mínima vs identidade confirmada

- Lead **novo** entra pelo Instagram com só "WhatsApp do João, interesse:
  musculação". Não tem CPF, email, endereço.
- Lead **avançado** (proposta) tem CPF confirmado, vai virar member com
  contrato + cobrança.

Pedir CPF na captura inicial mata a conversão (regra de mercado: cada campo
extra reduz captura ~10%). Mas member exige `persons` completo (ADR 0047:
toda identidade via `persons`, FK obrigatória em `members`).

### Tensão 2: lead → member sem duplicar identidade

Quando lead converte em member, queremos:

- **Não duplicar dados** (nome + CPF + telefone)
- **Preservar histórico** (lead.created_at, source, timeline de eventos)
- Sem schema com `lead.name` E `member.name` separados (manutenção dobrada,
  divergência inevitável)

## Decisão

### Modelo: `leads.person_id` **opcional** + `quick_name/quick_phone/quick_email`

```sql
CREATE TABLE leads (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies,
  unit_id uuid REFERENCES units,
  stage_id uuid NOT NULL REFERENCES lead_stages,

  -- FK pra persons quando lead já tem identidade confirmada
  person_id uuid REFERENCES persons,

  -- Captura inicial quando person_id ainda é NULL
  quick_name text,
  quick_phone text,
  quick_email text,

  -- Funil
  source lead_source NOT NULL DEFAULT 'other',
  source_ref uuid,   -- referral_id, gympass_session_id, etc
  interest text,
  notes text,
  assigned_to_user_id uuid REFERENCES users,

  -- Conversão
  converted_to_member_id uuid REFERENCES members,
  lost_reason text,
  archived_at timestamptz,

  -- Check: pelo menos UMA forma de contato
  CHECK (person_id IS NOT NULL OR quick_name IS NOT NULL OR quick_phone IS NOT NULL),
  -- + outros indexes
)
```

### Transições obrigatórias

| Estágio  | `person_id` obrigatório? | Justificativa                                       |
| -------- | ------------------------ | --------------------------------------------------- |
| `novo`            | ❌ não  | Captura mínima — só nome OU telefone                |
| `contato_feito`   | ❌ não  | Atendimento inicial, ainda sem CPF                  |
| `aula_experimental` | ❌ não | Trial visit, persons opcional                     |
| `proposta`        | ✅ sim  | Trigger Sprint 10 Faixa B+ valida no UPDATE         |
| `matriculado` (won) | ✅ sim | Conversão exige member, member exige persons       |
| `perdido` (lost)  | ❌ não  | Arquivado, persons opcional                         |

### Conversão `lead → member` reusa **mesmo `person_id`**

```typescript
// convertLeadToMember(leadId)
await db.transaction(async (tx) => {
  const lead = await tx.select(...).from(leads).where(eq(leads.id, leadId))
  if (!lead.personId) throw 'VALIDATION_ERROR: lead exige person_id'

  // 1. INSERT member com MESMO person_id (UNIQUE (tenant_id, person_id))
  const [member] = await tx
    .insert(members)
    .values({
      tenantId: lead.tenantId,
      personId: lead.personId,        // ← MESMO person_id
      companyId: lead.companyId,
    })
    .onConflictDoNothing({
      target: [members.tenantId, members.personId],
    })
    .returning({ id: members.id })

  // 2. Lead recebe FK do member criado (preserva histórico funil)
  await tx
    .update(leads)
    .set({ convertedToMemberId: member.id, archivedAt: new Date() })
    .where(eq(leads.id, leadId))

  // 3. Opcional: contract draft a partir da proposta aceita
  if (proposalId) {
    const proposal = await tx.select(...).from(proposals).where(...)
    await tx.insert(contracts).values({
      tenantId, companyId, memberId: member.id, planId: proposal.planId,
      startedAt: new Date(), status: 'active',
    })
  }
})
```

**Zero duplicação de identidade.** Member 100% reusa `persons` (ADR 0047).
Lead permanece como histórico append-only via `lead_events`.

### Antes da conversão: `upgradeLeadToPerson(leadId, personData)`

Quando lead avança pra `proposta`, UI dispara fluxo que coleta CPF + cria
`persons` row + atualiza `leads.person_id`. Os campos `quick_*` viram null
após upgrade (preservados em `lead_events.payload` se necessário).

## Alternativas consideradas

### A. Sem `quick_*` — exige `person_id` desde lead 'novo'

**Rejeitado.** Adiciona fricção crítica na captura. Mercado mostra que pedir
CPF no primeiro contato derruba 30-50% das conversões.

### B. `quick_*` mas SEM `person_id` (lead totalmente independente de persons)

**Rejeitado.** Quando converter, precisaria criar `persons` row separada
naquele momento; com risco de duplicação (lead+member ambos com cópia do nome,
telefone, CPF). Vai contra ADR 0047 (`persons` único cadastro de identidade).

### C. `leads` tem ambos: `person_id` E campos próprios (`name`, `phone`, etc)

**Rejeitado.** Duplicação ativa de identidade. UPDATE em `persons.name` não
reflete em `leads.name` — divergência inevitável. ADR 0047 explicitamente
proíbe esse padrão.

## Trade-offs

### Riscos

- **Lead com `quick_*` órfão pra sempre** — se nunca avança pra proposta, fica
  sem `person_id`. Aceito: lead é descartável; quando arquivado por motivo
  `perdido`, `lead_events` preserva trilha mesmo sem persons.
- **Trigger de validação** — UPDATE de stage pra `proposta`/`matriculado` exige
  `person_id NOT NULL`. Trigger fica em SQL puro (Sprint 10 Faixa B+); enquanto
  ausente, Server Action `moveLeadToStage` valida no boundary (regra 7).
- **Race condition na conversão** — 2 admins clicam "converter" simultaneamente.
  Mitigado por `members.UNIQUE (tenant_id, person_id)` + `ON CONFLICT DO NOTHING`
  + busca o member existente em caso de conflict (testado em
  `convertLeadToMember`).

### Aceito

- **Schema "feio" com campos `quick_*` + FK opcional** — preço a pagar pela
  flexibilidade de captura. UI esconde a complexidade (form mostra
  `personName ?? quickName ?? '(sem nome)'`).
- **Lead histórico** — após conversão, `leads.converted_to_member_id` linka pro
  member; lead em si fica arquivado mas legível (não apagado — regra 5).

## Consequências

### Migrations futuras

- **Sprint 10 Faixa B+**: trigger `leads_require_person_on_stage_won` valida
  `person_id NOT NULL` quando `stage.kind IN ('won')` ou
  `stage.requires_person=true`.
- **Sprint 10 Faixa B+**: constraint global "apenas 1 stage `kind='won'` ativo
  por tenant" (`UNIQUE WHERE kind='won' AND active=true`).
- **Sprint 11+**: campo `lead_score` (IA prevê probabilidade conversão por
  origem + interesse + tempo no funil) — dado calculado, não em schema.

### Compatibilidade com Modo Solo (ADR 0069)

Modo Solo (1 profissional autônomo) usa o mesmo modelo de funil — só que
`company_id` aponta pra company virtual auto-criada e estágios podem ser
simplificados pra 3 (novo → consulta → matriculado). UI `/app/vendas/funil/
configurar` (Faixa C+) permite editar `lead_stages`.

### Integração com passaporte (ADR 0077)

Lead **NUNCA cruza tenant**. Captura é per-tenant. Quando lead converte pra
member, segue regras de passaporte do paciente — outros tenants podem ver
**resumo cross-tenant** via `patient_company_links` mas não veem o lead
histórico (que fica isolado em RLS).

### Migration aplicada

- `packages/db/migrations/0016_worried_wonder_man.sql` — 5 tabelas + 4 enums
  + check constraints
- `packages/db/src/policies/0029_vendas_rls.sql` — RLS tenant-scoped, GRANTs
  ao role `logifit_app`, `lead_events` append-only sem UPDATE/DELETE

### Testes

- `packages/db/tests/vendas-rls.test.ts` — 8 tests cobrindo: isolation Rede vs
  Franquia, `leads_min_contact_or_person`, `lead_stages` unique por tenant,
  `proposals` check constraints, `lead_events` append-only via RLS.

### Próximos ADRs relacionados

- **Stretch**: ADR de DSL pra trigger "lead avançou X dias parado em
  estágio → tarefa de follow-up" (Sprint 13+ régua).
- **Stretch**: ADR de integração formulário público `/captar` no site do
  tenant (Sprint 11+).

## Referências

- ADR 0047 — Cadastro central persons
- ADR 0069 — Modo solo autônomo
- ADR 0077 — Passaporte paciente cross-tenant
- Sprint 10 spec — `docs/sprints/10-geral-funil-vendas.md`
