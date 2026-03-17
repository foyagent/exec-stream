# Exec Stream

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

Exec Stream は、`exec` アクティビティをブラウザ UI にリアルタイムでストリーミングするための OpenClaw プラグインであり、同時にスタンドアロンの relay server でもあります。

## 特長

- コマンドの開始、出力、完了イベントをリアルタイムで配信
- OpenClaw プラグインモード：`local` または `remote`
- スタンドアロンの Node.js server エントリーポイント
- ワンタイムコード + JWT token によるブラウザ認証フロー
- Docker、PM2、systemd 向けのデプロイテンプレート
- `exec-stream` 設定を `~/.openclaw/openclaw.json` に書き込む CLI インストーラー

## クイックスタート

### パッケージをインストール

```bash
npm install
npm run build
```

### OpenClaw 設定へインストール

ローカルモード：

```bash
npx . install --mode local --port 9200
```

リモートモード：

```bash
npx . install --mode remote --server https://nas.local:9200 [--token your-token]
```

### スタンドアロンサーバーを起動

```bash
npm run build:standalone
EXEC_STREAM_PORT=9200 \
EXEC_STREAM_JWT_SECRET=change-me \
EXEC_STREAM_REMOTE_TOKEN=remote-secret \
npm run start:standalone
```

その後、`http://localhost:9200/exec-stream` を開きます。

## インストールモード

### 1) OpenClaw プラグインとして：local モード

local モードでは、OpenClaw プラグインが組み込みの HTTP/WebSocket サーバーを直接起動します。

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

### 2) OpenClaw プラグインとして：remote モード

remote モードでは、OpenClaw は exec イベントと認証検証リクエストのみをリモートの Exec Stream サーバーへ転送します。

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

## スタンドアロンデプロイ

### Node.js / npx

```bash
npm install
npm run build:standalone
EXEC_STREAM_PORT=9200 EXEC_STREAM_JWT_SECRET=change-me EXEC_STREAM_REMOTE_TOKEN=remote-secret npm run start:standalone
```

環境変数：

- `EXEC_STREAM_PORT` - リッスンポート。デフォルトは `9200`
- `EXEC_STREAM_JWT_SECRET` - JWT 署名シークレット
- `EXEC_STREAM_TOKEN_EXPIRY` - token の有効期間（秒）。デフォルトは `172800`
- `EXEC_STREAM_REMOTE_TOKEN` - 任意。リモートイベント受信時に必要な bearer token

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

Docker Compose の例：

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

`exec-stream.service` を `/etc/systemd/system/exec-stream.service` にコピーし、`WorkingDirectory`、`ExecStart`、`User`、シークレットを調整したあと、次を実行します：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now exec-stream
sudo systemctl status exec-stream
```

## CLI

### インストールコマンド

```bash
npx openclaw-exec-stream install --mode local --port 9200
npx openclaw-exec-stream install --mode remote --server https://nas.local:9200 [--token your-token]
npx openclaw-exec-stream install --help
```

実行内容：

- OpenClaw 設定パスを検出（デフォルトは `~/.openclaw/openclaw.json`）
- 既存の JSON 設定があれば読み込み
- `exec-stream` を `plugins.allow` に追加
- `plugins.entries["exec-stream"]` を追加または更新
- 生成されたプラグイン設定スニペットと次の手順を表示

### CLI オプション

- `--mode <local|remote>` 必須
- `--port <number>` local モード専用
- `--server <url>` remote モード専用
- `--token <token>` 任意。server-to-server リクエスト用のリモート bearer token
- `--config <path>` 任意。設定パスを明示指定
- `-h, --help` ヘルプを表示

## 設定リファレンス

プラグイン設定キー：

- `mode`: `local` または `remote`
- `port`: ローカル HTTP/WebSocket ポート
- `remoteServer`: リモートサーバーのベース URL
- `remoteToken`: 任意のリモート bearer token
- `jwtSecret`: ローカルサーバー / スタンドアロンサーバー用の JWT 署名シークレット
- `tokenExpiry`: JWT の有効期間（秒）

## API

### `GET /exec-stream/health`
サービスのヘルス状態を返します：

```json
{ "status": "ok" }
```

### `GET /exec-stream/auth/code`
ワンタイム認証コードを作成します：

```json
{
  "code": "123456",
  "deviceId": "device_xxx",
  "expiresIn": 300
}
```

### `POST /exec-stream/auth/verify`
認証コードを検証し、JWT token を返します。

### `GET /exec-stream/auth/status?deviceId=...`
デバイスがすでに認証済みかどうかを確認します。

### `POST /exec-stream/api/events`
remote モードで転送された exec イベントを受信します。`remoteToken` が設定されている場合は、`Authorization: Bearer <token>` が必要です。

### `GET /exec-stream/commands`
最新のキャッシュ済みコマンド要約リストを返します。

## 開発

```bash
npm install
npm run build
node dist/cli.js install --help
```

プロジェクト構成：

```text
src/
├── cli.ts
├── commands/install.ts
├── hook.ts
├── server.ts
├── standalone.ts
└── types.ts
```

## 例

- `examples/openclaw.local.json`
- `examples/openclaw.remote.json`
- `docker-compose.yml`
- `ecosystem.config.js`
- `exec-stream.service`

## License

MIT
