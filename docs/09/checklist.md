# MewCode 第九阶段 Checklist

> 每一项通过运行代码或观察行为来验证，聚焦系统行为。

## 实现完整性

- [ ] CommandRegistry 注册和查找（验证：register 后 get 返回正确 CommandDef）
- [ ] 别名冲突检测（验证：两个命令用同一别名 → register 抛错，含冲突信息）
- [ ] 名称与别名冲突检测（验证：命令 B 的名称 = 命令 A 的别名 → 抛错）
- [ ] Parser 识别斜杠命令（验证：`/plan` → ParseResult { commandName: 'plan', args: '' }）
- [ ] Parser 提取参数（验证：`/mode strict` → ParseResult { commandName: 'mode', args: 'strict' }）
- [ ] Parser 大小写不敏感（验证：`/PLAN`、`/Plan`、`/plan` 都命中 plan）
- [ ] Parser 非斜杠输入返回 null（验证：`'hello'` → null）
- [ ] Dispatcher 命中命令执行 handler（验证：`/plan` → Agent mode 变为 'plan'）
- [ ] Dispatcher 未命中显示 /help 引导（验证：`/unknown` → 提示"未知命令，输入 /help 查看可用命令"）
- [ ] Completer 单匹配自动补全（验证：`/com` + Tab → 补全为 `/compact`）
- [ ] Completer 多匹配返回列表（验证：`/p` + Tab → `[/plan, /permission]`）
- [ ] Completer 隐藏命令不参与补全（验证：隐藏命令不出现在补全列表中）
- [ ] 10 个内置命令全部可用（验证：逐个输入，观察正确执行）

## 集成

- [ ] 输入分流：斜杠命令不走 Agent（验证：`/plan` 后对话历史无新增消息）
- [ ] 非斜杠输入正常走 Agent（验证：`'hello'` → Agent 正常响应）
- [ ] `/plan` 切换模式后状态栏显示 `[plan]` 标记
- [ ] `/do` 恢复执行模式后状态栏 `[plan]` 标记消失
- [ ] `/compact` 触发对话压缩（验证：多轮对话后执行，观察压缩结果）
- [ ] `/review` 把代码审查 prompt 注入对话（验证：对话历史出现注入的 system 消息）
- [ ] `/clear` 清屏 + 清空对话（验证：清屏后对话历史只剩 system prompt）
- [ ] `/help` 列出所有可见命令，不含隐藏命令

## 编译与测试

- [ ] `npx tsc --noEmit` 无类型错误
- [ ] `npm test` 全部测试通过
- [ ] 原有测试不受影响

## 端到端场景

### E2E1: 模式切换流程（对应 AC1, AC2）
1. 启动 MewCode，状态栏显示 `>`
2. 输入 `/plan`，状态栏变为 `[plan] >`，Agent 模式切换
3. 输入 `/do`，状态栏恢复 `>`，Agent 模式恢复
4. 验证这期间对话历史没有增加任何消息

### E2E2: 命令补全（对应 AC6）
1. 输入 `/p` 按 Tab
2. 观察弹出菜单显示 `/plan` 和 `/permission`
3. 输入 `/com` 按 Tab
4. 观察自动补全为 `/compact`

### E2E3: 完整对话中的命令穿插（对应 AC1, AC7）
1. 输入"帮我写一个函数"
2. Agent 正常回复
3. 输入 `/status` 查看 Token 用量
4. 输入 `/compact` 压缩对话
5. 输入"继续优化这个函数"
6. Agent 继续正常工作
7. 验证以上过程无崩溃、测试全通过
