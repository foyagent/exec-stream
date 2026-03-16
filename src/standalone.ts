import { ExecStreamServer } from './server';
import type { PluginConfig } from './types';

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const config: PluginConfig = {
  port: parseNumber(process.env.EXEC_STREAM_PORT, 9200),
  jwtSecret: process.env.EXEC_STREAM_JWT_SECRET || 'default-secret-change-me',
  tokenExpiry: parseNumber(process.env.EXEC_STREAM_TOKEN_EXPIRY, 172800),
  remoteToken: process.env.EXEC_STREAM_REMOTE_TOKEN,
  mode: 'local'
};

ExecStreamServer.registerStandalone(config);

const shutdown = () => {
  console.log('[exec-stream][standalone] Shutting down');
  ExecStreamServer.stop();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
