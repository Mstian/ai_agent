# MewCode 第十一阶段 · Hook 系统 Spec

## 背景

目前 Agent 生命周期中的自动化行为分散在各处硬编码：权限检查、上下文压缩、记忆提取、Skill 指令注入等。每加一个新的自动化行为都要改 Agent 核心代码，且用户无法自定义——想加"每次读文件前自动格式化"或"工具调用失败后发 HTTP 通知"只能改源码。

需要一套声明式 Hook 机制：用「事件 + 条件 + 动作」三要素描述规则，在 Agent 生命周期的关键节点自动触发。YAML 声明式加载，用户可自定义，Hook 自身失败不中断 Agent。

## 目标

- 用事件驱动模型在 Agent 生命周期关键节点挂自动化动作
- 条件表达式复用权限规则匹配语法，支持 AND/OR 逻辑
- 工具执行前可拦截，拦截结果反馈给模型使其调整
- 四种动作类型：命令、提示词注入、HTTP 请求、子 Agent（占位）
- YAML 文件声明式配置，启动时集中校验

## 功能需求

### F1: 三要素规则模型

每条 Hook 规则由三要素组成：

```yaml
- event: pre_tool_execute
  if:
    tools: [run_command]
    matchMode: all
    conditions:
      - field: command
        pattern: "rm *"
  action:
    type: command
    command: echo "拦截了危险命令"
```

- `event`（必填）— 触发时机
- `if`（可选）— 条件表达式，省略表示无条件触发
- `action`（必填）— 要执行的动作

### F2: 生命周期事件

四层 + 系统级：

| 事件 | 层级 | 说明 |
|------|------|------|
| `session_start` | 会话级 | 新会话开始 |
| `session_end` | 会话级 | 会话结束 |
| `turn_start` | 轮次级 | 每轮 Agent 循环开始 |
| `turn_end` | 轮次级 | 每轮 Agent 循环结束 |
| `message_received` | 消息级 | 收到用户消息后 |
| `pre_tool_execute` | 工具级 | 工具执行前（**可拦截**） |
| `post_tool_execute` | 工具级 | 工具执行后 |
| `agent_done` | 系统级 | Agent 任务完成/停止 |
| `error` | 系统级 | Agent 出现错误 |

### F3: 条件表达式

复用权限规则匹配语法：

- **精确匹配**：`pattern: "run_command"`
- **反向匹配**：`pattern: "!write_file"` — 排除
- **正则匹配**：`pattern: "/rm\\s+-rf/"` — `/pattern/` 包裹
- **Glob 匹配**：`pattern: "*.test.ts"`

**逻辑组合：** `matchMode: "all"`（全部满足，AND）或 `matchMode: "any"`（任一满足，OR），不混用。

**条件字段：** `tools`（工具名列表）、`conditions`（字段级匹配，如 `command`、`file_path`、`tool_use_id` 等）

### F4: 四种动作类型

**command（Shell 命令）：**
```yaml
action:
  type: command
  command: "echo 'Hello'"
  timeout: 5000
```

**prompt（提示词注入）：**
```yaml
action:
  type: prompt
  text: "请先确认用户意图再执行"
  position: before  # before=注入到消息前, after=消息后
```

**http（HTTP 请求）：**
```yaml
action:
  type: http
  url: "https://hooks.example.com/notify"
  method: POST
  headers:
    Content-Type: application/json
  body: '{"event": "{{event}}", "tool": "{{tool_name}}"}'
```

**agent（子 Agent，占位）：**
```yaml
action:
  type: agent
  prompt: "审查以下输出..."
  model: claude-sonnet-4-6
```

### F5: 拦截能力

- `pre_tool_execute` 事件支持拦截
- Hook 返回 `{ allowed: false, reason: "..." }` 时：
  - 工具不执行
  - 拒绝原因作为 tool_result 反馈给模型
  - 模型可以根据原因调整行为
- 其他事件不支持拦截，只执行副作用

### F6: 执行控制

每条 Hook 可配置：

- `runOnce: true` — 整个会话只跑一次
- `async: true` — 后台执行不阻塞（拦截事件忽略此配置）
- `timeout: 5000` — 命令超时时间（毫秒）

### F7: 错误隔离

- Hook 执行失败只记日志到 stderr，绝不抛异常
- 一个 Hook 失败不影响其他 Hook 和 Agent 主流程
- YAML 解析失败的单个 Hook 跳过并警告，不阻断整体加载

### F8: 配置加载

- 配置文件：`.mewcode/hooks.yaml`（项目级）、`~/.mewcode/hooks.yaml`（用户级）
- 两层合并，项目级 Hook 追加在用户级之后
- 启动时集中校验：event 和 action 必填、action.type 合法等
- 非法 Hook 跳过 + 打印警告

## 非功能需求

- N1: Hook 匹配和执行在 10ms 内完成（不含 Hook 自身的命令/HTTP 耗时）
- N2: pre_tool_execute 拦截不增加工具执行延迟（同步检查）
- N3: 配置文件解析失败不阻断启动

## 不做的事

- ❌ 子 Agent 动作的真实运行（占位，等 SubAgent 章节对接）
- ❌ runOnce 标记的持久化（重启后重置）
- ❌ Hook 执行顺序的显式优先级（按配置文件中的顺序执行）
- ❌ Hook 热重载（需重启生效）
- ❌ 条件表达式中的复杂嵌套（只支持单层 conditions 数组）

## 验收标准

- AC1: 配置 pre_tool_execute Hook 后，每次工具执行前都触发检查
- AC2: pre_tool_execute Hook 返回拦截时，工具不执行，拒绝原因反馈给模型
- AC3: 条件表达式支持精确/反向/正则/glob 四种匹配
- AC4: matchMode: "all" 要求全部条件满足，"any" 任一满足
- AC5: 四种动作类型均可声明，非法类型启动校验报错
- AC6: Hook 执行失败时仅打印日志，Agent 正常继续
- AC7: YAML 解析错误只跳过该 Hook，不阻断整体
- AC8: 支持的模板变量（{{event}}、{{tool_name}} 等）正确替换
- AC9: 所有现有测试继续通过，类型检查零错误
