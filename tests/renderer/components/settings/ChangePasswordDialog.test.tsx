/**
 * [FR-07.8][BL-39] Change master password dialog and its Settings entry point.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { renderWithQuery } from '../../helpers/renderWithQuery'
import { ChangePasswordDialog } from '@/components/settings/ChangePasswordDialog'
import Settings from '@/pages/Settings'
import { api } from '@/lib/api'

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  mockApi.post.mockReset()
})

function fill(current: string, next: string, confirm: string): void {
  fireEvent.change(screen.getByLabelText('Current master password'), { target: { value: current } })
  fireEvent.change(screen.getByLabelText('New master password'), { target: { value: next } })
  fireEvent.change(screen.getByLabelText('Confirm new master password'), {
    target: { value: confirm }
  })
}
const submit = (): void => {
  fireEvent.click(screen.getByRole('button', { name: /change password/i }))
}

describe('[BL-39] ChangePasswordDialog', () => {
  it('rejects a short new password without calling the API', () => {
    render(<ChangePasswordDialog open onClose={vi.fn()} />)
    fill('old-password', 'short', 'short')
    submit()
    expect(screen.getByText(/new password must be at least 10 characters/i)).toBeTruthy()
    expect(mockApi.post).not.toHaveBeenCalled()
  })

  it('rejects mismatched confirmation', () => {
    render(<ChangePasswordDialog open onClose={vi.fn()} />)
    fill('old-password', 'a-brand-new-pass', 'a-brand-new-pas')
    submit()
    expect(screen.getByText(/do not match/i)).toBeTruthy()
    expect(mockApi.post).not.toHaveBeenCalled()
  })

  it('rejects a new password equal to the current one', () => {
    render(<ChangePasswordDialog open onClose={vi.fn()} />)
    fill('same-password-1', 'same-password-1', 'same-password-1')
    submit()
    expect(screen.getByText(/different from the current/i)).toBeTruthy()
    expect(mockApi.post).not.toHaveBeenCalled()
  })

  it('sends both passwords, shows a toast and closes on success', async () => {
    mockApi.post.mockResolvedValue({ data: { success: true, unreadableSecrets: 0 } })
    const onClose = vi.fn()
    render(<ChangePasswordDialog open onClose={onClose} />)
    fill('old-password', 'a-brand-new-pass', 'a-brand-new-pass')
    submit()
    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith('/auth/change-password', {
        currentPassword: 'old-password',
        newPassword: 'a-brand-new-pass'
      })
    )
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(toast.success).toHaveBeenCalled()
  })

  it('warns when some secrets could not be re-encrypted', async () => {
    mockApi.post.mockResolvedValue({ data: { success: true, unreadableSecrets: 2 } })
    render(<ChangePasswordDialog open onClose={vi.fn()} />)
    fill('old-password', 'a-brand-new-pass', 'a-brand-new-pass')
    submit()
    await waitFor(() => expect(toast.warning).toHaveBeenCalled())
  })

  it('shows the server message inline and stays open on a 401', async () => {
    mockApi.post.mockRejectedValue({
      response: { status: 401, data: { error: 'Incorrect current password.' } }
    })
    const onClose = vi.fn()
    render(<ChangePasswordDialog open onClose={onClose} />)
    fill('wrong-password', 'a-brand-new-pass', 'a-brand-new-pass')
    submit()
    expect(await screen.findByText('Incorrect current password.')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('[BL-39] Settings entry point', () => {
  const config = {
    theme: 'dark',
    defaultFont: 'JetBrains Mono',
    defaultFontSize: 14,
    logRetentionDays: 90,
    lockEnabled: true,
    hasMasterPassword: true,
    autoLockMinutes: 15
  }

  it('shows "Change master password" while lock is on', async () => {
    mockApi.get.mockResolvedValue({ data: config })
    renderWithQuery(<Settings />)
    fireEvent.click(await screen.findByRole('button', { name: /change master password/i }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })

  it('hides it while lock is off', async () => {
    mockApi.get.mockResolvedValue({ data: { ...config, lockEnabled: false } })
    renderWithQuery(<Settings />)
    await screen.findByLabelText('App lock')
    expect(screen.queryByRole('button', { name: /change master password/i })).toBeNull()
  })
})
