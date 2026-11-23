import type { Prisma } from '@prisma/client'
import { prisma } from '../config/db'
import { CryptoService } from './crypto.service'
import { logger } from './logger.service'

export interface RekeyResult {
  /** Secrets moved from one of the old keys to the new key. */
  reencrypted: number
  /** Secrets no candidate key could decrypt; they are left unchanged. */
  unreadable: number
}

function tryDecrypt(key: Buffer, value: string): string | null {
  try {
    return CryptoService.decryptWith(key, value)
  } catch {
    return null
  }
}

export class SecretsService {
  /**
   * Moves every stored secret (profile passwords/passphrases and SSH private
   * keys) to `newKey` and applies `configUpdate`, in a single transaction, so
   * a lock-mode change can never leave secrets encrypted under a key the app
   * will no longer derive (FR-07.7).
   *
   * A value already readable with `newKey` is left as it is; otherwise each
   * of `oldKeys` is tried in turn. Values no key can read are counted and
   * left untouched rather than aborting, so a database damaged by the
   * pre-BL-10 lock toggle can still be moved to a working state.
   */
  static async rekey(
    oldKeys: Buffer[],
    newKey: Buffer,
    configUpdate: Prisma.AppConfigUpdateInput
  ): Promise<RekeyResult> {
    const result: RekeyResult = { reencrypted: 0, unreadable: 0 }

    const convert = (value: string): string | null => {
      if (tryDecrypt(newKey, value) !== null) return null
      for (const key of oldKeys) {
        const plain = tryDecrypt(key, value)
        if (plain !== null) {
          result.reencrypted++
          return CryptoService.encryptWith(newKey, plain)
        }
      }
      result.unreadable++
      return null
    }

    await prisma.$transaction(async (tx) => {
      const profiles = await tx.profile.findMany({
        where: { encryptedPassword: { not: null } },
        select: { id: true, encryptedPassword: true }
      })
      for (const profile of profiles) {
        const next = convert(profile.encryptedPassword as string)
        if (next !== null) {
          await tx.profile.update({ where: { id: profile.id }, data: { encryptedPassword: next } })
        }
      }

      const keys = await tx.sSHKey.findMany({ select: { id: true, encryptedPrivateKey: true } })
      for (const key of keys) {
        const next = convert(key.encryptedPrivateKey)
        if (next !== null) {
          await tx.sSHKey.update({ where: { id: key.id }, data: { encryptedPrivateKey: next } })
        }
      }

      await tx.appConfig.update({ where: { id: 'singleton' }, data: configUpdate })
    })

    if (result.unreadable > 0) {
      logger.warn(`Re-key left ${result.unreadable} secret(s) that no known key could decrypt`)
    }
    return result
  }
}
