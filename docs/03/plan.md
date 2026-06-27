# MewCode 第三阶段 Plan

## 架构概览

在第二阶段四层架构基础上，新增 Agent 层夹在 TUI 和 ChatManager 之间：

```
main.ts (TUI层)
    │
agent/ (Agent Loop 层) ← 新增
    │  agent.ts        — ReAct 循环引擎
    │  tool_executor.ts — 工具分类 + 并发/串行执行
    │  stream_collector.ts — 双路流式收集器
    │  types.ts         — Agent 事件类型
    │
    ├── chat/manager.ts  (修改：简化为单轮调用)
    │   └── provider/    (不变)
    │
    └── tools/           (不变，增加读写分类元数据)
        └── types.ts     (修改：Tool 接口增加 category 字段)
```

**关键变化：**
- ChatManager 从"自己管循环"降级为"只管一轮 LLM 调用"（不自动做 follow-up 调用）
- Agent 类接管循环逻辑，成为 TUI 的新依赖
- TUI 不再直接调 ChatManager，改为通过 Agent

## 核心数据结构

### AgentEvent（Agent 事件流）

取消原有 StreamEvent 的扁平结构，改为层次化事件：

```typescript
// 基础事件（沿用）
type BaseEvent = TextDelta | ThinkingDelta | ToolUseEvent | ToolExecutingEvent | ToolResultEvent | ErrorEvent;

// Agent 生命周期事件（新增）
interface TurnStartEvent {
  type: 'turn_start';
  turn: number;        // 当前第几轮（从 1 开始）
}

interface TurnEndEvent {
  type: 'turn_end';
  turn: number;
  stopReason: 'model_responded' | 'no_tool_use';
  tokenUsage?: { input: number; output: number };
}

interface AgentDoneEvent {
  type: 'agent_done';
  totalTurns: number;
  stopReason: 'task_completed' | 'max_iterations' | 'user_cancelled' | 'consecutive_unknown_tools' | 'stream_error';
  totalTokens?: { input: number; output: number };
}

// AgentEvent = BaseEvent | TurnStartEvent | TurnEndEvent | AgentDoneEvent
type AgentEvent = BaseEvent | TurnStartEvent | TurnEndEvent | AgentDoneEvent;
```

### Tool 接口扩展

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: ToolParameters;
  category: 'readonly' | 'mutation';  // 新增：工具分类
  execute(input: Record<string, unknown>, context: ToolExecuteContext): Promise<ToolResult>;
}
```

分类规则：
- `readonly`：read_file、glob、grep（无副作用，可并发）
- `mutation`：write_file、edit_file、run_command（有副作用，必须串行）

### StreamCollector

```typescript
class StreamCollector {
  // 消费 Provider 的异步生成器，同时做两件事：
  // 1. 实时透传 text_delta/thinking_delta 给外界
  // 2. 后台拼接完整 ContentBlock[]

  collect(
    stream: AsyncGenerator<StreamEvent>
  ): AsyncGenerator<StreamEvent>;  // 外界用 for await 消费

  getBlocks(): ContentBlock[];     // 收集完成后调用，获取完整响应
  hasToolUse(): boolean;           // 是否有 tool_use block
  getToolUseBlocks(): ContentBlock[];  // 获取所有 tool_use block
}
```

### ToolExecutor

```typescript
class ToolExecutor {
  constructor(registry: ToolRegistry);

  // 执行一批 tool_use block，自动处理并发/串行
  // 返回按原顺序排列的 tool_result ContentBlock[]
  executeBatch(
    toolUseBlocks: ContentBlock[],
    context: ToolExecuteContext
  ): AsyncGenerator<AgentEvent>;  // yield tool_executing + tool_result 事件
}
```

内部逻辑：
1. 将 toolUseBlocks 按 category 分为 readonly 和 mutation 两组
2. 先并发执行 readonly 组（Promise.all）
3. 再按顺序串行执行 mutation 组
4. 结果按原 toolUseBlocks 的顺序排列

### AgentConfig

```typescript
interface AgentConfig {
  maxIterations: number;    // 最大迭代次数，默认 5
  timeout: number;          // 单次 LLM 调用超时
  mode: 'full' | 'plan';   // 当前模式
}
```

### Agent

```typescript
class Agent {
  constructor(chatManager: ChatManager, toolExecutor: ToolExecutor, config: AgentConfig);

  // 执行用户任务，返回 AgentEvent 异步迭代器
  run(userInput: string, signal?: AbortSignal): AsyncGenerator<AgentEvent>;

  // 切换模式
  setMode(mode: 'full' | 'plan'): void;

  // 获取对话历史（透传 ChatManager）
  getMessages(): Message[];
  clear(): void;
}
```

## 模块设计

### 模块 G: Agent 事件类型 (types.ts)

**职责：** 定义 Agent 层的所有事件类型

**对外接口：** AgentEvent 联合类型、TurnStartEvent、TurnEndEvent、AgentDoneEvent

**依赖：** 沿用 provider/types.ts 的 BaseEvent 类型

### 模块 H: StreamCollector (stream_collector.ts)

**职责：** 包装 Provider 流，提供双路收集

**对外接口：** `collect(stream): AsyncGenerator` + `getBlocks()` + `hasToolUse()`

**依赖：** provider/types.ts

**内部逻辑：**
1. for await 遍历 stream
2. text_delta / thinking_delta → 透传 yield + 拼接到内部 ContentBlock[]
3. tool_use → 透传 yield + 追加到 ContentBlock[]
4. done → 保存 content + yield done
5. error → 透传 yield
6. collect 结束后，getBlocks() 返回完整拼好的 ContentBlock[]

**关键实现细节：**
- text_delta 需要和第二阶段 ChatManager 一样，按顺序拼到 currentTextBlock
- thinking_delta 同理
- tool_use 直接 push 到数组
- 最终 getBlocks() 返回的是 text(已拼接) + thinking(已拼接) + tool_use 的混合数组

### 模块 I: ToolExecutor (tool_executor.ts)

**职责：** 按安全性分批执行工具，管理并发/串行

**对外接口：** `executeBatch(toolUseBlocks, context): AsyncGenerator`

**依赖：** tools/types.ts、tools/registry.ts

**内部逻辑：**
1. 将 toolUseBlocks 分为 readonly 和 mutation 两组
2. phase1: readonly 组 → 每个 tool 用 Promise.all 并发执行
   - 每个 tool 先 yield tool_executing，执行完后 yield tool_result
   - 并发意味着多个 tool_executing 连续 yield，然后多个 tool_result
3. phase2: mutation 组 → 按顺序逐个执行
   - 每个 yield tool_executing → 执行 → yield tool_result
4. 结果收集：按 toolUseBlocks 原始顺序排列 tool_result ContentBlock[]

**为什么 mutation 串行：**
- 两个 write_file 可能写同一文件，后写的覆盖先写的
- run_command 可能依赖前一个命令的输出（如 mkdir 后 touch）
- LLM 返回 tool_use 的顺序通常是有意义的

### 模块 J: Agent 循环引擎 (agent.ts)

**职责：** ReAct 循环核心，协调 LLM 调用和工具执行

**对外接口：** `Agent` 类

**依赖：** ChatManager、ToolExecutor、StreamCollector、AgentConfig

**run() 核心逻辑：**

```
function run(userInput):
  yield turn_start(turn=1)

  // 将用户任务追加到 ChatManager
  chatManager.addUserMessage(userInput)

  loop (turn = 1, 2, ..., maxIterations):
    // ① 准备工具定义（根据当前 mode 过滤）
    tools = mode === 'plan'
      ? registry.filter(category === 'readonly')
      : registry.getAll()

    // ② 调用 LLM
    collector = new StreamCollector()
    for each event in collector.collect(chatManager.callLLM(tools)):
      yield event  // 实时透传 text_delta/thinking_delta/tool_use

    // ③ 判断是否有 tool_use
    if not collector.hasToolUse():
      // 模型说完了，没有工具调用
      chatManager.addAssistantMessage(collector.getBlocks())
      yield turn_end(turn, reason='no_tool_use')
      break

    // ④ 保存本轮 assistant 消息
    chatManager.addAssistantMessage(collector.getBlocks())

    // ⑤ 执行工具
    toolBlocks = collector.getToolUseBlocks()
    counter = checkConsecutiveUnknownTools(toolBlocks)
    if counter >= 2:
      yield agent_done(reason='consecutive_unknown_tools')
      break

    for each event in toolExecutor.executeBatch(toolBlocks):
      yield event  // tool_executing + tool_result

    // ⑥ 将 tool_result 注入对话历史
    for each result in executeBatch的返回值:
      chatManager.addToolResult(result)

    yield turn_end(turn, reason='tools_executed')

    turn++

  if turn > maxIterations:
    yield agent_done(reason='max_iterations')
  else:
    yield agent_done(reason='task_completed')
```

**ChatManager 改造：**
- 去掉第二阶段的 follow-up 调用（"工具执行后再调一次模型"）
- 改为提供单轮 LLM 调用方法：`callLLM(tools?): AsyncGenerator<StreamEvent>`
- 这个方法只负责：发请求、解析流、透传事件
- 不负责判断和追加消息（交给 Agent）

**停止条件处理：**
1. 模型停止调工具 → collector.hasToolUse() == false → break
2. 迭代上限 → 循环外的 turn > maxIterations 检查
3. 用户取消 → signal.aborted → 捕获 AbortError → yield agent_done(reason='user_cancelled')
4. 连续未知工具 → 每次 tool_use 检查工具是否存在，连续 2 次不存在则终止
5. 流出错 → 捕获 error 事件 → yield agent_done(reason='stream_error')

### 模块 D''：TUI 层扩展

**main.ts 改造：**
- 创建 Agent 替代直接使用 ChatManager
- processInput 消费 Agent.run() 的 AgentEvent 流
- 新增事件处理：turn_start（显示 `[第 N 轮]`）、turn_end、agent_done（显示总结）
- 新增命令处理：/plan、/do、/stop
- 提示符根据 mode 显示 `[plan] >` 或 `[do] >`

**Agent.run() 返回的事件流在 processInput 中的处理：**

```
switch event.type:
  turn_start  → 灰色 "[第 N 轮]"
  text_delta  → 逐字输出
  tool_use    → ⚡ 准备调用
  tool_executing → 🔧 执行中
  tool_result → ✅/❌ 完成
  turn_end    → 灰色 "[第 N 轮结束 · N tokens]"
  agent_done  → 灰色 "[Agent 完成 · N 轮 · N tokens]"
  error       → ❌ 错误
```

## 模块交互

### 一次完整 Agent 执行流程

```
用户输入 "在 src 目录创建 hello.txt，内容是 Hello World"
    │
    ▼
Agent.run(userInput)
    │
    │ turn_start(turn=1)
    │
    ├─→ ChatManager.addUserMessage(userInput)
    │
    ├─→ ChatManager.callLLM(allTools)  ← 带全工具
    │   │
    │   └─→ StreamCollector.collect(stream)
    │       │ yield text_delta → TUI 显示
    │       │ yield tool_use(write_file, {file_path: "src/hello.txt", content: "Hello World"})
    │       │
    │       └─→ getBlocks() → [tool_use: write_file]
    │
    ├─ hasToolUse() == true
    ├─ ChatManager.addAssistantMessage([tool_use])
    │
    ├─→ ToolExecutor.executeBatch([write_file])
    │   │ yield tool_executing(write_file)
    │   │ 执行 write_file
    │   │ yield tool_result(success, "创建文件成功")
    │   └─ 返回 [tool_result: "创建文件成功"]
    │
    ├─ ChatManager.addToolResult(tool_result)
    ├─ turn_end(turn=1, reason='tools_executed')
    │
    ├─ turn_start(turn=2)
    ├─→ ChatManager.callLLM(undefined)  ← 不带工具（这是 Agent 的决策）
    │   │
    │   等等，这里需要重新考虑...
    │
    └─ ...

实际上，第一次 LLM 返回 tool_use 后执行了工具，工具结果写入了对话历史。
第二次 LLM 调用时，模型看到 tool_result，可能：
  a) 觉得任务完成，返回纯文本 → hasToolUse() == false → break
  b) 觉得还需要更多操作（如写完后验证） → 返回 tool_use → 继续循环

所以每次循环都带工具定义（除了 plan mode 要过滤）。
```

### 修正后的完整流程

```
Agent.run("在 src 目录创建 hello.txt")

Turn 1:
  callLLM(allTools) → tool_use(write_file)
  executeBatch → tool_result(成功)
  messages: [user, assistant(tool_use), tool(tool_result)]

Turn 2:
  callLLM(allTools) → text_delta "已创建文件 src/hello.txt，内容为 Hello World"
  hasToolUse() == false → break
  agent_done(reason='task_completed')

总共 2 轮，用户看到完整的流式输出。
```

## 文件组织

```
mewcode/
├── src/
│   ├── main.ts              # 修改：Agent 替代 ChatManager，处理 AgentEvent
│   ├── agent/               # 新建
│   │   ├── types.ts         # AgentEvent、AgentConfig 类型
│   │   ├── agent.ts         # Agent 类：ReAct 循环引擎
│   │   ├── tool_executor.ts # ToolExecutor：并发/串行执行
│   │   ├── stream_collector.ts # StreamCollector：双路收集
│   │   └── agent.test.ts    # Agent 层测试
│   ├── chat/
│   │   └── manager.ts       # 修改：简化为单轮调用 + 消息管理
│   ├── tools/
│   │   └── types.ts         # 修改：Tool 接口增加 category 字段
│   ├── provider/            # 不变
│   └── config/              # 不变
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 循环引擎位置 | 新建 Agent 类，独立于 ChatManager | Agent 是协调者，ChatManager 是执行者。分离后 ChatManager 可独立测试单轮调用 |
| ChatManager 改造 | 从"管循环"降级为"管单轮" | 去掉 follow-up 调用逻辑，只提供 callLLM() + addXxxMessage() |
| 事件模型 | 新增 AgentEvent（含生命周期事件） | 和原有 StreamEvent 互补，不破坏已有 Provider 层 |
| Tool 分类 | category: 'readonly' / 'mutation' | 简单二分类，足够支撑并发/串行决策 |
| 并发策略 | readonly 并发 + mutation 串行 | 读操作无副作用可并发提速，写操作有依赖关系必须串行 |
| Plan Mode 实现 | Agent.setMode() 过滤工具列表 | 模式切换只是工具列表不同，不改变循环逻辑 |
| 流式收集 | StreamCollector 包装 AsyncGenerator | 双路收集内聚在一个类里，不污染 Agent 的循环逻辑 |
| 未知工具检测 | 连续 2 次触发终止 | 1 次可能是模型笔误，2 次说明模型确实不知道有什么工具了 |
| 迭代上限 | 默认 5 次 | 用户选择，足够覆盖大多数场景但不过度浪费 token |
