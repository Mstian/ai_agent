# MewCode 第十一阶段 Plan

## 架构概览

新增 `src/hooks/` 模块，嵌入到 Agent 生命周期各节点：

```
Agent.run() 每轮循环
  │
  ├── turn_start    → HookManager.fire('turn_start', ctx)
  │
  ├── pre_tool_execute → HookManager.fire('pre_tool_execute', ctx)
  │     └── 返回拦截 → 跳过工具执行 → 反馈给模型
  │
  ├── 执行工具
  │
  ├── post_tool_execute → HookManager.fire('post_tool_execute', ctx)
  │
  ├── turn_end      → HookManager.fire('turn_end', ctx)
  │
  └── agent_done    → HookManager.fire('agent_done', ctx)

main.ts
  ├── session_start → HookManager.fire('session_start', ctx)
  └── error         → HookManager.fire('error', ctx)
```

**核心原则：** Hook 自身失败只记日志不抛异常，pre_tool_execute 是唯一可拦截事件。

## 核心数据结构

### HookRule（一条 Hook 规则）

```typescript
interface HookRule {
  event: HookEvent;           // 触发事件
  if?: HookCondition;         // 条件表达式（可选）
  action: HookAction;         // 动作
  runOnce?: boolean;          // 只跑一次
  async?: boolean;            // 后台执行
  timeout?: number;           // 超时（ms）
}

type HookEvent = 'session_start' | 'session_end' | 'turn_start' | 'turn_end'
  | 'message_received' | 'pre_tool_execute' | 'post_tool_execute'
  | 'agent_done' | 'error';
```

### HookCondition（条件表达式）

```typescript
interface HookCondition {
  tools?: string[];              // 工具名列表
  matchMode?: 'all' | 'any';     // AND/OR，默认 all
  conditions?: ConditionItem[];  // 字段级匹配
}

interface ConditionItem {
  field: string;       // 匹配字段名（command, file_path, tool_name...）
  pattern: string;     // 匹配模式（精确/!/regex/glob）
}
```

### HookAction（动作）

```typescript
type HookAction =
  | { type: 'command'; command: string; timeout?: number }
  | { type: 'prompt'; text: string; position?: 'before' | 'after' }
  | { type: 'http'; url: string; method?: string; headers?: Record<string,string>; body?: string }
  | { type: 'agent'; prompt: string; model?: string };
```

### HookContext（触发上下文）

```typescript
interface HookContext {
  event: HookEvent;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  turnNumber?: number;
  cwd: string;
  sessionId?: string;
}
```

### HookFireResult（触发结果）

```typescript
interface HookFireResult {
  allowed: boolean;        // 是否允许继续（仅 pre_tool_execute 可返回 false）
  reason?: string;         // 拒绝原因
  promptInjections: string[]; // 要注入的提示词
}
```

## 模块设计

### 模块 A: types.ts

**职责：** Hook 系统所有类型定义。
**依赖：** 无

### 模块 B: HookMatcher（hook_matcher.ts）

**职责：** 条件匹配引擎，复用权限规则匹配逻辑。

```typescript
class HookMatcher {
  /** 检查单条规则的条件是否匹配当前上下文 */
  match(rule: HookRule, ctx: HookContext): boolean;
  /** 单条件匹配：精确/反向/正则/glob */
  private matchCondition(item: ConditionItem, ctx: HookContext): boolean;
  /** 工具名匹配 */
  private matchTools(tools: string[], ctx: HookContext): boolean;
}
```

**匹配逻辑：**
1. `if` 为空 → 无条件匹配，返回 true
2. `tools` 有值 → 检查当前工具名是否在列表中
3. `conditions` 有值 → 逐条匹配，根据 `matchMode` 组合结果
4. 单条 condition：检查 ctx 中的 field 值是否匹配 pattern
   - `/pattern/` → 正则匹配
   - `!value` → 反向匹配（不等于）
   - 含 `*` 或 `?` → glob 匹配
   - 否则 → 精确匹配

### 模块 C: HookExecutor（hook_executor.ts）

**职责：** 执行 Hook 动作。

```typescript
class HookExecutor {
  async execute(action: HookAction, ctx: HookContext): Promise<{ promptText?: string }>;
  private executeCommand(action, ctx): Promise<void>;
  private executeHttp(action, ctx): Promise<void>;
  private executePrompt(action, ctx): { promptText: string };
  private executeAgent(action, ctx): Promise<void>;  // 占位
}
```

**执行控制：**
- `async: true` → `setImmediate` 后台执行（拦截事件忽略）
- `timeout` → AbortController 限时
- `runOnce` → 内存 Set 标记已执行
- 模板变量替换：`{{event}}`、`{{tool_name}}`、`{{cwd}}` 等

### 模块 D: HookManager（hook_manager.ts）

**职责：** 总入口，加载配置、触发事件、管理生命周期。

```typescript
class HookManager {
  private rules: HookRule[];
  private matcher: HookMatcher;
  private executor: HookExecutor;

  constructor(projectRoot: string);
  
  /** 加载并校验所有 Hook 配置 */
  load(): void;
  
  /** 触发事件，返回拦截结果 */
  async fire(event: HookEvent, ctx: HookContext): Promise<HookFireResult>;
}
```

**fire() 流程：**
1. 过滤出匹配 event 的规则
2. 逐条用 matcher.match() 检查条件
3. 对匹配的规则执行 executor.execute()
4. 对于 pre_tool_execute：如果任一条 command 返回非零退出码，则拦截
5. 收集 prompt 注入
6. 返回HookFireResult

### 模块 E: Agent 集成

在 Agent 关键节点插入 HookManager.fire() 调用：
- `run()` 开头 → fire('session_start')
- 循环内 `turn_start` 后 → fire('turn_start')
- `executeBatch` 前 → fire('pre_tool_execute') → 检查 allowed
- `executeBatch` 后 → fire('post_tool_execute')
- 循环结束 → fire('turn_end')
- agent_done 处 → fire('agent_done')
- catch 块 → fire('error')

### 模块 F: main.ts 集成

- 创建 HookManager，调用 load()
- 注入 Agent
- 启动时打印已加载 Hook 数量

## 文件组织

```
mewcode/
├── src/
│   ├── hooks/                    # 新建
│   │   ├── types.ts              # A: Hook 类型定义
│   │   ├── hook_matcher.ts       # B: 条件匹配引擎
│   │   ├── hook_executor.ts      # C: 动作执行器
│   │   ├── hook_manager.ts       # D: 总入口
│   │   └── hooks.test.ts         # 测试
│   ├── agent/
│   │   └── agent.ts              # 修改：生命周期节点插入 Hook.fire()
│   └── main.ts                   # 修改：创建 HookManager
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 条件匹配 | 复用权限匹配逻辑（精确/!/regex/glob） | 一致的用户体验，减少学习成本 |
| 拦截机制 | pre_tool_execute 唯一可拦截事件 | 其他事件只做副作用，语义清晰 |
| 错误隔离 | try/catch 包裹每条 Hook 执行 | Hook 绝不中断 Agent |
| 配置格式 | YAML（.mewcode/hooks.yaml） | 与权限规则一致，声明式可读 |
| 模板变量 | 简单 {{var}} 替换 | 不引入模板引擎，够用 |
| pre_tool_execute 拦截 | command 类型 action 返回非零即拦截 | 简单可组合：可写脚本做任意逻辑判断 |
| 异步执行 | 拦截事件忽略 async 配置 | 安全策略必须同步，不能异步绕过 |
