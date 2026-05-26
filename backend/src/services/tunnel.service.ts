import { SSHService } from './ssh.service';
import net from 'net';

export class TunnelService {
  private static localServers = new Map<string, net.Server>();

  static async checkPort(port: number, host: string = '127.0.0.1'): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      server.listen(port, host);
    });
  }

  static async startLocalForward(sessionId: string, localPort: number, remoteHost: string, remotePort: number) {
    const session = SSHService.getSession(sessionId);
    if (!session) throw new Error('Session not found');
    
    const isFree = await this.checkPort(localPort);
    if (!isFree) throw new Error(`Port ${localPort} is already in use`);

    const server = net.createServer((socket) => {
      session.client.forwardOut('127.0.0.1', localPort, remoteHost, remotePort, (err, stream) => {
        if (err) {
          socket.end();
          return;
        }
        socket.pipe(stream);
        stream.pipe(socket);
      });
    });

    return new Promise<void>((resolve, reject) => {
      server.listen(localPort, '127.0.0.1', () => {
        const id = `local-${sessionId}-${localPort}`;
        this.localServers.set(id, server);
        resolve();
      });
      server.on('error', reject);
    });
  }

  static async stopLocalForward(sessionId: string, localPort: number) {
    const id = `local-${sessionId}-${localPort}`;
    const server = this.localServers.get(id);
    if (server) {
      server.close();
      this.localServers.delete(id);
    }
  }

  static async startRemoteForward(sessionId: string, remotePort: number, localHost: string, localPort: number) {
    const session = SSHService.getSession(sessionId);
    if (!session) throw new Error('Session not found');

    return new Promise<void>((resolve, reject) => {
      session.client.forwardIn('0.0.0.0', remotePort, (err) => {
        if (err) return reject(err);
        
        // We only register the listener once per session
        if (!(session as any).hasTcpListener) {
          session.client.on('tcp connection', (details, accept, rejectConnection) => {
            // Forward back to localHost:localPort
            // For a complete app, we'd map details.destPort to the configured localHost/Port.
            // For now, assuming standard 1-to-1 if remotePort matches.
            if (details.destPort === remotePort) {
              const socket = net.connect(localPort, localHost, () => {
                const stream = accept();
                socket.pipe(stream);
                stream.pipe(socket);
              });
              socket.on('error', () => rejectConnection());
            } else {
              rejectConnection();
            }
          });
          (session as any).hasTcpListener = true;
        }

        resolve();
      });
    });
  }

  static async stopRemoteForward(sessionId: string, remotePort: number) {
    const session = SSHService.getSession(sessionId);
    if (!session) return;
    session.client.unforwardIn('0.0.0.0', remotePort, () => {});
  }

  static async startDynamicForward(sessionId: string, localPort: number) {
    const session = SSHService.getSession(sessionId);
    if (!session) throw new Error('Session not found');

    const isFree = await this.checkPort(localPort);
    if (!isFree) throw new Error(`Port ${localPort} is already in use`);

    const server = net.createServer((socket) => {
      let state = 'VERSION';
      socket.on('data', (chunk) => {
        if (state === 'VERSION') {
          if (chunk[0] !== 0x05) return socket.end();
          socket.write(Buffer.from([0x05, 0x00])); // NO AUTH
          state = 'REQUEST';
        } else if (state === 'REQUEST') {
          const cmd = chunk[1]; // 0x01 = CONNECT
          if (cmd !== 0x01) return socket.end();
          const atyp = chunk[3];
          let host = '', portOffset = 0;
          if (atyp === 0x01) { // IPv4
            host = `${chunk[4]}.${chunk[5]}.${chunk[6]}.${chunk[7]}`;
            portOffset = 8;
          } else if (atyp === 0x03) { // Domain name
            const len = chunk[4];
            host = chunk.toString('utf8', 5, 5 + len);
            portOffset = 5 + len;
          } else {
            return socket.end();
          }
          const port = chunk.readUInt16BE(portOffset);

          session.client.forwardOut('127.0.0.1', localPort, host, port, (err, stream) => {
            if (err) {
              socket.write(Buffer.from([0x05, 0x01, 0x00, 0x01, 0,0,0,0, 0,0]));
              return socket.end();
            }
            socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0,0,0,0, 0,0]));
            socket.pipe(stream);
            stream.pipe(socket);
            state = 'CONNECTED';
          });
        }
      });
      socket.on('error', () => {});
    });

    return new Promise<void>((resolve, reject) => {
      server.listen(localPort, '127.0.0.1', () => {
        const id = `dynamic-${sessionId}-${localPort}`;
        this.localServers.set(id, server);
        resolve();
      });
      server.on('error', reject);
    });
  }

  static async stopDynamicForward(sessionId: string, localPort: number) {
    const id = `dynamic-${sessionId}-${localPort}`;
    const server = this.localServers.get(id);
    if (server) {
      server.close();
      this.localServers.delete(id);
    }
  }
}
