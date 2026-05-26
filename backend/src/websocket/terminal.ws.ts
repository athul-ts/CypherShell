import WebSocket, { WebSocketServer } from 'ws';
import { Server } from 'http';
import { SSHService } from '../services/ssh.service';

export function setupTerminalWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    if (request.url?.startsWith('/ws/terminal/')) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket, request) => {
    const sessionId = request.url?.split('/').pop();
    if (!sessionId) {
      ws.close(1008, 'Missing session ID');
      return;
    }

    const session = SSHService.getSession(sessionId);
    if (!session) {
      ws.close(1008, 'Invalid session ID');
      return;
    }

    session.client.shell({ term: 'xterm-256color' }, (err, stream) => {
      if (err) {
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
        ws.close(1011, 'Failed to start shell');
        return;
      }

      ws.send(JSON.stringify({ type: 'status', state: 'connected' }));

      stream.on('data', (data: any) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'output', data: data.toString('base64') }));
        }
      });

      stream.on('close', () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'status', state: 'disconnected' }));
          ws.close(1000, 'Shell closed');
        }
        SSHService.removeSession(sessionId);
      });

      ws.on('message', (message) => {
        try {
          const msg = JSON.parse(message.toString());
          if (msg.type === 'input' && msg.data) {
            stream.write(Buffer.from(msg.data, 'base64'));
          } else if (msg.type === 'resize' && msg.cols && msg.rows) {
            stream.setWindow(msg.rows, msg.cols, 0, 0);
          } else if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
        } catch (e) {
          console.error('WebSocket message error:', e);
        }
      });

      ws.on('close', () => {
        stream.end();
      });
    });
  });
}
