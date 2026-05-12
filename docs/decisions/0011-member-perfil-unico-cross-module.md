---
slug: member-perfil-unico-cross-module
status: accepted
date: 2026-05-12
---

# ADR 0011 — Member como perfil único cross-module + timeline event-sourced

## Contexto

LogiFit opera 3 verticais (Academia, Fisioterapia, Nutrição) sobre o mesmo
banco multi-tenant. A pessoa atendida pode aparecer em **N papéis** ao mesmo
tempo:

- Aluna da academia (vertical Academia)
- Paciente em fisioterapia (vertical Fisio)
- Acompanhamento nutricional (vertical Nutri)

Cada vertical tem suas **tabelas próprias** (prontuário fisio, antropometria
nutri, contratos academia, prescrições, etc). Dois caminhos arquiteturais
considerados:

### A. Tabela `member` por vertical

Cada vertical tem `members_academia`, `members_fisio`, `members_nutri`,
cada uma duplicando nome, email, telefone, endereço, data de nascimento.

- ✅ Cada vertical evolui isoladamente
- ❌ **Dado de identidade duplicado** → drift garantido (telefone atualiza
   na academia, fisio fica desatualizado)
- ❌ Cross-alert (regra 30) precisa de JOIN com 3 tabelas
- ❌ Search global (regra 30) precisa de UNION + dedup
- ❌ LGPD direito à eliminação obriga apagar em 3 lugares — bug ou
   inconsistência garantida

### B. Member único + tabelas verticais referenciando

`members` é UMA tabela canônica do tenant. Cada vertical referencia
`member_id` mas NUNCA duplica identidade. Identidade vem de `persons`
(Sprint 01a — ADR 0047).

- ✅ Single source of truth pra identidade do paciente
- ✅ Cross-alert + search global são JOINs simples
- ✅ LGPD eliminação acontece em 1 ponto + cascata via FK
- ✅ Mesmo modelo cobre 3 verticais sem branching schema
- ❌ Acoplamento — verticais precisam manter compatibilidade com `members`

## Decisão

**Opção B — Member único cross-module.**

### Schema canônico

```sql
-- packages/db/src/schema/members.ts
CREATE TABLE members (
  id uuid PK,
  tenant_id uuid NOT NULL,
  person_id uuid NOT NULL REFERENCES persons(id),
  company_id uuid NOT NULL REFERENCES companies(id),
  home_unit_id uuid REFERENCES units(id),
  family_history jsonb,           -- anamnese (consumida por Fisio Sprint 20 + Nutri Sprint 29)
  archived_at timestamptz,
  archive_reason text,
  ...
);
```

**Identidade vem via JOIN com persons** — `members` NÃO tem `name`,
`email`, `phone`, `document`, `birth_date`. UI lê via view
`v_members_full` (próximo passo) ou JOIN explícito.

### Tabelas verticais

Sprint 11 (prescrições), Sprint 20 (prontuário fisio), Sprint 29 (nutri
plano), Sprint 04 (financeiro) referenciam `member_id` (FK), nunca
`person_id` direto. Isso garante que **um paciente só pode ter dados de
vertical se for member do tenant** (regra 1 + 25).

### Timeline event-sourced

`member_events` é APPEND-ONLY (regra 5 — trigger ou ausência de policy
UPDATE/DELETE). Cada vertical emite seus eventos:

- Sprint 02: `member.created`, `member.updated`, `member.archived`,
  `member.transferred`, `member.note_added`, `member.tag_added`,
  `member.tag_removed`
- Sprint 03: `agenda.session_booked`, `agenda.session_completed`, ...
- Sprint 04: `invoice.created`, `payment.received`, ...
- Sprint 20: `evolucao.created`, `prontuario.signed`, ...

`/app/members/[id]/timeline` lista todos via ORDER BY at DESC. Filtros por
vertical / kind / data adicionados conforme verticais aterrissam.

### Notes Nível 5

`member_notes.visibility` enum: `author_only`, `unit`, `company`, `tenant`.
**Nunca cruza tenant via passaporte cross-tenant (regra 42 — Nível 5)**.
Server Action `addNote()` marcada `// ai-blocked: nota privada nível 5`
(regra 41).

### Tags

`member_tags` permite filtros operacionais (`vip`, `inadimplente`,
`musculação`, etc). PK composta `(tenant_id, member_id, tag)` impede
duplicação. Não há catálogo central — tags são livres por tenant.

## Alternativas consideradas

### Person como member (sem tabela intermediária)

Eliminar `members` e usar `persons` diretamente — adicionar `is_member`
flag em persons.

- ❌ Mistura semântica: `persons` é cadastro central (PF/PJ); member é
  RELAÇÃO entre tenant + person + company. Mesma pessoa pode ser member
  em N tenants distintos (passaporte cross-tenant — regra 42); flag
  `is_member` em persons quebra isso (qual tenant?).
- ❌ Verticais perdem ponto de extensão (`member_id` FK).

### EAV (entity-attribute-value) pra timeline

Em vez de `member_events.kind` enum + `payload jsonb`, modelar como
linhas separadas (`member_event_attribute`).

- ❌ Query velocidade — `SELECT * FROM member_events WHERE
  member_id = $1 ORDER BY at DESC` vira N JOINs.
- ❌ Tipos perdidos — payload jsonb mantém estrutura por evento; EAV
  vira string everywhere.

### Outbox pattern com Kafka/RabbitMQ

Em vez de `member_events` em Postgres, eventos em fila externa.

- ❌ Soberania perpétua (ADR 0091) — não vamos depender de fila externa
  no MVP.
- ❌ Timeline UI lê eventos passados; fila é stream, não query.
- Compatível: Sprint 30+ pode adicionar consumer que replica
  `member_events` → Postgres LISTEN/NOTIFY → WebSocket realtime.

## Consequências

### Positivas

- Identidade única (persons) → member único → verticals plug-in
- Timeline event-sourced cobre cross-alert (regra 30) + audit (regra 5)
- LGPD eliminação simples: anonymize `persons` cascateia via FK em
  `members`/`verticals`
- Verticais novas (Fase 2 Fisio, Fase 3 Nutri) plugam sem refactor

### Negativas

- Acoplamento: mudar shape de `members` exige migration coordenada com
  verticais. Aceito porque shape é estável (definido aqui no Sprint 02).
- View `v_members_full` precisa materializar leitura quente (Sprint 04+
  quando volume justificar — MVP roda JOIN direto sem cache).

### Decisões derivadas

1. **`member_id` é a unidade de scope** em todas as verticais. Server
   Actions de prontuário/prescrição/avaliação recebem `memberId`, nunca
   `personId` direto.
2. **Cross-alert** (Sprint 27 Fisio → Academia) consume `member_events`
   filtrado por kind + emit cross-tenant via passaporte se autorizado.
3. **Anonimização trial** (`anonymize_trial_data` Sprint 01a Faixa G)
   já mexe em `persons`; cascateia pra `members` via FK + `member_notes`
   via tenant_id. Cron de anonymization MVP cobre.
4. **Particionamento `member_events`** adiado pra Sprint 04+ (regra 34
   ativa quando volume `>5M/ano OU >50k/dia` — MVP <50k até primeiro
   tenant operacional). Sprint 04+ migration custom converte tabela.

## Status

**Accepted** — 2026-05-12.

## Referências

- [Sprint 02](../sprints/02-geral-crm-pessoas.md)
- [ADR 0047 — Cadastro central persons](0047-cadastro-central-persons.md)
- [ADR 0072 — Escalabilidade banco / particionamento](0072-escalabilidade-banco-particionamento-retencao-cold-storage.md)
- [ADR 0077 — Passaporte cross-tenant](0077-passaporte-paciente-vinculo-cross-tenant.md)
- [Regra 5 — append-only audit_log](../rules.md)
- [Regra 25 — clínico não cruza company em franchise](../rules.md)
- [Regra 42 — passaporte cross-tenant (Nível 5 nunca cruza)](../rules.md)
