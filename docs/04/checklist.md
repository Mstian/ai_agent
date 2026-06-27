# MewCode 第四阶段 Checklist

> 每一项通过运行代码或观察行为来验证，聚焦系统行为。

## 实现完整性

- [ ] 7 个固定模块全部定义且内容非空（验证：modules.ts 导出的 getDefaultModules() 返回 7 个 enabled 模块）
- [ ] PromptBuilder 按 priority 排序拼装（验证：注册 priority=5 和 priority=1 的模块，build() 结果中 priority=1 在前）
- [ ] 禁用模块不出现在 build() 结果中（验证：disable('tone') 后 build() 不含语气风格内容）
- [ ] 模板变量正确替换（验证：content 含 {{cwd}}，build({cwd:'/test'}) 结果含 '/test'）
- [ ] PromptManager.generateSystemMessages turn=1 返回完整环境+mode 消息（验证：消息数 ≥ 2）
- [ ] PromptManager.generateSystemMessages turn=4（每3轮）返回完整 mode 消息（验证：turn=4 时包含完整 mode 规则）
- [ ] PromptManager.generateSystemMessages turn=2 plan mode 返回精简提醒（验证：一行，含"规划模式"）
- [ ] PromptManager.generateSystemMessages turn=2 full mode 不返回模式消息（验证：消息数 = 0）
- [ ] CacheMonitor 正确提取 Anthropic usage 字段（验证：mock usage 含 cache_read_input_tokens=5000，extractFromUsage 返回正确值）
- [ ] DoneEvent 携带 cacheInfo（验证：AnthropicProvider mock SSE 含 usage，done 事件含 cacheInfo）
- [ ] 6 个工具 description 包含强化规则（验证：edit_file description 含"先 read_file"）
- [ ] Agent 每轮注入 system 消息（验证：mock 模式下 messages 中包含 [SystemInstruction] 标记的消息）

## 集成

- [ ] Agent 通过 PromptManager 获取 system prompt 而非硬编码（验证：main.ts 不再有 SYSTEM_PROMPT 常量）
- [ ] /plan 命令更新 task_mode 模块（验证：切换后 getSystemPrompt 中 mode 规则变为规划模式内容）
- [ ] ChatManager 正确注入 system 消息到 messages 数组（验证：注入后 getMessages 含 system 角色消息）
- [ ] AnthropicProvider message_start 解析不破坏现有 SSE 流程（验证：原有 tool_use 测试通过）

## 编译与测试

- [ ] `npx tsc --noEmit` 无类型错误
- [ ] `npm test` 全部测试通过（含原有 77 个 + 新增 prompt 测试）
- [ ] 原有 Agent/ChatManager/Provider/Tools 测试不受影响

## 端到端场景

### E2E1: 模块化 system prompt 生效（对应 AC1）
1. 启动 MewCode
2. 输入 "帮我改一下 src/main.ts，把 streamChar 函数重命名为 writeChar"
3. Agent 先调用 read_file 查看文件 → 再调用 edit_file 替换
4. **期望结果：** 编辑前先读文件（工具使用模块的规则生效）

### E2E2: 优先用专用工具（对应 AC2）
1. 启动 MewCode
2. 输入 "找到所有 TypeScript 文件"
3. Agent 调用 glob 工具而非 run_command('find ...')
4. **期望结果：** 优先使用 glob 而非 find 命令

### E2E3: Plan mode 约束生效（对应 AC4）
1. 启动 MewCode，输入 `/plan`
2. 输入 "创建一个 test.txt"
3. Agent 回复拒绝，说明当前处于规划模式
4. **期望结果：** plan mode 下模型拒绝修改操作

### E2E4: Plan mode 精简提醒（对应 AC6）
1. 启动 MewCode，输入 `/plan`
2. 连续发送 3 条消息
3. 观察第 2 条消息的 system 注入是否为精简一行
4. 第 3 条消息的注入又恢复完整版
5. **期望结果：** 轮次注入频率符合预期（首轮完整、第2轮精简、第4轮完整）

### E2E5: 缓存信息展示（对应 AC5）
1. 使用 Anthropic 协议启动 MewCode
2. 连续发送两条相同的消息
3. 第二条消息的 agent_done 事件包含 cacheInfo
4. **期望结果：** 终端显示缓存命中信息

### E2E6: 模块启用/禁用
1. 代码中 disable('tone')
2. 发送任意消息
3. Agent 回复风格不再受 tone 模块约束
4. **期望结果：** 禁用模块不影响其他模块正常拼装
