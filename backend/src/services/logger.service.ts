/**
 * Minimal structured logger for the CypherShell backend.
 *
 * Replaces bare console.log/error calls so logs are timestamped and
 * identifiable (CODE-09). Messages go to stdout/stderr as the parent
 * Electron process captures them via child process stdout.
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug'

function formatMessage(level: LogLevel, message: string): string {
  const time = new Date().toISOString()
  return `[${time}] [${level.toUpperCase()}] ${message}`
}

export const logger = {
  info: (message: string, ...args: unknown[]): void => {
    console.log(formatMessage('info', message), ...args)
  },

  warn: (message: string, ...args: unknown[]): void => {
    console.warn(formatMessage('warn', message), ...args)
  },

  error: (message: string, ...args: unknown[]): void => {
    console.error(formatMessage('error', message), ...args)
  },

  debug: (message: string, ...args: unknown[]): void => {
    if (process.env.NODE_ENV === 'development') {
      console.log(formatMessage('debug', message), ...args)
    }
  }
}
