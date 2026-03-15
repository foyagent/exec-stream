import type { ExecEvent, WebSocketMessage } from './types';

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
  private static activeExecs: Map<string, ActiveExecState> = new Map();

  static register(api: PluginAPI) {
    this.api = api;

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

  private static asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
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

  private static handleMessage(event: any) {
    const content = this.extractMessageText(event);
    if (!content) return;

    const match = content.match(/(?:^|\s)\/?exec-stream\s+auth\s+(\d{6})(?:\s|$)/i);
    if (!match) return;

    const code = match[1];
    this.api.logger.info(`[exec-stream] Detected auth phrase: ${code}`);

    const { ExecStreamServer } = require('./server');
    const result = ExecStreamServer.verifyCode(code);

    if (result.success) {
      this.api.logger.info(`[exec-stream] Auth code verified from chat: ${code}`);
      this.broadcast({
        type: 'auth_success',
        data: { message: '授权成功！', token: result.token }
      } as WebSocketMessage | any);
    } else {
      this.api.logger.warn(`[exec-stream] Auth phrase invalid: ${code}`);
    }
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
    const data = JSON.stringify(message);
    this.clients.forEach(ws => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(data);
        }
      } catch {
        // ignore broken websocket clients
      }
    });
  }

  static addClient(ws: any) {
    this.clients.add(ws);
  }

  static removeClient(ws: any) {
    this.clients.delete(ws);
  }
}
