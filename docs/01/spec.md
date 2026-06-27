# MewCode 第一阶段 · 纯对话 Spec

## 背景

从零构建一个终端 AI 编程助手 MewCode（类比 Claude Code）。
第一阶段聚焦核心对话能力：用户启动 MewCode → 进入终端交互界面 → 输入问题 → 调用大模型 API → 流式输出回复。
支持多轮对话记忆，不涉及 tool use、文件操作等 agent 能力。

## 目标

- 提供一个可用的终端 AI 对话工具
- 建立可扩展的 Provider 架构，方便后续接入更多模型
- 为后续阶段（tool use、代码编辑等）打好基础

## 功能需求

### F1: 配置管理
- 支持 `.mewcode.yaml`（项目目录优先）和 `~/.mewcode.yaml`（全局兜底）
- 四个核心字段：`protocol`（anthropic / openai）、`model`、`base_url`、`api_key`
- 启动时自动加载配置，配置缺失或格式错误时给出明确提示

### F2: Provider 抽象层
- 定义统一的 Provider 接口（发送消息、流式接收回复）
- 实现 Anthropic 和 OpenAI 两个 Provider
- 通过配置文件中的 `protocol` 字段决定使用哪个 Provider
- Provider 层不依赖 TUI，可以独立测试

### F3: 流式对话
- 用户输入问题，MewCode 调用 Provider 发送请求
- 回复内容通过 SSE 流式接收，逐字打印到终端
- 支持中途取消（Ctrl+C 中断当前回复）

### F4: Extended Thinking（Anthropic）
- 当使用 Anthropic 协议且模型支持 extended thinking 时，思考过程直接流式输出
- 思考内容和正常回复在视觉上有区分（如用颜色或前缀标记）

### F5: 多轮对话
- 对话上下文在内存中维护
- 每次请求携带之前的所有消息（user + assistant）
- 退出程序后对话历史不保留
- 支持 `/clear` 命令清空当前对话上下文

### F6: 终端交互界面（TUI）
- Ink + React 构建
- 上方对话区域：显示用户消息和 AI 回复，支持滚动
- 下方输入区域：多行输入，Enter 发送
- 流式渲染：AI 回复逐字出现

### F7: 退出程序
- 输入 `/exit` 或 Ctrl+C/Ctrl+D 退出

## 非功能需求

### N1: 可扩展性
- 新增一个 Provider 只需实现统一接口，无需修改 TUI 或配置加载逻辑
- 接口设计预留后续 tool use 的扩展空间（消息结构支持 tool role，但当前不实现）

### N2: 可靠性
- API 调用失败时显示错误信息，不崩溃
- 网络超时（默认 120 秒）后优雅退出请求
- 流式连接中断时，已接收的内容保留在屏幕上

### N3: 性能
- 流式首字延迟（TTFT）仅取决于 API 响应速度，客户端不做额外缓冲
- 终端渲染不卡顿，流式到达速度和渲染速度匹配

### N4: 可维护性
- TypeScript 严格模式，所有类型明确定义
- 代码用中文注释
- Provider 层可脱离 TUI 独立测试

### N5: 兼容性
- 支持 macOS 和 Linux 终端
- 支持 Node.js 20+

## 不做的事

- ❌ Tool use / function calling（留给后续阶段）
- ❌ 文件读写、代码编辑（留给后续阶段）
- ❌ 对话历史持久化（退出即丢失）
- ❌ 多 Provider 同时使用或运行时切换（一次只用一种）
- ❌ 语法高亮、Markdown 渲染（纯文本输出）
- ❌ 多会话管理、会话切换
- ❌ 配置文件热加载（启动时加载一次）
- ❌ 非 Anthropic 协议的 extended thinking（OpenAI 的 reasoning 留给后续）

## 验收标准

- AC1: 启动 MewCode，进入 TUI 界面，看到输入提示符
- AC2: 输入问题，看到回复流式逐字打印
- AC3: 连续提问 3 轮，AI 能正确引用之前说过的内容
- AC4: 输入 `/clear`，对话上下文清空，AI 不再记得之前的内容
- AC5: 输入 `/exit` 或 Ctrl+C，程序正常退出
- AC6: 配置文件缺失时，启动报错并给出明确提示
- AC7: 切换 `protocol` 为 openai，使用 OpenAI 模型正常对话
- AC8: 使用 Anthropic 且启用 extended thinking 时，思考过程可见
- AC9: 流式回复中途按 Ctrl+C，中断当前回复但不退出程序
