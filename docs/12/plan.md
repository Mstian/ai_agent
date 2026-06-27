# MewCode 第十二阶段 Plan

## 架构概览

新增 `src/subagent/` 模块 + 一个 `agent` 工具：

```
主 Agent 调用 agent 工具
  │
  ├── AgentTool.execute({ type, name, prompt, background })
  │     │
  │     ├── type='defined' → RoleLoader.load(name) → AgentRole
  │     │   → 新建 ChatManager（system = role.body）
  │     │
  │     └── type='fork' → 复制父 ChatManager.messages
  │         → 复制父工具集
  │
  ├── SubAgentRunner.run(agent, prompt)
  │     │
  │     ├── 创建独立 Agent 实例（受限工具 + 预设权限模式）
  │     ├── run() → 跑到底（task_completed / max_iterations）
  │     └── 返回 { finalText, turns, tokenUsage }
  │
  ├── 同步 → 结果直接返回 tool_result
  │
  └── 异步 → TaskManager.spawn() → 立即返回 taskId
        → 后台跑完 → 结果注入主对话
```

## 核心数据结构

### AgentRole（角色定义）

```typescript
interface AgentRole {
  name: string;
  description: string;
  tools?: string[];
  blocked_tools?: string[];
  model?: string;           // 'inherit' | 'haiku' | 'sonnet' | 'opus'
  max_iterations?: number;  // 默认 10
  permission_mode?: 'strict' | 'default' | 'permissive';
  body: string;             // Markdown 正文 = 系统提示
  source: 'builtin' | 'user' | 'project';
}
```

### AgentToolInput

```typescript
interface AgentToolInput {
  type: 'defined' | 'fork';
  name?: string;       // defined 模式：角色名
  prompt: string;      // 子 Agent 的任务
  background?: boolean;// 是否后台执行
}
```

### SubAgentResult

```typescript
interface SubAgentResult {
  taskId: string;
  roleName?: string;
  finalText: string;       // 最终回复
  turns: number;
  tokenUsage: { input: number; output: number };
  stopReason: string;
  duration: number;        // 毫秒
}
```

### BackgroundTask

```typescript
interface BackgroundTask {
  id: string;
  status: 'pending' | 'running' | 'done' | 'error';
  roleName?: string;
  prompt: string;
  result?: SubAgentResult;
  error?: string;
  startedAt: Date;
}
```

## 模块设计

### 模块 A: types.ts（subagent/types.ts）

类型定义：AgentRole, AgentRoleFrontmatter, SubAgentResult, BackgroundTask

### 模块 B: RoleLoader（subagent/role_loader.ts）

```typescript
class RoleLoader {
  constructor(projectRoot: string);
  listAll(): Pick<AgentRole, 'name' | 'description' | 'source'>[];
  load(name: string): AgentRole | null;
}
```

四级来源加载，同名按优先级覆盖。复用 Skill 系统的 frontmatter 解析逻辑。

### 模块 C: SubAgentRunner（subagent/runner.ts）

```typescript
class SubAgentRunner {
  constructor(provider: Provider, toolRegistry: ToolRegistry, hookManager?: HookManager);

  async run(
    messages: Message[],
    tools: ToolDefinition[],
    config: { maxIterations: number; permissionMode: string; signal?: AbortSignal },
  ): Promise<SubAgentResult>;
}
```

内部创建独立 ChatManager + Agent，跑到底后返回结果。

### 模块 D: TaskManager（subagent/task_manager.ts）

```typescript
class TaskManager {
  spawn(task: BackgroundTask): void;
  getStatus(id: string): BackgroundTask['status'] | null;
  getResult(id: string): SubAgentResult | null;
  listActive(): BackgroundTask[];
  checkCompleted(): BackgroundTask[]; // 返回刚完成的任务
}
```

### 模块 E: AgentTool（subagent/agent_tool.ts）

```typescript
class AgentTool implements Tool {
  name = 'agent';
  category = 'mutation';
  // ...
  async execute(input: AgentToolInput, ctx: ToolExecuteContext): Promise<ToolResult>;
}
```

核心分流：
- type='defined' → RoleLoader.load(name) → Runner.run()
- type='fork' → 复制父消息+工具 → Runner.run()
- background 或 fork → TaskManager.spawn()

### 模块 F: 工具过滤

在 AgentTool.execute() 中构造子工具列表时应用：
1. 移除 `agent` 工具（全局禁止）
2. 应用角色 tools 白名单
3. 应用角色 blocked_tools 黑名单
4. 后台任务额外过滤只读工具

### 模块 G: Agent 集成

- 注册 AgentTool 到 ToolRegistry
- AgentTool 需要在 execute 中获取父 Agent 的 messages 和 tools（通过 ToolExecuteContext 传递）

### 模块 H: main.ts 集成

- 创建 RoleLoader + SubAgentRunner + TaskManager
- 注册 AgentTool
- 注册后台任务检查到输入循环

## 文件组织

```
mewcode/
├── src/
│   ├── subagent/                    # 新建
│   │   ├── types.ts                 # A: 类型定义
│   │   ├── role_loader.ts           # B: 角色加载器
│   │   ├── runner.ts                # C: 子 Agent 执行器
│   │   ├── task_manager.ts          # D: 后台任务管理
│   │   ├── agent_tool.ts            # E: agent 工具
│   │   ├── builtins/                # 内置角色
│   │   │   └── code-reviewer.md
│   │   └── subagent.test.ts         # 测试
│   ├── agent/
│   │   └── agent.ts                 # 修改：暴露内部状态供 SubAgentRunner 使用
│   └── main.ts                      # 修改：注册 AgentTool + TaskManager
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| agent 工具注册 | 普通 Tool 接口实现 | 与现有工具系统无缝集成，模型直接调用 |
| Fork 消息复制 | 浅拷贝 messages 数组 + 深拷贝 ContentBlock | 平衡性能和隔离 |
| 子 Agent 实例 | 新建 Agent 实例而非复用 | 状态完全隔离，无副作用 |
| 后台任务通知 | TaskManager.checkCompleted() + 轮询 | 简单可靠，不引入事件系统 |
| 防嵌套 | 硬编码移除 agent 工具 | 最安全的防嵌套方式 |
| 模型选择 | 角色可指定 haiku/sonnet/opus | 便宜任务用 haiku 省钱 |
| 超时后台化 | 30s 超时自动转后台 | 长任务不阻塞用户交互 |
