#!/usr/bin/env node
import { runInstallCommand } from './commands/install';

function printHelp() {
  console.log(`openclaw-exec-stream

Usage:
  openclaw-exec-stream <command> [options]

Commands:
  install    Install or update Exec Stream config in OpenClaw
  help       Show this help message

Examples:
  openclaw-exec-stream install --mode local --port 9200
  openclaw-exec-stream install --mode remote --server https://nas.local:9200 --token your-token
  openclaw-exec-stream install --help
`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  switch (command) {
    case 'install':
      await runInstallCommand(args.slice(1));
      return;
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run `openclaw-exec-stream --help` for usage.');
      process.exitCode = 1;
  }
}

void main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[exec-stream] ${message}`);
  process.exitCode = 1;
});
