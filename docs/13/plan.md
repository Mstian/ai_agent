# MewCode 第十三阶段 Plan

## 架构概览

新增 `src/worktree/` 模块，挂在子 Agent 系统下面：

```
AgentTool.execute() 检测 role.isolation === 'worktree'
  │
  ├── WorktreeManager.create(taskId) → worktreePath
  │     ├── 安全校验目录名
  │     ├── git worktree add
  │     ├── 环境初始化（软链 node_modules、复制配置）
  │     └── 返回绝对路径
  │
  ├── 注入路径说明到 system prompt
  │     "你的工作目录是 /path/to/.mewcode/worktrees/xxx"
  │
  ├── SubAgentRunner.run(messages, tools, registry, { cwd: worktreePath })
  │     → 所有工具调用 cwd = worktreePath
  │
  └── WorktreeManager.cleanup(worktreePath)
        → git status 检查 → 删除或保留
```

## 核心数据结构

### WorktreeInfo

```typescript
interface WorktreeInfo {
  path: string;           // 绝对路径
  branch: string;         // 分支名
  taskId: string;         // 关联的任务 ID
  createdAt: Date;
  lastActiveAt: Date;
}
```

### WorktreeCreateOptions

```typescript
interface WorktreeCreateOptions {
  taskId: string;
  baseRef?: string;       // 基于哪个 ref，默认 HEAD
}
```

## 模块设计

### 模块 A: WorktreeManager（worktree/worktree_manager.ts）

```typescript
class WorktreeManager {
  constructor(projectRoot: string);
  
  /** 安全校验目录名 */
  static validateName(name: string): boolean;
  
  /** 创建 worktree */
  create(opts: WorktreeCreateOptions): Promise<WorktreeInfo>;
  
  /** 进入（幂等） */
  enter(name: string): WorktreeInfo | null;
  
  /** 退出 + 清理 */
  exit(name: string, force?: boolean): Promise<{ cleaned: boolean; reason?: string }>;
  
  /** 过期清理 */
  cleanExpired(maxAgeDays?: number): Promise<number>;
  
  /** 环境初始化 */
  private initEnvironment(worktreePath: string): Promise<void>;
}
```

**initEnvironment 内部：**
1. `ln -s ../../../../node_modules <worktree>/node_modules`
2. `cp .mewcode.yaml <worktree>/`
3. 复制 `.env` 等被 gitignore 但运行需要的文件

### 模块 B: AgentTool 集成

在 `agent_tool.ts` 的 defined 模式中：
1. 检查 `role.isolation === 'worktree'`
2. 创建 worktree
3. 修改 `cwd` 参数传给 runner
4. 在 system prompt 中注入路径信息
5. 完成后清理或保留

### 模块 C: SubAgentRunner 集成

`runner.ts` 接收 `cwd` 参数，传给每个 `ToolExecuteContext`：
```typescript
result = await tool.execute(input, {
  cwd: config.cwd,
  timeout: 30000,
  signal: config.signal,
});
```

### 模块 D: AgentRole 类型扩展

`types.ts` 加字段：
```typescript
isolation?: 'none' | 'worktree';
```

## 文件组织

```
mewcode/
├── src/
│   ├── worktree/                     # 新建
│   │   ├── worktree_manager.ts       # A: Worktree 管理
│   │   └── worktree.test.ts          # 测试
│   ├── subagent/
│   │   ├── types.ts                  # 修改：加 isolation 字段
│   │   ├── role_loader.ts            # 修改：解析 isolation 字段
│   │   ├── runner.ts                 # 修改：接收 cwd 参数
│   │   └── agent_tool.ts             # 修改：检测 isolation + 创建 worktree
│   └── main.ts                       # 修改：创建 WorktreeManager + 过期清理
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 隔离机制 | `git worktree` | Git 原生支持，零依赖 |
| cwd 传递 | 显式参数（不 chdir） | 不污染进程全局状态，天然线程安全 |
| 分支命名 | `mewcode/worktree-{taskId}` | 不被误认为功能分支 |
| 存储位置 | `.mewcode/worktrees/` | 在项目内但 git 不追踪（.gitignore） |
| 依赖目录 | 软链（ln -s） | 避免重复安装 node_modules 等 |
| 退出策略 | 有变更默认保留 | 防止数据丢失 |
| 过期清理 | 7 天 + git status 干净 | 保守策略，避免删有用数据 |
