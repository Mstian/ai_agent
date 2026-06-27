# MewCode 第一阶段 Plan

## 架构概览

整体分四层，从上到下依次是：

**TUI 层** — Ink + React 构建终端界面。包含对话展示区（ChatView）和输入区（InputArea），
通过 useChat hook 管理对话状态。TUI 层只依赖 ChatManager，不直接接触 Provider 或配置。

**Chat 层** — 对话上下文管理。维护消息列表，提供添加消息、清空上下文、获取完整历史等操作。
每次用户输入时，ChatManager 将完整消息历史传给 Provider 并消费流式事件。

**Provider 层** — 大模型 API 抽象。定义统一的 Provider 接口（streamChat），
AnthropicProvider 和 OpenAIProvider 各自实现。ProviderFactory 根据 protocol 字段创建对应实例。
每个 Provider 内部负责：标准消息格式 → API 请求格式的转换、HTTP 请求发送、SSE 流解析。

**Config 层** — YAML 配置加载。读取 .mewcode.yaml（项目优先，全局兜底），校验必填字段，
产出 ProviderConfig 供 ProviderFactory 使用。

数据流方向始终是单向的：Config → Provider → Chat → TUI。
TUI 不反向调用 ChatManager 之外的任何层。

## 核心数据结构

### ProviderConfig（配置层 → Provider 层）
从 YAML 文件加载的配置对象：
- protocol: 'anthropic' | 'openai'
- model: string          // 模型名
- base_url: string       // API 端点
- api_key: string        // 认证密钥

### Message（所有层共享的对话消息）
- role: 'user' | 'assistant' | 'system' | 'tool'
- content: string | ContentBlock[]

其中 ContentBlock：
- type: 'text' | 'tool_use' | 'tool_result' | 'thinking'
- text?: string          // 纯文本时使用
- thinking?: string      // extended thinking 内容
- tool_use_id?: string   // tool 相关（预留）
- tool_name?: string     // tool 相关（预留）
- tool_input?: object    // tool 相关（预留）

### StreamEvent（Provider → Chat 层的流式事件）
联合类型，可能是以下之一：
- TextDelta { type: 'text_delta'; text: string }
- ThinkingDelta { type: 'thinking_delta'; text: string }
- Done { type: 'done'; content: ContentBlock[] }
- Error { type: 'error'; message: string }

## 核心接口

### Provider（provider 抽象接口）
```
interface Provider {
  readonly protocol: string;
  readonly model: string;

  // 发送消息并以 async generator 返回流式事件
  streamChat(messages: Message[], signal?: AbortSignal): AsyncGenerator<StreamEvent>;
}
```

### ChatManager（对话管理器）
```
class ChatManager {
  constructor(provider: Provider, systemPrompt?: string);

  // 发送用户消息，返回异步迭代器用于流式消费
  sendMessage(userInput: string, signal?: AbortSignal): AsyncGenerator<StreamEvent>;

  // 清空对话历史（保留 system prompt）
  clear(): void;

  // 当前消息历史（供 TUI 展示用）
  getMessages(): Message[];
}
```

### ConfigManager（配置加载器）
```
class ConfigManager {
  // 自动搜索 .mewcode.yaml：先 cwd，再 home 目录
  load(): ProviderConfig;

  // 校验必填字段，格式错误抛描述性异常
  static validate(config: unknown): ProviderConfig;
}
```

### ProviderFactory
```
class ProviderFactory {
  // 根据 protocol 字段创建对应 Provider 实例
  static create(config: ProviderConfig): Provider;
}
```

## 模块设计

### 模块 A: Config 配置管理模块
**职责：** 搜索、加载、校验 YAML 配置文件

**对外接口：** `ConfigManager.load(): ProviderConfig`

**依赖：** 无（只依赖 Node.js fs 和 yaml 解析库）

**内部逻辑：**
1. 在 `process.cwd()` 查找 `.mewcode.yaml`，找到则加载
2. 未找到则在 `os.homedir()` 查找
3. 两处都未找到则抛错误：提示创建配置文件
4. 校验四个字段是否存在且 `protocol` 为合法值
5. 返回 `ProviderConfig`

### 模块 B: Provider 大模型供应商模块
**职责：** 封装大模型 API 的 HTTP 请求和 SSE 流解析

**对外接口：** `Provider` 接口

**子模块：**
- `Provider 接口` — 定义 `streamChat(messages, signal?): AsyncGenerator<StreamEvent>`
- `MessageConverter` — 内部工具，将标准 Message[] 转换为各 API 所需的 JSON 格式
- `AnthropicProvider` — 调用 Anthropic Messages API (`/v1/messages`)，解析 SSE 事件
- `OpenAIProvider` — 调用 OpenAI Chat Completions API (`/v1/chat/completions`)，解析 SSE 事件
- `ProviderFactory` — 根据 `protocol` 字段创建实例

**依赖：** Config 模块（接收 ProviderConfig）

**SSE 解析要点：**
- Anthropic 事件类型：`message_start`, `content_block_start`, `content_block_delta`（含 `thinking_delta` 和 `text_delta`）, `content_block_stop`, `message_delta`, `message_stop`
- OpenAI 事件类型：`chat.completion.chunk`，delta 中 `content` 为文本，`reasoning_content` 为思考内容
- 两个 Provider 各自解析并统一输出为 `StreamEvent`

### 模块 C: Chat 对话管理模块
**职责：** 维护对话上下文，协调 Provider 调用

**对外接口：** `ChatManager`

**依赖：** Provider 模块

**内部逻辑：**
1. 构造时接收 Provider 和可选的 system prompt
2. `sendMessage(userInput, signal?)`：
   - 将用户消息追加到消息列表
   - 调用 `provider.streamChat(messages, signal)`
   - 收集流式事件中的 assistant 回复
   - 流结束后，将完整 assistant 消息追加到消息列表
   - 整个过程通过 `AsyncGenerator<StreamEvent>` 逐事件透传给调用方
3. `clear()`：清空除 system prompt 外的所有消息
4. `getMessages()`：返回当前消息列表快照

### 模块 D: TUI 终端界面模块
**职责：** 终端交互界面渲染和用户输入处理

**对外接口：** Ink App 入口，无编程接口

**依赖：** Chat 模块

**组件树：**
```
App
├── ChatView（对话展示区）
│   ├── MessageBubble（每条消息，用户/AI 左右对齐）
│   │   ├── RoleLabel（"You" / "MewCode"）
│   │   └── ContentText（消息文本）
│   └── StreamingLine（当前正在流式输出的行）
└── InputArea（输入区）
    └── TextInput（多行输入框）
```

**内置命令处理（不经过 Provider）：**
- `/clear` → 调用 `chatManager.clear()`
- `/exit` → 退出 Ink App

## 模块交互

### 启动流程
```
main.ts
  1. ConfigManager.load()           → ProviderConfig
  2. ProviderFactory.create(config) → Provider
  3. new ChatManager(provider)      → ChatManager
  4. <App chatManager={...} />      → Ink 渲染 TUI
```

### 对话流程（一次用户输入）
```
用户按下 Enter
  → InputArea 触发 onSubmit(userInput)
  → 判断是否为内置命令（/clear, /exit）
  → 非命令时：chatManager.sendMessage(userInput, abortSignal)
  → ChatManager 追加 user 消息，调用 provider.streamChat(messages, signal)
  → Provider 发 HTTP POST，用 fetch 的 ReadableStream 逐行解析 SSE
  → 每个 SSE chunk 转为 StreamEvent，yield 给 ChatManager
  → ChatManager yield 给 TUI
  → StreamingLine 组件逐事件更新渲染文本
  → stream 结束，ChatManager 追加完整 assistant 消息
```

### 取消流程
```
用户按 Ctrl+C
  → InputArea 触发 onCancel
  → abortController.abort()
  → fetch 中断，stream 结束
  → 已接收的部分内容保留在屏幕上
```

## 文件组织
```
mewcode/
├── package.json
├── tsconfig.json
├── src/
│   ├── main.ts              # 入口：加载配置 → 创建 ChatManager → 启动 Ink
│   ├── config/
│   │   ├── types.ts          # ProviderConfig 类型定义
│   │   ├── loader.ts         # ConfigManager：搜索、加载、校验 YAML
│   │   └── config.test.ts    # ConfigManager 单元测试
│   ├── provider/
│   │   ├── types.ts          # Provider 接口、Message、ContentBlock、StreamEvent
│   │   ├── converter.ts      # MessageConverter：标准消息 → API 格式
│   │   ├── anthropic.ts      # AnthropicProvider
│   │   ├── openai.ts         # OpenAIProvider
│   │   ├── factory.ts        # ProviderFactory
│   │   └── provider.test.ts  # Provider 层单元测试
│   ├── chat/
│   │   ├── manager.ts        # ChatManager
│   │   └── chat.test.ts      # ChatManager 单元测试
│   └── tui/
│       ├── app.tsx            # Ink App 入口，组合 ChatView + InputArea
│       ├── chat_view.tsx      # ChatView：消息列表 + 流式行
│       ├── input_area.tsx     # InputArea：多行输入框
│       ├── hooks/
│       │   └── use_chat.ts    # useChat hook：封装 ChatManager 调用
│       └── components/
│           ├── message_bubble.tsx  # MessageBubble 组件
│           └── streaming_line.tsx  # StreamingLine 组件
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 运行时 | Node.js 20+ | 用户选择 |
| 包管理 | npm | Node.js 默认，不做额外选择 |
| TUI 框架 | Ink 5.x + React 18 | 用户选择；Ink 支持 React hooks，组件化清晰 |
| HTTP 客户端 | 内置 fetch（Node 18+） | 零依赖，方案 A 的选择 |
| SSE 解析 | 手动基于 `ReadableStream` 逐行读取 `data:` 行 | 不引入 EventSource 库，和方案 A 一致 |
| TypeScript 配置 | strict 模式，ESM 模块 | 类型安全，现代标准 |
| YAML 解析 | `yaml` npm 包 | 仅此一个外部依赖，轻量稳定 |
| 测试框架 | Node 内置 test runner（`node --test`） | 零依赖，足够覆盖单元测试 |
| 消息结构 | 预留 `tool_use` 和 `tool_result` role | spec N1 要求，为后续工具调用做准备 |
| AbortController | 使用标准 AbortSignal | 原生的中断机制，不做抽象 |
