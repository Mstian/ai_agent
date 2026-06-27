# MewCode 第十二阶段 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/subagent/types.ts` | 子 Agent 类型定义 |
| 新建 | `src/subagent/role_loader.ts` | 角色加载器 |
| 新建 | `src/subagent/runner.ts` | 子 Agent 执行器 |
| 新建 | `src/subagent/task_manager.ts` | 后台任务管理 |
| 新建 | `src/subagent/agent_tool.ts` | agent 工具实现 |
| 新建 | `src/subagent/builtins/code-reviewer.md` | 内置角色 |
| 新建 | `src/subagent/subagent.test.ts` | 测试 |
| 修改 | `src/main.ts` | 注册 AgentTool + TaskManager |

## T1: 类型定义

**文件：** `src/subagent/types.ts`
**步骤：**
1. AgentRole 接口
2. AgentRoleFrontmatter 接口
3. SubAgentResult 接口
4. BackgroundTask 接口

**验证：** `npx tsc --noEmit` 通过

## T2: 角色加载器

**文件：** `src/subagent/role_loader.ts`
**步骤：**
1. 四级目录扫描（builtins → 用户 → 项目）
2. YAML frontmatter 解析
3. 同名按优先级覆盖
4. listAll() + load(name)

**验证：** `npx tsc --noEmit` 通过

## T3: 子 Agent 执行器

**文件：** `src/subagent/runner.ts`
**步骤：**
1. 接收 messages + tools + config → 创建独立 Agent 实例
2. run() 跑到底 → 收集结果
3. 返回 SubAgentResult（finalText, turns, tokenUsage, stopReason）

**验证：** `npx tsc --noEmit` 通过

## T4: 后台任务管理

**文件：** `src/subagent/task_manager.ts`
**步骤：**
1. spawn(task) — 启动后台执行
2. getStatus/getResult/listActive
3. checkCompleted() — 返回刚完成的任务

**验证：** `npx tsc --noEmit` 通过

## T5: agent 工具

**文件：** `src/subagent/agent_tool.ts`
**步骤：**
1. 实现 Tool 接口，name='agent'
2. execute() 分流 defined/fork
3. 工具过滤（去 agent + 角色白/黑名单）
4. 同步/异步分发

**验证：** `npx tsc --noEmit` 通过

## T6: 内置角色

**文件：** `src/subagent/builtins/code-reviewer.md`
**步骤：**
1. YAML frontmatter + Markdown 正文
2. 角色：审查代码、只读工具

**验证：** RoleLoader 可正确加载

## T7: main.ts 接入

**文件：** `src/main.ts`
**步骤：**
1. 创建 RoleLoader + SubAgentRunner + TaskManager
2. 注册 AgentTool 到 ToolRegistry
3. 输入循环中检查后台任务完成状态

**验证：** `npm test` 全部通过

## T8: 测试

**文件：** `src/subagent/subagent.test.ts`
**步骤：**
1. RoleLoader 加载/优先级覆盖
2. SubAgentRunner 跑到底
3. TaskManager 后台任务
4. AgentTool 工具过滤

**验证：** `npm test` 全部通过

## 执行顺序

```
T1 ──→ T2 ──→ T5 ──→ T7
  │            │
  ├──→ T3 ────→│
  │            │
  ├──→ T4 ────→│
  │            │
  └──→ T6 ────→│
                │
                └──→ T8
```

T2、T3、T4、T6 可并行（都只依赖 T1）。T5 依赖 T2-T4。T7 依赖 T5。T8 最后。
