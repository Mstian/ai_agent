# MewCode 第一阶段 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `package.json` | 项目配置、依赖、脚本 |
| 新建 | `tsconfig.json` | TypeScript 严格模式、ESM 配置 |
| 新建 | `src/config/types.ts` | ProviderConfig 类型定义 |
| 新建 | `src/config/loader.ts` | ConfigManager：YAML 搜索、加载、校验 |
| 新建 | `src/config/config.test.ts` | ConfigManager 单元测试 |
| 新建 | `src/provider/types.ts` | Provider 接口、Message、StreamEvent 等类型 |
| 新建 | `src/provider/converter.ts` | MessageConverter：标准消息 → API 格式 |
| 新建 | `src/provider/anthropic.ts` | AnthropicProvider：SSE 请求与解析 |
| 新建 | `src/provider/openai.ts` | OpenAIProvider：SSE 请求与解析 |
| 新建 | `src/provider/factory.ts` | ProviderFactory：按 protocol 创建实例 |
| 新建 | `src/provider/provider.test.ts` | Provider 层单元测试 |
| 新建 | `src/chat/manager.ts` | ChatManager：对话上下文管理 |
| 新建 | `src/chat/chat.test.ts` | ChatManager 单元测试 |
| 新建 | `src/tui/app.tsx` | Ink App 入口组件 |
| 新建 | `src/tui/chat_view.tsx` | ChatView：消息列表 + 流式行 |
| 新建 | `src/tui/input_area.tsx` | InputArea：多行输入框 |
| 新建 | `src/tui/hooks/use_chat.ts` | useChat hook：封装 ChatManager + 流式状态 |
| 新建 | `src/tui/components/message_bubble.tsx` | MessageBubble 组件 |
| 新建 | `src/tui/components/streaming_line.tsx` | StreamingLine 组件 |
| 新建 | `src/main.ts` | 入口：串联配置→Provider→Chat→TUI |
| 新建 | `src/tui/cli.ts` | CLI 入口：解析参数、启停 Ink |

## T1: 项目骨架初始化

**文件：** `package.json`, `tsconfig.json`
**依赖：** 无
**步骤：**
1. 初始化 `package.json`：name 为 `mewcode`，type 为 `module`
2. 添加依赖：`ink@5`, `react@18`, `yaml`
3. 添加 dev 依赖：`@types/react`, `typescript`, `tsx`
4. 添加 scripts：`"dev": "tsx src/main.ts"`, `"test": "node --test --import tsx src/**/*.test.ts"`
5. 配置 `tsconfig.json`：strict 模式，target ES2022，module NodeNext，jsx react-jsx

**验证：** `npm install` 成功，`npx tsc --noEmit` 通过（文件创建后逐项验证）

## T2: Config 类型定义

**文件：** `src/config/types.ts`
**依赖：** 无
**步骤：**
1. 定义 `ProviderConfig` 类型，含 `protocol`、`model`、`base_url`、`api_key` 四个字段
2. `protocol` 为联合类型 `'anthropic' | 'openai'`
3. 导出类型

**验证：** TypeScript 编译无错误

## T3: ConfigManager 实现

**文件：** `src/config/loader.ts`
**依赖：** T2
**步骤：**
1. 实现 `ConfigManager.load()` 方法
2. 搜索逻辑：先 `cwd()`，再 `homedir()`
3. 用 `yaml` 包解析文件内容
4. 实现 `ConfigManager.validate()` 静态方法：检查四个必填字段、protocol 合法性
5. 未找到文件时抛出描述性错误，格式错误时抛出指出具体字段

**验证：** `cd src/config && npx tsx -e "import {ConfigManager} from './loader.js'; console.log(ConfigManager.load())"` 能正确读取测试配置

## T4: Config 单元测试

**文件：** `src/config/config.test.ts`
**依赖：** T3
**步骤：**
1. 测试：正确配置能被加载
2. 测试：项目目录配置优先于全局配置
3. 测试：无配置文件时抛错误
4. 测试：缺少必填字段时抛错误
5. 测试：非法 protocol 值时抛错误

**验证：** `node --test --import tsx src/config/config.test.ts` 全部通过

## T5: Provider 类型定义

**文件：** `src/provider/types.ts`
**依赖：** 无
**步骤：**
1. 定义 `Message` 接口：`role`, `content`
2. 定义 `ContentBlock` 接口：`type`, `text?`, `thinking?`, `tool_use_id?`, `tool_name?`, `tool_input?`
3. 定义 `StreamEvent` 联合类型：`TextDelta`, `ThinkingDelta`, `Done`, `Error`
4. 定义 `Provider` 接口：`protocol`, `model` 属性，`streamChat` 方法签名为 `AsyncGenerator<StreamEvent>`
5. `streamChat` 接受 `messages: Message[]` 和 `signal?: AbortSignal`

**验证：** TypeScript 编译无错误

## T6: MessageConverter 实现

**文件：** `src/provider/converter.ts`
**依赖：** T5
**步骤：**
1. 实现 `toAnthropicMessages(messages: Message[]): object[]`
   - 标准 Message → Anthropic Messages API 格式
   - system role 单独提取为顶层参数
2. 实现 `toOpenAIMessages(messages: Message[]): object[]`
   - 标准 Message → OpenAI Chat Completions API 格式
   - system role 保留在消息列表中
3. 处理 thinking block（Anthropic assistant 消息中可能包含）

**验证：** TypeScript 编译无错误；可在测试中验证转换结果形状

## T7: AnthropicProvider 实现

**文件：** `src/provider/anthropic.ts`
**依赖：** T5, T6
**步骤：**
1. 实现 `AnthropicProvider` 类，实现 `Provider` 接口
2. 构造器接收 `ProviderConfig`，保存 `base_url`、`model`、`api_key`
3. 实现 `streamChat`：
   - 用 `fetch` POST 到 `${base_url}/v1/messages`
   - 设置 headers：`x-api-key`、`anthropic-version`、`content-type`
   - 请求体含 `model`、`messages`、`stream: true`、`max_tokens`
   - 通过 `AbortSignal` 支持取消
   - 使用 `ReadableStream` reader 逐行读取 SSE
   - 解析 `message_start`、`content_block_start`、`content_block_delta`（含 `thinking_delta` 和 `text_delta`）、`content_block_stop`、`message_stop`
   - 每个 delta 转为 `StreamEvent` 并 yield
   - 流结束 yield `Done` 事件
   - 错误捕获，yield `Error` 事件

**验证：** TypeScript 编译无错误

## T8: OpenAIProvider 实现

**文件：** `src/provider/openai.ts`
**依赖：** T5, T6
**步骤：**
1. 实现 `OpenAIProvider` 类，实现 `Provider` 接口
2. 构造器接收 `ProviderConfig`
3. 实现 `streamChat`：
   - POST 到 `${base_url}/v1/chat/completions`
   - headers：`Authorization: Bearer ${api_key}`
   - 请求体含 `model`、`messages`、`stream: true`
   - 解析 SSE `data:` 行中的 JSON
   - `choices[0].delta.content` → `TextDelta`
   - `choices[0].delta.reasoning_content` → `ThinkingDelta`
   - `finish_reason === 'stop'` → `Done`
   - 错误 → `Error`

**验证：** TypeScript 编译无错误

## T9: ProviderFactory 实现

**文件：** `src/provider/factory.ts`
**依赖：** T2, T5, T7, T8
**步骤：**
1. 实现 `ProviderFactory.create(config: ProviderConfig): Provider`
2. `protocol === 'anthropic'` → 创建 `AnthropicProvider`
3. `protocol === 'openai'` → 创建 `OpenAIProvider`
4. 非法 protocol → 抛错

**验证：** `npx tsx -e "import {ProviderFactory} from './factory.js'; console.log(ProviderFactory.create({...}))"` 返回正确实例

## T10: Provider 层单元测试

**文件：** `src/provider/provider.test.ts`
**依赖：** T7, T8, T9
**步骤：**
1. 测试 ProviderFactory 创建 AnthropicProvider
2. 测试 ProviderFactory 创建 OpenAIProvider
3. 测试非法 protocol 抛错
4. 测试 MessageConverter 正确转换 user/assistant/system 消息
5. 用 mock fetch 测试 AnthropicProvider SSE 解析
6. 用 mock fetch 测试 OpenAIProvider SSE 解析

**验证：** `node --test --import tsx src/provider/provider.test.ts` 全部通过

## T11: ChatManager 实现

**文件：** `src/chat/manager.ts`
**依赖：** T5
**步骤：**
1. 实现 `ChatManager` 类
2. 构造器：存储 provider 引用，初始化空消息列表
3. `sendMessage`：
   - 创建 user Message 追加到列表
   - 复制当前消息列表传给 `provider.streamChat`
   - 收集 delta 内容拼接 assistant 回复
   - 透传所有 StreamEvent 给调用方
   - stream 结束后，将完整 assistant Message 追加到列表
4. `clear()`：清空消息列表
5. `getMessages()`：返回消息列表副本

**验证：** TypeScript 编译无错误

## T12: Chat 层单元测试

**文件：** `src/chat/chat.test.ts`
**依赖：** T11
**步骤：**
1. 创建 mock Provider（返回固定 StreamEvent 序列）
2. 测试 sendMessage 后消息列表长度增加
3. 测试 clear 后消息列表清空
4. 测试 getMessages 返回副本不影响内部状态
5. 测试 stream 中断后部分内容保留

**验证：** `node --test --import tsx src/chat/chat.test.ts` 全部通过

## T13: TUI 基础组件

**文件：** `src/tui/components/message_bubble.tsx`, `src/tui/components/streaming_line.tsx`
**依赖：** 无
**步骤：**
1. `MessageBubble`：显示单条消息，`role === 'user'` 显示 "You"，否则显示 "MewCode"
   - 用不同颜色区分双方
2. `StreamingLine`：显示当前正在流式输出的文本
   - 接收 `text: string` 和 `thinking: string` prop
   - thinking 用灰色/斜体显示，正常文本默认色

**验证：** TypeScript 编译无错误

## T14: useChat Hook

**文件：** `src/tui/hooks/use_chat.ts`
**依赖：** T11
**步骤：**
1. 实现 `useChat(chatManager: ChatManager)` hook
2. 管理状态：`messages`（历史消息）、`streamingText`（当前流式文本）、`streamingThinking`、`isStreaming`
3. `sendMessage(input: string)`：重置流式状态，遍历 `chatManager.sendMessage` 的异步迭代器
   - 每个 `TextDelta` 追加到 `streamingText`
   - 每个 `ThinkingDelta` 追加到 `streamingThinking`
   - `Done` 时将流式内容固化为一条 message 加入 `messages`，停止 streaming
   - `Error` 时显示错误信息
4. 支持 AbortController 取消
5. `clearChat()`：调用 `chatManager.clear()` 并重置 UI 状态

**验证：** TypeScript 编译无错误；Hook 返回的接口可供组件使用

## T15: TUI 视图组件

**文件：** `src/tui/chat_view.tsx`, `src/tui/input_area.tsx`
**依赖：** T13, T14
**步骤：**
1. `ChatView`：
   - 接收 `messages`、`streamingText`、`streamingThinking`、`isStreaming`
   - 渲染 `MessageBubble` 列表
   - 正在流式时在最下方渲染 `StreamingLine`
2. `InputArea`：
   - 渲染 Ink `TextInput` 组件，支持多行
   - `onSubmit` 时将内容传给父组件的回调
   - 处理 `/clear` 和 `/exit` 内置命令（不传给 ChatManager）

**验证：** TypeScript 编译无错误

## T16: App 入口与 CLI

**文件：** `src/tui/app.tsx`, `src/main.ts`, `src/tui/cli.ts`
**依赖：** T3, T9, T11, T15
**步骤：**
1. `app.tsx`：
   - 接收 `chatManager` prop
   - 组合 `ChatView` + `InputArea`
   - 用 `useChat` hook 连接状态
2. `main.ts`：
   - 串联流程：`ConfigManager.load()` → `ProviderFactory.create()` → `new ChatManager()` → Ink 渲染
   - 错误处理：配置加载失败时输出错误并退出
3. `cli.ts`：命令行入口点，解析参数，启动应用

**验证：** `npx tsx src/main.ts` 启动后看到 TUI 界面

## 执行顺序

```
T1 ──→ T2 ──→ T3 ──→ T4
                    │
T5 ──→ T6 ──→ T7 ──→ T9 ──→ T10
        │     │             /
        │     └── T8 ──────┘
        │
T11 ──→ T12
  │
T13 ──→ T14 ──→ T15 ──→ T16
```

## 依赖关系总结

- T1（项目骨架）→ 所有任务的基础
- T5（Provider types）→ T6, T7, T8, T11
- T7 + T8 → T9（ProviderFactory 需要两个实现）
- T5 → T11（ChatManager 依赖 Provider 类型）
- T13 + T14 → T15 → T16（TUI 自底向上构建）
- T3 + T9 + T11 + T15 → T16（入口串联所有层）

配置层（T2-T4）、Provider 层（T5-T10）、Chat 层（T11-T12）可并行开发。
TUI 层（T13-T16）依赖 Chat 层完成。
