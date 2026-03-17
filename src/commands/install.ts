import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

type InstallMode = 'local' | 'remote';

type InstallOptions = {
  mode?: InstallMode;
  port?: number;
  server?: string;
  token?: string;
  config?: string;
  help?: boolean;
};

type OpenClawConfig = {
  plugins?: {
    allow?: string[];
    entries?: Record<string, any>;
  };
  [key: string]: any;
};

const COMMAND_HELP = `Install Exec Stream into OpenClaw.

Usage:
  openclaw-exec-stream install --mode local [--port 9200] [--config ~/.openclaw/openclaw.json]
  openclaw-exec-stream install --mode remote --server https://nas.local:9200 [--token your-token] [--config ~/.openclaw/openclaw.json]

What this command does:
  1. Runs \`openclaw plugins install <this-plugin> --link\` to install plugin files + skills
  2. Updates OpenClaw config with plugins.entries["exec-stream"]

Options:
  --mode <local|remote>   Installation mode
  --port <number>         Local Exec Stream port (local mode only, default: 9200)
  --server <url>          Remote Exec Stream server URL (remote mode only)
  --token <token>         Optional remote bearer token for server-to-server requests
  --config <path>         Explicit OpenClaw config path
  -h, --help              Show this help message
`;

export async function runInstallCommand(argv: string[]) {
  const options = parseArgs(argv);

  if (options.help) {
    console.log(COMMAND_HELP);
    return;
  }

  validateOptions(options);
  ensurePluginInstalled();

  const configPath = resolveConfigPath(options.config);
  const config = readConfig(configPath);
  const updated = applyExecStreamConfig(config, options as Required<Pick<InstallOptions, 'mode'>> & InstallOptions);

  writeConfig(configPath, updated);
  printSuccess(configPath, updated.plugins?.entries?.['exec-stream']?.config || {});
}

function parseArgs(argv: string[]): InstallOptions {
  const options: InstallOptions = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case '--mode':
        options.mode = next as InstallMode;
        i += 1;
        break;
      case '--port':
        options.port = Number.parseInt(next || '', 10);
        i += 1;
        break;
      case '--server':
        options.server = next;
        i += 1;
        break;
      case '--token':
        options.token = next;
        i += 1;
        break;
      case '--config':
        options.config = next;
        i += 1;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        if (arg.startsWith('--')) {
          throw new Error(`Unknown option: ${arg}\n\n${COMMAND_HELP}`);
        }
        throw new Error(`Unexpected argument: ${arg}\n\n${COMMAND_HELP}`);
    }
  }

  return options;
}

function validateOptions(options: InstallOptions) {
  if (!options.mode) {
    throw new Error(`Missing required option: --mode\n\n${COMMAND_HELP}`);
  }

  if (options.mode !== 'local' && options.mode !== 'remote') {
    throw new Error(`Invalid mode: ${options.mode}. Use local or remote.`);
  }

  if (options.mode === 'local') {
    if (options.port !== undefined && (!Number.isFinite(options.port) || options.port <= 0)) {
      throw new Error('Invalid --port value. Use a positive integer.');
    }
    return;
  }

  if (!options.server) {
    throw new Error('Remote mode requires --server.');
  }

  try {
    const url = new URL(options.server);
    if (!/^https?:$/.test(url.protocol)) {
      throw new Error('Unsupported protocol');
    }
  } catch {
    throw new Error(`Invalid --server URL: ${options.server}`);
  }
}

function ensurePluginInstalled() {
  const pluginRoot = path.resolve(__dirname, '../../');
  const availabilityCheck = spawnSync('openclaw', ['--help'], { stdio: 'ignore' });

  if (availabilityCheck.error) {
    if ((availabilityCheck.error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        'OpenClaw CLI not found in PATH. Please install OpenClaw first, then run:\n' +
          `  openclaw plugins install "${pluginRoot}" --link`
      );
    }

    throw new Error(`Failed to start OpenClaw CLI: ${availabilityCheck.error.message}`);
  }

  console.log('📦 Installing Exec Stream plugin files into OpenClaw...');
  const installResult = spawnSync('openclaw', ['plugins', 'install', pluginRoot, '--link'], {
    stdio: 'inherit'
  });

  if (installResult.error) {
    throw new Error(`Failed to run openclaw plugins install: ${installResult.error.message}`);
  }

  if (installResult.status !== 0) {
    throw new Error(
      'openclaw plugins install failed. Fix the error above, then retry this command.\n' +
        `You can also run it manually:\n  openclaw plugins install "${pluginRoot}" --link`
    );
  }
}

function resolveConfigPath(explicitPath?: string): string {
  const candidates = [explicitPath, process.env.OPENCLAW_CONFIG_PATH, path.join(os.homedir(), '.openclaw', 'openclaw.json')].filter(
    Boolean
  ) as string[];

  for (const candidate of candidates) {
    const resolved = expandHome(candidate);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  const fallback = expandHome(candidates[0] || path.join(os.homedir(), '.openclaw', 'openclaw.json'));
  fs.mkdirSync(path.dirname(fallback), { recursive: true });
  return fallback;
}

function readConfig(configPath: string): OpenClawConfig {
  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8')) as OpenClawConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse OpenClaw config at ${configPath}: ${message}`);
  }
}

function applyExecStreamConfig(config: OpenClawConfig, options: Required<Pick<InstallOptions, 'mode'>> & InstallOptions): OpenClawConfig {
  const next: OpenClawConfig = { ...config };
  const plugins = { ...(next.plugins || {}) };
  const allow = new Set<string>(plugins.allow || []);
  allow.add('exec-stream');

  const entries = { ...(plugins.entries || {}) };
  const execStreamConfig =
    options.mode === 'local'
      ? {
          mode: 'local',
          port: options.port || 9200
        }
      : {
          mode: 'remote',
          remoteServer: options.server,
          remoteToken: options.token
        };

  entries['exec-stream'] = {
    enabled: true,
    config: execStreamConfig
  };

  next.plugins = {
    ...plugins,
    allow: Array.from(allow),
    entries
  };

  return next;
}

function writeConfig(configPath: string, config: OpenClawConfig) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function printSuccess(configPath: string, execStreamConfig: Record<string, unknown>) {
  console.log('✅ Exec Stream installed and configured successfully.');
  console.log(`Config file: ${configPath}`);
  console.log('');
  console.log('plugins.entries["exec-stream"]:');
  console.log(JSON.stringify({ enabled: true, config: execStreamConfig }, null, 2));
  console.log('');
  console.log('Next steps:');
  if (execStreamConfig.mode === 'local') {
    console.log('1. Restart OpenClaw Gateway.');
    console.log(`2. Open http://localhost:${execStreamConfig.port || 9200}/exec-stream`);
  } else {
    console.log('1. Make sure your remote Exec Stream server is reachable.');
    console.log('2. Restart OpenClaw Gateway.');
    console.log(`3. Open ${((execStreamConfig.remoteServer as string) || '').replace(/\/$/, '')}/exec-stream`);
  }
}

function expandHome(inputPath: string): string {
  if (inputPath === '~') return os.homedir();
  if (inputPath.startsWith('~/')) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}
