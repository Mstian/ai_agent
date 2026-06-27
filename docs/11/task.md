# MewCode 第十一阶段 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/hooks/types.ts` | Hook 类型定义 |
| 新建 | `src/hooks/hook_matcher.ts` | 条件匹配引擎 |
| 新建 | `src/hooks/hook_executor.ts` | 动作执行器 |
| 新建 | `src/hooks/hook_manager.ts` | 总入口 + YAML 加载 |
| 新建 | `src/hooks/hooks.test.ts` | 测试 |
| 修改 | `src/agent/agent.ts` | 生命周期节点插入 Hook.fire() |
| 修改 | `src/main.ts` | 创建 HookManager |

## T1: Hook 类型定义

**文件：** `src/hooks/types.ts`
**步骤：**
1. HookEvent 联合类型（9 个事件）
2. HookCondition 接口（tools, matchMode, conditions）
3. ConditionItem 接口（field, pattern）
4. HookAction 联合类型（command/prompt/http/agent）
5. HookRule 接口（event, if?, action, runOnce?, async?, timeout?）
6. HookContext 接口（event, toolName?, toolInput?, toolResult?, turnNumber?, cwd, sessionId?）
7. HookFireResult 接口（allowed, reason?, promptInjections）

**验证：** `npx tsc --noEmit` 通过

## T2: 条件匹配引擎

**文件：** `src/hooks/hook_matcher.ts`
**步骤：**
1. `match(rule, ctx)` — 条件为 null 返回 true
2. `matchSingle(pattern, value)` — 精确/反向(!)/正则(/pattern/)/glob(*)
3. `matchCondition(item, ctx)` — 从 ctx 取 field 值，调 matchSingle
4. `matchTools(tools, ctx)` — 检查 ctx.toolName 是否在列表中
5. 组合逻辑：matchMode='all' → every，'any' → some

**验证：** `npx tsc --noEmit` 通过

## T3: 动作执行器

**文件：** `src/hooks/hook_executor.ts`
**步骤：**
1. `execute(action, ctx)` — 按 action.type 分发
2. `executeCommand` — child_process.exec + timeout
3. `executePrompt` — 返回 { promptText }（注入由 Manager 处理）
4. `executeHttp` — fetch + 模板变量替换
5. `executeAgent` — 占位，打印 TODO 日志
6. 模板变量替换函数 `expandVars(text, ctx)`

**验证：** `npx tsc --noEmit` 通过

## T4: HookManager

**文件：** `src/hooks/hook_manager.ts`
**步骤：**
1. `load(projectRoot)` — 读两层 YAML + 校验 + 跳过非法规则
2. 校验逻辑：event 必填且合法、action.type 必填且合法、非法项跳过+警告
3. `fire(event, ctx)` — 过滤匹配规则 → 执行动作 → 收集拦截/注入结果
4. 错误隔离：每条 Hook 独立 try/catch
5. `runOnce` 跟踪：内存 Set 记录已执行的 rule index
6. pre_tool_execute 拦截逻辑

**验证：** `npx tsc --noEmit` 通过

## T5: Agent 集成

**文件：** `src/agent/agent.ts`
**步骤：**
1. 注入 HookManager
2. run() 方法中插入 fire() 调用：
   - 首轮 turn_start 后 → fire('session_start')
   - 每轮开头 → fire('turn_start')
   - executeBatch 前 → fire('pre_tool_execute') → 检查 allowed
   - executeBatch 后 → fire('post_tool_execute')
   - agent_done → fire('agent_done')
   - catch 块 → fire('error')

**验证：** 原有 agent 测试通过

## T6: main.ts 接入

**文件：** `src/main.ts`
**步骤：**
1. 创建 HookManager，调用 load()
2. 注入 Agent
3. 启动日志显示已加载 Hook 数量

**验证：** `npm test` 全部通过

## T7: 测试

**文件：** `src/hooks/hooks.test.ts`
**步骤：**
1. HookMatcher：精确/反向/正则/glob 匹配、AND/OR 组合
2. HookExecutor：command 执行、prompt 返回、模板变量替换
3. HookManager：配置加载、事件触发、pre_tool_execute 拦截
4. 错误隔离：非法配置跳过、执行失败不抛异常

**验证：** `npm test` 全部通过

## 执行顺序

```
T1 ──→ T2 ──→ T4 ──→ T5 ──→ T6
  │            │
  └──→ T3 ────→│
                │
                └──→ T7
```

T2、T3 可并行（都只依赖 T1）。T4 依赖 T2、T3。T5、T6 依赖 T4。T7 最后。
