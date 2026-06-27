# MewCode 第九阶段 Plan

## 架构概览

新增 `src/commands/` 模块，位于用户输入和 Agent 之间：

```
用户输入
  │
  ├── Parser.parse(input) → 斜杠命令? → ParseResult
  │     │
  │     ├── 是命令 → Dispatcher.dispatch(result, ui)
  │     │              → CommandRegistry.get(name) → handler(ui, args)
  │     │
  │     └── 非命令 → 送入 Agent.run(input)
  │
  └── Tab 补全 → Completer.complete(input) → 补全结果
```

**核心原则：** 命令处理器通过 UIContext 接口操作外部世界，不直接依赖 main.ts 或具体渲染框架。

## 核心数据结构

### CommandType（命令类型）

```typescript
type CommandType = 'local' | 'ui' | 'prompt';
```

- `local`：纯本地操作，不涉及界面状态和对话（如 /help, /status）
- `ui`：改变界面状态（如 /clear, /plan）
- `prompt`：将预设提示词注入对话交给 AI（如 /review）

### CommandDef（命令定义）

```typescript
interface CommandDef {
  name: string;             // 主名称（小写）
  aliases?: string[];       // 别名列表
  description: string;      // 简短描述（/help 展示用）
  usage?: string;           // 用法示例
  type: CommandType;        // 命令类型
  argsHint?: string;        // 参数提示（/help 展示用）
  hidden?: boolean;         // 是否隐藏（不参与 /help 和补全）
  handler: CommandHandler;  // 处理函数
}

type CommandHandler = (ctx: UIContext, args: string) => void | Promise<void>;
```

### UIContext（界面控制接口）

```typescript
interface UIContext {
  /** 显示普通消息 */
  showMessage(text: string): void;
  /** 显示错误消息 */
  showError(text: string): void;
  /** 将文本作为用户消息送入 Agent */
  sendToAgent(text: string): void;
  /** 切换 Agent 模式 */
  setAgentMode(mode: 'full' | 'plan'): void;
  /** 获取当前 Agent 模式 */
  getAgentMode(): 'full' | 'plan';
  /** 获取 Token 用量信息 */
  getTokenUsage(): { estimated: number };
  /** 获取当前会话 ID */
  getCurrentSessionId(): string | null;
  /** 获取 MemoryManager */
  getMemoryManager(): MemoryManager | null;
  /** 清屏 */
  clearScreen(): void;
  /** 退出程序 */
  requestExit(): void;
  /** 获取 Agent 引用（用于 /compact 等） */
  getAgent(): Agent | null;
}
```

### ParseResult（解析结果）

```typescript
interface ParseResult {
  commandName: string;  // 已转小写
  args: string;         // 原始参数字符串（去除命令名后的部分）
  raw: string;          // 原始输入
}
```

## 模块设计

### 模块 A: types.ts

**职责：** 命令系统所有类型定义。
**依赖：** 无

### 模块 B: CommandRegistry（registry.ts）

**职责：** 命令注册、冲突检测、查找。

```typescript
class CommandRegistry {
  register(def: CommandDef): void;         // 注册 + 冲突检测
  get(name: string): CommandDef | null;    // 按名称或别名查找
  getAll(includeHidden?: boolean): CommandDef[];  // 列出所有
  getNames(includeHidden?: boolean): string[];    // 列出名称（补全用）
}
```

**冲突检测逻辑：**
- 注册时收集所有已注册的名称和别名到一个 Set
- 新命令的 name 和每个 alias 都检查是否在 Set 中
- 冲突 → 抛出 `CommandConflictError`（含冲突命令名和别名信息）

### 模块 C: Parser + Dispatcher（parser.ts）

**职责：** 解析输入、分发执行。

```typescript
class CommandParser {
  parse(input: string): ParseResult | null;
}

class CommandDispatcher {
  constructor(registry: CommandRegistry);
  dispatch(input: string, ui: UIContext): Promise<boolean>;
  // 返回 true = 已处理为命令，false = 非命令应送 Agent
}
```

**解析逻辑：**
1. trim 后不以 `/` 开头 → 返回 null（非命令）
2. 找到第一个空格，之前是 commandName，之后是 args
3. commandName 转小写
4. registry.get(name) → null 则显示 `/help` 引导

### 模块 D: Completer（completer.ts）

**职责：** Tab 补全逻辑。

```typescript
class CommandCompleter {
  constructor(registry: CommandRegistry);
  complete(line: string): [string[], string];
  // 返回 [匹配列表, 已匹配的前缀]
}
```

**补全逻辑：**
1. 仅当行以 `/` 开头且无空格时触发补全
2. 取 `/` 后部分做前缀匹配（registry.getNames()）
3. 过滤隐藏命令
4. 单匹配 → 返回完整命令名
5. 多匹配 → 返回所有匹配项列表（由调用方展示菜单）
6. 零匹配 → 返回原始输入

### 模块 E: builtins.ts

**职责：** 十个内置命令的定义和实现。

每个命令是一个工厂函数，返回 CommandDef：
```typescript
function createHelpCommand(): CommandDef;
function createCompactCommand(): CommandDef;
// ...
```

命令按类型组织，处理函数通过 UIContext 接口操作外部世界。

### 模块 F: main.ts 改造

**改动范围：**
1. 创建 CommandRegistry，注册所有内置命令
2. 创建 CommandDispatcher
3. 实现 UIContext 接口（在 main.ts 中，桥接实际组件）
4. 输入入口加分流：`dispatcher.dispatch(input, ui)` → true 则跳过 Agent
5. readline 设置 Tab 补全回调
6. 删除原硬编码的 if/else 命令处理代码

## 模块交互

```
启动:
  main.ts → CommandRegistry.register(所有内置命令)
  main.ts → new CommandDispatcher(registry)
  main.ts → 实现 UIContext（桥接到 ChatManager、Agent、MemoryManager 等）

输入时:
  rl.on('line', input) → dispatcher.dispatch(input, ui)
    ├── Parser.parse(input) → 非斜杠 → return false → 走 Agent
    └── Parser.parse(input) → 命令 → registry.get(name)
          ├── 命中 → handler(ui, args) → return true
          └── 未命中 → ui.showError('/help 引导') → return true

Tab 补全:
  rl.on('tab', line) → completer.complete(line)
    → 返回补全结果 → readline 显示
```

## 文件组织

```
mewcode/
├── src/
│   ├── commands/                  # 新建
│   │   ├── types.ts               # A: 类型定义 + UIContext 接口
│   │   ├── registry.ts            # B: 注册中心
│   │   ├── parser.ts              # C: 解析器 + 分发器
│   │   ├── completer.ts           # D: Tab 补全
│   │   ├── builtins.ts            # E: 10 个内置命令
│   │   └── commands.test.ts       # 测试
│   └── main.ts                    # 修改：接入命令系统 + 实现 UIContext
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 命令查找 | HashMap（`Map<string, CommandDef>`） | O(1) 查找，名字和别名都映射到同一 CommandDef |
| 冲突检测时机 | 注册时立即检测 | 启动就炸，不让冲突潜伏到运行时 |
| UIContext 接口 | 在 main.ts 中用闭包实现 | 简单直接，避免引入 DI 容器 |
| 输入分流位置 | readline on line 回调的第一件事 | 命令绝不走 Agent，省 token |
| Tab 补全 | readline 内置 compositer 机制 | Node.js readline 原生支持，不引入新依赖 |
| 命令处理器签名 | `(ctx: UIContext, args: string) => void \| Promise<void>` | 支持同步和异步命令 |
| 参数传递 | 原始字符串 | 简单，各命令自己解析 |
| 状态栏联动 | 在 setAgentMode 等方法中调用 refreshStatusBar | 模式切换后状态栏自动更新 |
