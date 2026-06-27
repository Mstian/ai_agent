# MewCode 第五阶段 Plan

## 架构概览

权限系统作为新层，插入到 Agent 和 ToolExecutor 之间：

```
Agent 循环
  │  检测到 tool_use
  │
  ├──→ PermissionManager.check(toolUseBlock)
  │       │
  │       ├─ Layer 1: BlacklistChecker   — 硬编码黑名单正则
  │       ├─ Layer 2: SandboxChecker     — 路径 + symlink 解析防逃逸
  │       ├─ Layer 3: RuleEngine         — YAML 规则匹配
  │       ├─ Layer 4: ModeResolver       — strict/default/permissive 判断
  │       └─ Layer 5: HumanInTheLoop     — y/N 终端确认
  │
  │  返回 PermissionResult { allowed, reason?, confirmRequired? }
  │
  ├── 如果 denied → 构造 tool_result 错误返回给模型（不终止循环）
  ├── 如果 needs confirmation → 暂停循环，终端询问用户
  │       用户 y → 放行；N → 拒绝
  └── 如果 allowed → ToolExecutor.executeBatch()
```

## 核心数据结构

### PermissionResult

```typescript
interface PermissionResult {
  allowed: boolean;
  reason?: string;           // 拒绝原因
  deniedBy: LayerName;       // 哪一层拒绝的
  confirmRequired?: boolean; // 是否需要用户确认
}
```

### PermissionRule

```typescript
interface PermissionRule {
  tool: string;              // 工具名（Bash、WriteFile、ReadFile 等）
  pattern: string;           // glob 模式匹配参数
  action: 'allow' | 'deny';
  source: 'user' | 'project' | 'local';  // 规则来源
}
```

### PermissionMode

```typescript
type PermissionMode = 'strict' | 'default' | 'permissive';
```

### RuleSet（从 YAML 加载）

```typescript
interface RuleSet {
  rules: PermissionRule[];
}
```

### ConfirmCallback

```typescript
type ConfirmCallback = (toolName: string, params: string) => Promise<'allow' | 'deny' | 'allow_session' | 'allow_always'>;
```

## 模块设计

### 模块 P: PermissionManager

**职责：** 五层检查链的总入口。协调各层，逐层判断。

**对外接口：**
```typescript
class PermissionManager {
  constructor(config: PermissionConfig);

  // 检查单个工具调用
  check(
    toolName: string,
    params: Record<string, unknown>,
    onConfirm?: ConfirmCallback,
  ): Promise<PermissionResult>;

  // 切换模式
  setMode(mode: PermissionMode): void;
  getMode(): PermissionMode;

  // 动态添加规则（如 y session / y always）
  addSessionRule(rule: PermissionRule): void;
  addPermanentRule(rule: PermissionRule): Promise<void>;
}
```

**检查链流程：**
```
check(toolName, params, onConfirm):
  1. BlacklistChecker.check(toolName, params)
     → 命中 → 返回 denied (不可覆盖)
  
  2. SandboxChecker.check(toolName, params)
     → 路径逃逸 → 返回 denied
  
  3. RuleEngine.match(toolName, params)
     → deny 规则命中 → 返回 denied
     → allow 规则命中 → 返回 allowed
  
  4. ModeResolver.resolve(mode)
     → strict → confirmRequired = true（即使规则 allow 也确认）
     → default → 规则未命中 → confirmRequired = true
     → permissive → 规则未命中 → 自动 allowed
  
  5. 如果 confirmRequired → 调用 onConfirm 获取用户决策
     → 允许 → 返回 allowed
     → 拒绝 → 返回 denied
```

### 模块 Q: BlacklistChecker（第一层）

**职责：** 硬编码黑名单正则匹配。不可被配置关闭。

**内部：** 升级现有 `checkDangerousCommand` 函数为 BlacklistChecker 类。

```typescript
class BlacklistChecker {
  private static DANGEROUS_PATTERNS: RegExp[];

  // 仅对 run_command 生效
  check(toolName: string, params: Record<string, unknown>): PermissionResult | null;
  // 返回 null 表示未命中，继续下一层
  // 返回 PermissionResult 表示命中，拒绝
}
```

### 模块 R: SandboxChecker（第二层）

**职责：** 限制文件操作在项目目录内。解析符号链接。

```typescript
class SandboxChecker {
  private projectRoot: string;

  // 对文件工具生效（read_file、write_file、edit_file、glob、grep）
  check(toolName: string, params: Record<string, unknown>): PermissionResult | null;
}
```

**内部逻辑：**
1. 提取 params 中的路径参数（file_path、path）
2. 用 `fs.realpathSync` 解析符号链接
3. 判断解析后的绝对路径是否以 projectRoot 为前缀
4. 不在范围内 → 返回 denied，附带实际路径信息

### 模块 S: RuleEngine（第三层）

**职责：** 加载三层 YAML 规则文件，按优先级匹配。

```typescript
class RuleEngine {
  private rules: PermissionRule[];

  constructor();
  // 加载规则：本地级 → 项目级 → 用户级（后加载的优先级高，覆盖同名）
  load(): void;

  // 匹配规则
  match(toolName: string, params: Record<string, unknown>): PermissionResult | null;
}
```

**规则加载顺序（后加载覆盖先加载）：**
1. 加载用户级 `~/.mewcode/rules.yaml`
2. 加载项目级 `.mewcode/rules.yaml`（覆盖用户级同名）
3. 加载本地级 `.mewcode/rules.local.yaml`（覆盖项目级同名）

**匹配逻辑：**
1. 根据 toolName 提取对应参数字符串
   - run_command → params.command
   - 文件工具 → params.file_path 或 params.path
2. 遍历规则（按优先级从高到低）
3. 第一条匹配的规则返回其 action
4. 无匹配返回 null

**glob 匹配：** 复用现有的简单 glob 匹配逻辑（`simpleGlobMatch`）。

### 模块 T: ModeResolver（第四层）

**职责：** 根据当前权限模式，决定规则未命中时的行为。

```typescript
class ModeResolver {
  private mode: PermissionMode;

  resolve(ruleMatched: boolean): { allowed: boolean; confirmRequired: boolean } {
    switch (this.mode) {
      case 'strict':
        return { allowed: false, confirmRequired: true };
        // 所有操作都需要确认（包括 read_file）
      
      case 'default':
        if (ruleMatched) return { allowed: true, confirmRequired: false };
        return { allowed: false, confirmRequired: true };
        // 规则命中 → 放行；未命中 → 确认
      
      case 'permissive':
        return { allowed: true, confirmRequired: false };
        // 规则命中或未命中都放行（前两层已拦住危险操作）
    }
  }
}
```

### 模块 U: HumanInTheLoop（第五层）

**职责：** 通过回调函数暂停 Agent 并获取用户决策。

```typescript
class HumanInTheLoop {
  // confirm 通过外部注入的回调实现（由 TUI 层提供 readline 交互）
  static async confirm(
    toolName: string,
    params: Record<string, unknown>,
    onConfirm: ConfirmCallback,
    timeout?: number,
  ): Promise<PermissionResult>;
}
```

**回调签名：**
```typescript
type ConfirmCallback = (
  toolName: string,
  paramsSummary: string,
) => Promise<'allow' | 'deny' | 'allow_session' | 'allow_always'>;
```

**TUI 层实现（main.ts 中）：**
```
显示: [权限确认] 即将执行 run_command("npm test")，是否允许？[y/N/session/always]
用户输入 y → 'allow'
用户输入 N → 'deny'（默认）
用户输入 s → 'allow_session'
用户输入 a → 'allow_always'
超时 60s → 'deny'
```

### 模块 B'''：ToolExecutor 扩展

ToolExecutor 不再直接执行工具，而是先调用 PermissionManager.check()：

```
executeBatch():
  for each toolUseBlock:
    result = await permissionManager.check(toolName, params, onConfirm)
    if !result.allowed:
      yield tool_result(success:false, error: "权限拒绝: " + result.reason)
      continue
    yield tool_executing
    // ... 正常执行
```

**权限拒绝不终止循环**——Agent 拿到拒绝的 tool_result，模型可以调整策略。

### 模块 G''：Agent 扩展

Agent.run() 需要：
1. 创建 PermissionManager 并注入 ToolExecutor
2. 传递确认回调（指向 main.ts 的 readline 交互）
3. 权限拒绝时正常收集 tool_result 并继续循环

### 模块 D''''：TUI 扩展

main.ts 需要：
1. 创建 PermissionManager 实例
2. 实现确认回调函数（readline 暂停 → 提问 → 等待输入 → 返回结果）
3. 新增命令：`/mode strict|default|permissive`
4. 提示符显示当前权限模式

**确认回调在 main.ts 中的实现：**
```typescript
async function confirmCallback(toolName: string, paramsSummary: string): Promise<string> {
  // 暂停主 readline
  rl.pause();
  
  // 创建临时 readline 用于确认输入
  const confirmRl = readline.createInterface({ input: process.stdin, output: process.stdout });
  
  return new Promise((resolve) => {
    confirmRl.question(
      `${YELLOW}[权限确认]${RESET} 即将执行 ${toolName}(${paramsSummary})，是否允许？[y/N] `,
      (answer) => {
        confirmRl.close();
        const trimmed = answer.trim().toLowerCase();
        if (trimmed === 'y') resolve('allow');
        else if (trimmed === 's') resolve('allow_session');
        else if (trimmed === 'a') resolve('allow_always');
        else resolve('deny');
      },
    );
  });
}
```

## 模块交互

### 一次工具调用的权限检查流程

```
Agent 检测到 tool_use(run_command, {command: "npm test"})
  │
  ▼
ToolExecutor.executeBatch()
  │
  ▼
PermissionManager.check("run_command", {command: "npm test"}, onConfirm)
  │
  ├─ Layer 1: BlacklistChecker.check()
  │   "npm test" 不匹配黑名单 → null（继续）
  │
  ├─ Layer 2: SandboxChecker.check()
  │   run_command 不是文件工具 → null（继续）
  │
  ├─ Layer 3: RuleEngine.match()
  │   rules 中有 Bash(npm *): allow → 命中 allow
  │
  ├─ Layer 4: ModeResolver.resolve(ruleMatched=true)
  │   mode=default, ruleMatched=true → allowed
  │
  └─ 返回 { allowed: true }
  
  → 正常执行工具
```

### 需要确认的场景

```
PermissionManager.check("run_command", {command: "curl example.com"}, onConfirm)
  │
  ├─ Layer 1: 不匹配黑名单
  ├─ Layer 2: 不是文件工具
  ├─ Layer 3: 无规则匹配（用户未配置 curl 相关规则）
  ├─ Layer 4: mode=default, ruleMatched=false → confirmRequired=true
  └─ Layer 5: 调用 onConfirm("run_command", "curl example.com")
       │
       ▼ 终端询问用户
       [权限确认] 即将执行 run_command(curl example.com)，是否允许？[y/N]
       用户输入 N → 返回 { allowed: false, reason: "用户拒绝" }
  
  → 返回 denied tool_result 给模型
  → 模型看到后可能换用 fetch 工具或解释需要网络请求的原因
```

## 文件组织

```
mewcode/
├── src/
│   ├── main.ts                  # 修改：confirmCallback + /mode 命令
│   ├── permission/              # 新建
│   │   ├── types.ts             # PermissionResult、PermissionRule、PermissionMode
│   │   ├── blacklist.ts         # BlacklistChecker（升级 checkDangerousCommand）
│   │   ├── sandbox.ts           # SandboxChecker（symlink 解析）
│   │   ├── rule_engine.ts       # RuleEngine（YAML 加载 + glob 匹配）
│   │   ├── mode_resolver.ts     # ModeResolver
│   │   ├── human_in_the_loop.ts # HumanInTheLoop
│   │   ├── manager.ts           # PermissionManager（五层总入口）
│   │   └── permission.test.ts   # 权限系统测试
│   ├── agent/
│   │   ├── agent.ts             # 修改：集成 PermissionManager
│   │   └── tool_executor.ts     # 修改：执行前调用权限检查
│   └── tools/
│       └── helpers.ts           # 修改：checkDangerousCommand 迁移到 permission/
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 权限检查位置 | ToolExecutor 执行前，而非 Agent 循环中 | Agent 不应关心权限细节，ToolExecutor 是"执行"的唯一入口 |
| 确认回调模式 | Promise + 注入回调函数 | 权限模块不依赖 readline 或其他 I/O 实现，方便测试 |
| 黑名单不可覆盖 | 硬编码在 BlacklistChecker 中 | 安全底线，不能通过 YAML 配置放开 |
| 沙箱用 realpath | fs.realpathSync | 防止通过符号链接绕开路径前缀检查 |
| 规则匹配 | 第一条匹配 wins（按优先级排序） | 简单直观，避免规则冲突的复杂解析 |
| y session 存储 | 内存中 Map（工具名+模式 → allow/deny） | 会话级规则不需要持久化 |
| y always 存储 | 追加到 .mewcode/rules.local.yaml | 永久存储，下次启动仍生效 |
| 确认超时 | 60 秒默认拒绝 | 防止无人值守时永久阻塞 |
