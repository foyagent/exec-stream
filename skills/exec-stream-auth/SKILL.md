# Exec Stream Auth

当用户发送以下标准化授权口令时，识别并完成 Exec Stream Web UI 授权：

```text
/exec-stream auth 123456
```

## 匹配规则

仅匹配以下格式：
- `/exec-stream auth <6位数字>`
- `exec-stream auth <6位数字>`

正则建议：
```regex
(?:^|\s)\/?exec-stream\s+auth\s+(\d{6})(?:\s|$)
```

## 处理步骤

1. 提取 6 位数字授权码。
2. 调用本地验证 API：

```bash
curl -X POST http://localhost:9200/exec-stream/auth/verify \
  -H "Content-Type: application/json" \
  -d '{"code":"123456"}'
```

3. 根据结果回复：
   - 成功：`✅ Exec Stream 授权成功！Token 有效期 48 小时。`
   - 失败：`❌ 授权码无效或已过期，请重新获取。`

## 注意事项

- 授权码有效期 5 分钟
- 授权码一次性使用，验证后立即失效
- 需要 Exec Stream 插件已运行在本地 9200 端口
- Web UI 复制按钮应复制完整标准口令，而不是裸 6 位数字
