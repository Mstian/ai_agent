# MewCode 第三阶段 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/agent/types.ts` | AgentEvent、AgentConfig 类型定义 |
| 新建 | `src/agent/stream_collector.ts` | StreamCollector：双路收集（实时透传 + 累积拼接） |
| 新建 | `src/agent/tool_executor.ts` | ToolExecutor：按 category 分类，并发/串行执行 |
| 新建 | `src/agent/agent.ts` | Agent 类：ReAct 循环引擎 |
| 新建 | `src/agent/agent.test.ts` | Agent 层单元测试 |
| 修改 | `src/tools/types.ts` | Tool 接口增加 category 字段 |
| 修改 | `src/tools/read_file.ts` | 添加 category = 'readonly' |
| 修改 | `src/tools/glob.ts` | 添加 category = 'readonly' |
| 修改 | `src/tools/grep.ts` | 添加 category = 'readonly' |
| 修改 | `src/tools/write_file.ts` | 添加 category = 'mutation' |
| 修改 | `src/tools/edit_file.ts` | 添加 category = 'mutation' |
| 修改 | `src/tools/run_command.ts` | 添加 category = 'mutation' |
| 修改 | `src/chat/manager.ts` | 简化为单轮调用：拆出 callLLM，去掉 follow-up |
| 修改 | `src/main.ts` | Agent 替代 ChatManager，处理 AgentEvent，/plan /do /stop 命令 |

## T1: Tool 接口增加 category 字段

**文件：** `src/tools/types.ts` + 全部 6 个工具文件
**依赖：** 无
**步骤：**
1. Tool 接口加 `category: 'readonly' | 'mutation'` 字段
2. read_file.ts：`category = 'readonly' as const`
3. glob.ts：`category = 'readonly' as const`
4. grep.ts：`category = 'readonly' as const`
5. write_file.ts：`category = 'mutation' as const`
6. edit_file.ts：`category = 'mutation' as const`
7. run_command.ts：`category = 'mutation' as const`

**验证：** `npx tsc --noEmit` 通过，`npm test` 全通过

## T2: Agent 事件类型定义

**文件：** `src/agent/types.ts`
**依赖：** 无
**步骤：**
1. 定义 TurnStartEvent：type + turn(number)
2. 定义 TurnEndEvent：type + turn + stopReason + tokenUsage?
3. 定义 AgentDoneEvent：type + totalTurns + stopReason + totalTokens?
4. 定义 AgentEvent 联合类型：BaseEvent（从 provider/types 导入）| TurnStartEvent | TurnEndEvent | AgentDoneEvent
5. 定义 AgentConfig 接口：maxIterations、timeout、mode
6. 导入 provider/types.ts 的 BaseEvent 类型，re-export 为 AgentEvent

**验证：** `npx tsc --noEmit` 通过

## T3: StreamCollector 实现

**文件：** `src/agent/stream_collector.ts`
**依赖：** T2、provider/types.ts
**步骤：**
1. 实现 StreamCollector 类
2. collect(stream: AsyncGenerator<StreamEvent>): AsyncGenerator<StreamEvent>
   - for await 遍历 stream
   - text_delta → 透传 yield + 拼接到 currentTextBlock
   - thinking_delta → 透传 yield + 拼接到 currentThinkingBlock
   - tool_use → 透传 yield + push 到 contentBlocks
   - done → content 不为空时用其覆盖内部 blocks（防御性）；yield done
   - error → 透传 yield
   - 返回的 generator 供外界消费实时事件
3. getBlocks(): ContentBlock[] — 返回完整拼好的 blocks
4. hasToolUse(): boolean — 检查 blocks 中是否有 tool_use
5. getToolUseBlocks(): ContentBlock[] — 过滤返回 tool_use 类型的 blocks

**验证：** `npx tsc --noEmit` 通过

## T4: ToolExecutor 实现

**文件：** `src/agent/tool_executor.ts`
**依赖：** T1、tools/registry.ts
**步骤：**
1. 实现 ToolExecutor 类，构造器接收 ToolRegistry
2. executeBatch(toolUseBlocks, context): AsyncGenerator<AgentEvent>
   a. 将 toolUseBlocks 按 tool.category 分为 readonly 和 mutation 两组
   b. readonly 组：每个 tool yield tool_executing → Promise.all 并发执行 → 每个 yield tool_result。保持原始顺序
   c. mutation 组：按顺序逐个 yield tool_executing → 执行 → yield tool_result
   d. 结果收集为 ContentBlock[]（tool_result 类型），按原始 toolUseBlocks 顺序
3. 工具不存在时：yield tool_result(success=false, error="未知工具")
4. 工具执行异常时：catch → yield tool_result(success=false, error=异常信息)
5. 返回结果数组（tool_result ContentBlock[]）

**验证：** `npx tsc --noEmit` 通过

## T5: ChatManager 改造为单轮

**文件：** `src/chat/manager.ts`
**依赖：** 无外部新依赖
**步骤：**
1. 拆出 callLLM(tools?, signal?): AsyncGenerator<StreamEvent>
   - 调用 provider.streamChat(messages, signal, tools)
   - 返回异步生成器（不做任何事件收集和消息追加）
   - 这是纯 LLM 调用
2. 保留 addUserMessage(content): void
3. 保留 addAssistantMessage(blocks): void（追加 assistant 消息到 messages）
4. 新增 addToolResult(toolResultBlock): void（追加 tool role 消息）
5. sendMessage 方法改为内部调用 callLLM + StreamCollector + 消息追加（简化版，供基本对话使用）
6. 去掉原有的工具执行逻辑和 follow-up 调用（交给 Agent）
7. clear() 和 getMessages() 保持不变

**验证：** `npm test` 中 ChatManager 原有测试通过（需要更新 mock 以适配新接口）

## T6: Agent 循环引擎实现

**文件：** `src/agent/agent.ts`
**依赖：** T2-T5
**步骤：**
1. 实现 Agent 类
   - constructor(chatManager, toolExecutor, config)
   - mode 状态管理（full / plan）
2. run(userInput, signal?): AsyncGenerator<AgentEvent>
   ```
   ① chatManager.addUserMessage(userInput)
   ② for turn = 1 to maxIterations:
        yield turn_start(turn)
        准备 tools = (mode==='plan' ? readonlyOnly : all)

        // 调 LLM + 收集
        collector = new StreamCollector()
        for event in collector.collect(chatManager.callLLM(tools, signal)):
          if event.type === 'error': yield agent_done('stream_error'), return
          yield event  // 实时透传

        blocks = collector.getBlocks()
        chatManager.addAssistantMessage(blocks)

        if !collector.hasToolUse():
          yield turn_end(turn, 'no_tool_use', tokens)
          yield agent_done('task_completed', tokens)
          return

        // 检查连续未知工具
        if consecutiveUnknownTools >= 2:
          yield agent_done('consecutive_unknown_tools')
          return

        // 执行工具
        toolBlocks = collector.getToolUseBlocks()
        for event in toolExecutor.executeBatch(toolBlocks, context):
          yield event

        // 结果注入
        for block in results:
          chatManager.addToolResult(block)

        yield turn_end(turn, 'tools_executed')

   ③ 循环结束（超限）
      yield agent_done('max_iterations')
   ```
3. 实现 setMode(mode)，clear()，getMessages()
4. 用户取消：signal.aborted 时 catch AbortError → agent_done('user_cancelled')

**验证：** `npx tsc --noEmit` 通过

## T7: main.ts 接入 Agent

**文件：** `src/main.ts`
**依赖：** T6
**步骤：**
1. 创建 ToolExecutor 和 Agent 实例
2. processInput 改为调用 agent.run(trimmed)
3. 消费 AgentEvent 流，switch 增加 turn_start、turn_end、agent_done 处理
   - turn_start: 灰色 `[第 N 轮]`
   - turn_end: 灰色 `[第 N 轮结束]`
   - agent_done: 灰色总结 `[完成 · N 轮 · N tokens]` 或 `[达到迭代上限 · 已完成 N 轮]`
4. 新增命令处理：
   - /plan: `agent.setMode('plan')` + 提示
   - /do: `agent.setMode('full')` + 提示
   - /stop: 通过 AbortController 停止当前循环
5. 提示符显示当前模式：mode === 'plan' 时 `[plan] >` 否则 `>`
6. 保留 /exit、/clear 处理

**验证：** `npm run dev` 启动，/plan 和 /do 切换正常，Agent 循环工作

## T8: Agent 层测试

**文件：** `src/agent/agent.test.ts`
**依赖：** T3-T6
**步骤：**
1. StreamCollector 测试：mock Provider 流 → 验证实时透传 + getBlocks 正确
2. ToolExecutor 测试：
   - 全 readonly 工具 → 验证并发执行（用 sleep 工具测时序）
   - 全 mutation 工具 → 验证串行执行
   - 混合 → 验证先并发后串行
3. Agent 测试：
   - 模型直接返回文本 → agent_done('task_completed')，1 轮
   - 模型先 tool_use 再文本 → 2 轮完成
   - 模型连续 5 次 tool_use → agent_done('max_iterations')
   - plan mode → 只传 readonly 工具给 Provider
   - 流错误 → agent_done('stream_error')

**验证：** `npm test` 中 Agent 层测试通过

## 执行顺序

```
T1 (Tool category) ─────────────────────────────┐
                                                  │
T2 (Agent types) ──→ T3 (StreamCollector) ──→ T4 (ToolExecutor)
                                                       │
                                                  T5 (ChatManager 改造)
                                                       │
                                                  T6 (Agent 循环)
                                                       │
                                    T7 (main.ts) ←────┘
                                    T8 (测试)
```

T1 和 T2 可并行。T3、T4 依赖 T2。T5 可与 T2-T4 并行。T6 依赖 T3+T4+T5。T7 依赖 T6。T8 在 T6 之后。

## 依赖关系总结

- T1 是工具层小改动，独立且简单
- T2 是类型基础，T3/T4/T5/T6 都依赖它
- T3（StreamCollector）和 T4（ToolExecutor）是 Agent 的两个子组件
- T5（ChatManager 改造）是让 ChatManager 适配新的 Agent 架构
- T6（Agent）是核心，整合 T3+T4+T5
- T7 是界面接入，依赖 T6
- T8 是测试，在所有组件完成后编写
