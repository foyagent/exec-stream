# Exec Stream

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

Exec Stream 是一个 OpenClaw 插件，同时也是一个独立的 relay server，用于将 `exec` 活动实时流式传输到浏览器 UI。

## 特性

- 实时命令启动、输出和完成事件
- OpenClaw 插件模式：`local` 或 `remote`
- 独立的 Node.js server 入口
- 使用一次性验证码 + JWT token 的浏览器认证流程
- 提供 Docker、PM2 和 systemd 的部署模板
- CLI 安装器，可将 `exec-stream` 配置写入 `~/.openclaw/openclaw.json`

## 快速开始

### 安装包

```bash
npm install
npm run build
```

### 安装到 OpenClaw 配置中

本地模式：

```bash
npx . install --mode local --port 9200
```

远程模式：

```bash
npx . install --mode remote --server https://nas.local:9200 [--token your-token]
```

### 启动独立服务器

```bash
npm run build:standalone
EXEC_STREAM_PORT=9200 \
EXEC_STREAM_JWT_SECRET=change-me \
EXEC_STREAM_REMOTE_TOKEN=remote-secret \
npm run start:standalone
```

然后打开 `http://localhost:9200/exec-stream`。

## 安装模式

### 1）作为 OpenClaw 插件：本地模式

在本地模式下，OpenClaw 插件会直接启动内嵌的 HTTP/WebSocket 服务器。

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

### 2）作为 OpenClaw 插件：远程模式

在远程模式下，OpenClaw 只会将 exec 事件和认证验证请求转发到远程 Exec Stream 服务器。

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

## 独立部署

### Node.js / npx

```bash
npm install
npm run build:standalone
EXEC_STREAM_PORT=9200 EXEC_STREAM_JWT_SECRET=change-me EXEC_STREAM_REMOTE_TOKEN=remote-secret npm run start:standalone
```

环境变量：

- `EXEC_STREAM_PORT` - 监听端口，默认 `9200`
- `EXEC_STREAM_JWT_SECRET` - JWT 签名密钥
- `EXEC_STREAM_TOKEN_EXPIRY` - token 有效期（秒），默认 `172800`
- `EXEC_STREAM_REMOTE_TOKEN` - 可选，用于远程事件接收的 bearer token

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

Docker Compose 示例：

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

将 `exec-stream.service` 复制到 `/etc/systemd/system/exec-stream.service`，调整 `WorkingDirectory`、`ExecStart`、`User` 和密钥后，执行：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now exec-stream
sudo systemctl status exec-stream
```

## CLI

### 安装命令

```bash
npx openclaw-exec-stream install --mode local --port 9200
npx openclaw-exec-stream install --mode remote --server https://nas.local:9200 [--token your-token]
npx openclaw-exec-stream install --help
```

它会执行以下操作：

- 检测 OpenClaw 配置路径（默认 `~/.openclaw/openclaw.json`）
- 如果存在则读取现有 JSON 配置
- 将 `exec-stream` 添加到 `plugins.allow`
- 添加或更新 `plugins.entries["exec-stream"]`
- 输出最终的插件配置片段和后续步骤

### CLI 选项

- `--mode <local|remote>` 必填
- `--port <number>` 仅用于本地模式
- `--server <url>` 仅用于远程模式
- `--token <token>` 可选，用于 server-to-server 请求的远程 bearer token
- `--config <path>` 可选，显式指定配置路径
- `-h, --help` 显示帮助

## 配置参考

插件配置项：

- `mode`: `local` 或 `remote`
- `port`: 本地 HTTP/WebSocket 端口
- `remoteServer`: 远程服务器基础 URL
- `remoteToken`: 可选的远程 bearer token
- `jwtSecret`: 本地服务器 / 独立服务器使用的 JWT 签名密钥
- `tokenExpiry`: JWT 有效期（秒）

## API

### `GET /exec-stream/health`
返回服务健康状态：

```json
{ "status": "ok" }
```

### `GET /exec-stream/auth/code`
创建一次性认证码：

```json
{
  "code": "123456",
  "deviceId": "device_xxx",
  "expiresIn": 300
}
```

### `POST /exec-stream/auth/verify`
验证认证码并返回 JWT token。

### `GET /exec-stream/auth/status?deviceId=...`
检查设备是否已完成授权。

### `POST /exec-stream/api/events`
在远程模式下接收转发的 exec 事件。当配置了 `remoteToken` 时，需要 `Authorization: Bearer <token>`。

### `GET /exec-stream/commands`
返回最新缓存的命令摘要列表。

## 开发

```bash
npm install
npm run build
node dist/cli.js install --help
```

项目结构：

```text
src/
├── cli.ts
├── commands/install.ts
├── hook.ts
├── server.ts
├── standalone.ts
└── types.ts
```

## 示例

- `examples/openclaw.local.json`
- `examples/openclaw.remote.json`
- `docker-compose.yml`
- `ecosystem.config.js`
- `exec-stream.service`

## License

MIT
