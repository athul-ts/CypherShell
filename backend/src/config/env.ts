import { randomBytes } from 'crypto'

export const env = {
  /**
   * BL-19: the JWT signing secret exists only in this backend process's
   * memory. It is never read from disk or from the environment, so a token can
   * be minted only by this process and stops working when it exits (a BL-16
   * restart already empties the token store, so nothing is lost).
   */
  jwtSecret: randomBytes(48).toString('hex')
}
