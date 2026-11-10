/**
 * Smoke tests for the in-process SSH server fixture, so failures in the
 * integration tests that use it point at the code under test, not the fixture.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { Client, utils, type ConnectConfig } from 'ssh2'
import { startTestSshServer, type TestSshServer } from './helpers/sshServer'

const servers: TestSshServer[] = []

afterAll(async () => {
  await Promise.all(servers.map((server) => server.close()))
})

function connect(config: ConnectConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    client.on('ready', () => resolve(client))
    client.on('error', reject)
    client.connect({ readyTimeout: 5000, ...config })
  })
}

describe('test SSH server', () => {
  it('accepts password auth and echoes shell input', async () => {
    const server = await startTestSshServer()
    servers.push(server)
    const client = await connect({
      host: server.host,
      port: server.port,
      username: server.username,
      password: server.password
    })

    const echoed = await new Promise<string>((resolve, reject) => {
      client.shell({ term: 'xterm-256color' }, (err, stream) => {
        if (err) return reject(err)
        stream.once('data', (data: Buffer) => resolve(data.toString('utf8')))
        stream.write('ping')
      })
    })
    client.end()

    expect(echoed).toBe('ping')
  })

  it('accepts an authorized public key and rejects a wrong password', async () => {
    const keyPair = utils.generateKeyPairSync('ed25519')
    const server = await startTestSshServer({ authorizedKeys: [keyPair.public] })
    servers.push(server)

    const client = await connect({
      host: server.host,
      port: server.port,
      username: server.username,
      privateKey: keyPair.private
    })
    client.end()

    await expect(
      connect({
        host: server.host,
        port: server.port,
        username: server.username,
        password: 'wrong-password'
      })
    ).rejects.toThrow(/authentication/i)
  })
})
