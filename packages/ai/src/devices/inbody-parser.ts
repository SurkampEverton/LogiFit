/**
 * Parser CSV InBody — Sprint 32 Faixa B.1.
 *
 * InBody (e similares) exporta resultado de bioimpedância em CSV com colunas
 * comuns: Date, Weight, BodyFatPct, MuscleMass, BMI, etc. Adapter converte
 * pra `NormalizedReading[]` FHIR-like.
 *
 * **Layout suportado** (canônico InBody 270/570/770):
 *   Date,Time,Weight,BodyFatMass,MuscleMass,BMR,WaistHipRatio,BMI,...
 *
 * Sprint 32b: parsers FIT (Garmin), TCX (Polar), GPX (GPS) em arquivos
 * separados (`fit-parser.ts`, `tcx-gpx-parser.ts`). MVP só InBody CSV.
 */

import type { NormalizedReading } from './provider'

export interface ParseResult {
  readings: NormalizedReading[]
  /** Linhas que não puderam ser parseadas (audit) */
  errors: Array<{ line: number; reason: string }>
}

/**
 * Parser tolerante: aceita CSV com ; ou , como separador; ignora linhas vazias;
 * tenta múltiplos formatos de data.
 */
export function parseInBodyCsv(content: string): ParseResult {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length < 2) {
    return { readings: [], errors: [{ line: 0, reason: 'CSV vazio ou sem dados' }] }
  }

  const delimiter = lines[0]!.includes(';') ? ';' : ','
  const headers = lines[0]!.split(delimiter).map((h) => h.trim().toLowerCase())

  // Mapeia colunas conhecidas → observationCode + unit
  const columnMap: Record<string, { code: string; unit: string }> = {
    weight: { code: 'WEIGHT', unit: 'kg' },
    'peso (kg)': { code: 'WEIGHT', unit: 'kg' },
    bodyfatpct: { code: 'BODY_FAT_PCT', unit: '%' },
    bodyfat_pct: { code: 'BODY_FAT_PCT', unit: '%' },
    'pbf (%)': { code: 'BODY_FAT_PCT', unit: '%' },
    'gordura corporal (%)': { code: 'BODY_FAT_PCT', unit: '%' },
    musclemass: { code: 'MUSCLE_MASS_KG', unit: 'kg' },
    muscle_mass: { code: 'MUSCLE_MASS_KG', unit: 'kg' },
    'smm (kg)': { code: 'MUSCLE_MASS_KG', unit: 'kg' },
    'massa muscular (kg)': { code: 'MUSCLE_MASS_KG', unit: 'kg' },
  }

  const dateIdx = headers.findIndex(
    (h) => h === 'date' || h === 'data' || h === 'data exame' || h === 'datatime',
  )
  const timeIdx = headers.findIndex((h) => h === 'time' || h === 'hora')

  if (dateIdx === -1) {
    return { readings: [], errors: [{ line: 0, reason: 'Coluna "Date" não encontrada' }] }
  }

  const readings: NormalizedReading[] = []
  const errors: ParseResult['errors'] = []

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(delimiter).map((c) => c.trim())
    const dateRaw = cols[dateIdx]
    if (!dateRaw) {
      errors.push({ line: i + 1, reason: 'Data ausente' })
      continue
    }
    const timeRaw = timeIdx >= 0 ? (cols[timeIdx] ?? '12:00:00') : '12:00:00'
    const measuredAt = parseDateTime(dateRaw, timeRaw)
    if (!measuredAt) {
      errors.push({ line: i + 1, reason: `Data inválida: ${dateRaw}` })
      continue
    }

    let foundAny = false
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j]!
      const map = columnMap[header]
      if (!map) continue
      const raw = cols[j]
      if (!raw) continue
      const value = Number.parseFloat(raw.replace(',', '.'))
      if (Number.isFinite(value)) {
        readings.push({
          observationCode: map.code,
          value,
          unit: map.unit,
          measuredAt,
          quality: 'high',
          metadata: { source: 'inbody_csv', line: i + 1 },
        })
        foundAny = true
      }
    }

    if (!foundAny) {
      errors.push({
        line: i + 1,
        reason: 'Nenhuma coluna conhecida com valor numérico',
      })
    }
  }

  return { readings, errors }
}

/**
 * Aceita formatos ISO, BR (dd/mm/yyyy) e US (mm/dd/yyyy — heurística).
 * Retorna ISO timestamp ou null.
 */
function parseDateTime(dateRaw: string, timeRaw: string): string | null {
  const time = /^\d{2}:\d{2}/.test(timeRaw)
    ? `${timeRaw}${timeRaw.length === 5 ? ':00' : ''}`
    : '12:00:00'
  // ISO direto
  if (/^\d{4}-\d{2}-\d{2}/.test(dateRaw)) {
    const iso = `${dateRaw.slice(0, 10)}T${time}Z`
    const d = new Date(iso)
    return isNaN(d.getTime()) ? null : d.toISOString()
  }
  // BR: dd/mm/yyyy
  const brMatch = dateRaw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (brMatch) {
    const [, d, m, y] = brMatch
    const iso = `${y}-${m}-${d}T${time}Z`
    const dt = new Date(iso)
    return isNaN(dt.getTime()) ? null : dt.toISOString()
  }
  return null
}
