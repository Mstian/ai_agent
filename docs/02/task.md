# MewCode 第二阶段 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/tools/types.ts` | Tool 接口、ToolResult、ToolExecuteContext、ToolDefinition |
| 新建 | `src/tools/helpers.ts` | 超时封装、路径规范化、安全检查、输出截断 |
| 新建 | `src/tools/registry.ts` | ToolRegistry：注册、查找、toAPIFormat() |
| 新建 | `src/tools/read_file.ts` | ReadFileTool：读文件 |
| 新建 | `src/tools/write_file.ts` | WriteFileTool：写/覆盖文件 |
| 新建 | `src/tools/edit_file.ts` | EditFileTool：原文唯一匹配替换 |
| 新建 | `src/tools/run_command.ts` | RunCommandTool：执行 shell 命令（含安全过滤） |
| 新建 | `src/tools/glob.ts` | GlobTool：按模式查找文件 |
| 新建 | `src/tools/grep.ts` | GrepTool：搜索代码内容 |
| 新建 | `src/tools/tools.test.ts` | 所有工具的系统测试 |
| 修改 | `src/provider/types.ts` | +ToolUseEvent/ToolExecutingEvent/ToolResultEvent；Provider.streamChat +tools 参数 |
| 修改 | `src/provider/anthropic.ts` | 解析 input_json_delta 拼装 tool_use；请求体 +tools |
| 修改 | `src/provider/openai.ts` | 解析 delta.tool_calls 增量；请求体 +tools |
| 修改 | `src/provider/converter.ts` | tool 消息转换 + OpenAI tool_calls 格式 |
| 修改 | `src/chat/manager.ts` | 工具执行协调流程：检测 tool_use → 执行 → 再调模型 |
| 修改 | `src/main.ts` | 注册工具 + 工具事件视觉效果 |

## T1: 工具系统基础设施

**文件：** `src/tools/types.ts`, `src/tools/helpers.ts`
**依赖：** 无
**步骤：**
1. 定义 Tool 接口：name、description、parameters、execute
2. 定义 ToolExecuteContext、ToolResult、ToolDefinition 类型
3. 定义 ToolError 异常类
4. helpers.ts 实现：resolvePath（防路径逃逸）、withTimeout、checkDangerousCommand（黑名单）、isBinary、truncateOutput、ok/fail

**验证：** `npx tsc --noEmit` 通过

## T2: 工具注册中心

**文件：** `src/tools/registry.ts`
**依赖：** T1
**步骤：**
1. 实现 ToolRegistry 类
2. register(tool)：检查重名，存入 Map
3. get(name)：按名查找
4. getAll()：返回所有工具数组
5. toAPIFormat()：转为 API 工具列表格式

**验证：** TypeScript 编译无错误

## T3: 六个核心工具

**文件：** `src/tools/read_file.ts`, `write_file.ts`, `edit_file.ts`, `run_command.ts`, `glob.ts`, `grep.ts`
**依赖：** T1
**步骤：**
1. ReadFileTool：fs.readFileSync，防路径逃逸，限 1MB，检测二进制
2. WriteFileTool：mkdirSync(recursive) + writeFileSync，防路径逃逸
3. EditFileTool：indexOf 计次，0次报"未找到"，≥2次报"匹配N处"，1次替换
4. RunCommandTool：黑名单检查，execSync，超时，输出截断 20000 字符
5. GlobTool：手写递归遍历 + 轻量 glob 匹配（支持 * ** ?）
6. GrepTool：递归遍历 + RegExp 搜索，忽略 node_modules 等，每文件最多 10 行

**验证：** 每个工具 TypeScript 编译无错误

## T4: Provider 类型扩展

**文件：** `src/provider/types.ts`
**依赖：** T1
**步骤：**
1. 新增 ToolUseEvent、ToolExecutingEvent、ToolResultEvent 接口
2. 更新 StreamEvent 联合类型包含新事件
3. Provider 接口 streamChat 方法增加可选 tools 参数（默认 undefined）

**验证：** `npx tsc --noEmit` 通过（此时 anthropic.ts/openai.ts 会有类型错误，暂时可接受）

## T5: Anthropic Provider tool_use 解析

**文件：** `src/provider/anthropic.ts`
**依赖：** T4
**步骤：**
1. 添加 partialJsonBuffers: Map<number, string> 成员
2. content_block_delta 增加 input_json_delta 分支：追加 partial_json 到缓冲区
3. content_block_stop 中 tool_use block 完成时 JSON.parse 缓冲区 → yield ToolUseEvent
4. 请求体根据 tools 参数添加 tools 字段（Anthropic 格式）
5. 导入 ToolDefinition 类型

**验证：** `npx tsc --noEmit` 通过

## T6: OpenAI Provider tool_use 解析

**文件：** `src/provider/openai.ts`
**依赖：** T4
**步骤：**
1. 添加 pendingToolCalls: Map<number, { id, name, argsBuf }> 变量
2. delta 循环增加 delta.tool_calls 分支：按 index 归并 id/name/arguments 碎片
3. [DONE] 到达时 JSON.parse 各 argsBuf → yield ToolUseEvent → 加入 contentBlocks
4. 请求体根据 tools 参数添加 tools 字段（OpenAI function calling 格式）
5. 导入 ToolDefinition 类型

**验证：** `npx tsc --noEmit` 通过

## T7: MessageConverter 扩展

**文件：** `src/provider/converter.ts`
**依赖：** T4
**步骤：**
1. toOpenAIMessages 增加 tool role 消息处理：{ role: 'tool', tool_call_id, content }
2. toOpenAIMessages 增加 assistant 消息的 tool_calls 字段生成
3. contentToAnthropic 的 tool_result 分支完善

**验证：** `npm test` 中 MessageConverter 相关测试通过

## T8: ChatManager 工具执行流程

**文件：** `src/chat/manager.ts`
**依赖：** T2, T4
**步骤：**
1. 添加 toolRegistry 成员和 setToolRegistry 方法
2. sendMessage 修改为：
   a. 第一次调用 provider（带 tools），收集事件
   b. 检测到 tool_use → yield + 加入 contentBlocks
   c. done → 追加 assistant 消息
   d. 遍历 tool_use blocks → 查 registry → 执行工具 → 构造 tool_result → 注入 messages
   e. 第二次调用 provider（不带 tools）→ 收集模型基于工具结果的文字回复
3. 处理异常：工具不存在、工具执行异常
4. clear 和 getMessages 保持不变

**验证：** `npm test` 中 ChatManager 原有测试通过

## T9: main.ts 工具集成

**文件：** `src/main.ts`
**依赖：** T3, T8
**步骤：**
1. 导入 ToolRegistry 和六个工具类
2. 创建 registry 并注册六个工具
3. chatManager.setToolRegistry(registry)
4. 在事件 switch 中添加 tool_use（⚡）、tool_executing（🔧）、tool_result（✅/❌）视觉效果
5. done 事件增加处理（不做额外操作）
6. system prompt 更新为支持工具的描述
7. 移除第一阶段的重复 You 打印

**验证：** `npm run dev` 启动后工具系统正常工作

## T10: 工具系统测试

**文件：** `src/tools/tools.test.ts`
**依赖：** T1-T3
**步骤：**
1. helpers 测试：resolvePath（正常/逃逸）、checkDangerousCommand（拦截/通过）、isBinary、withTimeout（正常/超时）
2. ToolRegistry 测试：注册/查找/重名抛错/toAPIFormat
3. ReadFileTool 测试：读取存在的文件/不存在/目录/空路径（使用临时目录，cwd 设为临时目录）
4. WriteFileTool 测试：创建新文件/覆盖已有/递归建目录
5. EditFileTool 测试：唯一匹配替换/0次匹配/多处匹配/空old_string
6. RunCommandTool 测试：echo/危险命令拦截/命令失败/空命令
7. GlobTool 测试：按扩展名/递归匹配/无匹配
8. GrepTool 测试：搜索文本/忽略node_modules/include过滤/无匹配

**验证：** `npm test` 全部 66 个测试通过

## 执行顺序

```
T1 ──→ T2 ──→ T3 ──→ T10（工具测试）
  │
  └──→ T4 ──→ T5 ──→ T7 ──→ T8 ──→ T9
         │     │              /
         └──→ T6 ───────────┘
```

配置层（不变）、Provider 已有测试（不变）、Chat 已有测试（不变）。

T3 和 T4-T7 可并行开发。T8 依赖工具系统和 Provider 扩展都完成。T10 可在 T3 完成后立即开始。

## 依赖关系总结

- T1（types + helpers）→ 所有工具相关任务的基础
- T2（registry）→ T8（ChatManager 调用 registry）
- T3（六个工具）→ T10（测试）+ T9（注册）
- T4（types 扩展）→ T5 + T6 + T7
- T5 + T6 + T7 → T8（ChatManager 调用更新后的 Provider）
- T8 → T9（main.ts 集成）
