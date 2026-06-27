# MewCode 第三阶段 Checklist

> 每一项通过运行代码或观察行为来验证，聚焦系统行为。

## 实现完整性

- [ ] Tool 接口包含 category 字段（验证：read_file.category === 'readonly'，write_file.category === 'mutation'）
- [ ] StreamCollector 正确透传 text_delta 同时累积完整 ContentBlock（验证：mock 流含 3 个 text_delta，collect 后 getBlocks 返回 1 个完整 text block）
- [ ] StreamCollector.hasToolUse() 正确判断（验证：有 tool_use 时返回 true，纯文本时返回 false）
- [ ] ToolExecutor 全部 readonly 工具并发执行（验证：2 个 readonly 工具执行完成时间 < 各自耗时之和）
- [ ] ToolExecutor 全部 mutation 工具串行执行（验证：2 个 mutation 工具按顺序执行，第二个等第一个完成）
- [ ] ToolExecutor 混合工具先并发后串行（验证：readonly 组并发完成后再执行 mutation 组）
- [ ] ChatManager.callLLM 正确调用 Provider 并透传事件（验证：mock Provider，事件透传到调用方）
- [ ] Agent 在模型返回纯文本后停止（验证：mock 无 tool_use → agent_done('task_completed')，1 轮）
- [ ] Agent 在工具调用后继续循环直到模型返回文本（验证：mock 第 1 轮 tool_use → 第 2 轮纯文本 → agent_done，2 轮）
- [ ] Agent 达到 maxIterations 后自动停止（验证：mock 连续 tool_use → 5 轮后 agent_done('max_iterations')）
- [ ] Agent plan mode 只传 readonly 工具（验证：agent.setMode('plan') 后 callLLM 收到只有 read_file/glob/grep）
- [ ] Agent 连续 2 次未知工具后终止（验证：连续 2 次 tool_use 引用了不存在的工具名 → agent_done('consecutive_unknown_tools')）
- [ ] /plan 命令切换到规划模式（验证：输入 /plan，提示符变为 [plan] >，模型只用只读工具）
- [ ] /do 命令切换到执行模式（验证：输入 /do，提示符变为 [do] >，模型可用全部工具）
- [ ] /stop 命令停止当前循环（验证：Agent 执行中按 /stop → 循环终止，对话历史保留）

## 集成

- [ ] Agent.run() 事件流正确生成所有生命周期事件（验证：mock 一轮 tool_use 调用，事件序列为 turn_start → text_delta → tool_use → tool_executing → tool_result → turn_end → turn_start → text_delta → turn_end → agent_done）
- [ ] ChatManager 消息列表在 Agent 循环中正确累积（验证：2 轮循环后 getMessages 含 user + assistant(tool_use) + tool(tool_result) + assistant(text)）
- [ ] Provider 层的 tool_use 流式解析与 Agent 循环正确配合（验证：真实 API 调用，tool_use 被解析 → 执行 → 结果回写 → 继续循环）
- [ ] StreamCollector 不阻塞实时通道（验证：text_delta 到达后立即在终端显示，不等待 getBlocks）

## 编译与测试

- [ ] `npx tsc --noEmit` 无类型错误
- [ ] `npm test` 全部测试通过（含原有 66 个 + 新增 Agent 层测试）
- [ ] 原有 Config/Provider/Chat/Tools 测试不受影响
- [ ] Agent 层测试覆盖：StreamCollector、ToolExecutor、Agent 循环

## 端到端场景

### E2E1: 自主完成任务（对应 AC1）
1. 启动 MewCode
2. 输入 "在项目根目录创建一个 test.txt，内容是 Hello MewCode"
3. Agent 自动：① 调用 write_file 创建文件 → ② 看到成功 → ③ 回复"已创建"
4. 用 ls 验证 test.txt 存在且内容正确
5. **期望结果：** 整个过程无需用户手动干预，Agent 自主完成

### E2E2: 自主调研并分析（对应 AC1）
1. 启动 MewCode
2. 输入 "src/main.ts 这个文件主要做了什么？"
3. Agent 自动：① 调用 read_file 读取文件 → ② 分析内容 → ③ 给出总结
4. **期望结果：** Agent 自动完成"读文件 → 分析 → 回复"

### E2E3: 简单对话不触发工具（对应 AC3）
1. 启动 MewCode
2. 输入 "你好，TypeScript 的泛型是什么？"
3. Agent 直接返回文字回复，不调用工具
4. **期望结果：** 1 轮完成，agent_done('task_completed')

### E2E4: 迭代上限兜底（对应 AC4）
1. （需要 mock 一个始终返回 tool_use 的 Provider）
2. Agent 自动执行 5 轮后停止
3. 终端显示 agent_done 信息包含"达到迭代上限"
4. **期望结果：** 不会无限循环，5 轮后优雅停止

### E2E5: Plan Mode 两段式（对应 AC5、AC6）
1. 启动 MewCode
2. 输入 `/plan`
3. 提示符变为 `[plan] >`
4. 输入 "帮我分析这个项目的架构"
5. Agent 只用 read_file/glob/grep 调研
6. 生成计划后，用户输入 `/do`
7. 提示符变为 `[do] >`
8. **期望结果：** plan mode 限制只读，do mode 恢复全工具

### E2E6: Ctrl+C 中断（对应 AC7）
1. 启动 MewCode
2. 输入一个需要多轮工具的复杂任务
3. 执行过程中按 Ctrl+C
4. 循环终止，程序不退出，可以继续输入新问题
5. **期望结果：** 中断不退出，已执行的工具结果保留

### E2E7: Agent 完成后继续对话（对应 AC10）
1. 启动 MewCode
2. 输入 "读取 src/main.ts"
3. Agent 调用 read_file 并回复
4. 输入 "这个文件导入了哪些模块？"
5. Agent 能基于上一轮的上下文回答
6. **期望结果：** 多轮 Agent 对话上下文正确保持
