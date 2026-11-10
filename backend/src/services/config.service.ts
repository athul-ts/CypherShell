import { prisma } from '../config/db'
import { AppConfig } from '@prisma/client'

interface ConfigUpdateInput {
  theme?: string
  defaultFont?: string
  defaultFontSize?: number
  logRetentionDays?: number
  autoLockMinutes?: number
}

/** Thrown when the app has not been through first-run setup yet. */
export class AppNotConfiguredError extends Error {
  constructor() {
    super('App not configured.')
    this.name = 'AppNotConfiguredError'
  }
}

export class ConfigService {
  /**
   * Reads the singleton config row, or `null` before first-run setup.
   *
   * Never creates the row (BL-10): the row's existence is what
   * `GET /api/auth/status` reports as "configured", so only the setup
   * endpoints may create it.
   */
  static async findConfig(): Promise<AppConfig | null> {
    return prisma.appConfig.findUnique({ where: { id: 'singleton' } })
  }

  /** Reads the config row; throws `AppNotConfiguredError` before first-run setup. */
  static async getConfig(): Promise<AppConfig> {
    const config = await this.findConfig()
    if (!config) throw new AppNotConfiguredError()
    return config
  }

  /**
   * Updates the user-editable settings. `lockEnabled` is deliberately not
   * accepted: changing the lock mode changes the encryption key, so it goes
   * through `POST /api/auth/setup-password` and `POST /api/auth/disable-lock`,
   * which re-encrypt every stored secret (FR-07.7).
   */
  static async updateConfig(data: ConfigUpdateInput): Promise<AppConfig> {
    await this.getConfig()

    // Whitelist updateable fields
    const { theme, defaultFont, defaultFontSize, logRetentionDays, autoLockMinutes } = data

    return prisma.appConfig.update({
      where: { id: 'singleton' },
      data: {
        ...(theme !== undefined && { theme }),
        ...(defaultFont !== undefined && { defaultFont }),
        ...(defaultFontSize !== undefined && { defaultFontSize }),
        ...(logRetentionDays !== undefined && { logRetentionDays }),
        ...(autoLockMinutes !== undefined && { autoLockMinutes })
      }
    })
  }
}
