/**
 * [FR-05.1][BL-12] ssh2's own key generator writes about 1 in 300 ed25519 keys that ssh2 then
 * refuses to parse ("Malformed OpenSSH private key"). A stored key like that could never
 * connect, so generation tries again until ssh2 can read what it made.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { utils } from 'ssh2'
import { KeyService } from '../../backend/src/services/key.service'
import { CryptoService } from '../../backend/src/services/crypto.service'
import { prisma } from '../../backend/src/config/db'

beforeAll(async () => {
  await prisma.sSHKey.deleteMany()
  CryptoService.setActiveKey(
    await CryptoService.deriveKey('test-key', CryptoService.generateSalt())
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('[BL-12] generated keys that ssh2 cannot read are never stored', () => {
  it('generates again when the first key does not parse', async () => {
    const real = utils.generateKeyPairSync('ed25519')
    const spy = vi
      .spyOn(utils, 'generateKeyPairSync')
      .mockReturnValueOnce({
        private:
          '-----BEGIN OPENSSH PRIVATE KEY-----\nbm90IGEga2V5\n-----END OPENSSH PRIVATE KEY-----\n',
        public: real.public
      })
      .mockReturnValueOnce(real)

    const key = await KeyService.generateKey('retry', 'ed25519')

    expect(spy).toHaveBeenCalledTimes(2)
    const stored = CryptoService.decrypt(key.encryptedPrivateKey)
    expect(stored).toBe(real.private)
    expect(utils.parseKey(stored)).not.toBeInstanceOf(Error)
  })

  it('also checks a passphrase-protected key with its passphrase', async () => {
    const real = utils.generateKeyPairSync('ed25519', {
      passphrase: 'pw',
      cipher: 'aes256-ctr',
      rounds: 16
    })
    const spy = vi
      .spyOn(utils, 'generateKeyPairSync')
      .mockReturnValueOnce({ private: 'garbage', public: real.public })
      .mockReturnValueOnce(real)

    const key = await KeyService.generateKey('retry-pw', 'ed25519', 'pw')

    expect(spy).toHaveBeenCalledTimes(2)
    expect(utils.parseKey(CryptoService.decrypt(key.encryptedPrivateKey), 'pw')).not.toBeInstanceOf(
      Error
    )
  })

  it('gives up with an error instead of storing an unusable key', async () => {
    const real = utils.generateKeyPairSync('ed25519')
    vi.spyOn(utils, 'generateKeyPairSync').mockReturnValue({
      private: 'garbage',
      public: real.public
    })
    const before = await prisma.sSHKey.count()

    await expect(KeyService.generateKey('never', 'ed25519')).rejects.toThrow(/could not generate/i)

    expect(await prisma.sSHKey.count()).toBe(before)
  })
})
