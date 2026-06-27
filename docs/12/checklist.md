# MewCode 第十二阶段 Checklist

> 每一项通过运行代码或观察行为来验证。

## 实现完整性

- [ ] RoleLoader 四级扫描（验证：listAll 返回合并后角色列表）
- [ ] 项目级角色覆盖内置（验证：项目级 code-reviewer.md 覆盖内置）
- [ ] SubAgentRunner 跑到底返回结果（验证：简单 prompt → 子 Agent 完成 → SubAgentResult）
- [ ] 子 Agent 达到 max_iterations 正常结束
- [ ] agent 工具定义式分流（验证：type='defined' → 加载角色 → 执行）
- [ ] agent 工具 Fork 式分流（验证：type='fork' → 继承消息 → 执行）
- [ ] 工具过滤：agent 工具不在子 Agent 列表中
- [ ] 工具过滤：角色白名单生效
- [ ] 工具过滤：角色黑名单生效
- [ ] 后台任务异步执行（验证：TaskManager.spawn 后立即返回 taskId）
- [ ] 后台任务完成后可获取结果

## 集成

- [ ] agent 工具注册到 ToolRegistry
- [ ] 主 Agent 可通过 tool_use 调用 agent 工具
- [ ] 后台任务完成后通知主 Agent
- [ ] 启动日志显示已加载角色数量

## 编译与测试

- [ ] `npx tsc --noEmit` 无类型错误
- [ ] `npm test` 全部测试通过
- [ ] 原有测试不受影响

## 端到端场景

### E2E1: 定义式子 Agent 代码审查（对应 AC1, AC3, AC4）
1. 启动 MewCode，在 .mewcode/subagents/ 放置自定义角色
2. 输入"请用 code-reviewer 角色审查 src/agent.ts"
3. 观察主 Agent 调用 agent 工具
4. 观察子 Agent 执行（run_command 等工具可用，agent 工具不可用）
5. 观察结果返回给主 Agent

### E2E2: Fork 式子 Agent 并行任务
1. 主 Agent 对话几轮后
2. 输入"同时审查 agent.ts 和 manager.ts"
3. 观察主 Agent fork 两个子 Agent
4. Fork 子 Agent 继承对话历史
5. 子 Agent 携带历史上下文正确审查
