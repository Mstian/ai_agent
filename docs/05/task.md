# MewCode 第五阶段 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/permission/types.ts` | PermissionResult、PermissionRule、PermissionMode、ConfirmCallback |
| 新建 | `src/permission/blacklist.ts` | BlacklistChecker：硬编码正则（从 helpers 迁移升级） |
| 新建 | `src/permission/sandbox.ts` | SandboxChecker：realpath + 前缀判断 |
| 新建 | `src/permission/rule_engine.ts` | RuleEngine：三层 YAML 加载 + glob 匹配 |
| 新建 | `src/permission/mode_resolver.ts` | ModeResolver：strict/default/permissive |
| 新建 | `src/permission/manager.ts` | PermissionManager：五层检查链总入口 |
| 新建 | `src/permission/permission.test.ts` | 权限系统测试 |
| 修改 | `src/tools/helpers.ts` | checkDangerousCommand 改为调用 BlacklistChecker |
| 修改 | `src/agent/tool_executor.ts` | 执行前调用 PermissionManager.check() |
| 修改 | `src/agent/agent.ts` | 集成 PermissionManager，传递确认回调 |
| 修改 | `src/main.ts` | confirmCallback + /mode 命令 + 提示符 |

## T1: 权限类型定义

**文件：** `src/permission/types.ts`
**依赖：** 无
**步骤：**
1. PermissionResult: allowed、reason?、deniedBy?、confirmRequired?
2. PermissionRule: tool、pattern、action('allow'/'deny')、source
3. PermissionMode: 'strict' | 'default' | 'permissive'
4. ConfirmCallback 类型：返回 'allow'|'deny'|'allow_session'|'allow_always'
5. LayerName 类型

**验证：** `npx tsc --noEmit` 通过

## T2: BlacklistChecker（第一层）

**文件：** `src/permission/blacklist.ts`
**依赖：** T1
**步骤：**
1. 从 helpers.ts 迁移 DANGEROUS_PATTERNS
2. 实现 BlacklistChecker 类
3. check(toolName, params): 仅对 run_command 生效
4. 命中返回 PermissionResult{allowed:false}，未命中返回 null
5. 更新 helpers.ts 的 checkDangerousCommand 委托给 BlacklistChecker

**验证：** `npm test` 中 RunCommandTool 危险命令测试通过

## T3: SandboxChecker（第二层）

**文件：** `src/permission/sandbox.ts`
**依赖：** T1
**步骤：**
1. 实现 SandboxChecker 类，构造器接收 projectRoot
2. check(toolName, params): 对文件工具提取路径参数
3. fs.realpathSync 解析符号链接
4. 判断是否以 projectRoot 为前缀
5. 路径逃逸返回 denied，附带实际路径

**验证：** `npx tsc --noEmit` 通过

## T4: RuleEngine（第三层）

**文件：** `src/permission/rule_engine.ts`
**依赖：** T1
**步骤：**
1. 实现 RuleEngine 类
2. load(): 依次加载三层 YAML 文件
   - ~/.mewcode/rules.yaml（用户级）
   - .mewcode/rules.yaml（项目级）
   - .mewcode/rules.local.yaml（本地级，优先级最高）
3. rules 在加载时去重（后加载覆盖先加载的同名规则）
4. match(toolName, params): 提取参数字符串 → 遍历规则 → glob 匹配
5. 第一条匹配的规则返回其 action
6. 无匹配返回 null
7. addRule(rule): 供 y session / y always 动态添加

**验证：** `npx tsc --noEmit` 通过

## T5: ModeResolver + HumanInTheLoop（第四、五层）

**文件：** `src/permission/mode_resolver.ts`
**依赖：** T1
**步骤：**
1. 实现 ModeResolver 类
2. resolve(mode, ruleMatched): 根据三档模式返回 {allowed, confirmRequired}

**验证：** `npx tsc --noEmit` 通过

## T6: PermissionManager（总入口）

**文件：** `src/permission/manager.ts`
**依赖：** T2-T5
**步骤：**
1. 实现 PermissionManager 类
2. 构造函数：创建各层实例
3. check(toolName, params, onConfirm?): 逐层执行检查链
4. 任一层返回非 null → 立即返回该结果
5. confirmRequired 时调用 onConfirm 获取用户决策
6. setMode/getMode
7. addSessionRule / addPermanentRule

**验证：** `npx tsc --noEmit` 通过

## T7: ToolExecutor 集成权限检查

**文件：** `src/agent/tool_executor.ts`
**依赖：** T6
**步骤：**
1. ToolExecutor 构造器增加 permissionManager 参数
2. executeBatch() 中每个 toolUseBlock 执行前调用 permissionManager.check()
3. 如果 denied → yield tool_result(success=false, error="权限拒绝: ...")
4. 如果 allowed → 正常执行

**验证：** `npm test` 中 ToolExecutor 原有测试通过

## T8: Agent 集成 PermissionManager

**文件：** `src/agent/agent.ts`
**依赖：** T7
**步骤：**
1. Agent 构造器增加 permissionManager 参数
2. 传递确认回调给 permissionManager
3. 权限拒绝的 tool_result 正常处理（不终止循环）

**验证：** `npm test` 中 Agent 原有测试通过

## T9: main.ts 接入

**文件：** `src/main.ts`
**依赖：** T8
**步骤：**
1. 创建 PermissionManager 实例
2. 实现 confirmCallback 函数（readline 临时暂停 → 提问 → 等待输入）
3. 注入 ToolExecutor 和 Agent
4. 新增命令：/mode strict|default|permissive
5. 提示符显示权限模式（如 `[default] >`）
6. 与 plan mode 共存显示（如 `[plan] [default] >`）

**验证：** `npm run dev` 启动，/mode 切换正常，确认交互正常

## T10: 权限系统测试

**文件：** `src/permission/permission.test.ts`
**依赖：** T2-T6
**步骤：**
1. BlacklistChecker：黑名单命中/未命中
2. SandboxChecker：正常路径/路径逃逸/符号链接逃逸
3. RuleEngine：单层加载/多层覆盖/allow规则/deny规则/glob匹配/无匹配
4. ModeResolver：strict/default/permissive 各档行为
5. PermissionManager：集成测试（黑名单拦截不可覆盖、规则命中自动放行、strict 全部确认）

**验证：** `npm test` 中权限测试通过

## 执行顺序

```
T1 ──→ T2 ──→ T6 ──→ T7 ──→ T8 ──→ T9
  │     T3 ──┘
  │     T4 ──┘
  └──→ T5 ──→ T10
```

T2-T5 可并行。T6 依赖 T2-T5。T7 依赖 T6。T8 依赖 T7。T9 依赖 T8。T10 可在 T6 完成后直接开始。
