/** BL-38: tests that connect to the fixture server trust its host key first. */
import { prisma } from '../../../backend/src/config/db'
import type { TestSshServer } from './sshServer'

export async function trustTestServer(server: TestSshServer): Promise<void> {
  await prisma.knownHost.upsert({
    where: { host_port: { host: server.host.toLowerCase(), port: server.port } },
    update: {
      keyType: server.hostKey.type,
      fingerprint: server.hostKey.fingerprint,
      publicKey: server.hostKey.publicKey
    },
    create: {
      host: server.host.toLowerCase(),
      port: server.port,
      keyType: server.hostKey.type,
      fingerprint: server.hostKey.fingerprint,
      publicKey: server.hostKey.publicKey
    }
  })
}
