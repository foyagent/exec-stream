# Exec Stream 授权码处理

## 触发条件
当用户消息匹配以下格式时触发：
- `/exec-stream auth <6位数字>`
- `exec-stream auth <6位数字>`
- `Exec Stream 授权码: <6位数字>`

## 功能
识别 Exec Stream 插件的授权码，调用本地验证 API 完成授权。

## 执行步骤

1. **提取授权码**
   - 从消息中提取 6 位数字授权码

2. **调用验证 API**
   ```bash
   curl -X POST http://localhost:9200/exec-stream/auth/verify \
     -H "Content-Type: application/json" \
     -d "{\"code\":\"<授权码>\"}"
   ```

3. **处理结果**
   - 如果成功：回复"✅ Exec Stream 授权成功！Token 有效期 48 小时。"
   - 如果失败：回复"❌ 授权码无效或已过期，请重新获取。"

## 示例

**用户输入**：
```
/exec-stream auth 123456
```

**Bot 回复**：
```
✅ Exec Stream 授权成功！Token 有效期 48 小时。
```

## 注意事项

- 授权码 5 分钟内有效
- 一次性使用，验证后立即失效
- 需要 Exec Stream 插件已启动（端口 9200）
