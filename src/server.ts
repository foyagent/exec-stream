import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import * as jwt from 'jsonwebtoken';
import * as path from 'path';
import * as fs from 'fs';
import * as zlib from 'zlib';
import * as crypto from 'crypto';
import { ExecStreamHook } from './hook';
import type {
  CompressionConfig,
  EncryptedPayloadEnvelope,
  EncryptedWebSocketMessage,
  PluginConfig,
  RemoteAuthVerifyResult,
  WebSocketMessage
} from './types';

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

type LoggerLike = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
};

type ApiLike = {
  logger: LoggerLike;
  registerHttpRoute?: (route: { path: string; auth: string; match: string; handler: () => Promise<boolean> | boolean }) => void;
};

type JwtClaims = {
  sub: string;
  permissions: string[];
  encKey: string;
};

export class ExecStreamServer {
  private static server: http.Server | null = null;
  private static wss: WebSocketServer | null = null;
  private static webDir: string;
  private static api: ApiLike;
  private static jwtSecret: string;
  private static tokenExpirySeconds: number;
  private static remoteToken?: string;
  private static derivedEncryptionKey: Buffer;
  private static compressionConfig: Required<CompressionConfig> = {
    enabled: true,
    threshold: 1024
  };

  private static authCodes: Map<string, { deviceId: string; createdAt: number }> = new Map();
  private static authorizedDevices: Map<string, string> = new Map();
  private static commandCache: CachedCommand[] = [];
  private static readonly maxCachedCommands = 10;

  static register(api: ApiLike, config: PluginConfig) {
    this.createServer(api, config, 'plugin');

    api.registerHttpRoute?.({
      path: '/exec-stream',
      auth: 'plugin',
      match: 'prefix',
      handler: async () => false
    });
  }

  static registerStandalone(config: PluginConfig) {
    const logger: LoggerLike = {
      info: msg => console.log(msg),
      warn: msg => console.warn(msg),
      error: msg => console.error(msg)
    };

    this.createServer({ logger }, config, 'standalone');
  }

  private static createServer(api: ApiLike, config: PluginConfig, source: 'plugin' | 'standalone') {
    if (this.server) {
      api.logger.warn(`[exec-stream][${source}] Server already running; skipping duplicate register`);
      return;
    }

    const port = config.port || 9200;
    this.jwtSecret = config.jwtSecret || 'default-secret-change-me';
    this.derivedEncryptionKey = this.deriveKey(this.jwtSecret);
    this.tokenExpirySeconds = config.tokenExpiry || 172800;
    this.remoteToken = config.remoteToken;
    this.api = api;
    this.webDir = path.join(__dirname, '../web');
    this.compressionConfig = {
      enabled: config.compression?.enabled ?? true,
      threshold: config.compression?.threshold ?? 1024
    };

    this.server = http.createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });

    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
      const token = this.extractToken(req);

      try {
        const payload = jwt.verify(token, this.jwtSecret) as JwtClaims;
        (ws as any).userId = payload.sub;
        (ws as any).encKey = payload.encKey;
        api.logger.info(`[exec-stream][${source}] WebSocket client connected: ${payload.sub}`);
      } catch {
        api.logger.warn(`[exec-stream][${source}] WebSocket auth failed: invalid token`);
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
          // ignore invalid ping frames
        }
      });

      ws.on('close', () => {
        ExecStreamHook.removeClient(ws);
        api.logger.info(`[exec-stream][${source}] WebSocket client disconnected`);
      });
    });

    this.server.listen(port, '0.0.0.0', () => {
      api.logger.info(`[exec-stream][${source}] WebSocket server listening on port ${port}`);
    });
  }

  static getCompressionConfig(): Required<CompressionConfig> {
    return { ...this.compressionConfig };
  }

  static shouldCompress(payload: string): boolean {
    if (!this.compressionConfig.enabled) return false;
    return Buffer.byteLength(payload, 'utf8') >= this.compressionConfig.threshold;
  }

  static compressPayload(payload: string): string {
    return zlib.deflateSync(Buffer.from(payload, 'utf8')).toString('base64');
  }

  static inflatePayload(base64Payload: string): string {
    return zlib.inflateSync(Buffer.from(base64Payload, 'base64')).toString('utf8');
  }

  static deriveKey(secret: string): Buffer {
    return crypto.createHash('sha256').update(secret, 'utf8').digest();
  }

  static encodeKeyForClaim(key: Buffer): string {
    return key.toString('base64url');
  }

  static decodeKeyFromClaim(key: string): Buffer {
    return Buffer.from(key, 'base64url');
  }

  private static getEncryptionKey(): Buffer {
    return this.derivedEncryptionKey || this.deriveKey(this.jwtSecret || 'default-secret-change-me');
  }

  static encrypt(plainText: string, key: Buffer = this.getEncryptionKey()): EncryptedWebSocketMessage {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      type: 'encrypted',
      data: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64')
    };
  }

  static decrypt(message: EncryptedWebSocketMessage, key: Buffer = this.getEncryptionKey()): string {
    const iv = Buffer.from(message.iv, 'base64');
    const authTag = Buffer.from(message.authTag, 'base64');
    const encrypted = Buffer.from(message.data, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }

  static toWireMessage(payload: string): string {
    const envelope: EncryptedPayloadEnvelope = this.shouldCompress(payload)
      ? { compressed: true, payload: this.compressPayload(payload) }
      : { compressed: false, payload };

    return JSON.stringify(this.encrypt(JSON.stringify(envelope)));
  }

  private static handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    const urlPath = parsedUrl.pathname;

    if (req.method === 'OPTIONS') {
      this.applyCorsHeaders(res);
      res.statusCode = 204;
      res.end();
      return;
    }

    if (urlPath === '/exec-stream/health' || urlPath === '/health') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      this.applyCorsHeaders(res);
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

    if (urlPath === '/exec-stream/api/events' && req.method === 'POST') {
      this.handleIncomingRemoteEvent(req, res);
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

  private static applyCorsHeaders(res: http.ServerResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
    this.applyCorsHeaders(res);
    res.end(JSON.stringify({ code, deviceId, expiresIn: 300 }));

    this.api.logger.info(`[exec-stream][local] Generated auth code: ${code} for device: ${deviceId}`);
  }

  private static handleAuthVerifyRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const { code } = JSON.parse(body);
        const result = this.verifyCode(code, req);

        if (!result.success) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          this.applyCorsHeaders(res);
          res.end(JSON.stringify({ success: false, error: result.error }));
          this.api.logger.warn(`[exec-stream] Invalid auth code: ${code}`);
          return;
        }

        res.setHeader('Content-Type', 'application/json');
        this.applyCorsHeaders(res);
        res.end(JSON.stringify({ success: true, token: result.token, deviceId: result.deviceId }));
      } catch {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        this.applyCorsHeaders(res);
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
      this.applyCorsHeaders(res);
      res.end(JSON.stringify({ authorized: false, error: '缺少 deviceId' }));
      return;
    }

    const token = this.authorizedDevices.get(deviceId);

    res.setHeader('Content-Type', 'application/json');
    this.applyCorsHeaders(res);
    res.end(JSON.stringify({ authorized: !!token, token: token || null }));
  }

  static verifyCode(code: string, req?: http.IncomingMessage): RemoteAuthVerifyResult {
    if (req?.headers.authorization && !this.isRemoteRequestAuthorized(req)) {
      return { success: false, error: 'remote token invalid' };
    }

    const authData = this.authCodes.get(code);

    if (!authData) {
      return { success: false, error: '授权码无效或已过期' };
    }

    const claims: JwtClaims = {
      sub: authData.deviceId,
      permissions: ['exec:read'],
      encKey: this.encodeKeyForClaim(this.derivedEncryptionKey)
    };

    const token = jwt.sign(claims, this.jwtSecret, {
      expiresIn: this.tokenExpirySeconds
    });

    this.authorizedDevices.set(authData.deviceId, token);
    this.authCodes.delete(code);

    this.api.logger.info(`[exec-stream] Auth code verified: ${code} -> device: ${authData.deviceId}`);

    return { success: true, token, deviceId: authData.deviceId };
  }

  private static handleIncomingRemoteEvent(req: http.IncomingMessage, res: http.ServerResponse) {
    if (!this.isRemoteRequestAuthorized(req)) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      this.applyCorsHeaders(res);
      res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
      this.api.logger.warn('[exec-stream][local] Rejected remote event: invalid token');
      return;
    }

    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const event = JSON.parse(body) as WebSocketMessage;
        ExecStreamHook.broadcastLocal(event as any);

        if (event.type === 'exec_end' && event.data && this.isCachedCommand(event.data)) {
          this.addCommandToCache(event.data);
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        this.applyCorsHeaders(res);
        res.end(JSON.stringify({ success: true }));
        this.api.logger.info(`[exec-stream][local] Accepted remote event: ${event.type}`);
      } catch {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        this.applyCorsHeaders(res);
        res.end(JSON.stringify({ success: false, error: 'Invalid event payload' }));
      }
    });
  }

  private static isCachedCommand(value: any): value is CachedCommand {
    return Boolean(value && typeof value === 'object' && typeof value.execId === 'string' && typeof value.command === 'string' && typeof value.timestamp === 'number');
  }

  private static isRemoteRequestAuthorized(req: http.IncomingMessage): boolean {
    const token = this.extractBearerToken(req.headers.authorization);
    if (!token) return false;

    if (this.remoteToken && token === this.remoteToken) {
      return true;
    }

    try {
      jwt.verify(token, this.jwtSecret);
      return true;
    } catch {
      return false;
    }
  }

  private static extractBearerToken(header?: string): string | undefined {
    if (!header || !header.startsWith('Bearer ')) return undefined;
    return header.substring(7).trim() || undefined;
  }

  static addCommandToCache(command: CachedCommand) {
    this.commandCache.push(command);
    if (this.commandCache.length > this.maxCachedCommands) {
      this.commandCache = this.commandCache.slice(-this.maxCachedCommands);
    }
    this.api.logger.info(`[exec-stream] Cached command: ${command.command}`);
  }

  private static handleCommandsRequest(res: http.ServerResponse) {
    res.setHeader('Content-Type', 'application/json');
    this.applyCorsHeaders(res);
    res.end(JSON.stringify({ commands: [...this.commandCache].sort((a, b) => a.timestamp - b.timestamp), count: this.commandCache.length }));
  }

  static broadcastLocal(message: WebSocketMessage | any) {
    ExecStreamHook.broadcastLocal(message);
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
