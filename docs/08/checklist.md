# MewCode 第八阶段 Checklist

> 每一项通过运行代码或观察行为来验证，聚焦系统行为。

## 实现完整性

- [ ] InstructionLoader 三层加载（验证：项目根有 CLAUDE.md 时，load() 返回内容包含其文本且排在最前）
- [ ] @include 正确展开（验证：文件 A @include 文件 B，load() 返回内容在引用位置包含 B 的全文）
- [ ] @include 嵌套深度 ≤3（验证：第 4 层 @include 被忽略，stderr 输出警告）
- [ ] @include 路径拦截（验证：`@include ../../../etc/passwd` 被拒绝，stderr 输出警告）
- [ ] @include 防环（验证：A→B→A 循环引用不会无限展开，stderr 输出警告）
- [ ] SessionArchiver 会话 ID 格式正确（验证：ID 匹配 `YYYYMMDD-HHMMSS-xxxx`）
- [ ] SessionArchiver 消息追加（验证：对话后 JSONL 文件存在，每行一条合法 JSON）
- [ ] SessionRecovery 坏行跳过（验证：JSONL 最后一行是残缺 JSON，recover() 跳过该行返回其余消息）
- [ ] SessionRecovery 未配对 tool_use 截断（验证：最后 assistant 含 tool_use 无 tool_result → 该 block 被移除）
- [ ] SessionRecovery 时间跨度提醒（验证：恢复 >24h 前的会话，消息列表含时间提醒 system 消息）
- [ ] SessionRecovery 过期清理（验证：mtime >30 天的会话文件在 cleanExpired() 后被删除）
- [ ] MemoryIndex 重建（验证：memory 目录有笔记文件时，rebuild() 生成 MEMORY.md 含正确链接）
- [ ] MemoryIndex 大小限制（验证：索引 >200 行时，截断保留最新 200 行）
- [ ] AutoNotes 异步提取（验证：Agent 完成对话后，后台 LLM 调用被触发，main 流程不等待）

## 集成

- [ ] MemoryManager.initialize() 返回 customInstructions 和 longTermMemory（验证：启动日志打印加载状态）
- [ ] system prompt 包含项目指令和记忆索引（验证：首条 LLM 请求的 system prompt 含 CLAUDE.md 内容和 MEMORY.md 内容）
- [ ] ChatManager 消息追加时同步写 JSONL（验证：发一条消息 → JSONL 文件多一行）
- [ ] Agent 循环结束后触发 AutoNotes（验证：task_completed 时 stderr 显示"记忆提取中..."或类似日志）
- [ ] 启动时展示可恢复会话（验证：sessions 目录有文件时，启动打印会话列表）
- [ ] /clear 不影响会话存档（验证：clear 后 JSONL 文件仍在，继续追加）

## 编译与测试

- [ ] `npx tsc --noEmit` 无类型错误
- [ ] `npm test` 全部测试通过
- [ ] 原有测试不受影响

## 端到端场景

### E2E1: 新项目首次对话（对应 AC1, AC5, AC11, AC12）
1. 在项目根创建 CLAUDE.md，写入"本项目使用 TypeScript，严格模式"
2. 启动 MewCode，发送"帮我写一个工具函数"
3. 观察 system prompt 包含 CLAUDE.md 内容
4. 对话完成后，检查 .mewcode/sessions/ 下有 JSONL 文件
5. 对话完成后，检查 .mewcode/memory/ 下可能生成笔记（取决于 LLM）
6. 再次启动 MewCode，观察 system prompt 包含上次记忆

### E2E2: 会话崩溃恢复（对应 AC5, AC7, AC8）
1. 启动 MewCode，进行几轮对话
2. 模拟崩溃：在 JSONL 最后一行末尾加残缺文本 `{"broken":`
3. 重新启动 MewCode，选择恢复该会话
4. 观察坏行被跳过，对话历史正常加载

### E2E3: @include 引用链（对应 AC2, AC3, AC4, AC5）
1. 创建 CLAUDE.md 含 `@include .mewcode/tech-stack.md`
2. .mewcode/tech-stack.md 含 `@include .mewcode/db-config.md`
3. 启动 MewCode，观察 system prompt 包含三层展开后的完整内容
4. 尝试在 tech-stack.md 中添加 `@include ../../../etc/hosts`，观察被拦截
