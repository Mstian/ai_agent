# MewCode 第十阶段 · Skill 系统 Spec

## 背景

目前用户反复输入相同的提示词（如"帮我写规范的 commit message"、"审查当前变更"），每次都要重新描述，浪费 token 且格式不统一。已有的 `/review` 命令虽然注入了代码审查 prompt，但它是硬编码的，无法扩展。

需要一套 Skill 机制：把可复用的 AI 操作封装成独立文件，附带元信息和工具约束，支持按需加载和两种执行模式。让 Agent 像调用"能力包"一样激活专属指令和工具集。

## 目标

- 用 YAML frontmatter + Markdown 正文定义 Skill，放在三级目录中按优先级覆盖
- 两阶段加载：启动时只注入名字和说明（省 token），用时再由内置工具加载完整指令
- 加载后的指令钉在上下文显眼位置，支持多 Skill 同时激活
- 两种执行模式：共享对话和独立对话
- 加载时自动注册为斜杠命令，/clear 时清掉已激活 Skill
- 提供 commit、review、test 三个内置样板

## 功能需求

### F1: Skill 文件格式

单个 Skill 是一个 `.md` 文件，YAML frontmatter + Markdown 正文：

```markdown
---
name: commit
description: 分析代码变更并生成规范的 commit message
tools: [read_file, run_command, glob, grep]
mode: shared
---

你是一个 commit message 生成器...
```

**frontmatter 字段：**
- `name`（必填）— 唯一标识，kebab-case
- `description`（必填）— 一句话说明，启动时注入上下文
- `tools`（可选）— 可见工具白名单，限制模型可用工具范围
- `mode`（可选）— 执行模式：`shared`（共享对话，默认）或 `isolated`（独立对话）
- `history`（可选）— 独立模式下携带的历史消息数（默认 10）
- `model`（可选）— 指定使用的模型

正文是发给模型的 SOP 指令，支持 `{{param}}` 占位符替换用户传入的参数。

### F2: 三级存放与优先级

1. **内置** — `<mewcode>/src/skills/builtins/`（编译内嵌，最低优先级）
2. **用户级** — `~/.mewcode/skills/`
3. **项目级** — `<project>/.mewcode/skills/`（最高优先级）

同名 Skill 按优先级覆盖：项目级 > 用户级 > 内置。解析失败的单个文件跳过并打印警告，不阻断整体加载。

### F3: 两阶段加载

**阶段一（启动时）：** 扫描所有 Skill 文件，解析 frontmatter 中的 name 和 description，注入到 system prompt 的 `active_skills` 模块：
```
可用 Skill:
- commit: 分析代码变更并生成规范的 commit message
- review: 审查当前代码变更
- test: 为变更生成测试用例

输入 /<name> 或让 AI 调用 skill_load 工具来激活
```

模型能看到 Skill 列表，但看不到完整指令——省 token。

**阶段二（激活时）：** 模型调用 `skill_load` 工具（或用户输入斜杠命令），加载指定 Skill 的完整指令和工具约束。加载后指令钉在上下文最前面，每轮重建 system prompt 时都在。

### F4: skill_load 系统工具

一个内置工具，实现 Skill 的按需激活：

- **名称**：`skill_load`
- **参数**：`{ name: string, params?: Record<string, string> }`
- **类别**：`readonly`（仅读取本地文件）
- **行为**：
  1. 根据 name 查找 Skill 文件（按优先级）
  2. 读取 frontmatter + 正文
  3. 正文中 `{{param}}` 替换为用户传入的 params
  4. 将完整指令注入到上下文（钉在 system prompt 最前面）
  5. 如果 Skill 声明了 tools 白名单，收窄当前可用工具
  6. 自动注册为斜杠命令（`/<skill_name>`）
- **系统级**：此工具不受任何白名单限制，永远可用

### F5: 工具白名单

Skill 声明 `tools` 字段后，激活时收窄 Agent 可用工具：

- 只有白名单中的工具对模型可见
- `skill_load` 始终可见（系统级工具）
- 启动时校验：白名单中不存在的工具名立即报错
- 多个 Skill 同时激活时，白名单取并集
- 所有 Skill 卸载后恢复全工具列表

### F6: 两种执行模式

**shared（共享对话）：**
- Skill 指令注入当前对话
- 模型在正常 ReAct 循环中执行
- 工具调用结果留在主对话历史中

**isolated（独立对话）：**
- 开一个新的 ChatManager 实例，独立于主对话
- 可选携带最近 N 条历史（由 `history` 字段指定）
- Skill 完整执行完毕后，将结果摘要回流到主对话
- 独立对话中的工具调用细节不污染主历史

### F7: 生命周期管理

- `/clear` 时清空所有已激活的 Skill，恢复全工具列表
- 支持 `/skill unload <name>` 卸载单个 Skill
- 支持 `/skill list` 列出已激活的 Skill
- Skill 文件热更新：文件变更后下次加载时自动使用新内容

### F8: 目录型 Skill

一个目录作为一个 Skill 包，包含：
- `skill.md` — 入口 Markdown（frontmatter + 正文）
- `tools/` — 专属工具的实现脚本（每个工具一个文件）
- `schemas/` — 工具参数 JSON Schema

加载时不仅注入指令，还把专属工具注册到 ToolRegistry。目录型 Skill 适合复杂的可分发能力包。

### F9: 三个内置 Skill

1. **commit** — 分析 `git diff` 输出，生成规范的多行 commit message
2. **review** — 代码审查，检查正确性、安全性、性能、可读性
3. **test** — 为当前变更生成对应的测试用例

## 非功能需求

- N1: 启动扫描所有 Skill 文件 < 100ms
- N2: skill_load 调用 < 10ms（纯文件读取 + 缓存）
- N3: 工具白名单校验在启动时完成，不拖到运行时

## 不做的事

- ❌ Skill 市场分发和版本管理
- ❌ Skill 依赖管理（Skill A 依赖 Skill B）
- ❌ Skill 热重载（文件变更自动检测）
- ❌ Skill 权限隔离（沙箱执行）
- ❌ 动态生成 Markdown 提示词

## 验收标准

- AC1: 启动时 system prompt 包含可用 Skill 名称和说明（阶段一）
- AC2: 模型调用 skill_load("commit") 后，完整 Skill 指令注入上下文
- AC3: Skill 激活后自动注册为斜杠命令，输入 `/commit` 直接激活 commit skill
- AC4: Skill 声明 tools 白名单后，激活时模型只能看到白名单中的工具
- AC5: 同名 Skill 项目级覆盖用户级，用户级覆盖内置
- AC6: isolated 模式 Skill 执行时不污染主对话历史
- AC7: `/clear` 清空所有已激活 Skill
- AC8: 白名单中不存在的工具名启动时报错
- AC9: 目录型 Skill 加载后专属工具注册到 ToolRegistry
- AC10: 所有现有测试继续通过，类型检查零错误
