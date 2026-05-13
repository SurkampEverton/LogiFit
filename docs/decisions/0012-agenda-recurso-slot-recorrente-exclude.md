---
slug: agenda-recurso-slot-recorrente-exclude
status: accepted
date: 2026-05-13
---

# ADR 0012 — Agenda como recurso + slot recorrente lazy + EXCLUDE constraint

## Contexto

Sprint 03 entrega a agenda universal LogiFit. O modelo precisa:

1. **Atender 3 verticais** (Academia/Fisio/Nutri) com o mesmo schema — instrutor
   de musculação, fisioterapeuta, nutricionista, sala de pilates, equipamento
   ergométrico. Todos são "recurso agendável".
2. **Suportar recorrência** ("toda segunda 18h, instrutor X, sala Y")
   — milhares de slots gerados conforme RRULE RFC 5545.
3. **Prevenir conflito** de dois bookings simultâneos no mesmo recurso —
   sem confiar em transação aplicação (multi-instance Next.js sem advisory
   lock global).
4. **Permitir histórico** — agendamentos cancelados/no-show ficam pra audit.

### Caminho A — Materializar todos os slots (rejeitado)

`recurring_slots` gera linhas em `appointment_slots` (`(slot_id, date)` PK)
para os próximos 12 meses. Cada slot vira row. Booking faz UPDATE no slot.

- ✅ Lookups são triviais (`SELECT * FROM appointment_slots WHERE date = ...`)
- ❌ **Volume**: tenant com 50 instrutores × 8 slots/dia × 365 dias = 146k rows/ano
  * 100 tenants = 14.6M rows. Hot dataset, particionamento pesado.
- ❌ Regra mudou (instrutor mudou horário) → recalcular materialização ×
  cancelar slots futuros + recriar = migration complexa cada mudança.
- ❌ Status mais comum (slot livre) é a maioria — desperdício de storage.

### Caminho B — Materialização lazy + EXCLUDE constraint (escolhido)

`recurring_slots` armazena **só a regra** (`rrule` text + start_time + end_time +
capacity). Slots concretos (linhas) nascem **on-demand** quando alguém agenda:
materializam em `appointments` direto. Helper `expandRecurring(rrule, range)`
calcula slots virtuais pra UI semanal/mensal.

- ✅ **Volume mínimo**: apenas slots EFETIVAMENTE bookados viram rows
- ✅ **Regra muda → nada migra** — próximas expansões pegam a nova regra
- ✅ **Exclusão de overlap via banco** com `EXCLUDE USING gist` — Postgres
  garante atomicidade sem lock pessimista

```sql
ALTER TABLE appointments ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (
    resource_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status IN ('booked', 'checked_in'));
```

- `resource_id WITH =` — só conflita no mesmo recurso
- `tstzrange(..., '[)')` — intervalo `[start, end)` inclusive-exclusive,
  evita conflito em fronteira (10–11 e 11–12 OK)
- `WHERE status IN ('booked', 'checked_in')` — history (cancelled/no_show/
  completed) coexiste, só contam slots ativos

## Decisão

Adotar caminho B com 4 tabelas:

| Tabela | Cardinalidade | Função |
|---|---|---|
| `resources` | ~50/tenant (instrutor/sala/equipamento) | Catálogo do agendável |
| `recurring_slots` | ~200/tenant (1 regra por horário) | Regra de recorrência RRULE |
| `appointments` | ~10k/mês/tenant (5M/ano em redes grandes) | Bookings concretos |
| `appointment_waitlist` | ~100/dia/tenant (slot lotado) | Lista de espera |

### Materialização lazy

Helper `expandRecurring(rrule, startTime, endTime, range)` em `@repo/db` usa
**rrule.js** (lib Node ~12KB) pra expandir RRULE pro range pedido. Resultado
combina com `appointments` existentes pra mostrar:
- Slots virtuais ainda livres → renderiza "vago" no canvas
- Slots virtuais ocupados (já tem `appointment` matching) → renderiza booked

Server Action `getWeekAgenda(resourceIds[], range)` faz:
1. SELECT `appointments` no range
2. SELECT `recurring_slots` ativos dos recursos
3. `expandRecurring()` → slots virtuais
4. Merge (appointment.recurring_slot_id = slot.id) → array final UI

### EXCLUDE constraint

- `CREATE EXTENSION btree_gist` necessário (uuid `=` em gist op-class)
- Insert violando → SQLSTATE `23P01` (`exclusion_violation`)
- Server Action `createAppointment` cata e retorna `CONFLICT` envelope
  (ADR 0071) → UI mostra "horário já reservado"

### Particionamento

`appointments` previsão >5M rows/ano em tenant grande (regra 34 + ADR 0072).
**Adiado pra Sprint 04+** quando volume real justificar (MVP cabe sem). Quando
chegar, PARTITION BY RANGE (`starts_at`) mensal + retenção de 5 anos (com cold
storage em Parquet zstd).

### Realtime

Canal `tenant:X:company:Y:unit:Z:agenda` via PG `LISTEN/NOTIFY` + WebSocket
próprio Next.js (regra de soberania perpétua #4 — sem Supabase Realtime).

## Consequências

### Positivas

- **Schema enxuto**: ~200 `recurring_slots` em vez de 14.6M `appointment_slots`
  pré-gerados — 73000× menos rows
- **Mudança de regra é local**: editar `recurring_slots.rrule` propaga
  automaticamente para futuras expansões (slots já bookados ficam intactos)
- **Garantia atômica**: dois bookings simultâneos no mesmo recurso/horário não
  podem coexistir; Postgres rejeita o segundo com 23P01
- **History preservado**: cancelled/no-show ficam pra audit + dashboards de
  ocupação histórica
- **Compatível RFC 5545**: rrule.js é a referência implementação JS;
  integrações futuras (Google Calendar, iCalendar export) trivializam

### Negativas

- **Lazy expansion custa CPU**: rrule.js calcula slots virtuais a cada render.
  Mitigação: cache `getWeekAgenda(range)` por 30s no Redis (Sprint 04+).
- **EXCLUDE constraint requer btree_gist** extension — uma migration extra
  (`CREATE EXTENSION IF NOT EXISTS btree_gist`)
- **rrule.js (~12KB gzip)** entra no bundle de Server Actions — aceito (pesa
  só no servidor, não no client)
- **Status enum complexa** (booked/checked_in/cancelled/no_show/completed) —
  cuidado em queries: filter por `status IN ('booked', 'checked_in')` para
  contagem de ocupação; filter por `status != 'cancelled'` para histórico.

### Migração futura para particionamento

Quando `appointments` atingir 5M rows:
1. Criar tabela `appointments_partitioned` com `PARTITION BY RANGE (starts_at)`
2. Mover dados via `INSERT ... SELECT` em janela de baixo tráfego
3. Renomear tabelas + recriar EXCLUDE constraint em cada partição

Job `create-next-partitions` (regra 34) cria partições mensais 90 dias à frente.

## Alternativas consideradas

- **Big Calendar libraries (react-big-calendar)**: UI sim, mas modelo de dados é
  ortogonal. Reaproveitamos ideias mas não a lib.
- **Tabela `slots` materializada**: rejeitado por volume (item acima).
- **Lock pessimista via advisory lock**: rejeitado — multi-instance Next.js
  sem coordenação central; advisory lock seria por conexão Postgres, perde-se
  ao retornar pool. EXCLUDE constraint é o caminho idiomático.
- **Optimistic locking via `version` column**: rejeitado — não previne overlap,
  só previne race em update do mesmo row. EXCLUDE cobre **inserts paralelos**.

## Referências

- [Sprint 03 — Geral · Agenda universal](../sprints/03-geral-agenda-universal.md)
- [Postgres EXCLUDE constraint docs](https://www.postgresql.org/docs/16/sql-createtable.html#SQL-CREATETABLE-EXCLUDE)
- [RFC 5545 — iCalendar (RRULE)](https://datatracker.ietf.org/doc/html/rfc5545#section-3.3.10)
- [rrule.js](https://github.com/jakubroztocil/rrule)
- [Regra 34 — particionamento mandatório >5M rows/ano](../rules.md#34)
- [ADR 0072 — escalabilidade banco](0072-escalabilidade-banco-particionamento-retencao-cold-storage.md)
- [Regra 4 — soberania perpétua: Realtime via LISTEN/NOTIFY](../rules.md)
