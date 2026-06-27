# MewCode 第七阶段 Checklist

## 实现完整性

- [ ] TokenEstimator 正确估算（验证：新增 5000 字符 → 估算增量 ≈ 2000 tokens）
- [ ] 单条 tool_result 超 3000 字符存盘替换（验证：替换后消息含"工具结果已存盘"和预览）
- [ ] 同组 tool_result 合计超 8000 挑大存盘（验证：存最大直到合计低于阈值）
- [ ] 用户消息不被 offload（验证：user role 的消息内容不变）
- [ ] 摘要 Prompt 禁止工具调用（验证：Prompt 含"禁止调用任何工具"）
- [ ] 摘要后注入边界消息（验证：消息列表末尾有"上下文已压缩" system 消息）
- [ ] 连续 3 次摘要失败熔断（验证：第 3 次失败后不再尝试）
- [ ] manual compress 使用 3K 余量

## 集成

- [ ] Agent 每轮自动调用 ContextManager.autoCompress()
- [ ] /compress 命令手动触发
- [ ] /clear 重置熔断计数器

## 编译与测试

- [ ] `npx tsc --noEmit` 无类型错误
- [ ] `npm test` 全部测试通过
- [ ] 原有测试不受影响

## 端到端场景

### E2E1: 大工具结果自动存盘（对应 AC1）
1. 创建一个 5000 字符的文本文件
2. 让 Agent 读取该文件
3. 观察工具结果被存盘替换为预览

### E2E2: 手动压缩（对应 AC6）
1. 对话几轮后输入 /compress
2. 观察对话历史被摘要压缩
3. 出现边界消息
