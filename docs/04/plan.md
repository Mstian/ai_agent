# MewCode 第四阶段 Plan

## 架构概览

在三阶段架构基础上，新增提示工程层。Agent 不再直接拼 system prompt 字符串，而是通过 PromptManager 管理模块化提示：

```
main.ts
  │
agent/agent.ts                    (修改：集成 PromptManager)
  │
  ├── prompt/                     ← 新增
  │   ├── types.ts                — PromptModule、ModuleKey、InjectionSpec
  │   ├── modules.ts              — 7 个固定模块 + 可选模块的内容定义
  │   ├── builder.ts              — PromptBuilder：按优先级拼装模块
  │   ├── manager.ts              — PromptManager：模板替换、system 消息注入、轮次控制
  │   └── cache_monitor.ts        — CacheMonitor：解析 Anthropic 缓存字段
  │
  ├── chat/manager.ts             (不变)
  ├── provider/
  │   └── anthropic.ts            (修改：暴露缓存字段到 StreamEvent)
  │
  └── tools/                      (修改：6 个工具 description 强化关键规则)
```

## 核心数据结构

### PromptModule

```typescript
interface PromptModule {
  key: ModuleKey;           // 模块唯一标识
  priority: number;         // 优先级（越小越靠前）
  content: string;          // 模块内容（可含 {{variable}} 模板变量）
  enabled: boolean;         // 是否启用
}
```

**模块 Key 枚举：**
```typescript
type ModuleKey =
  | 'identity'           // 身份
  | 'constraints'        // 系统约束
  | 'task_mode'          // 任务模式
  | 'actions'            // 动作执行
  | 'tool_use'           // 工具使用
  | 'tone'               // 语气风格
  | 'output'             // 文本输出
  | 'custom_instructions'// 自定义指令（可选）
  | 'active_skills'      // 已激活 Skill（可选）
  | 'long_term_memory';  // 长期记忆（可选）
```

### PromptBuilder

```typescript
class PromptBuilder {
  private modules: Map<ModuleKey, PromptModule>;

  register(module: PromptModule): void;
  enable(key: ModuleKey): void;
  disable(key: ModuleKey): void;

  // 按 priority 排序 → 过滤 enabled → 拼接
  build(variables?: Record<string, string>): string;
}
```

### PromptManager

```typescript
class PromptManager {
  private builder: PromptBuilder;
  private lastInjectionTurn: Map<string, number>;

  // 获取顶层 system prompt（稳定内容，供 Provider 使用）
  getSystemPrompt(variables?: Record<string, string>): string;

  // 生成运行时 system 消息（变化内容）
  // turn: 当前轮次，用于轮次注入频率控制
  generateSystemMessages(
    turn: number,
    context: InjectionContext,
  ): SystemMessage[];

  // 更新模块内容（如 mode 切换时更新 task_mode 模块）
  updateModule(key: ModuleKey, content: string): void;
}
```

### InjectionContext

```typescript
interface InjectionContext {
  mode: 'full' | 'plan';      // 当前模式
  cwd: string;                 // 工作目录
  gitBranch?: string;          // 当前 git 分支
  date: string;                // 当前日期
}
```

### SystemMessage（注入消息）

```typescript
interface SystemMessage {
  role: 'system';
  content: string;  // 格式：[SystemInstruction]\ntype: xxx\n---\n<content>
}
```

### CacheInfo（缓存命中信息）

```typescript
interface CacheInfo {
  cacheCreationTokens: number;   // 本次创建缓存的 token 数
  cacheReadTokens: number;       // 命中缓存的 token 数
  inputTokens: number;           // 总输入 token 数
}
```

### StreamEvent 扩展

在 TurnEndEvent 和 AgentDoneEvent 中增加可选 cacheInfo 字段。

AnthropicProvider 在 message_start 和 message_delta 事件中提取 usage 信息，
通过新增的 CacheInfo 结构暴露。

## 模块设计

### 模块 K: 提示类型定义 (types.ts)

**职责：** PromptModule、ModuleKey、InjectionContext、SystemMessage、CacheInfo

**对外接口：** 导出所有类型

### 模块 L: 固定模块内容 (modules.ts)

**职责：** 定义 7 个固定模块 + 可选模块的默认内容

**固定模块内容要点：**

**identity（priority=1）：**
```
你是 MewCode，一个终端 AI 编程助手。
你能读取代码、搜索文件、执行命令、编辑文件。
```

**constraints（priority=2）：**
```
工作目录: {{cwd}}
- 所有文件操作必须在工作目录范围内
- 不能访问工作目录以外的文件
- 不能执行危险的 shell 命令
```

**task_mode（priority=3）：**
```
当前模式: {{mode_label}}
{{mode_rules}}
```
mode 为 'plan' 时 mode_rules 为详细的规划模式规则，'full' 时为执行模式规则。

**actions（priority=4）：**
```
执行任务时遵循以下流程：
1. 先理解用户需求，必要时先调研代码
2. 制定分步计划
3. 逐步执行，每步验证结果
4. 完成后总结所做的工作
```

**tool_use（priority=5）：**
```
工具使用原则：
- 优先使用专用工具而非 shell 命令（如 glob 代替 find，grep 代替 grep 命令）
- 编辑文件前必须先 read_file 查看当前内容
- 创建文件前先检查是否已存在
- 工具调用失败时，分析错误原因并调整参数重试
```

**tone（priority=6）：**
```
用中文回答。回答简洁精准，不要过度解释。
```

**output（priority=7）：**
```
支持 Markdown 格式输出。代码块标注语言。
错误报告格式：先说明问题，再给出建议。
```

### 模块 M: PromptBuilder (builder.ts)

**职责：** 注册、启用/禁用、按优先级拼装

**拼装逻辑：**
1. 过滤 enabled 模块
2. 按 priority 升序排列
3. 每个模块 content 用 `\n\n` 连接
4. 可选：调用方传入 variables 做模板替换（`{{key}}` → value）

### 模块 N: PromptManager (manager.ts)

**职责：** 提示系统的总入口，管理 Builder + 生成 system 消息

**getSystemPrompt()：** 委托给 builder.build()，传入环境变量

**generateSystemMessages(turn, context)：** 生成需要注入的 system 消息列表：
1. 首轮（turn=1）：注入完整的环境信息 + mode 规则
2. 每 3 轮：重复注入 mode 规则（完整版）
3. 其余轮次：注入一行精简提醒（如果是 plan mode）
4. 返回 system 消息数组

**轮次注入频率控制：**
```typescript
generateSystemMessages(turn, context):
  messages = []
  
  if turn === 1:
    // 首轮：注入环境信息 + mode 完整规则
    messages.push(environmentMessage(context))
    messages.push(modeMessage(context, 'full'))
  
  else if turn % 3 === 0:
    // 每 3 轮：重复 mode 完整规则
    messages.push(modeMessage(context, 'full'))
  
  else:
    // 其余轮次：精简提醒
    if context.mode === 'plan':
      messages.push(modeReminder(context))
  
  return messages
```

**updateModule()：** 更新指定模块的 content，用于模式切换时动态修改 task_mode 模块。

### 模块 O: CacheMonitor (cache_monitor.ts)

**职责：** 从 Anthropic API 响应中提取缓存命中信息

**实现：**
- 在 AnthropicProvider 的 message_start 事件中解析 `usage` 字段
- message_start 的 `message.usage` 包含 `cache_creation_input_tokens` 和 `cache_read_input_tokens`
- 将这些字段收集到 CacheInfo 结构
- 在 done 事件中附加 CacheInfo

**StreamEvent 扩展：** DoneEvent 增加可选 `cacheInfo?: CacheInfo` 字段。

### 模块 B''：Provider 扩展

**AnthropicProvider：**
- message_start 事件解析 `message.usage` 提取缓存字段
- done 事件携带 cacheInfo
- 不做额外请求，纯解析

### 模块 G'：Agent 扩展

**Agent.run() 改造：**
1. 构造 InjectionContext（mode、cwd、date）
2. 每轮 LLM 调用前：
   a. 调用 promptManager.generateSystemMessages(turn, context)
   b. 将返回的 system 消息注入到 messages 数组（在最新 user 消息之后、LLM 调用之前）
3. 收到 done 事件时提取 cacheInfo → 附加到 turn_end / agent_done

**Agent.setMode() 改造：**
- 调用 promptManager.updateModule('task_mode', newContent) 更新模式相关内容

### 模块 F'：工具描述强化

6 个工具的 description 字段强化关键规则：

| 工具 | 当前 description | 强化后 |
|------|-----------------|--------|
| edit_file | "精确替换文件中的特定文本段落..." | "精确替换文件中的特定文本段落。**使用前必须先 read_file 查看文件当前内容**，old_string 必须在文件中出现恰好一次..." |
| write_file | "创建新文件或覆盖已有文件..." | "创建新文件或覆盖已有文件。**如果文件已存在，先 read_file 确认内容**。会递归创建不存在的父目录。" |
| run_command | "执行 shell 命令并返回输出..." | "执行 shell 命令并返回输出。**优先使用 glob/grep 等专用工具**，仅在没有专用工具时使用此命令。" |

### 模块 D'''：TUI 扩展

main.ts 变化最小：
- 创建 PromptManager 并注入 Agent
- agent_done 事件中如有 cacheInfo，显示缓存命中率
- 如 `[缓存命中: 85% · 节省 12000 tokens]`

## 模块交互

### 一次 LLM 调用的提示系统流程

```
Agent.run()
  │
  ├─ 1. 构建顶层 system prompt（稳定，可缓存）
  │     promptManager.getSystemPrompt({cwd, date})
  │     → "你是 MewCode...\n\n工作目录: /Users/...\n\n..."
  │     → 传给 ChatManager constructor（创建时一次）
  │
  ├─ 2. 每轮 LLM 调用前
  │     promptManager.generateSystemMessages(turn, context)
  │     → [{role:'system', content:'[SystemInstruction]\ntype: mode_switch\n...'}]
  │     → 注入到 messages 数组
  │
  ├─ 3. 调用 ChatManager.callLLM(tools, signal)
  │     → 请求发到 Anthropic API
  │     → cache_read_input_tokens = 12000 (system prompt + tools 命中缓存)
  │
  └─ 4. 收到 done 事件
        cacheInfo = { cacheReadTokens: 12000, inputTokens: 15000, ... }
        → 附加到 turn_end / agent_done
```

## 文件组织

```
mewcode/
├── src/
│   ├── main.ts                  # 修改：创建 PromptManager 注入 Agent
│   ├── prompt/                  # 新建
│   │   ├── types.ts             # PromptModule、InjectionContext 等类型
│   │   ├── modules.ts           # 7 个固定模块 + 可选模块的默认内容
│   │   ├── builder.ts           # PromptBuilder：注册 + 拼装
│   │   ├── manager.ts           # PromptManager：模板替换 + system 消息注入
│   │   └── cache_monitor.ts     # CacheMonitor：解析 Anthropic 缓存字段
│   ├── agent/
│   │   ├── agent.ts             # 修改：集成 PromptManager
│   │   └── types.ts             # 修改：TurnEndEvent/AgentDoneEvent 加 cacheInfo
│   ├── provider/
│   │   ├── types.ts             # 修改：DoneEvent 加 cacheInfo
│   │   └── anthropic.ts         # 修改：解析 message_start usage 字段
│   ├── tools/                   # 修改：6 个工具 description 强化
│   ├── chat/                    # 不变
│   └── config/                  # 不变
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 稳定指令通道 | 顶层 system 参数 | Anthropic 的 Prompt Cache 缓存顶层 system，不缓存 messages 中的 system 消息 |
| 变化指令通道 | system 角色消息（非 user） | 模型不会回复 system 消息，且不破坏顶层 system 的缓存 |
| 模块拼装 | 按 priority 排序 + 空行分隔 | 简单直观，priority 即顺序 |
| 模板变量 | 简单的 `{{key}}` 替换 | 不需要模板引擎，够用 |
| 缓存字段来源 | message_start 的 message.usage | Anthropic 在此事件中返回缓存信息，无需额外请求 |
| 轮次注入策略 | 首轮完整 + 每3轮重复 + 其余精简 | 用户确认的偏好 |
| 注入标记格式 | `[SystemInstruction]\ntype: xxx\n---\ncontent` | 简单可解析，模型不会混淆 |
