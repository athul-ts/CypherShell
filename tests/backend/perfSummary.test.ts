/** [NFR-01][BL-45] The perf record gates and the CI summary table. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'
import { enforce, median, percentile, type PerfRecord } from '../perf/record'

const { summarize } = createRequire(import.meta.url)('../../scripts/perf-summary.cjs') as {
  summarize: (dir: string) => string
}

const rec = (over: Partial<PerfRecord>): PerfRecord => ({
  metric: 'm',
  value: 10,
  unit: 'ms',
  target: 50,
  gate: 'hard',
  pass: true,
  ...over
})

describe('[BL-45] enforce', () => {
  it('a hard gate fails at the target', () => {
    expect(() => enforce(rec({ value: 50 }))).toThrow(/not below/)
    expect(() => enforce(rec({ value: 49.9 }))).not.toThrow()
  })

  it('a soft gate warns above the target and fails above twice the target', () => {
    expect(() => enforce(rec({ gate: 'soft', value: 70 }))).not.toThrow()
    expect(() => enforce(rec({ gate: 'soft', value: 100 }))).toThrow(/twice/)
  })

  it('an info record never fails', () => {
    expect(() => enforce(rec({ gate: 'info', value: 9999 }))).not.toThrow()
  })
})

describe('[BL-45] statistics', () => {
  it('median and percentile', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(
      percentile(
        Array.from({ length: 100 }, (_, i) => i + 1),
        95
      )
    ).toBe(95)
  })
})

describe('[BL-45] summarize', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-perf-sum-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('lists every value with its result', () => {
    fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify(rec({ metric: 'alpha', value: 12 })))
    fs.writeFileSync(
      path.join(dir, 'b.json'),
      JSON.stringify(rec({ metric: 'beta', value: 70, gate: 'soft', pass: false }))
    )
    const table = summarize(dir)
    expect(table).toContain('| alpha | 12 ms | < 50 | hard | ✅')
    expect(table).toContain('| beta | 70 ms | < 50 | soft | ⚠️')
  })

  it('says so when there are no results', () => {
    expect(summarize(dir)).toContain('No performance results')
    expect(summarize(path.join(dir, 'missing'))).toContain('No performance results')
  })
})
