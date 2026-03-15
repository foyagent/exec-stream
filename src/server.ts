import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import * as jwt from 'jsonwebtoken';
import * as path from 'path';
import * as fs from 'fs';
import { ExecStreamHook } from './hook';
import type { PluginConfig } from './types';

type CachedCommand = {
  execId: string;
  command: string;
  cwd?: string;
  timestamp: number;
  exitCode?: number;
  duration?: number;
  stdout?: string;
  stderr?: string;
};

export class ExecStreamServer {
  private static server: http.Server | null = null;
  private static wss: WebSocketServer | null = null;
  private static webDir: string;
  private static api: any;
  private static jwtSecret: string;
  private static tokenExpirySeconds: number;

  private static authCodes: Map<string, { deviceId: string; createdAt: number }> = new Map();
  private static authorizedDevices: Map<string, string> = new Map();
  private static commandCache: CachedCommand[] = [];

  static register(api: any, config: PluginConfig) {
    const port = config.port || 9200;
    this.jwtSecret = config.jwtSecret || 'default-secret-change-me';
    this.tokenExpirySeconds = config.tokenExpiry || 172800;
    this.api = api;
    this.webDir = path.join(__dirname, '../web');

    this.server = http.createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });

    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
      const token = this.extractToken(req);

      try {
        const payload = jwt.verify(token, this.jwtSecret) as any;
        (ws as any).userId = payload.sub;
        api.logger.info(`WebSocket client connected: ${payload.sub}`);
      } catch {
        api.logger.warn('WebSocket auth failed: invalid token');
        ws.close(1008, 'Unauthorized');
        return;
      }

      ExecStreamHook.addClient(ws);

      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.action === 'ping') {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
        } catch {
          // ignore
        }
      });

      ws.on('close', () => {
        ExecStreamHook.removeClient(ws);
        api.logger.info('WebSocket client disconnected');
      });
    });

    api.registerHttpRoute({
      path: '/exec-stream',
      auth: 'plugin',
      match: 'prefix',
      handler: async () => false
    });

    this.server.listen(port, '0.0.0.0', () => {
      api.logger.info(`Exec Stream WebSocket server listening on port ${port}`);
    });
  }

  private static handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    const urlPath = parsedUrl.pathname;

    if (urlPath === '/exec-stream/health' || urlPath === '/health') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (urlPath === '/exec-stream/auth/code' && req.method === 'GET') {
      this.handleAuthCodeRequest(res);
      return;
    }

    if (urlPath === '/exec-stream/auth/verify' && req.method === 'POST') {
      this.handleAuthVerifyRequest(req, res);
      return;
    }

    if (urlPath === '/exec-stream/auth/status' && req.method === 'GET') {
      this.handleAuthStatusRequest(req, res);
      return;
    }

    if (urlPath === '/exec-stream/commands' && req.method === 'GET') {
      this.handleCommandsRequest(res);
      return;
    }

    let filePath = urlPath;
    if (urlPath === '/' || urlPath === '/exec-stream' || urlPath === '/exec-stream/') {
      filePath = '/index.html';
    }

    if (filePath.startsWith('/exec-stream/')) {
      filePath = filePath.substring('/exec-stream'.length);
    }

    const fullPath = path.join(this.webDir, filePath);

    if (!fullPath.startsWith(this.webDir)) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Forbidden');
      return;
    }

    if (!fs.existsSync(fullPath)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Not found');
      return;
    }

    try {
      const content = fs.readFileSync(fullPath);

      if (filePath.endsWith('.html')) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
      } else if (filePath.endsWith('.js')) {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      } else if (filePath.endsWith('.css')) {
        res.setHeader('Content-Type', 'text/css; charset=utf-8');
      } else {
        res.setHeader('Content-Type', 'application/octet-stream');
      }

      res.statusCode = 200;
      res.end(content);
    } catch {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Internal server error');
    }
  }

  private static extractToken(req: http.IncomingMessage): string {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/exec_stream_token=([^;]+)/);
    if (match) return match[1];

    const url = new URL(req.url || '/', 'http://localhost');
    const queryToken = url.searchParams.get('token');
    if (queryToken) return queryToken;

    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) {
      return auth.substring(7);
    }

    return '';
  }

  private static handleAuthCodeRequest(res: http.ServerResponse) {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const deviceId = `device_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    this.authCodes.set(code, {
      deviceId,
      createdAt: Date.now()
    });

    setTimeout(() => {
      this.authCodes.delete(code);
    }, 5 * 60 * 1000);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(JSON.stringify({
      code,
      deviceId,
      expiresIn: 300
    }));

    this.api.logger.info(`[exec-stream] Generated auth code: ${code} for device: ${deviceId}`);
  }

  private static handleAuthVerifyRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { code } = JSON.parse(body);
        const result = this.verifyCode(code);

        if (!result.success) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(JSON.stringify({ success: false, error: result.error }));
          this.api.logger.warn(`[exec-stream] Invalid auth code: ${code}`);
          return;
        }

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(JSON.stringify({ success: true, token: result.token, deviceId: result.deviceId }));
      } catch {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(JSON.stringify({ success: false, error: '请求格式错误' }));
      }
    });
  }

  private static handleAuthStatusRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    const deviceId = parsedUrl.searchParams.get('deviceId');

    if (!deviceId) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.end(JSON.stringify({ authorized: false, error: '缺少 deviceId' }));
      return;
    }

    const token = this.authorizedDevices.get(deviceId);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(JSON.stringify({
      authorized: !!token,
      token: token || null
    }));
  }

  static verifyCode(code: string): { success: boolean; token?: string; deviceId?: string; error?: string } {
    const authData = this.authCodes.get(code);

    if (!authData) {
      return { success: false, error: '授权码无效或已过期' };
    }

    const token = jwt.sign(
      { sub: authData.deviceId, permissions: ['exec:read'] },
      this.jwtSecret,
      { expiresIn: this.tokenExpirySeconds }
    );

    this.authorizedDevices.set(authData.deviceId, token);
    this.authCodes.delete(code);

    this.api.logger.info(`[exec-stream] Auth code verified: ${code} -> device: ${authData.deviceId}`);

    return { success: true, token, deviceId: authData.deviceId };
  }

  static addCommandToCache(command: CachedCommand) {
    this.commandCache.push(command);
    if (this.commandCache.length > 10) {
      this.commandCache = this.commandCache.slice(-10);
    }
    this.api.logger.info(`[exec-stream] Cached command: ${command.command}`);
  }

  private static handleCommandsRequest(res: http.ServerResponse) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(JSON.stringify({
      commands: [...this.commandCache].sort((a, b) => a.timestamp - b.timestamp),
      count: this.commandCache.length
    }));
  }

  static stop() {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
