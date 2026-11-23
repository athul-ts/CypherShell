/**
 * scripts/native-prebuild.cjs (BL-36, ADR-003)
 *
 * better-sqlite3 13 is an N-API module that ships prebuilt binaries for every
 * platform inside its npm package, so nothing is rebuilt for Electron. These
 * helpers keep only the target's binary in the packaged app and check that it
 * is built for the architecture being packaged. No Electron imports, so they
 * can be unit-tested.
 */
const fs = require('fs')
const path = require('path')

const PE_MACHINES = { 0x8664: 'x64', 0xaa64: 'arm64' }
const ELF_MACHINES = { 0x3e: 'x64', 0xb7: 'arm64' }
const MACHO_CPUS = { 0x01000007: 'x64', 0x0100000c: 'arm64' }

/** The CPU architecture a PE, ELF or (thin, 64-bit) Mach-O binary was built for. */
function readBinaryArch(file) {
  const fd = fs.openSync(file, 'r')
  let head
  try {
    head = Buffer.alloc(4096)
    const n = fs.readSync(fd, head, 0, head.length, 0)
    head = head.subarray(0, n)
  } finally {
    fs.closeSync(fd)
  }
  if (head.length >= 64 && head.toString('latin1', 0, 2) === 'MZ') {
    const peOffset = head.readUInt32LE(0x3c)
    if (peOffset + 6 <= head.length)
      return PE_MACHINES[head.readUInt16LE(peOffset + 4)] || 'unknown'
  }
  if (head.length >= 20 && head.toString('latin1', 0, 4) === '\x7fELF') {
    return ELF_MACHINES[head.readUInt16LE(18)] || 'unknown'
  }
  if (head.length >= 8 && head.readUInt32LE(0) === 0xfeedfacf) {
    return MACHO_CPUS[head.readUInt32LE(4)] || 'unknown'
  }
  return 'unknown' // includes fat Mach-O binaries
}

/** Throws unless `file` is built for `arch` — a wrong-arch binary only fails on the user's machine. */
function assertBinaryArch(file, arch) {
  const found = readBinaryArch(file)
  if (found !== arch) {
    throw new Error(
      `[after-pack] ${file} is built for "${found}" but the target is "${arch}" — ` +
        'it would fail to load in the packaged app.'
    )
  }
}

/**
 * Keeps only `prebuilds/<platform>-<arch>.node` in a staged better-sqlite3 and
 * removes any `build/` directory: the loader prefers a locally compiled build
 * over the prebuild, and one would be built for the packaging machine.
 * Returns the kept file. `platform` is win32, darwin or linux.
 */
function prunePrebuilds(bs3Dir, platform, arch) {
  fs.rmSync(path.join(bs3Dir, 'build'), { recursive: true, force: true })
  const dir = path.join(bs3Dir, 'prebuilds')
  const keep = `${platform}-${arch}.node`
  if (!fs.existsSync(path.join(dir, keep))) {
    throw new Error(`[after-pack] better-sqlite3 has no prebuilt binary "${keep}" in ${dir}`)
  }
  for (const name of fs.readdirSync(dir)) {
    if (name !== keep) fs.rmSync(path.join(dir, name), { recursive: true, force: true })
  }
  return path.join(dir, keep)
}

module.exports = { readBinaryArch, assertBinaryArch, prunePrebuilds }
