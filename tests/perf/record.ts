/**
 * Records one NFR-01 measurement as perf-results/<metric>.json (BL-45) and applies its gate.
 *
 *  - hard: the value must be below the target, or the test fails.
 *  - soft: above the target is a warning; above twice the target fails (a slow CI machine
 *    must not fail a run, a real regression must).
 *  - info: recorded only.
 */
import fs from 'fs'
import path from 'path'

export interface PerfRecord {
  metric: string
  value: number
  unit: string
  /** The NFR-01 limit; `value` must stay below it. */
  target: number
  gate: 'hard' | 'soft' | 'info'
  /** Whether the target was met. */
  pass: boolean
  note?: string
}

export const PERF_DIR = path.resolve('perf-results')

export function record(
  metric: string,
  value: number,
  unit: string,
  target: number,
  gate: PerfRecord['gate'],
  note?: string
): PerfRecord {
  const rounded = Math.round(value * 100) / 100
  const result: PerfRecord = {
    metric,
    value: rounded,
    unit,
    target,
    gate,
    pass: rounded < target,
    note
  }
  fs.mkdirSync(PERF_DIR, { recursive: true })
  fs.writeFileSync(path.join(PERF_DIR, `${metric}.json`), JSON.stringify(result, null, 2) + '\n')
  return result
}

/** Throws when the gate is exceeded; returns the record otherwise. */
export function enforce(result: PerfRecord): PerfRecord {
  const { metric, value, unit, target, gate } = result
  if (gate === 'hard' && value >= target) {
    throw new Error(`${metric}: ${value} ${unit} is not below the ${target} ${unit} target`)
  }
  if (gate === 'soft' && value >= target * 2) {
    throw new Error(`${metric}: ${value} ${unit} is above twice the ${target} ${unit} target`)
  }
  return result
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}
