import { prisma } from '../config/db'
import { AppConfig } from '@prisma/client'
import { randomBytes } from 'crypto'

interface ConfigUpdateInput {
  theme?: string
  defaultFont?: string
  defaultFontSize?: number
  logRetentionDays?: number
  lockEnabled?: boolean
  autoLockMinutes?: number
}

export class ConfigService {
  static async getConfig(): Promise<AppConfig> {
    let config = await prisma.appConfig.findUnique({ where: { id: 'singleton' } })
    if (!config) {
      config = await prisma.appConfig.create({
        data: {
          id: 'singleton',
          encryptionKeySalt: randomBytes(16).toString('hex')
        }
      })
    }
    return config
  }

  static async updateConfig(data: ConfigUpdateInput): Promise<AppConfig> {
    await this.getConfig() // ensure it exists

    // Whitelist updateable fields
    const { theme, defaultFont, defaultFontSize, logRetentionDays, lockEnabled, autoLockMinutes } =
      data

    // FUN-02: Prevent enabling lock without a master password hash
    if (lockEnabled === true) {
      const current = await prisma.appConfig.findUnique({ where: { id: 'singleton' } })
      if (current && !current.masterPasswordHash) {
        throw new Error('Set a master password before enabling app lock.')
      }
    }

    return prisma.appConfig.update({
      where: { id: 'singleton' },
      data: {
        ...(theme !== undefined && { theme }),
        ...(defaultFont !== undefined && { defaultFont }),
        ...(defaultFontSize !== undefined && { defaultFontSize }),
        ...(logRetentionDays !== undefined && { logRetentionDays }),
        ...(lockEnabled !== undefined && { lockEnabled }),
        ...(autoLockMinutes !== undefined && { autoLockMinutes })
      }
    })
  }
}
