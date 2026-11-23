/**
 * scripts/check-mac-update-feed.cjs (BL-37, NFR-07)
 *
 * electron-updater installs a macOS update from a .zip listed in latest-mac.yml.
 * Fails unless the feed lists both the x64 and the arm64 zip, each with sha512
 * and size. Usage: node scripts/check-mac-update-feed.cjs dist/latest-mac.yml
 */
const fs = require('fs')

const REQUIRED = ['x64', 'arm64']

/** Returns a list of problems; empty when the feed is complete. */
function checkMacUpdateFeed(file) {
  if (!fs.existsSync(file)) return [`${file} not found`]
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)

  // Minimal parse of the `files:` list: one block per `- url:` entry.
  const entries = []
  let current = null
  for (const line of lines) {
    const url = /^\s*-\s+url:\s*(\S+)/.exec(line)
    if (url) {
      current = { url: url[1], sha512: false, size: false }
      entries.push(current)
      continue
    }
    if (!current) continue
    if (/^\s+sha512:\s*\S+/.test(line)) current.sha512 = true
    else if (/^\s+size:\s*\d+/.test(line)) current.size = true
    else if (/^\S/.test(line)) current = null // a top-level key ends the list
  }

  const problems = []
  for (const arch of REQUIRED) {
    const entry = entries.find((e) => e.url.endsWith(`-macos-${arch}.zip`))
    if (!entry) {
      problems.push(`latest-mac.yml does not list a "-macos-${arch}.zip" file`)
      continue
    }
    if (!entry.sha512) problems.push(`${entry.url} (${arch}) has no sha512`)
    if (!entry.size) problems.push(`${entry.url} (${arch}) has no size`)
  }
  return problems
}

if (require.main === module) {
  const file = process.argv[2]
  if (!file) {
    console.error('usage: check-mac-update-feed.cjs <latest-mac.yml>')
    process.exit(2)
  }
  const problems = checkMacUpdateFeed(file)
  if (problems.length > 0) {
    for (const p of problems) console.error(`[mac-feed] ${p}`)
    process.exit(1)
  }
  console.log('[mac-feed] latest-mac.yml lists both x64 and arm64 zips')
}

module.exports = { checkMacUpdateFeed }
