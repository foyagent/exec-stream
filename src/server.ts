import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import * as jwt from 'jsonwebtoken';
import * as path from 'path';
import * as fs from 'fs';
import { ExecStreamHook } from './hook';
import type { PluginConfig } from './types';

export class ExecStreamServer {
  private static server: http.Server | null = null;
  private static wss: WebSocketServer | null = null;
  private static webDir: string;
  private static api: any;
  private static jwtSecret: string;
  private static tokenExpirySeconds: number;
  
  // 授权码存储：code -> { deviceId, createdAt }
  private static authCodes: Map<string, { deviceId: string; createdAt: number }> = new Map();
  // 已授权设备：deviceId -> token
  private static authorizedDevices: Map<string, string> = new Map();

  static register(api: any, config: PluginConfig) {
    const port = config.port || 9200;
    this.jwtSecret = config.jwtSecret || 'default-secret-change-me';
    this.tokenExpirySeconds = config.tokenExpiry || 172800;
    this.api = api;
    
    // 获取 web 目录路径
    this.webDir = path.join(__dirname, '../web');

    // 创建 HTTP 服务器，处理静态文件
    this.server = http.createServer((req, res) => {
      this.handleHttpRequest(req, res);
    });
    
    // 创建 WebSocket 服务器
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

    // 注册 HTTP 路由到 OpenClaw Gateway
    api.registerHttpRoute({
      path: '/exec-stream',
      auth: 'plugin',
      match: 'prefix',
      handler: async (req: http.IncomingMessage, res: http.ServerResponse) => {
        // 让内部的 http.createServer 处理
        return false;
      }
    });

    this.server.listen(port, '0.0.0.0', () => {
      api.logger.info(`Exec Stream WebSocket server listening on port ${port}`);
    });
  }

  private static handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    const urlPath = parsedUrl.pathname;
    
    // 健康检查
    if (urlPath === '/exec-stream/health' || urlPath === '/health') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    
    // 授权码生成
    if (urlPath === '/exec-stream/auth/code' && req.method === 'GET') {
      this.handleAuthCodeRequest(req, res);
      return;
    }
    
    // 授权码验证
    if (urlPath === '/exec-stream/auth/verify' && req.method === 'POST') {
      this.handleAuthVerifyRequest(req, res);
      return;
    }
    
    // 检查设备授权状态
    if (urlPath === '/exec-stream/auth/status' && req.method === 'GET') {
      this.handleAuthStatusRequest(req, res);
      return;
    }
    
    // 根路径或 /exec-stream 返回 index.html
    let filePath = urlPath;
    if (urlPath === '/' || urlPath === '/exec-stream' || urlPath === '/exec-stream/') {
      filePath = '/index.html';
    }
    
    // 移除 /exec-stream 前缀
    if (filePath.startsWith('/exec-stream/')) {
      filePath = filePath.substring('/exec-stream'.length);
    }
    
    // 构建完整文件路径
    const fullPath = path.join(this.webDir, filePath);
    
    // 安全检查：确保文件路径在 web 目录内
    if (!fullPath.startsWith(this.webDir)) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Forbidden');
      return;
    }
    
    // 检查文件是否存在
    if (!fs.existsSync(fullPath)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Not found');
      return;
    }
    
    // 读取并返回文件
    try {
      const content = fs.readFileSync(fullPath);
      
      // 设置 Content-Type
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
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Internal server error');
    }
  }

  private static extractToken(req: http.IncomingMessage): string {
    // 从 Cookie 提取
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/exec_stream_token=([^;]+)/);
    if (match) return match[1];

    // 从 Query 提取
    const url = new URL(req.url || '/', 'http://localhost');
    const queryToken = url.searchParams.get('token');
    if (queryToken) return queryToken;

    // 从 Authorization header 提取
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) {
      return auth.substring(7);
    }

    return '';
  }

  // 生成授权码
  private static handleAuthCodeRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const deviceId = `device_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    
    this.authCodes.set(code, {
      deviceId,
      createdAt: Date.now()
    });
    
    // 5分钟后自动删除
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

  // 验证授权码
  private static handleAuthVerifyRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { code } = JSON.parse(body);
        const authData = this.authCodes.get(code);
        
        if (!authData) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.end(JSON.stringify({ success: false, error: '授权码无效或已过期' }));
          this.api.logger.warn(`[exec-stream] Invalid auth code: ${code}`);
          return;
        }
        
        // 生成 JWT token
        const token = jwt.sign(
          { sub: authData.deviceId, permissions: ['exec:read'] },
          this.jwtSecret,
          { expiresIn: this.tokenExpirySeconds }
        );
        
        // 保存已授权设备
        this.authorizedDevices.set(authData.deviceId, token);
        
        // 删除授权码（一次性使用）
        this.authCodes.delete(code);
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(JSON.stringify({ success: true, token, deviceId: authData.deviceId }));
        
        this.api.logger.info(`[exec-stream] Auth code verified: ${code} -> device: ${authData.deviceId}`);
      } catch (e) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(JSON.stringify({ success: false, error: '请求格式错误' }));
      }
    });
  }

  // 检查设备授权状态
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

  // 公开方法：供 hook.ts 调用
  static verifyCode(code: string): { success: boolean; token?: string; error?: string } {
    const authData = this.authCodes.get(code);
    
    if (!authData) {
      return { success: false, error: '授权码无效或已过期' };
    }
    
    // 生成 JWT token
    const token = jwt.sign(
      { sub: authData.deviceId, permissions: ['exec:read'] },
      this.jwtSecret,
      { expiresIn: this.tokenExpirySeconds }
    );
    
    // 保存已授权设备
    this.authorizedDevices.set(authData.deviceId, token);
    
    // 删除授权码（一次性使用）
    this.authCodes.delete(code);
    
    this.api.logger.info(`[exec-stream] Auth code verified via hook: ${code} -> device: ${authData.deviceId}`);
    
    return { success: true, token };
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
