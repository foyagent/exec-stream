import type {
  ExecEvent,
  RemoteAuthVerifyResult,
  ResolvedPluginConfig,
  WebSocketMessage
} from './types';

declare const WebSocket: {
  OPEN: number;
};

type AgentEventPayload = {
  runId?: string;
  stream?: string;
  data?: Record<string, unknown>;
};

type ActiveExecState = {
  execId: string;
  sessionId: string;
  command: string;
  cwd?: string;
  timestamp: number;
  lastOutputSnapshot: string;
};

type PluginAPI = {
  runtime?: {
    sessionId?: string;
    events?: {
      onAgentEvent?: (listener: (event: AgentEventPayload) => void) => (() => boolean) | void;
    };
  };
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  on: (event: string, handler: (event: any) => void) => void;
};

export class ExecStreamHook {
  private static clients: Set<any> = new Set();
  private static api: PluginAPI;
  private static config: ResolvedPluginConfig = { mode: 'local' };
  private static activeExecs: Map<string, ActiveExecState> = new Map();
  private static remoteSessionToken?: string;

  static register(api: PluginAPI, config: ResolvedPluginConfig) {
    this.api = api;
    this.config = config;
    this.remoteSessionToken = undefined;

    api.runtime?.events?.onAgentEvent?.((event: AgentEventPayload) => {
      this.handleAgentEvent(event);
    });

    api.on('before_tool_call', (event: any) => {
      if (event.toolName !== 'exec') return;

      const execId = this.generateExecId();
      const timestamp = Date.now();
      const sessionId = api.runtime?.sessionId || 'unknown';
      const command = this.asString(event.params?.command);
      const cwd = this.asOptionalString(event.params?.cwd);
      const toolKey = this.buildToolKey(event.runId, event.toolCallId, command, timestamp);

      this.activeExecs.set(toolKey, {
        execId,
        sessionId,
        command,
        cwd,
        timestamp,
        lastOutputSnapshot: ''
      });

      const execEvent: ExecEvent = {
        sessionId,
        execId,
        command,
        cwd,
        timestamp
      };

      this.broadcast({
        type: 'exec_start',
        data: execEvent
      });
    });

    api.on('after_tool_call', (event: any) => {
      if (event.toolName !== 'exec') return;

      const command = this.asString(event.params?.command);
      const toolKey = this.buildToolKey(event.runId, event.toolCallId, command);
      const state = this.activeExecs.get(toolKey);
      const extracted = this.extractExecResult(event.result);

      const execEvent: ExecEvent = {
        sessionId: state?.sessionId || api.runtime?.sessionId || 'unknown',
        execId: state?.execId || this.generateExecId(),
        command,
        cwd: state?.cwd || this.asOptionalString(event.params?.cwd),
        timestamp: state?.timestamp || Date.now(),
        exitCode: extracted.exitCode,
        duration: this.asOptionalNumber(event.durationMs),
        stdout: extracted.stdout,
        stderr: extracted.stderr
      };

      this.broadcast({
        type: 'exec_end',
        data: execEvent
      });

      const { ExecStreamServer } = require('./server');
      ExecStreamServer.addCommandToCache(execEvent);
      this.activeExecs.delete(toolKey);
    });

    const messageHandler = (event: any) => this.handleMessage(event);
    ['message', 'message_received', 'chat_message', 'user_message'].forEach(eventName => {
      try {
        api.on(eventName, messageHandler);
      } catch {
        // ignore unsupported message hooks
      }
    });

    api.logger.info(`[exec-stream] Hook registered in ${config.mode} mode`);
  }

  private static handleAgentEvent(event: AgentEventPayload) {
    if (event.stream !== 'tool') return;

    const data = event.data;
    if (!data) return;
    if (data.name !== 'exec') return;
    if (data.phase !== 'update') return;

    const toolKey = this.buildToolKey(event.runId, data.toolCallId, undefined);
    const state = this.activeExecs.get(toolKey);
    if (!state) return;

    const partialResult = this.asRecord(data.partialResult);
    const details = this.asRecord(partialResult?.details);
    const contentText = this.extractContentText(partialResult);
    const currentSnapshot = this.asOptionalString(details?.tail) || contentText;
    if (!currentSnapshot) return;

    const delta = this.computeDelta(state.lastOutputSnapshot, currentSnapshot);
    state.lastOutputSnapshot = currentSnapshot;
    if (!delta) return;

    this.broadcast({
      type: 'exec_output',
      data: {
        sessionId: state.sessionId,
        execId: state.execId,
        command: state.command,
        cwd: state.cwd,
        timestamp: state.timestamp,
        stdout: delta
      }
    });
  }

  private static extractExecResult(result: unknown): {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
  } {
    const record = this.asRecord(result);
    const details = this.asRecord(record?.details);

    const stdout =
      this.asOptionalString(record?.stdout) ||
      this.asOptionalString(details?.aggregated) ||
      this.extractContentText(record);
    const stderr = this.asOptionalString(record?.stderr);
    const exitCode =
      this.asOptionalNumber(details?.exitCode) ??
      this.asOptionalNumber(record?.exitCode) ??
      this.asOptionalNumber(record?.code);

    return { stdout, stderr, exitCode };
  }

  private static extractContentText(value: unknown): string | undefined {
    const record = this.asRecord(value);
    const content = record?.content;
    if (!Array.isArray(content)) return undefined;

    const text = content
      .map(part => {
        const item = this.asRecord(part);
        return item?.type === 'text' ? this.asOptionalString(item.text) || '' : '';
      })
      .join('');

    return text || undefined;
  }

  private static computeDelta(previous: string, current: string): string {
    if (!previous) return current;
    if (current === previous) return '';
    if (current.startsWith(previous)) return current.slice(previous.length);
    return current;
  }

  private static buildToolKey(
    runId: unknown,
    toolCallId: unknown,
    command?: string,
    timestamp?: number
  ): string {
    const run = this.asOptionalString(runId) || 'unknown-run';
    const tool = this.asOptionalString(toolCallId);
    if (tool) return `${run}:${tool}`;

    const cmd = command || 'unknown-command';
    return `${run}:no-tool-call-id:${cmd}:${timestamp || 0}`;
  }

  private static asRecord(value: unknown): Record<string, any> | undefined {
    return value && typeof value === 'object' ? (value as Record<string, any>) : undefined;
  }

  private static asString(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  private static asOptionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private static asOptionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }

  private static generateExecId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  private static sanitizeMessage(message: WebSocketMessage | any): WebSocketMessage | any {
    return message;
  }

  private static handleMessage(event: any) {
    const content = this.extractMessageText(event);
    if (!content) return;

    const match = content.match(/(?:^|\s)\/?exec-stream\s+auth\s+(\d{6})(?:\s|$)/i);
    if (!match) return;

    const code = match[1];
    this.api.logger.info(`[exec-stream] Detected auth phrase (${this.config.mode} mode): ${code}`);

    this.verifyAuthCode(code)
      .then(result => {
        if (result.success) {
          if (this.config.mode === 'remote' && result.token) {
            this.remoteSessionToken = result.token;
          }

          this.api.logger.info(`[exec-stream] Auth code verified (${this.config.mode} mode): ${code}`);
          this.broadcast({
            type: 'auth_success',
            data: { message: '授权成功！', token: result.token }
          } as WebSocketMessage | any);
        } else {
          this.api.logger.warn(`[exec-stream] Auth phrase invalid (${this.config.mode} mode): ${code}`);
        }
      })
      .catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        this.api.logger.error(`[exec-stream] Auth verification failed (${this.config.mode} mode): ${message}`);
      });
  }

  private static extractMessageText(event: any): string {
    if (!event) return '';
    const candidates = [
      event.content,
      event.text,
      event.message,
      event.body?.content,
      event.payload?.content,
      event.data?.content,
      event.data?.text
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate;
      }
    }

    return '';
  }

  static broadcast(message: WebSocketMessage | any) {
    if (this.config.mode === 'remote') {
      void this.reportToRemote(message);
      return;
    }

    this.broadcastLocal(message);
  }

  static broadcastLocal(message: WebSocketMessage | any) {
    const payload = this.sanitizeMessage(message);
    const jsonPayload = JSON.stringify(payload);
    const { ExecStreamServer } = require('./server');
    const wireMessage = ExecStreamServer.toWireMessage(jsonPayload);

    this.clients.forEach(ws => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(wireMessage);
        }
      } catch {
        // ignore broken websocket clients
      }
    });
  }

  static async reportToRemote(event: WebSocketMessage | any) {
    const remoteServer = this.config.remoteServer?.trim();
    if (!remoteServer) {
      this.api.logger.warn('[exec-stream] Remote mode enabled but remoteServer is not configured');
      return;
    }

    const url = new URL('/exec-stream/api/events', this.ensureTrailingSlash(remoteServer)).toString();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    const authToken = this.remoteSessionToken || this.config.remoteToken;
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(event)
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        this.api.logger.warn(
          `[exec-stream] Remote event report failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.api.logger.error(`[exec-stream] Remote event report error: ${message}`);
    }
  }

  private static async verifyAuthCode(code: string): Promise<RemoteAuthVerifyResult> {
    if (this.config.mode === 'local') {
      const { ExecStreamServer } = require('./server');
      return ExecStreamServer.verifyCode(code);
    }

    const remoteServer = this.config.remoteServer?.trim();
    if (!remoteServer) {
      return { success: false, error: 'remoteServer 未配置' };
    }

    const url = new URL('/exec-stream/auth/verify', this.ensureTrailingSlash(remoteServer)).toString();

    const requestVerify = async (authorization?: string): Promise<{ response: Response; payload: any }> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      if (authorization) {
        headers.Authorization = `Bearer ${authorization}`;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ code })
      });

      const payload = await response.json().catch(() => ({}));
      return { response, payload };
    };

    try {
      let { response, payload } = await requestVerify(this.config.remoteToken);

      if (!response.ok && this.config.remoteToken && (response.status === 401 || response.status === 403)) {
        ({ response, payload } = await requestVerify());
      }

      if (!response.ok) {
        return {
          success: false,
          error: this.asOptionalString(payload?.error) || `HTTP ${response.status}`
        };
      }

      return {
        success: Boolean(payload?.success),
        token: this.asOptionalString(payload?.token),
        deviceId: this.asOptionalString(payload?.deviceId),
        error: this.asOptionalString(payload?.error)
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  private static ensureTrailingSlash(value: string): string {
    return value.endsWith('/') ? value : `${value}/`;
  }

  static addClient(ws: any) {
    this.clients.add(ws);
  }

  static removeClient(ws: any) {
    this.clients.delete(ws);
  }
}
