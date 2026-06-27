# MewCode 第二阶段 Plan

## 架构概览

在第一阶段四层架构（Config → Provider → Chat → TUI）基础上，增加工具系统层：

```
main.ts (TUI层)
    │
chat/manager.ts (对话管理 + 工具执行协调)
    │
├── provider/ (API 调用 + 流式 tool_use 解析)
│   ├── anthropic.ts  — 解析 input_json_delta 拼装 tool_use
│   ├── openai.ts     — 解析 delta.tool_calls 增量
│   └── converter.ts  — 标准消息 ↔ API 格式（含 tool_calls）
│
└── tools/ (工具系统)
    ├── types.ts      — Tool 接口、ToolResult、ToolExecuteContext
    ├── registry.ts   — ToolRegistry 注册中心
    ├── helpers.ts    — 超时、路径校验、安全过滤
    ├── read_file.ts  — 读文件
    ├── write_file.ts — 写文件
    ├── edit_file.ts  — 唯一匹配替换
    ├── run_command.ts— 执行 shell 命令
    ├── glob.ts       — 模式匹配文件
    └── grep.ts       — 搜索代码内容

config/ (YAML 配置加载，不变)
```

ChatManager 从单纯的"调用 Provider → 透传事件"升级为工具执行协调者。Provider 层的 streamChat 方法新增 tools 参数，屏蔽 Anthropic 和 OpenAI 在 tool calling 格式上的差异。

## 核心数据结构

### Tool（工具接口）
```typescript
interface Tool {
  name: string;
  description: string;
  parameters: ToolParameters;  // JSON Schema 格式
  execute(input: Record<string, unknown>, context: ToolExecuteContext): Promise<ToolResult>;
}
```

### ToolParameters（参数 JSON Schema）
```typescript
interface ToolParameters {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
}
```

### ToolExecuteContext（执行上下文）
```typescript
interface ToolExecuteContext {
  cwd: string;       // 当前工作目录
  timeout: number;   // 超时时间（ms）
  signal?: AbortSignal;
}
```

### ToolResult（执行结果）
```typescript
interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  meta?: Record<string, unknown>;  // exit_code 等
}
```

### ToolDefinition（传给 API 的工具定义）
```typescript
interface ToolDefinition {
  name: string;
  description: string;
  input_schema: ToolParameters;  // Anthropic 用 input_schema，OpenAI 用 parameters
}
```

### 原有类型扩展

**ContentBlock**（已有，tool_use/tool_result 类型从预留变为实际使用）：
- type: 'text' | 'thinking' | 'tool_use' | 'tool_result'
- tool_use_id?: string
- tool_name?: string
- tool_input?: Record<string, unknown>

**StreamEvent 新增三种**：
```typescript
interface ToolUseEvent {
  type: 'tool_use';
  tool_use_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

interface ToolExecutingEvent {
  type: 'tool_executing';
  tool_use_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

interface ToolResultEvent {
  type: 'tool_result';
  tool_use_id: string;
  tool_name: string;
  success: boolean;
  output: string;
  meta?: Record<string, unknown>;
}
```

**Provider 接口签名扩展**：
```typescript
streamChat(messages: Message[], signal?: AbortSignal, tools?: ToolDefinition[]): AsyncGenerator<StreamEvent>;
```
tools 为可选参数。不传或传空时，模型不使用工具（与第一阶段行为完全一致）。

## 模块设计

### 模块 E: Tool 基础层 (types.ts + helpers.ts + registry.ts)

**职责：** 定义 Tool 接口、执行上下文、结果类型；提供公共辅助函数；管理工具注册

**helpers.ts 核心函数：**
- `resolvePath(inputPath, cwd)` — 规范化路径 + 防逃逸检查
- `withTimeout(promise, ms, signal?)` — Promise 超时包装
- `checkDangerousCommand(command)` — 扫描危险命令模式，匹配返回拒绝原因
- `truncateOutput(output, maxLen)` — 截断过长输出
- `isBinary(buffer)` — 检测文件是否为二进制
- `ok(output, meta?)` / `fail(error, meta?)` — 构造 ToolResult

**registry.ts：**
```typescript
class ToolRegistry {
  register(tool: Tool): void;
  get(name: string): Tool | undefined;
  getAll(): Tool[];
  toAPIFormat(): ToolDefinition[];
}
```

### 模块 F: 六个核心工具

**ReadFileTool：** `file_path` → fs.readFileSync → 返回文本。拒绝目录、>1MB、二进制、路径逃逸。

**WriteFileTool：** `file_path` + `content` → mkdirSync(recursive) + writeFileSync。覆盖已有或创建新文件。

**EditFileTool：** `file_path` + `old_string` + `new_string` → indexOf 计次 → 0次报错/≥2次报错/1次替换写回。不做正则匹配，不做模糊匹配。

**RunCommandTool：** `command` + `timeout?` → 黑名单检查 → execSync(timeout, maxBuffer) → 截断输出。exit code 放 meta。

**GlobTool：** `pattern` + `path?` → 递归目录遍历 + 手写 glob 匹配（支持 * ** ?）。返回匹配文件路径列表。

**GrepTool：** `pattern` + `include?` + `path?` → 递归遍历 + RegExp 搜索行。忽略 node_modules/.git/dist 等。每个文件最多 10 行匹配。

### 模块 B'：Provider 层扩展

**AnthropicProvider 改造：**
- 新增 `partialJsonBuffers: Map<number, string>` 用于拼装 input_json_delta
- content_block_delta 增加 `input_json_delta` 分支：追加 partial_json 到缓冲区
- content_block_stop 增加 tool_use 处理：JSON.parse 缓冲区 → yield ToolUseEvent
- 请求体新增 `tools` 字段（Anthropic 格式：name + description + input_schema）

**OpenAIProvider 改造：**
- 新增 `pendingToolCalls: Map<number, { id, name, argsBuf }>` 用于归并 tool_calls
- delta 循环增加 `delta.tool_calls` 分支：按 index 归并 id/name/arguments 碎片
- [DONE] 到达时 JSON.parse 各 argsBuf → yield ToolUseEvent
- 请求体新增 `tools` 字段（OpenAI 格式：type: 'function' + function: { name, description, parameters }）

**MessageConverter 改造：**
- `contentToAnthropic`：tool_result 的 content 字段完善
- `toOpenAIMessages`：增加 tool role 消息处理（tool_call_id + content）；assistant 消息中有 tool_use 时增加 tool_calls 字段

### 模块 C'：ChatManager 升级

从单纯透传升级为工具执行协调者。sendMessage 流程：

```
1. 追加 user 消息
2. 调用 provider.streamChat(messages, signal, toolDefs)
3. 收集 text_delta / thinking_delta → 透传
4. 检测 tool_use → yield 给 UI → 加入 contentBlocks
5. 收到 done → 追加 assistant 消息（含 tool_use blocks）
6. 遍历 tool_use blocks → 查 ToolRegistry → 执行工具 → 构造 tool_result → 注入 messages
7. 再调一次 provider.streamChat(messages, signal, undefined)
   （不带 tools，让模型基于工具结果生成最终文字回复）
8. 透传模型回复 → 追加 assistant 消息 → 结束
```

**关键设计决策：第 7 步不传 tools，防止模型再次发起工具调用（不做连环调用）。**

### 模块 D'：TUI 层扩展

main.ts 在 switch 中新增三种事件的视觉效果：
- `tool_use` → `⚡ 准备调用: <tool_name> (<params>)`（灰色）
- `tool_executing` → `🔧 <tool_name> <params>`（灰色，不换行）
- `tool_result` → 成功后 `✅ <tool_name> 完成: <preview>`（灰色）；失败 `❌ <tool_name> 失败: <error>`（红色）

main.ts 启动时创建 ToolRegistry 并注册六个工具，注入 ChatManager。

## 模块交互

### 一次带工具调用的对话流程

```
用户输入 "帮我看看 src/main.ts 的内容"
    │
    ▼
ChatManager.sendMessage("帮我看看 src/main.ts 的内容")
    │ 追加 user 消息
    │ 调用 provider.streamChat(messages, signal, toolDefs)
    │
    ▼
AnthropicProvider / OpenAIProvider
    │ 构建请求体（含 tools 定义）
    │ fetch POST → SSE 流 → 解析 tool_use
    │ yield ToolUseEvent { tool_name: "read_file", tool_input: { file_path: "src/main.ts" } }
    │
    ▼
ChatManager (收集事件)
    │ 检测到 tool_use → yield 给 TUI → 加入 contentBlocks
    │ 收到 done → 追加 assistant 消息
    │
    ▼
ChatManager (执行工具)
    │ registry.get("read_file") → tool.execute(...)
    │ 构造 tool_result → 注入 messages
    │ yield tool_result 给 TUI
    │
    ▼
ChatManager (再调模型)
    │ provider.streamChat(messages, signal, undefined)  ← 不带 tools
    │ 模型基于 tool_result 生成文字回复
    │ yield text_delta → 透传给 TUI
    │ done → 追加 assistant 消息
    │
    ▼
TUI 展示完整回复
```

### 错误处理分支

```
工具不存在 → yield tool_result(success: false, error: "未知工具")
工具执行异常 → catch → yield tool_result(success: false, error: 异常信息)
API 返回错误 → 和第一阶段一样，透传 error 事件
```

## 文件组织

```
mewcode/
├── src/
│   ├── main.ts              # 修改：注册工具 + 工具事件视觉效果
│   ├── config/              # 不变
│   ├── provider/
│   │   ├── types.ts          # 修改：+ToolUseEvent/ToolExecutingEvent/ToolResultEvent；Provider 接口 +tools 参数
│   │   ├── converter.ts      # 修改：tool 消息转换 + OpenAI tool_calls 格式
│   │   ├── anthropic.ts      # 修改：input_json_delta 碎片拼接 + tools 字段
│   │   ├── openai.ts         # 修改：tool_calls delta 归并 + tools 字段
│   │   ├── factory.ts        # 不变
│   │   └── provider.test.ts  # 不变（已有测试覆盖基本流程）
│   ├── chat/
│   │   ├── manager.ts        # 重写：工具执行协调流程
│   │   └── chat.test.ts      # 不变（已有测试依然通过）
│   └── tools/                # 新建
│       ├── types.ts          # Tool 接口、ToolResult、ToolExecuteContext、ToolDefinition
│       ├── registry.ts       # ToolRegistry
│       ├── helpers.ts        # 超时、路径校验、安全检查、截断
│       ├── read_file.ts      # ReadFileTool
│       ├── write_file.ts     # WriteFileTool
│       ├── edit_file.ts      # EditFileTool（唯一匹配替换）
│       ├── run_command.ts    # RunCommandTool（含黑名单）
│       ├── glob.ts           # GlobTool（手写 glob 匹配）
│       ├── grep.ts           # GrepTool（递归 + RegExp）
│       └── tools.test.ts     # 66 个测试（含 helpers、registry、全部工具）
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 工具执行不循环 | 拿到工具结果后调用模型生成回复就停，不传 tools | 先验证单轮工具调用可靠性，连环调用留到下一阶段 |
| 工具参数格式 | JSON Schema（Anthropic 风格） | 内部统一格式，转 OpenAI 时适配为 function.parameters |
| Glob 实现 | 手写递归 + 模式匹配 | 不增加外部依赖，Node.js 内置 fs 足够 |
| Grep 实现 | 递归 + RegExp | 跨平台，不依赖 grep 命令 |
| Edit 匹配策略 | indexOf 精确字符串匹配 | 不做正则，不做模糊匹配，避免不可预测行为 |
| 命令安全 | 硬编码黑名单 + 超时 | 表层防御，后续可加用户确认 |
| 工具定义注入 | 通过 ChatManager.setToolRegistry() | 与 Provider 解耦，Provider 只关心 API 通信 |
| 第二次调用不传 tools | streamChat(..., undefined) | 防止模型再次发起工具调用，保证"不做连环调用" |
