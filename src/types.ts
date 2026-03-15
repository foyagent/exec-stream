export interface ExecEvent {
  sessionId: string;
  execId: string;
  command: string;
  cwd?: string;
  timestamp: number;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  duration?: number;
}

export interface WebSocketMessage {
  type: 'exec_start' | 'exec_output' | 'exec_end' | 'auth_success' | 'pong';
  data?: ExecEvent | { message?: string; token?: string };
}

export interface PluginConfig {
  port?: number;
  jwtSecret?: string;
  tokenExpiry?: number;
}
