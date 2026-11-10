export type AuthMethod = 'password' | 'key' | 'key+passphrase'

/** The profile as loaded from the API (secrets are never included). */
export interface ProfileSnapshot {
  name: string
  group?: string | null
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  sshKeyId?: string | null
  hasPassword?: boolean
}

/** Field values held by ProfileForm. `password` is the SSH password or the key passphrase. */
export interface ProfileFormValues {
  name: string
  group: string
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  password: string
  sshKeyId: string
}

export type ProfilePayload = Partial<{
  name: string
  group: string | null
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  password: string
  sshKeyId: string
}>

const usesKey = (method: AuthMethod): boolean => method !== 'password'
const needsSecret = (method: AuthMethod): boolean => method !== 'key'

/**
 * Whether the password/passphrase input must be filled in. A new secret is
 * required when creating a profile, and whenever an edit switches to a method
 * that needs one — the stored secret belongs to the old method and must not
 * be reused (an SSH password is not a key passphrase).
 */
export function secretRequired(
  original: ProfileSnapshot | undefined,
  values: ProfileFormValues
): boolean {
  if (!needsSecret(values.authMethod)) return false
  if (!original) return values.authMethod === 'password'
  return original.authMethod !== values.authMethod || !original.hasPassword
}

/**
 * Builds the request body for ProfileForm.
 *
 * Create sends every field. Edit sends only what changed (FR-01.8.4): the API
 * leaves omitted fields untouched, and treats `password: ''` as "clear the
 * stored secret", so the password is sent only when the user typed one — or
 * as `''` when switching to plain key auth, which needs no secret (FR-01.8.6).
 */
export function buildProfilePayload(
  original: ProfileSnapshot | undefined,
  values: ProfileFormValues
): ProfilePayload {
  const sshKeyId = usesKey(values.authMethod) && values.sshKeyId ? values.sshKeyId : undefined

  if (!original) {
    return {
      name: values.name,
      group: values.group || null,
      host: values.host,
      port: values.port,
      username: values.username,
      authMethod: values.authMethod,
      ...(needsSecret(values.authMethod) && values.password ? { password: values.password } : {}),
      ...(sshKeyId ? { sshKeyId } : {})
    }
  }

  const payload: ProfilePayload = {}
  if (values.name !== original.name) payload.name = values.name
  if (values.group !== (original.group ?? '')) payload.group = values.group || null
  if (values.host !== original.host) payload.host = values.host
  if (values.port !== original.port) payload.port = values.port
  if (values.username !== original.username) payload.username = values.username

  const methodChanged = values.authMethod !== original.authMethod
  if (methodChanged) payload.authMethod = values.authMethod

  if (sshKeyId && (methodChanged || sshKeyId !== (original.sshKeyId ?? ''))) {
    payload.sshKeyId = sshKeyId
  }

  if (needsSecret(values.authMethod)) {
    if (values.password) payload.password = values.password
  } else if (methodChanged) {
    payload.password = ''
  }

  return payload
}
