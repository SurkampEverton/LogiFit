/**
 * `expandRecurring(rrule, startTime, endTime, range)` — Sprint 03 Faixa D (ADR 0012).
 *
 * Materialização **lazy** de slots recorrentes: dada uma regra RFC 5545 + horário
 * + duração + range de busca, retorna os slots virtuais (não-persistidos) que
 * caem dentro do range.
 *
 * Server Action `getWeekAgenda(resourceIds, range)` faz:
 *   1. SELECT `appointments` no range (slots ocupados/cancelados)
 *   2. SELECT `recurring_slots` ativos
 *   3. `expandRecurring(rs.rrule, rs.startTime, rs.endTime, range)` por slot
 *   4. Merge: slot virtual com appointment matching = booked; sem match = vago
 *
 * Wall-clock: `startTime`/`endTime` são `time` Postgres ('18:00:00'). Combinamos
 * com cada DATE retornada por `rrule.between()` no fuso UTC default (timezone
 * do tenant entra no Sprint 04+ via `tenants.timezone` coluna nova).
 *
 * rrule.js é a referência implementação JS de RFC 5545 — ~12KB gzip server-side.
 */
import { RRule } from 'rrule'

export interface VirtualSlot {
  /** ISO timestamptz do início do slot. */
  startsAt: string
  /** ISO timestamptz do fim do slot. */
  endsAt: string
  /** ID do `recurring_slot` que originou — caller usa pra join com appointments. */
  recurringSlotId: string
}

interface ExpandRecurringInput {
  recurringSlotId: string
  /** RRULE RFC 5545 — ex: `'FREQ=WEEKLY;BYDAY=MO,WE,FR'` (sem prefix `RRULE:`). */
  rrule: string
  /** Hora local do start — formato `'HH:MM:SS'`. */
  startTime: string
  /** Hora local do end — formato `'HH:MM:SS'`. */
  endTime: string
  /** Início do range de busca (inclusive). */
  rangeStart: Date
  /** Fim do range de busca (inclusive). */
  rangeEnd: Date
}

/**
 * Combina `date` (YYYY-MM-DD) + `time` (HH:MM:SS) em ISO UTC.
 * Sprint 04+: aceita timezone do tenant pra wall-clock real local.
 */
function combineDateTime(date: Date, time: string): Date {
  const [hh, mm, ss] = time.split(':').map((s) => Number.parseInt(s, 10))
  const d = new Date(date)
  d.setUTCHours(hh ?? 0, mm ?? 0, ss ?? 0, 0)
  return d
}

export function expandRecurring(input: ExpandRecurringInput): VirtualSlot[] {
  const { recurringSlotId, rrule, startTime, endTime, rangeStart, rangeEnd } = input

  // RRule.fromString aceita "RRULE:..." ou só "FREQ=...". Normalizamos.
  const rruleString = rrule.startsWith('RRULE:') ? rrule : `RRULE:${rrule}`

  // DTSTART necessário pra rrule.js calcular ocorrências. Usamos primeiro dia
  // do range como anchor — rrule.js calcula a partir daí.
  const dtstart = new Date(rangeStart)
  dtstart.setUTCHours(0, 0, 0, 0)

  let rule: RRule
  try {
    rule = RRule.fromString(`DTSTART:${formatDtstart(dtstart)}\n${rruleString}`)
  } catch {
    // RRULE inválido — retorna vazio (caller pode logar)
    return []
  }

  // .between() retorna ocorrências dentro do range, inclusive ambos limites
  const occurrences = rule.between(rangeStart, rangeEnd, true)

  return occurrences.map((occ) => {
    const starts = combineDateTime(occ, startTime)
    const ends = combineDateTime(occ, endTime)
    return {
      startsAt: starts.toISOString(),
      endsAt: ends.toISOString(),
      recurringSlotId,
    }
  })
}

/**
 * Formato `YYYYMMDDTHHMMSSZ` requerido por DTSTART RFC 5545.
 */
function formatDtstart(d: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  )
}
