# MewCode 第二阶段 Checklist

> 每一项通过运行代码或观察行为来验证，聚焦系统行为。

## 实现完整性

- [ ] ReadFileTool 正确读取文本文件（验证：创建临时文件，调用 execute 返回文件内容）
- [ ] ReadFileTool 拒绝路径逃逸（验证：传入 ../../../etc/passwd，返回失败）
- [ ] WriteFileTool 创建/覆盖文件（验证：写入后 readFileSync 检查内容一致）
- [ ] EditFileTool 唯一匹配替换（验证：写入包含特定内容的文件，替换后验证）
- [ ] EditFileTool 匹配 0 次报错（验证：old_string 不存在，返回"未找到匹配"）
- [ ] EditFileTool 匹配 ≥2 次报错（验证：old_string 出现两次，返回"匹配 N 处"）
- [ ] RunCommandTool 执行正常命令（验证：echo hello 返回 hello）
- [ ] RunCommandTool 拦截危险命令（验证：rm -rf / 被安全检查拒绝）
- [ ] GlobTool 按模式匹配文件（验证：创建临时文件结构，匹配 *.ts 返回正确列表）
- [ ] GrepTool 搜索代码内容（验证：创建含特定文本的文件，搜索返回匹配行）
- [ ] GrepTool 忽略 node_modules（验证：在 node_modules 中放匹配文件，结果不包含它）
- [ ] ToolRegistry 注册/查找/去重（验证：注册后 get 返回正确实例，重复注册抛错）
- [ ] ToolRegistry.toAPIFormat() 返回正确格式（验证：输出包含 name、description、input_schema）
- [ ] ChatManager 检测 tool_use 并执行工具（验证：mock Provider 返回 tool_use 事件，工具被执行）
- [ ] ChatManager 工具执行后调用模型生成回复（验证：tool_result 注入后收到第二次响应的 text_delta）

## 集成

- [ ] main.ts 正确注册六个工具并注入 ChatManager（验证：启动不报错）
- [ ] AnthropicProvider 正确解析 input_json_delta（验证：mock SSE 含 tool_use，yield ToolUseEvent）
- [ ] OpenAIProvider 正确解析 delta.tool_calls（验证：mock SSE 含 tool_calls，yield ToolUseEvent）
- [ ] MessageConverter 正确转换 tool 消息（验证：tool role 消息转 OpenAI 格式正确）
- [ ] 第一次调用传 tools，第二次调用不传 tools（验证：查看代码或 mock 验证 streamChat 参数）
- [ ] 所有 Message 类型 (user/assistant/system/tool) 在对话历史中正确流转

## 编译与测试

- [ ] `npx tsc --noEmit` 无类型错误
- [ ] `npm test` 全部 66 个测试通过
- [ ] Config 层测试不变（8 个）
- [ ] Provider 层测试不变（Factory + Converter + Anthropic + OpenAI 共 15 个）
- [ ] Chat 层测试不变（8 个，加上原有覆盖）
- [ ] 工具系统测试全部通过（Helpers + Registry + 6 Tools 共 35 个）

## 端到端场景

### E2E1: 工具调用读文件（对应 AC1）
1. 启动 MewCode
2. 输入 "帮我看看 src/main.ts 的内容"
3. 终端显示：⚡ 准备调用 read_file
4. 终端显示：🔧 正在执行 read_file
5. 终端显示：✅ read_file 完成
6. MewCode 展示文件内容摘要
7. **期望结果：** 工具调用成功，模型基于文件内容生成回复

### E2E2: 普通对话不受影响（对应 AC3）
1. 启动 MewCode
2. 输入 "你好，什么是 TypeScript？"
3. 模型直接用文字回复，不触发工具调用
4. **期望结果：** 不带工具意图的对话依然正常流式输出

### E2E3: 工具不存在时优雅报错（对应 AC4）
1. （需要构造：mock 一个不存在的工具调用）
2. 观察终端显示：❌ 失败: 未知工具
3. **期望结果：** 程序不崩溃，错误信息清晰

### E2E4: 连续多轮对话
1. 启动 MewCode
2. 输入 "帮我看看 src/main.ts"
3. 模型调用 read_file 并回复
4. 输入 "这个文件有几个 import？"
5. 模型能基于上一轮读取的内容回答
6. **期望结果：** 多轮对话 + 工具调用的上下文正确保持

### E2E5: 危险命令拦截（对应 AC6）
1. （需要构造：让模型尝试执行危险命令）
2. 直接调用 RunCommandTool.execute({ command: 'rm -rf /' })
3. 返回 success: false，error 包含"安全检查"
4. **期望结果：** 危险命令被拦截，不会执行

### E2E6: Edit 多处匹配报错（对应 AC5）
1. 写入临时文件，包含两行相同的 "TODO: fix"
2. 调用 EditFileTool.execute({ file_path, old_string: 'TODO: fix', new_string: 'DONE' })
3. 返回 success: false，error 包含"2 处"
4. **期望结果：** 多处匹配被检测到，文件未被修改

### E2E7: 类型检查通过（对应 AC9）
1. 运行 `npx tsc --noEmit`
2. 无错误输出
3. **期望结果：** 零类型错误
