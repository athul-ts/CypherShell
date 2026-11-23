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
    autoReconnect: profile.autoReconnect ?? true,
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
      sshKeyId: '',
      autoReconnect: true
    })
    expect(payload).toEqual({
      name: 'New',
      group: null,
      host: 'h',
      port: 2222,
      username: 'u',
      authMethod: 'password',
      password: 'pw',
      autoReconnect: true
    })
  })

  it('[BL-41] turning "Reconnect automatically" off sends { autoReconnect: false } only', () => {
    const payload = buildProfilePayload(
      passwordProfile,
      valuesFrom(passwordProfile, { autoReconnect: false })
    )
    expect(payload).toEqual({ autoReconnect: false })
  })
})

describe('[FR-02.6][BL-41] ProfileForm "Reconnect automatically"', () => {
  it('is on by default and saves the unchecked value', async () => {
    mockApi.get.mockResolvedValue({ data: [] })
    mockApi.put.mockResolvedValue({ data: {} })
    renderWithQuery(<ProfileForm open profile={passwordProfile} onOpenChange={() => {}} />)

    const box = screen.getByLabelText('Reconnect automatically') as HTMLInputElement
    expect(box.checked).toBe(true)
    fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }))

    await waitFor(() =>
      expect(mockApi.put).toHaveBeenCalledWith('/profiles/p1', { autoReconnect: false })
    )
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

describe('[FR-01.8.7][BL-31] inline validation', () => {
  function renderNew(): void {
    mockApi.get.mockResolvedValue({ data: [] })
    renderWithQuery(<ProfileForm open onOpenChange={() => {}} />)
  }

  it('blank Name, Host, Username and Password show errors and send nothing', async () => {
    renderNew()
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }))

    expect(await screen.findByText('Name is required')).toBeInTheDocument()
    expect(screen.getByText('Host is required')).toBeInTheDocument()
    expect(screen.getByText('Username is required')).toBeInTheDocument()
    expect(screen.getByText('Password is required')).toBeInTheDocument()
    expect(mockApi.post).not.toHaveBeenCalled()
  })

  it.each(['0', '65536'])('port %s is rejected', async (port) => {
    renderNew()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'n' } })
    fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'h' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'u' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'p' } })
    fireEvent.change(screen.getByLabelText('Port'), { target: { value: port } })
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }))

    expect(await screen.findByText('Port must be a number from 1 to 65535')).toBeInTheDocument()
    expect(mockApi.post).not.toHaveBeenCalled()
  })

  it('an error clears as soon as its field is edited', async () => {
    renderNew()
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }))
    expect(await screen.findByText('Name is required')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'x' } })
    expect(screen.queryByText('Name is required')).not.toBeInTheDocument()
    expect(screen.getByText('Host is required')).toBeInTheDocument() // others stay
  })

  it('SSH key methods require a key', async () => {
    renderNew()
    fireEvent.change(screen.getByLabelText('Auth Method'), { target: { value: 'key' } })
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }))
    expect(await screen.findByText('Select an SSH key')).toBeInTheDocument()
  })

  it('a valid form is submitted', async () => {
    mockApi.get.mockResolvedValue({ data: [] })
    mockApi.post.mockResolvedValue({ data: {} })
    renderWithQuery(<ProfileForm open onOpenChange={() => {}} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Web' } })
    fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'web.local' } })
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'root' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: /save profile/i }))

    await waitFor(() =>
      expect(mockApi.post).toHaveBeenCalledWith(
        '/profiles',
        expect.objectContaining({ name: 'Web', host: 'web.local', username: 'root', port: 22 })
      )
    )
  })
})
