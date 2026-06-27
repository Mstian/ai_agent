# MewCode 第十二阶段 · 子 Agent 系统 Spec

## 背景

主 Agent 处理复杂任务时经常需要同时做多件事（查资料、写代码、跑测试），单一线程的 ReAct 循环效率低。如果能把子任务委派给独立的子 Agent 并行执行，每个子 Agent 有干净上下文、受限工具和独立权限，主 Agent 只收结果摘要——上下文污染、token 浪费、工具冲突等问题都解决了。

## 目标

- 一个统一的 `agent` 工具，用 `type` 参数分流定义式和 Fork 式
- 角色用 Markdown + YAML frontmatter 定义，多来源按优先级覆盖
- 子 Agent 跑到底（run-to-completion），完成后异步通知主 Agent
- 后台任务管理器追踪子 Agent 状态和结果
- 工具过滤防无限嵌套

## 功能需求

### F1: agent 工具

一个 Tool 接口实现，参数：

```json
{
  "type": "defined" | "fork",
  "name": "code-reviewer",        // type=defined 时：角色名
  "prompt": "请审查 src/agent.ts", // 子 Agent 的任务描述
  "background": true              // 可选，是否后台执行
}
```

**分流逻辑：**
- `type: "defined"` → 加载预定义角色 → 新建对话 → 注入系统提示 → 跑到底
- `type: "fork"` → 继承父对话历史 → 复制工具集 → 首次请求命中缓存 → 跑到底
- Fork 式强制后台执行（`background` 参数忽略）

### F2: 角色定义

角色文件是 `.md`，YAML frontmatter + Markdown 正文：

```markdown
---
name: code-reviewer
description: 代码审查专家
tools: [read_file, glob, grep, run_command]
blocked_tools: [write_file, edit_file]
model: sonnet
max_iterations: 10
permission_mode: default
---

你是一个代码审查专家。审查代码时...
```

**字段说明：**
- `name`（必填）— 角色唯一标识
- `description`（必填）— 用途说明
- `tools`（可选）— 工具白名单，不填继承父 Agent 全部工具
- `blocked_tools`（可选）— 工具黑名单，在白名单基础上再排除
- `model`（可选）— 指定模型，`inherit`（默认）或 `haiku/sonnet/opus`
- `max_iterations`（可选）— 最大轮次，默认 10
- `permission_mode`（可选）— 权限模式，默认 `default`

正文是子 Agent 的系统提示，伴随整个生命周期。

### F3: 多来源加载 + 优先级覆盖

四级来源，高优先级覆盖低：

1. **插件级**（最低）— 内置 Skill 目录中的角色
2. **内置级** — `src/subagent/builtins/`
3. **用户级** — `~/.mewcode/subagents/`
4. **项目级**（最高）— `.mewcode/subagents/`

同名角色按优先级覆盖。解析失败跳过+警告。

### F4: 定义式 vs Fork 式

**定义式（defined）：**
- 新 ChatManager，messages 只有一条 system（角色正文）
- 工具集 = 角色白名单 - 黑名单 - 全局禁止（agent 工具本身）
- 从空白上下文开始，专注角色任务

**Fork 式（fork）：**
- 复制父 ChatManager 的全部 messages
- 复制父 Agent 的工具集（减去全局禁止）
- 首次 LLM 请求可命中 prompt cache（消息前缀不变）
- 适合"帮我同时做 X 和 Y"的并行场景
- 强制后台执行

### F5: 跑到底模式

子 Agent 在独立 Agent 实例中运行，非交互、不间断：

- 循环直到模型不再调工具（task_completed）或达到 max_iterations
- 不会弹出权限确认（子 Agent 权限模式在角色中预设）
- 工具调用结果留在子 Agent 内部，不污染主对话
- 完成后结果摘要返回主 Agent：
  ```
  [子Agent code-reviewer 完成] (8 轮, ~12K tokens)
  
  发现 3 个问题:
  1. agent.ts:145 — 未处理空指针
  2. ...
  ```

### F6: 工具过滤多层防线

三层防线确保子 Agent 只能访问允许的工具：

1. **全局禁止层** — `agent` 工具本身禁止传给子 Agent（防无限嵌套）
2. **角色限制层** — 角色的 `tools`（白名单）和 `blocked_tools`（黑名单）
3. **后台白名单层** — 后台任务只允许只读工具

过滤顺序：全局禁止 → 角色白名单 → 角色黑名单 → 后台白名单

### F7: 后台任务管理

**后台任务管理器**追踪所有运行中的子 Agent：

- `spawn(agent, prompt)` → 返回 taskId → 异步执行
- `getStatus(taskId)` → pending / running / done / error
- `getResult(taskId)` → 子 Agent 最终回复文本
- `listActive()` → 所有活跃任务

**进入后台的三种方式：**
1. 显式指定 `background: true`
2. 超时自动切后台（子 Agent 运行超过 30s 自动后台化）
3. 用户手动 `/bg` 切当前任务到后台
- Fork 式强制走后台

### F8: 基础设施共享

子 Agent 共享主 Agent 的：
- LLM 客户端（Provider 实例）
- Hook 引擎
- 文件系统（同一个 cwd）

子 Agent 隔离：
- 消息列表（ChatManager 独立）
- 权限状态（PermissionManager 独立或预设模式）
- Token 计数独立
- 文件读缓存独立

## 非功能需求

- N1: 子 Agent 启动延迟 < 50ms（不含 LLM 调用）
- N2: Fork 式首次请求缓存命中率 > 80%
- N3: 后台任务不阻塞主 Agent 交互

## 不做的事

- ❌ Worktree 文件隔离
- ❌ 多 Agent 团队编排
- ❌ 后台任务跨会话持久化
- ❌ 子 Agent 间直接通信
- ❌ 子 Agent 动态生成角色

## 验收标准

- AC1: 主 Agent 调用 `agent` 工具（defined 模式）启动子 Agent，子 Agent 完成后返回结果
- AC2: Fork 式子 Agent 继承父对话历史，首次请求命中缓存
- AC3: 角色白名单过滤生效，子 Agent 看不到 write_file 工具
- AC4: `agent` 工具不在子 Agent 的工具列表中（防无限嵌套）
- AC5: 项目级角色覆盖内置同名角色
- AC6: 后台任务异步执行不阻塞主 Agent
- AC7: 子 Agent 达到 max_iterations 时正常结束并返回结果
- AC8: 所有现有测试继续通过，类型检查零错误
