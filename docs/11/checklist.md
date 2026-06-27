# MewCode 第十一阶段 Checklist

> 每一项通过运行代码或观察行为来验证。

## 实现完整性

- [ ] 条件匹配：精确匹配生效（验证：`pattern: "run_command"` 匹配 tool_name="run_command"）
- [ ] 条件匹配：反向匹配生效（验证：`pattern: "!write_file"` 不匹配 tool_name="write_file"）
- [ ] 条件匹配：正则匹配生效（验证：`pattern: "/rm\\s/"` 匹配 "rm -rf /"）
- [ ] 条件匹配：glob 匹配生效（验证：`pattern: "*.test.ts"` 匹配 "agent.test.ts"）
- [ ] matchMode 'all' AND 逻辑（验证：两个条件都满足才触发）
- [ ] matchMode 'any' OR 逻辑（验证：任一条件满足即触发）
- [ ] command 动作执行（验证：`echo "test"` 正确执行）
- [ ] prompt 动作返回文本（验证：text 被收集到 promptInjections）
- [ ] http 动作发起请求（验证：fetch 被调用）
- [ ] agent 动作占位不报错（验证：打印 TODO 日志）
- [ ] pre_tool_execute 拦截生效（验证：allowed=false 时工具不执行）
- [ ] Hook 执行失败不抛异常（验证：错误被 try/catch 捕获）
- [ ] YAML 非法规则跳过不阻断（验证：event 缺失的 Hook 跳过）

## 集成

- [ ] session_start 事件触发（验证：新会话开始时对应 Hook 执行）
- [ ] turn_start 事件触发（验证：每轮开始对应 Hook 执行）
- [ ] pre_tool_execute 在工具执行前触发
- [ ] post_tool_execute 在工具执行后触发
- [ ] agent_done 在 Agent 停止时触发
- [ ] Agent 注入 HookManager 后正常执行

## 编译与测试

- [ ] `npx tsc --noEmit` 无类型错误
- [ ] `npm test` 全部测试通过
- [ ] 原有测试不受影响

## 端到端场景

### E2E1: pre_tool_execute 拦截危险命令（对应 AC1, AC2）
1. 在 .mewcode/hooks.yaml 配置 pre_tool_execute Hook，command 模式匹配 "rm *" 并拒绝
2. 启动 MewCode，让 Agent 执行 `rm -rf test/`
3. 观察工具被拦截，Agent 收到拒绝原因
4. Agent 根据原因调整行为

### E2E2: turn_start 自动注入提示词
1. 配置 turn_start Hook，无条件注入"请使用中文回复"
2. 启动 MewCode，观察每轮 system prompt 包含该提示词

### E2E3: 错误隔离
1. 配置一个 command 为 "nonexistent_cmd_xyz" 的 Hook
2. 启动 MewCode
3. 观察 stderr 打印警告，Agent 正常运行不影响
