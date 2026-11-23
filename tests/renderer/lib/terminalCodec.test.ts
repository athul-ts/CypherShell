/**
 * [FR-02.2][BL-15] Terminal I/O must carry UTF-8 intact.
 *
 * Regression: output was written as `atob(data)` (a Latin-1 string), which
 * garbles multi-byte UTF-8, and input was encoded with `btoa(data)`, which
 * throws for any character outside Latin-1.
 */
import { describe, it, expect } from 'vitest'
import { encodeInput, decodeOutput } from '@/lib/terminalCodec'

const utf8 = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)
const serverSees = (base64: string): string => Buffer.from(base64, 'base64').toString('utf8')
const serverSends = (text: string): string => Buffer.from(text, 'utf8').toString('base64')

const samples = ['plain ascii', 'café é', 'box ─│┌┐', '日本語', 'emoji 🙂🚀', '\x1b[31mred\x1b[0m']

describe('[FR-02.2][BL-15] encodeInput', () => {
  it.each(samples)('sends %j to the server as UTF-8', (text) => {
    expect(serverSees(encodeInput(text))).toBe(text)
  })

  it('never throws, unlike btoa()', () => {
    expect(() => btoa('🙂')).toThrow()
    expect(() => encodeInput('🙂 \ud800 lone surrogate')).not.toThrow()
  })

  it('handles large pastes', () => {
    const big = 'é'.repeat(200_000)
    expect(serverSees(encodeInput(big))).toBe(big)
  })
})

describe('[FR-02.2][BL-15] decodeOutput', () => {
  it.each(samples)('returns the raw bytes of %j', (text) => {
    expect(utf8(decodeOutput(serverSends(text)))).toBe(text)
  })

  it('keeps a character split across two frames decodable as a stream', () => {
    const bytes = Buffer.from('─', 'utf8') // 3 bytes: e2 94 80
    const first = decodeOutput(bytes.subarray(0, 1).toString('base64'))
    const second = decodeOutput(bytes.subarray(1).toString('base64'))
    const decoder = new TextDecoder()
    expect(decoder.decode(first, { stream: true }) + decoder.decode(second)).toBe('─')
  })

  it('differs from the old atob() string for non-ASCII output', () => {
    const frame = serverSends('é')
    expect(atob(frame)).not.toBe('é') // the old path wrote "Ã©"
    expect(utf8(decodeOutput(frame))).toBe('é')
  })
})
