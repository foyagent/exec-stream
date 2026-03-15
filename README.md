# Exec Stream - OpenClaw 终端命令实时推送插件

实时展示 OpenClaw 执行的终端命令及输出，支持 Web 终端界面。

## 功能特性

- ✅ **实时命令输出** - 实时显示命令执行过程和输出
- ✅ **Web 终端界面** - 类似终端的 UI，支持滚动查看历史
- ✅ **授权码功能** - 六位数授权码快速授权，无需手动复制 token
- ✅ **JWT 鉴权** - 安全的 JWT token 鉴权，支持 24 小时有效期
- ✅ **多设备支持** - 支持多设备同时连接

## 安装

### 通过 npm 安装（推荐）

```bash
npm install @openclaw/exec-stream
```

### 手动安装

1. 克隆仓库：
```bash
git clone https://github.com/your-username/exec-stream.git
cd exec-stream
```

2. 安装依赖：
```bash
npm install
```

3. 复制到 OpenClaw 插件目录：
```bash
cp -r . ~/.openclaw/extensions/exec-stream/
```

4. 重启 OpenClaw Gateway：
```bash
openclaw gateway restart
```

## 配置

在 `~/.openclaw/openclaw.json` 中添加配置：

```json
{
  "plugins": {
    "allow": ["exec-stream"],
    "entries": {
      "exec-stream": {
        "enabled": true,
        "config": {
          "port": 9200,
          "jwtSecret": "your-secret-key",
          "tokenExpiry": 86400
        }
      }
    }
  }
}
```

### 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `port` | number | 9200 | WebSocket 服务端口 |
| `jwtSecret` | string | - | JWT 签名密钥（建议使用 SecretRef） |
| `tokenExpiry` | number | 86400 | Token 有效期（秒），默认 24h |

## 使用方法

### 1. 生成访问 Token

```bash
# 方法1：通过 API 生成
curl http://localhost:9200/exec-stream/auth/code

# 方法2：通过 WebUI 自动生成
# 访问 http://localhost:9200/exec-stream
# 自动显示授权码界面
```

### 2. 授权访问

访问 `http://localhost:9200/exec-stream`，会显示授权码界面：

```
请授权访问
授权码: 123456
[📋 复制授权码]
```

将授权码发送给 OpenClaw（在任何渠道），即可完成授权。

### 3. 查看命令输出

授权成功后，WebUI 自动连接并显示终端界面，实时展示命令执行过程。

## API 端点

### `GET /exec-stream/auth/code`

生成六位数授权码。

**响应示例**：
```json
{
  "code": "123456",
  "deviceId": "device_xxx",
  "expiresIn": 300
}
```

### `POST /exec-stream/auth/verify`

验证授权码并返回 JWT token。

**请求体**：
```json
{
  "code": "123456"
}
```

**响应示例**：
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "deviceId": "device_xxx"
}
```

### `GET /exec-stream/auth/status?deviceId=xxx`

检查设备授权状态。

**响应示例**：
```json
{
  "authorized": true,
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

### `GET /exec-stream/health`

健康检查端点。

## 技术架构

```
OpenClaw Extension Hook (exec 拦截)
    ↓
WebSocket Server (端口 9200)
    ↓
Web Frontend (浏览器)
```

### 核心模块

1. **Exec Hook** (`src/hook.ts`) - 拦截 exec 工具调用
2. **WebSocket Server** (`src/server.ts`) - WebSocket 服务 + HTTP API
3. **Web Frontend** (`web/`) - 终端 UI + WebSocket 客户端

## 开发

### 本地开发

```bash
# 克隆仓库
git clone https://github.com/your-username/exec-stream.git
cd exec-stream

# 安装依赖
npm install

# 复制到 OpenClaw 插件目录
cp -r . ~/.openclaw/extensions/exec-stream/

# 重启 Gateway（修改代码后需要重启）
openclaw gateway restart
```

### 文件结构

```
exec-stream/
├── openclaw.plugin.json    # OpenClaw 插件 manifest
├── package.json            # npm 配置
├── index.ts                # 插件入口
├── src/
│   ├── types.ts           # 类型定义
│   ├── hook.ts            # exec 拦截
│   └── server.ts          # WebSocket 服务
└── web/
    ├── index.html         # 前端页面
    └── app.js             # WebSocket 客户端
```

## 安全说明

- **JWT Token** - 使用 JWT 进行身份验证，有效期 24 小时
- **授权码** - 一次性使用，5 分钟有效期
- **HTTPS** - 生产环境建议使用 HTTPS
- **密钥管理** - 建议使用 SecretRef 管理 jwtSecret

## License

MIT

## 贡献

欢迎提交 Issue 和 Pull Request！

## 作者

Boen - OpenClaw Team

## 链接

- [OpenClaw 文档](https://docs.openclaw.ai)
- [GitHub](https://github.com/your-username/exec-stream)
- [npm](https://www.npmjs.com/package/@openclaw/exec-stream)
