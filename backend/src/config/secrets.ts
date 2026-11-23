/**
 * The two secrets the main process hands to the backend (BL-46, ADR-005): the per-install
 * storage key (SEC-05) and the per-launch secret (BL-17).
 *
 * In the packaged app they arrive in the first message over `process.parentPort` and are kept
 * only here, in memory: they are never written to `process.env`, where same-user processes
 * could read them. Standalone runs and tests, which have no parent port, still use the
 * `STORAGE_KEY` and `LAUNCH_SECRET` environment variables.
 */
interface SecretValues {
  storageKey?: string
  launchSecret?: string
}

let received: SecretValues = {}

export const Secrets = {
  set(values: { storageKey: string; launchSecret: string }): void {
    received = { ...values }
  },

  clear(): void {
    received = {}
  },

  /** The PBKDF2 input used while app lock is off, or `undefined` when none was provided. */
  storageKey(): string | undefined {
    return received.storageKey ?? process.env.STORAGE_KEY
  },

  launchSecret(): string {
    return received.launchSecret ?? process.env.LAUNCH_SECRET ?? ''
  }
}
