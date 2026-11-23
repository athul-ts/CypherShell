/**
 * scripts/perf-summary.cjs (BL-45, NFR-01)
 *
 * Prints the NFR-01 measurements in perf-results/ as a markdown table and appends it to
 * $GITHUB_STEP_SUMMARY when that is set. Never fails: the gates are enforced by the tests.
 * Usage: node scripts/perf-summary.cjs [dir]
 */
const fs = require('fs')
const path = require('path')

/** The markdown table for every *.json record in `dir`. */
function summarize(dir) {
  if (!fs.existsSync(dir)) return 'No performance results.\n'
  const records = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
  if (records.length === 0) return 'No performance results.\n'

  const rows = records.map((r) => {
    const status = r.pass ? '✅' : r.gate === 'hard' ? '❌' : '⚠️'
    const note = r.note ? ` — ${r.note}` : ''
    return `| ${r.metric} | ${r.value} ${r.unit} | < ${r.target} | ${r.gate} | ${status}${note} |`
  })
  return [
    '### NFR-01 performance',
    '',
    '| Metric | Value | Target | Gate | Result |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    ''
  ].join('\n')
}

if (require.main === module) {
  const table = summarize(path.resolve(process.argv[2] || 'perf-results'))
  console.log(table)
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, table + '\n')
}

module.exports = { summarize }
