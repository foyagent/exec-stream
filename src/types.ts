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

export interface AuthSuccessMessageData {
  message?: string;
  token?: string;
}

export interface WebSocketMessage {
  type: 'exec_start' | 'exec_output' | 'exec_end' | 'auth_success' | 'pong';
  data?: ExecEvent | AuthSuccessMessageData;
}

export type ExecStreamMode = 'local' | 'remote';

export interface RemoteConfig {
  remoteServer?: string;
  remoteToken?: string;
}

export interface PluginConfig extends RemoteConfig {
  port?: number;
  jwtSecret?: string;
  tokenExpiry?: number;
  mode?: ExecStreamMode;
}

export interface ResolvedPluginConfig extends PluginConfig {
  mode: ExecStreamMode;
}

export interface RemoteAuthVerifyResult {
  success: boolean;
  token?: string;
  deviceId?: string;
  error?: string;
}
