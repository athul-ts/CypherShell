export const env = {
  jwtSecret: process.env.JWT_SECRET || (() => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'FATAL: JWT_SECRET environment variable is not set. ' +
        'The main process must generate and pass a random secret. ' +
        'See SEC-01 in security review.'
      )
    }
    // Dev-only fallback — never reaches production
    return 'default-dev-secret-do-not-use-in-prod'
  })()
}
