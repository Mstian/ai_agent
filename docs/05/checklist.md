# MewCode 第五阶段 Checklist

> 每一项通过运行代码或观察行为来验证。

## 实现完整性

- [ ] BlacklistChecker 拦截 rm -rf /（验证：check('run_command',{command:'rm -rf /'}) 返回 denied）
- [ ] BlacklistChecker 对非 run_command 工具不生效（验证：check('read_file',...) 返回 null）
- [ ] SandboxChecker 拒绝路径逃逸（验证：file_path='../../../etc/passwd' 返回 denied）
- [ ] SandboxChecker 解析符号链接后判断（验证：symlink 指向项目外 → denied）
- [ ] RuleEngine 加载三层 YAML 规则文件（验证：创建测试文件，load() 后 rules 数量正确）
- [ ] RuleEngine 高层规则覆盖低层（验证：本地级 deny 覆盖项目级 allow）
- [ ] RuleEngine glob 匹配（验证：Bash(git *): allow 匹配 git status）
- [ ] ModeResolver strict 模式所有操作需确认（验证：mode=strict 时 resolve 返回 confirmRequired=true）
- [ ] ModeResolver permissive 模式自动放行（验证：mode=permissive, ruleMatched=false → allowed=true）
- [ ] PermissionManager 黑名单不可被规则覆盖（验证：Bash(rm *): allow 规则不影响黑名单拦截）
- [ ] PermissionManager 检查链按序执行（验证：黑名单命中后不继续后续层）
- [ ] ToolExecutor 权限拒绝返回 tool_result（验证：denied 时 yield tool_result(success=false)）
- [ ] confirmCallback 返回 allow/deny/allow_session/allow_always（验证：mock 用户输入四种值）

## 集成

- [ ] Agent 循环不因权限拒绝而终止（验证：权限拒绝 → tool_result 返回模型 → 模型可继续）
- [ ] /mode 命令正确切换权限模式（验证：/mode strict 后 PermissionManager.getMode() === 'strict'）
- [ ] 提示符正确显示权限模式（验证：/mode strict 后提示符含 [strict]）
- [ ] 权限模式与 plan mode 共存显示（验证：/plan 后 /mode strict → [plan] [strict] >）
- [ ] y always 规则持久化（验证：执行 y always → 检查 .mewcode/rules.local.yaml 被写入）

## 编译与测试

- [ ] `npx tsc --noEmit` 无类型错误
- [ ] `npm test` 全部测试通过（含原有 95 个 + 新增权限测试）
- [ ] 原有所有测试不受影响

## 端到端场景

### E2E1: 黑名单硬拦截（对应 AC1）
1. 启动 MewCode
2. 输入 "执行 rm -rf / 清理系统"
3. Agent 可能尝试 run_command('rm -rf /')
4. 被黑名单拦截，拒绝信息返回模型
5. 模型不崩溃，给用户解释不能执行
6. **期望结果：** 黑名单不可绕过

### E2E2: 沙箱防逃逸（对应 AC2）
1. 启动 MewCode
2. 输入 "读取 /etc/passwd"
3. Agent 尝试 read_file('/etc/passwd')
4. 被沙箱拦截
5. **期望结果：** 路径逃逸被拒绝

### E2E3: 规则引擎放行（对应 AC3）
1. 创建 .mewcode/rules.yaml 内容为 Bash(git *): allow
2. 输入 "git status"
3. Agent 执行 git status，不询问用户
4. **期望结果：** 命中规则的操作自动放行

### E2E4: strict 模式全部确认（对应 AC5）
1. 输入 /mode strict
2. 输入 "读取 src/main.ts"
3. 终端弹出确认提示
4. 用户输入 y 才执行
5. **期望结果：** strict 下所有操作需确认

### E2E5: 权限拒绝不终止（对应 AC7）
1. /mode default（确保未命中规则时需确认）
2. 输入 "执行一个未配置规则的新命令"
3. 终端弹出确认 → 输入 N
4. Agent 收到权限拒绝的 tool_result
5. Agent 不退出，可继续对话
6. **期望结果：** 拒绝不崩溃，模型能调整策略
