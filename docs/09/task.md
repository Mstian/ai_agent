# MewCode 第九阶段 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/commands/types.ts` | 命令系统类型 + UIContext 接口 |
| 新建 | `src/commands/registry.ts` | 命令注册中心 |
| 新建 | `src/commands/parser.ts` | 解析器 + 分发器 |
| 新建 | `src/commands/completer.ts` | Tab 补全 |
| 新建 | `src/commands/builtins.ts` | 10 个内置命令 |
| 新建 | `src/commands/commands.test.ts` | 命令系统测试 |
| 修改 | `src/main.ts` | 接入命令系统 + 实现 UIContext |

## T1: 命令系统类型定义

**文件：** `src/commands/types.ts`
**依赖：** 无
**步骤：**
1. 定义 `CommandType = 'local' | 'ui' | 'prompt'`
2. 定义 `CommandHandler = (ctx: UIContext, args: string) => void | Promise<void>`
3. 定义 `CommandDef` 接口（name, aliases, description, usage, type, argsHint, hidden, handler）
4. 定义 `UIContext` 接口（showMessage, showError, sendToAgent, setAgentMode, getAgentMode, getTokenUsage, getCurrentSessionId, getMemoryManager, clearScreen, requestExit, getAgent）
5. 定义 `ParseResult` 接口（commandName, args, raw）

**验证：** `npx tsc --noEmit` 通过

## T2: 命令注册中心

**文件：** `src/commands/registry.ts`
**依赖：** T1
**步骤：**
1. 实现 `CommandRegistry` 类，内部 `Map<string, CommandDef>` 映射
2. `register(def)` — 冲突检测（name/aliases 的 Set），冲突抛 `CommandConflictError`
3. `get(name)` — 按名称或别名查找
4. `getAll(includeHidden)` — 列出所有命令
5. `getNames(includeHidden)` — 列出所有名称（补全用）

**验证：** `npx tsc --noEmit` 通过；注册冲突抛错

## T3: 解析器 + 分发器

**文件：** `src/commands/parser.ts`
**依赖：** T2
**步骤：**
1. 实现 `CommandParser.parse(input)` — 识别 `/` 前缀 → 提取命令名和参数 → 命令名转小写
2. 实现 `CommandDispatcher.dispatch(input, ui)` —
   a. parser.parse() → null 则 return false
   b. registry.get(name) → null 则 ui.showError（含 /help 引导）→ return true
   c. 命中 → handler(ui, args) → return true

**验证：** `npx tsc --noEmit` 通过

## T4: Tab 补全

**文件：** `src/commands/completer.ts`
**依赖：** T2
**步骤：**
1. 实现 `CommandCompleter.complete(line)` —
   a. 仅当行以 `/` 开头且无空格时补全
   b. 取 `/` 后部分做前缀匹配
   c. 过滤隐藏命令
   d. 返回 `[匹配列表, 前缀]`

**验证：** `npx tsc --noEmit` 通过

## T5: 内置命令实现

**文件：** `src/commands/builtins.ts`
**依赖：** T1
**步骤：**
1. 实现 10 个命令的创建函数：
   - `/help` (local) — 遍历 registry.getAll() 格式化输出
   - `/compact` (ui) — ctx.getAgent()?.manualCompress()
   - `/clear` (ui) — ctx.clearScreen() + ctx.getAgent()?.clear()
   - `/plan` (ui) — ctx.setAgentMode('plan')
   - `/do` (ui) — ctx.setAgentMode('full')
   - `/session` (local) — 显示会话 ID、存档状态
   - `/memory` (local) — 显示长期记忆列表
   - `/permission` (ui) — 查看/切换权限模式（/permission strict|default|permissive）
   - `/status` (local) — 显示 Token 用量、模式、缓存信息
   - `/review` (prompt) — ctx.sendToAgent(reviewPrompt)
2. 实现 `registerAllBuiltins(registry)` 函数

**验证：** `npx tsc --noEmit` 通过

## T6: main.ts 接入

**文件：** `src/main.ts`
**依赖：** T3, T4, T5
**步骤：**
1. 创建 CommandRegistry + 注册内置命令
2. 创建 CommandDispatcher + CommandCompleter
3. 实现 UIContext 对象（桥接到 ChatManager、Agent、MemoryManager 等实例）
4. 在 `rl.on('line')` 开头加分流：`await dispatcher.dispatch(input, ui)` → true 则跳过 Agent
5. 设置 readline Tab 补全回调
6. 删除原硬编码 if/else 命令处理代码
7. 状态栏 showPrompt 联动模式标记（读取 agent.getMode()）

**验证：** `npm run dev` 启动，逐个测试 10 个命令

## T7: 测试

**文件：** `src/commands/commands.test.ts`
**依赖：** T2, T3, T4, T5
**步骤：**
1. Registry 注册/冲突检测/查找
2. Parser 解析斜杠/非斜杠/带参数/大小写
3. Dispatcher 分发命中和未命中
4. Completer 单匹配/多匹配/隐藏命令过滤
5. 内置命令 handler 逻辑（用 mock UIContext）

**验证：** `npm test` 全部通过

## 执行顺序

```
T1 ──→ T2 ──→ T3 ──→ T6
  │            │
  ├──→ T5 ────→│
  │            │
  └──→ T4 ──→ T6
                │
                └──→ T7
```

T2、T4、T5 可并行（都只依赖 T1）。T3 依赖 T2。T6 依赖 T3、T4、T5。T7 最后。
