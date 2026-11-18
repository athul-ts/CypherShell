/**
 * [FR-07.1][FR-07.7][BL-26] New master passwords need at least 10
 * characters, and the user sees a strength hint while typing.
 */
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithQuery } from './helpers/renderWithQuery'
import SetupWizard from '@/pages/SetupWizard'
import Settings from '@/pages/Settings'
import { passwordStrength, MIN_MASTER_PASSWORD_LENGTH } from '@/lib/passwordStrength'
import { api } from '@/lib/api'

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
}

describe('[BL-26] passwordStrength', () => {
  it('rates anything under 10 characters too short', () => {
    expect(MIN_MASTER_PASSWORD_LENGTH).toBe(10)
    expect(passwordStrength('Abc!12345').level).toBe('too-short')
  })

  it('rates by length and character variety', () => {
    expect(passwordStrength('aaaaaaaaaa').level).toBe('weak')
    expect(passwordStrength('abcdefgh12').level).toBe('weak')
    expect(passwordStrength('abcdefgh1234').level).toBe('fair')
    expect(passwordStrength('Abcdefg!12').level).toBe('fair')
    expect(passwordStrength('Correct-Horse-42').level).toBe('strong')
    expect(passwordStrength('correct horse battery staple').level).toBe('strong')
  })
})

describe('[BL-26] setup wizard', () => {
  function fill(password: string, confirm = password): void {
    fireEvent.change(screen.getByPlaceholderText('Min. 10 characters'), {
      target: { value: password }
    })
    fireEvent.change(screen.getByPlaceholderText('Re-enter password'), {
      target: { value: confirm }
    })
  }

  it('blocks a 9-character password without calling the API', async () => {
    renderWithQuery(<SetupWizard onComplete={() => {}} />)
    fill('123456789')
    fireEvent.click(screen.getByRole('button', { name: /set password/i }))
    expect(await screen.findByText('Password must be at least 10 characters.')).toBeInTheDocument()
    expect(mockApi.post).not.toHaveBeenCalled()
  })

  it('accepts 10 characters', async () => {
    mockApi.post.mockResolvedValue({ data: { token: 't' } })
    const onComplete = vi.fn()
    renderWithQuery(<SetupWizard onComplete={onComplete} />)
    fill('1234567890')
    fireEvent.click(screen.getByRole('button', { name: /set password/i }))
    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith('/auth/setup', { password: '1234567890' })
    )
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
  })

  it('shows the strength hint as the user types', () => {
    renderWithQuery(<SetupWizard onComplete={() => {}} />)
    expect(screen.queryByTestId('password-strength')).toBeNull()
    fill('short')
    expect(screen.getByTestId('password-strength')).toHaveTextContent('Too short')
    fill('correct horse battery staple')
    expect(screen.getByTestId('password-strength')).toHaveTextContent('Strong')
  })
})

describe('[BL-26] Settings — turning lock on', () => {
  it('requires 10 characters for a new master password and shows the hint', async () => {
    mockApi.get.mockResolvedValue({
      data: {
        theme: 'dark',
        defaultFont: 'JetBrains Mono',
        defaultFontSize: 14,
        logRetentionDays: 90,
        lockEnabled: false,
        hasMasterPassword: false,
        autoLockMinutes: 15
      }
    })
    renderWithQuery(<Settings />)
    fireEvent.click(await screen.findByLabelText('App lock'))

    const input = await screen.findByLabelText('New Master Password')
    expect(input).toHaveAttribute('placeholder', 'Minimum 10 characters')
    fireEvent.change(input, { target: { value: '123456789' } })
    expect(screen.getByRole('button', { name: /turn on lock/i })).toBeDisabled()
    expect(screen.getByTestId('password-strength')).toHaveTextContent('Too short')

    fireEvent.change(input, { target: { value: '1234567890' } })
    expect(screen.getByRole('button', { name: /turn on lock/i })).toBeEnabled()
  })
})
