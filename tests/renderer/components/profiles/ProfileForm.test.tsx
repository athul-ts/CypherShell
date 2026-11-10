/**
 * [FR-01.8.4][FR-01.1][BL-13] Editing a profile sends only changed fields.
 *
 * Regression: the form always submitted `password: ''`, which the API treats
 * as "clear the stored password", so every edit erased a saved password.
 */
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../../helpers/renderWithQuery'
import { ProfileForm } from '@/components/profiles/ProfileForm'
import {
  buildProfilePayload,
  secretRequired,
  type ProfileFormValues,
  type ProfileSnapshot
} from '@/components/profiles/profilePayload'
import { api } from '@/lib/api'

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
}

const passwordProfile: ProfileSnapshot & { id: string } = {
  id: 'p1',
  name: 'Prod web',
  group: 'Production',
  host: '10.0.0.5',
  port: 22,
  username: 'deploy',
  authMethod: 'password',
  sshKeyId: null,
  hasPassword: true
}

function valuesFrom(
  profile: ProfileSnapshot,
  overrides: Partial<ProfileFormValues> = {}
): ProfileFormValues {
  return {
    name: profile.name,
    group: profile.group ?? '',
    host: profile.host,
    port: profile.port,
    username: profile.username,
    authMethod: profile.authMethod,
    password: '',
    sshKeyId: profile.sshKeyId ?? '',
    ...overrides
  }
}

describe('[FR-01.8.4][BL-13] buildProfilePayload', () => {
  it('a name-only edit sends only the name — no password', () => {
    const payload = buildProfilePayload(passwordProfile, valuesFrom(passwordProfile, { name: 'X' }))
    expect(payload).toEqual({ name: 'X' })
  })

  it('an untouched edit sends nothing', () => {
    expect(buildProfilePayload(passwordProfile, valuesFrom(passwordProfile))).toEqual({})
  })

  it('a typed password is sent', () => {
    const payload = buildProfilePayload(
      passwordProfile,
      valuesFrom(passwordProfile, { password: 'new-secret' })
    )
    expect(payload).toEqual({ password: 'new-secret' })
  })

  it('[FR-01.8.6] switching to SSH key auth clears the stored password', () => {
    const payload = buildProfilePayload(
      passwordProfile,
      valuesFrom(passwordProfile, { authMethod: 'key', sshKeyId: 'k1' })
    )
    expect(payload).toEqual({ authMethod: 'key', sshKeyId: 'k1', password: '' })
  })

  it('switching to key + passphrase sends the passphrase and requires it', () => {
    const values = valuesFrom(passwordProfile, {
      authMethod: 'key+passphrase',
      sshKeyId: 'k1',
      password: 'key-pass'
    })
    expect(buildProfilePayload(passwordProfile, values)).toEqual({
      authMethod: 'key+passphrase',
      sshKeyId: 'k1',
      password: 'key-pass'
    })
    expect(secretRequired(passwordProfile, { ...values, password: '' })).toBe(true)
  })

  it('keeping the method does not require re-entering the stored secret', () => {
    expect(secretRequired(passwordProfile, valuesFrom(passwordProfile))).toBe(false)
  })

  it('create sends all fields', () => {
    const payload = buildProfilePayload(undefined, {
      name: 'New',
      group: '',
      host: 'h',
      port: 2222,
      username: 'u',
      authMethod: 'password',
      password: 'pw',
      sshKeyId: ''
    })
    expect(payload).toEqual({
      name: 'New',
      group: null,
      host: 'h',
      port: 2222,
      username: 'u',
      authMethod: 'password',
      password: 'pw'
    })
  })
})

describe('[FR-01.8.4][BL-13] ProfileForm edit', () => {
  it('saving a renamed password profile sends { name } only', async () => {
    mockApi.get.mockResolvedValue({ data: [] })
    mockApi.put.mockResolvedValue({ data: {} })
    renderWithQuery(<ProfileForm open profile={passwordProfile} onOpenChange={() => {}} />)

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Prod web 2' } })
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }))

    await waitFor(() => expect(mockApi.put).toHaveBeenCalled())
    expect(mockApi.put).toHaveBeenCalledWith('/profiles/p1', { name: 'Prod web 2' })
  })

  it('[FR-01.1] offers all three auth methods', () => {
    mockApi.get.mockResolvedValue({ data: [] })
    renderWithQuery(<ProfileForm open onOpenChange={() => {}} />)
    const options = Array.from(
      (screen.getByLabelText('Auth Method') as HTMLSelectElement).options
    ).map((o) => o.value)
    expect(options).toEqual(['password', 'key', 'key+passphrase'])
  })
})
