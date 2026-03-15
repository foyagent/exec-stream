# 发布指南

## 发布到 npm

### 1. 准备工作

确保你有 npm 账号，如果没有：
```bash
npm signup
```

登录 npm：
```bash
npm login
```

### 2. 检查包名是否可用

```bash
npm search @openclaw/exec-stream
```

如果包名已被占用，修改 `package.json` 中的 `name` 字段。

### 3. 发布

```bash
# 安装依赖（如果还没装）
npm install

# 发布到 npm
npm publish --access public
```

### 4. 验证发布

```bash
# 搜索你的包
npm search @openclaw/exec-stream

# 查看包信息
npm info @openclaw/exec-stream
```

## 发布到 GitHub

### 1. 创建 GitHub 仓库

在 GitHub 上创建新仓库：
- 仓库名：`exec-stream`
- 描述：`OpenClaw 终端命令实时推送插件`
- 公开仓库

### 2. 推送代码

```bash
# 添加远程仓库
git remote add origin https://github.com/your-username/exec-stream.git

# 添加所有文件
git add .

# 提交
git commit -m "feat: 初始化 Exec Stream 插件

- 实时命令输出流
- WebSocket Server
- Web 终端界面
- 授权码功能
- JWT 鉴权"

# 推送到 GitHub
git push -u origin main
```

### 3. 创建 Release

在 GitHub 上创建 Release：
- Tag: `v0.1.0`
- Title: `v0.1.0 - 初始版本`
- Description: 从 README.md 复制

## 更新版本

### 1. 更新代码

修改代码后，更新 `package.json` 中的版本号：

```bash
# 小版本更新（修复 bug）
npm version patch  # 0.1.0 -> 0.1.1

# 中版本更新（新功能）
npm version minor  # 0.1.0 -> 0.2.0

# 大版本更新（破坏性变更）
npm version major  # 0.1.0 -> 1.0.0
```

### 2. 推送更新

```bash
# 提交代码
git add .
git commit -m "fix: 修复某个问题"
git push

# 推送 tags
git push --tags

# 发布到 npm
npm publish
```

## 用户安装

发布后，用户可以这样安装：

```bash
# 通过 npm 安装
npm install @openclaw/exec-stream

# 或通过 OpenClaw CLI 安装（如果支持）
openclaw plugins install @openclaw/exec-stream
```

## 注意事项

1. **包名** - 确保 `@openclaw/exec-stream` 这个 scope 可用
2. **版本号** - 遵循语义化版本（SemVer）
3. **README** - 保持 README.md 更新
4. **测试** - 发布前确保功能正常
5. **Changelog** - 建议添加 CHANGELOG.md 记录变更

## 自动化（可选）

可以设置 GitHub Actions 自动发布：

```yaml
# .github/workflows/publish.yml
name: Publish to npm

on:
  release:
    types: [created]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          registry-url: 'https://registry.npmjs.org'
      - run: npm ci
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{secrets.NPM_TOKEN}}
```
