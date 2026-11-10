/**
 * Terminal I/O framing for the WebSocket protocol (SRS §9.5, BL-15).
 *
 * The backend relays raw SSH bytes as base64. Decoding them with `atob()`
 * yields a Latin-1 "binary string", so writing that to xterm garbles every
 * multi-byte UTF-8 character; encoding input with `btoa()` throws on any
 * character outside Latin-1. These helpers keep the payload as bytes.
 */

const textEncoder = new TextEncoder()
/** Stays well below engines' argument-count limits for `String.fromCharCode(...bytes)`. */
const CHUNK_SIZE = 0x8000

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE))
  }
  return btoa(binary)
}

/** Encodes typed or pasted text as base64 of its UTF-8 bytes. Never throws. */
export function encodeInput(text: string): string {
  return bytesToBase64(textEncoder.encode(text))
}

/**
 * Decodes a base64 output frame to raw bytes. Pass the result straight to
 * `terminal.write()`, which decodes UTF-8 itself — including characters
 * split across two frames.
 */
export function decodeOutput(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
