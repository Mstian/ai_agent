# MewCode 第十三阶段 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/worktree/worktree_manager.ts` | Worktree 创建/进入/退出/清理 + 安全校验 + 环境初始化 |
| 新建 | `src/worktree/worktree.test.ts` | 测试 |
| 修改 | `src/subagent/types.ts` | 加 isolation 字段 |
| 修改 | `src/subagent/role_loader.ts` | 解析 isolation 字段 |
| 修改 | `src/subagent/runner.ts` | 接收 + 使用 cwd 参数 |
| 修改 | `src/subagent/agent_tool.ts` | 检测 isolation → 创建 worktree |
| 修改 | `src/main.ts` | 创建 WorktreeManager + 过期清理 |

## T1: WorktreeManager 实现

**文件：** `src/worktree/worktree_manager.ts`
**步骤：**
1. `validateName(name)` — 安全校验（字符集、长度、拒绝 . 和 ..）
2. `create(opts)` — git worktree add + 分支创建
3. `enter(name)` — 幂等检查目录存在
4. `exit(name, force?)` — git status 检查 → git worktree remove + 分支删除
5. `initEnvironment(path)` — 软链 node_modules + 复制配置
6. `cleanExpired(maxAgeDays)` — 扫描 + 清理过期 worktree

**验证：** `npx tsc --noEmit` 通过

## T2: 角色类型扩展

**文件：** `src/subagent/types.ts`、`src/subagent/role_loader.ts`
**步骤：**
1. AgentRole 加 `isolation?: 'none' | 'worktree'`
2. AgentRoleFrontmatter 加 `isolation?: string`
3. role_loader 解析时默认 'none'

**验证：** 现有测试通过

## T3: Runner cwd 支持

**文件：** `src/subagent/runner.ts`
**步骤：**
1. run() config 加 `cwd?: string`
2. 所有 tool.execute() 的 context.cwd 使用 config.cwd ?? process.cwd()

**验证：** 现有测试通过

## T4: AgentTool 集成

**文件：** `src/subagent/agent_tool.ts`
**步骤：**
1. 注入 WorktreeManager
2. defined 模式检测 `role.isolation === 'worktree'`
3. 创建 worktree → 获取路径
4. system prompt 注入路径说明
5. cwd 传给 runner
6. 完成后清理 worktree

**验证：** 现有测试通过

## T5: main.ts 接入

**文件：** `src/main.ts`
**步骤：**
1. 创建 WorktreeManager
2. 注入 AgentTool
3. 启动时异步清理过期 worktree

**验证：** `npm test` 全部通过

## T6: 测试

**文件：** `src/worktree/worktree.test.ts`
**步骤：**
1. validateName 安全校验
2. create/enter/exit 生命周期
3. 非法名称被拒绝

**验证：** `npm test` 全部通过

## 执行顺序

```
T1 ──→ T4 ──→ T5
  │
T2 ──→ T3 ──→ T4
              │
              └──→ T6
```

T1、T2 可并行。T3 依赖 T2。T4 依赖 T1、T3。T5 依赖 T4。T6 最后。
