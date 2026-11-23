/**
 * [FR-11][BL-38] The host-key dialog: confirm a new key, hard stop on a changed one.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HostKeyDialog, type HostKeyInfo } from '@/components/profiles/HostKeyDialog'

const FP = 'SHA256:' + 'a'.repeat(43)
const OLD_FP = 'SHA256:' + 'b'.repeat(43)

const unknown: HostKeyInfo = {
  code: 'HOST_KEY_UNKNOWN',
  host: 'srv.local',
  port: 22,
  keyType: 'ssh-ed25519',
  fingerprint: FP
}
const mismatch: HostKeyInfo = {
  ...unknown,
  code: 'HOST_KEY_MISMATCH',
  knownKeyType: 'ssh-ed25519',
  knownFingerprint: OLD_FP
}

describe('[BL-38] HostKeyDialog', () => {
  it('renders nothing without a host key', () => {
    render(<HostKeyDialog info={null} onTrust={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('unknown key: shows host, type and fingerprint and lets the user trust it', () => {
    const onTrust = vi.fn()
    render(<HostKeyDialog info={unknown} onTrust={onTrust} onClose={vi.fn()} />)
    expect(screen.getByText(/srv\.local:22/)).toBeTruthy()
    expect(screen.getByText('ssh-ed25519')).toBeTruthy()
    expect(screen.getByText(FP)).toBeTruthy()
    expect(screen.getByText(/ssh-keygen -lf/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /trust and connect/i }))
    expect(onTrust).toHaveBeenCalledTimes(1)
  })

  it('unknown key: Cancel closes without trusting', () => {
    const onTrust = vi.fn()
    const onClose = vi.fn()
    render(<HostKeyDialog info={unknown} onTrust={onTrust} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(onClose).toHaveBeenCalled()
    expect(onTrust).not.toHaveBeenCalled()
  })

  it('changed key: shows both fingerprints and offers no way to trust', () => {
    render(<HostKeyDialog info={mismatch} onTrust={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText(FP)).toBeTruthy()
    expect(screen.getByText(OLD_FP)).toBeTruthy()
    expect(screen.getByText(/no password or key was sent/i)).toBeTruthy()
    expect(screen.getByText(/settings.*known hosts/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /trust/i })).toBeNull()
    expect(screen.getAllByRole('button', { name: /close/i }).length).toBeGreaterThan(0)
  })
})
