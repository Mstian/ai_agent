# MewCode 第一阶段 Checklist

> 每一项通过运行代码或观察行为来验证，聚焦系统行为。

## 实现完整性
- [ ] ConfigManager 正确加载 YAML 配置（验证：创建测试 .mewcode.yaml，运行 `ConfigManager.load()` 返回正确对象）
- [ ] ProviderFactory 根据 protocol 创建对应实例（验证：分别传入 anthropic 和 openai，得到正确 Provider 类型）
- [ ] ChatManager 维护多轮对话上下文（验证：连续 sendMessage 3 次，getMessages() 返回 6 条消息）
- [ ] TUI 启动后显示对话界面和输入提示符（验证：肉眼观察终端界面）
- [ ] `/clear` 命令清空上下文（验证：发一条消息后执行 `/clear`，getMessages() 仅剩 system prompt）
- [ ] `/exit` 命令退出程序（验证：输入 `/exit`，进程正常退出返回码 0）

## 集成
- [ ] ConfigManager → ProviderFactory → ChatManager 链路串联正确（验证：`main.ts` 执行到 Ink 渲染不报错）
- [ ] ChatManager 调用 Provider.streamChat 并透传 StreamEvent（验证：TUI 收到流式事件并渲染）
- [ ] Provider 层不依赖 TUI（验证：单独 import Provider 模块，无 Ink 相关依赖报错）

## 编译与测试
- [ ] `npx tsc --noEmit` 无类型错误
- [ ] `npm test` 所有单元测试通过
- [ ] Config 层测试覆盖：正常加载、优先级、缺文件、缺字段、非法 protocol
- [ ] Provider 层测试覆盖：Factory 创建、MessageConverter 转换、SSE 解析（mock fetch）
- [ ] Chat 层测试覆盖：消息追加、上下文清空、副本隔离、中断保留

## 端到端场景

### E2E1: 基本对话（对应 AC1, AC2, AC3）
1. 在项目目录创建 `.mewcode.yaml`，配置 Anthropic
2. 启动 `npx tsx src/main.ts`
3. 看到 TUI 界面，底部有输入提示
4. 输入 "你好，我叫小明"
5. 看到 AI 回复流式逐字打印
6. 输入 "我叫什么名字？"
7. AI 回答包含 "小明"
8. **期望结果：** 界面正常，流式输出，多轮记忆正常

### E2E2: 上下文清空（对应 AC4）
1. 接 E2E1，输入 "我喜欢猫"
2. 输入 `/clear`
3. 输入 "刚才我说喜欢什么动物？"
4. AI 表示不知道之前的对话
5. **期望结果：** clear 后 AI 不再记得上下文

### E2E3: OpenAI 切换（对应 AC7）
1. 修改 `.mewcode.yaml`，protocol 改为 openai，配置 OpenAI 模型和 key
2. 启动 MewCode
3. 输入问题，正常流式回复
4. **期望结果：** OpenAI 后端正常工作

### E2E4: 流式中断（对应 AC9）
1. 启动 MewCode
2. 输入一个需要较长回复的问题
3. 在回复过程中按 Ctrl+C
4. 已打印的部分保留，程序不退出，可以继续输入
5. **期望结果：** 中断不退出，部分内容保留

### E2E5: 配置错误处理（对应 AC6）
1. 删除或重命名 `.mewcode.yaml`
2. 启动 MewCode
3. 看到错误提示：找不到配置文件，建议创建
4. 程序退出（或提示后退出）
5. **期望结果：** 明确的错误提示，不是 crash

### E2E6: 程序退出（对应 AC5）
1. 启动 MewCode
2. 输入 `/exit`
3. 程序正常退出，返回终端
4. **期望结果：** 无报错，终端恢复正常
