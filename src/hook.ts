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

  // 用 runId + toolCallId 关联 before/update/after 三个阶段，避免依赖不存在的 event.context 透传。
  private static activeExecs: Map<string, ActiveExecState> = new Map();

  static register(api: PluginAPI) {
    this.api = api;

    // 订阅全局 agent event，用于接收 exec 工具的实时 partialResult。
    // OpenClaw 会在 tool/update 阶段提供 details.tail（累计尾部输出），这里做增量切片后广播给前端。
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

      if (event.result && typeof event.result === 'object') {
        api.logger.info('[exec-stream] result keys: ' + Object.keys(event.result).join(','));
      } else {
        api.logger.warn('[exec-stream] exec result is empty or non-object');
      }

      api.logger.info(
        '[exec-stream] mapped result: ' +
          JSON.stringify({
            exitCode: extracted.exitCode,
            stdoutLength: extracted.stdout?.length || 0,
            stderrLength: extracted.stderr?.length || 0
          })
      );

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

      this.activeExecs.delete(toolKey);
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

    // OpenClaw exec 的最终结构主要是：
    // result.details = { status, exitCode, durationMs, aggregated, cwd }
    // 旧逻辑读 stdout/stderr/exitCode，会拿不到真正输出。
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

  // 处理消息，识别授权码
  private static handleMessage(event: any) {
    const content = event.content || event.text || '';
    if (typeof content !== 'string') return;
    
    // 匹配六位数授权码
    const match = content.match(/\b(\d{6})\b/);
    if (!match) return;
    
    const code = match[1];
    this.api.logger.info(`[exec-stream] Detected auth code: ${code}`);
    
    // 调用验证 API
    const { ExecStreamServer } = require('./server');
    const result = ExecStreamServer.verifyCode(code);
    
    if (result.success) {
      this.api.logger.info(`[exec-stream] Auth code verified: ${code}`);
      // 广播授权成功消息
      this.broadcast({
        type: 'auth_success',
        data: { message: '授权成功！', token: result.token }
      });
    } else {
      this.api.logger.warn(`[exec-stream] Auth code invalid: ${code}`);
    }
  }

  static broadcast(message: WebSocketMessage) {
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
