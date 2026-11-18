/** FUN-14: Normalize a remote SFTP path, handling '.', '..', and extra slashes. Absolute paths stay absolute (BL-30). */
export function normalizeSftpPath(base: string, name: string): string {
  const joined = !base || base === '.' ? name : `${base}/${name}`
  const absolute = joined.startsWith('/')
  const result: string[] = []
  for (const part of joined.split('/')) {
    if (part === '..') {
      if (result.length > 0) result.pop()
    } else if (part && part !== '.') {
      result.push(part)
    }
  }
  if (absolute) return '/' + result.join('/')
  return result.join('/') || '.'
}

/** The directory above `path`; the root and the login directory (`.`) have none (BL-30). */
export function parentPath(path: string): string {
  if (path === '.' || path === '' || path === '/') return path || '.'
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  if (path.startsWith('/')) return '/' + parts.join('/')
  return parts.join('/') || '.'
}
