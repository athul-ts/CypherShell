import { randomUUID } from 'node:crypto'

/**
 * In-memory store of active JWT token IDs (JTIs).
 *
 * When the user locks the app, all issued JTIs are revoked so that
 * existing JWTs become invalid immediately (SEC-06). On unlock, a
 * fresh batch of JTIs is issued.
 *
 * This is an in-memory store — it resets when the backend restarts,
 * which is acceptable since restarting the app requires re-authentication.
 */
export class TokenStore {
  private static readonly activeJtis = new Set<string>()

  /** Issue a new JTI for a fresh token. */
  static issue(): string {
    const jti = randomUUID()
    this.activeJtis.add(jti)
    return jti
  }

  /** Check whether a JTI is still active. */
  static validate(jti: string): boolean {
    return this.activeJtis.has(jti)
  }

  /** Revoke every previously-issued token. Called on lock. */
  static revokeAll(): void {
    this.activeJtis.clear()
  }
}
