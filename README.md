# Exec Stream

Exec Stream is an OpenClaw plugin plus a standalone relay server for streaming `exec` activity to a browser UI in real time.

## Features

- Real-time command start, output, and completion events
- OpenClaw plugin mode: `local` or `remote`
- Standalone Node.js server entrypoint
- Browser auth flow with one-time code + JWT token
- Deployment templates for Docker, PM2, and systemd
- CLI installer for writing `exec-stream` config into `~/.openclaw/openclaw.json`

## Quick Start

### Install package

```bash
npm install
npm run build
```

### Install into OpenClaw config

Local mode:

```bash
npx . install --mode local --port 9200
```

Remote mode:

```bash
npx . install --mode remote --server https://nas.local:9200 [--token your-token]
```

### Start standalone server

```bash
npm run build:standalone
EXEC_STREAM_PORT=9200 \
EXEC_STREAM_JWT_SECRET=change-me \
EXEC_STREAM_REMOTE_TOKEN=remote-secret \
npm run start:standalone
```

Then open `http://localhost:9200/exec-stream`.

## Installation Modes

### 1) As an OpenClaw plugin: local mode

In local mode, the OpenClaw plugin starts the embedded HTTP/WebSocket server directly.

```json
{
  "plugins": {
    "allow": ["exec-stream"],
    "entries": {
      "exec-stream": {
        "enabled": true,
        "config": {
          "mode": "local",
          "port": 9200
        }
      }
    }
  }
}
```

### 2) As an OpenClaw plugin: remote mode

In remote mode, OpenClaw only forwards exec events and auth verification requests to a remote Exec Stream server.

```json
{
  "plugins": {
    "allow": ["exec-stream"],
    "entries": {
      "exec-stream": {
        "enabled": true,
        "config": {
          "mode": "remote",
          "remoteServer": "https://nas.local:9200",
          "remoteToken": "your-token"
        }
      }
    }
  }
}
```

## Standalone Deployment

### Node.js / npx

```bash
npm install
npm run build:standalone
EXEC_STREAM_PORT=9200 EXEC_STREAM_JWT_SECRET=change-me EXEC_STREAM_REMOTE_TOKEN=remote-secret npm run start:standalone
```

Environment variables:

- `EXEC_STREAM_PORT` - listen port, default `9200`
- `EXEC_STREAM_JWT_SECRET` - JWT signing secret
- `EXEC_STREAM_TOKEN_EXPIRY` - token lifetime in seconds, default `172800`
- `EXEC_STREAM_REMOTE_TOKEN` - optional bearer token required for remote event ingestion

### Docker

```bash
docker build -t exec-stream .
docker run -p 9200:9200 \
  -e EXEC_STREAM_PORT=9200 \
  -e EXEC_STREAM_JWT_SECRET=change-me \
  -e EXEC_STREAM_TOKEN_EXPIRY=172800 \
  -e EXEC_STREAM_REMOTE_TOKEN=remote-secret \
  exec-stream
```

Docker Compose example:

```yaml
services:
  exec-stream:
    build: .
    ports:
      - "9200:9200"
    environment:
      EXEC_STREAM_PORT: 9200
      EXEC_STREAM_JWT_SECRET: change-me
      EXEC_STREAM_TOKEN_EXPIRY: 172800
      EXEC_STREAM_REMOTE_TOKEN: remote-secret
    restart: unless-stopped
```

### PM2

```bash
npm install
npm run build
pm2 start ecosystem.config.js
pm2 save
```

### systemd

Copy `exec-stream.service` to `/etc/systemd/system/exec-stream.service`, adjust `WorkingDirectory`, `ExecStart`, `User`, and secrets, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now exec-stream
sudo systemctl status exec-stream
```

## CLI

### Install command

```bash
npx openclaw-exec-stream install --mode local --port 9200
npx openclaw-exec-stream install --mode remote --server https://nas.local:9200 [--token your-token]
npx openclaw-exec-stream install --help
```

What it does:

- Detects the OpenClaw config path (default `~/.openclaw/openclaw.json`)
- Reads existing JSON config if present
- Adds `exec-stream` to `plugins.allow`
- Adds or updates `plugins.entries["exec-stream"]`
- Prints the resulting plugin snippet and next steps

### CLI options

- `--mode <local|remote>` required
- `--port <number>` local mode only
- `--server <url>` remote mode only
- `--token <token>` optional remote bearer token for server-to-server requests
- `--config <path>` optional explicit config path
- `-h, --help` show help

## Configuration Reference

Plugin config keys:

- `mode`: `local` or `remote`
- `port`: local HTTP/WebSocket port
- `remoteServer`: remote server base URL
- `remoteToken`: optional remote bearer token
- `jwtSecret`: JWT signing secret for local server / standalone server
- `tokenExpiry`: JWT lifetime in seconds

## API

### `GET /exec-stream/health`
Returns service health:

```json
{ "status": "ok" }
```

### `GET /exec-stream/auth/code`
Creates a one-time auth code:

```json
{
  "code": "123456",
  "deviceId": "device_xxx",
  "expiresIn": 300
}
```

### `POST /exec-stream/auth/verify`
Verifies an auth code and returns a JWT token.

### `GET /exec-stream/auth/status?deviceId=...`
Checks whether a device has already been authorized.

### `POST /exec-stream/api/events`
Receives forwarded exec events in remote mode. Requires `Authorization: Bearer <token>` when `remoteToken` is configured.

### `GET /exec-stream/commands`
Returns the latest cached command summary list.

## Development

```bash
npm install
npm run build
node dist/cli.js install --help
```

Project layout:

```text
src/
├── cli.ts
├── commands/install.ts
├── hook.ts
├── server.ts
├── standalone.ts
└── types.ts
```

## Examples

- `examples/openclaw.local.json`
- `examples/openclaw.remote.json`
- `docker-compose.yml`
- `ecosystem.config.js`
- `exec-stream.service`

## License

MIT
