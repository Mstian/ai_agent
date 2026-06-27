# MewCode 第八阶段 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/memory/types.ts` | 记忆系统所有类型定义 |
| 新建 | `src/memory/instruction_loader.ts` | F1: 三层加载 + @include 展开 |
| 新建 | `src/memory/session_archiver.ts` | F2: JSONL 追加写 |
| 新建 | `src/memory/session_recovery.ts` | F3: 会话恢复 + 过期清理 |
| 新建 | `src/memory/memory_index.ts` | E: 索引读写 + 大小限制 |
| 新建 | `src/memory/auto_notes.ts` | D: 异步 LLM 记忆提取 |
| 新建 | `src/memory/memory_manager.ts` | F: 总入口 |
| 新建 | `src/memory/memory.test.ts` | 记忆系统测试 |
| 修改 | `src/prompt/manager.ts` | 接收 long_term_memory 参数 |
| 修改 | `src/chat/manager.ts` | 消息追加时通知 MemoryManager |
| 修改 | `src/agent/agent.ts` | 循环结束后触发 AutoNotes |
| 修改 | `src/main.ts` | 创建 MemoryManager + 会话恢复 |

## T1: 记忆系统类型定义

**文件：** `src/memory/types.ts`
**依赖：** 无
**步骤：**
1. 定义 MemoryNote 接口（name, description, metadata.type, content）
2. 定义 SessionRecord 联合类型（session_meta | message）
3. 定义 SessionSummary 接口（id, startedAt, messageCount, lastActiveAt）
4. 定义 InstructionFile 接口（path, layer, content）
5. 定义记忆笔记 frontmatter 结构

**验证：** `npx tsc --noEmit` 通过

## T2: InstructionLoader 实现

**文件：** `src/memory/instruction_loader.ts`
**依赖：** T1
**步骤：**
1. 实现 `scanFiles(root)` — 扫描三层目录的指令文件
   - L1: `<root>/CLAUDE.md`、`<root>/AGENTS.md`
   - L2: `<root>/.mewcode/*.md`（CLAUDE.md 除外）
   - L3: `~/.mewcode/*.md`
2. 实现 `resolveIncludes(content, baseDir, visited, depth)` — 递归展开 @include
   - 匹配行级 `@include <path>` 语法
   - 嵌套深度 > 3 时跳过并打印警告
   - visited 集合防环
   - 解析后绝对路径必须包含 projectRoot 前缀，否则拦截
3. 实现 `load()` — 按 layer 优先级拼接（project > project_config > user），高优先级在前

**验证：** `npx tsc --noEmit` 通过；手动创建测试指令文件，调用 load() 观察输出顺序和 @include 展开

## T3: SessionArchiver 实现

**文件：** `src/memory/session_archiver.ts`
**依赖：** T1
**步骤：**
1. 实现 session ID 生成：`YYYYMMDD-HHMMSS-xxxx`（xxxx = crypto.randomBytes(2).toString('hex')）
2. 实现 `startSession(cwd)` — 创建 JSONL 文件，写 meta 行
3. 实现 `appendMessage(role, content)` — `fs.appendFileSync` 追加一行 JSON
4. 实现 `endSession()` — 清理状态
5. 实现 `getCurrentSessionId()` — 返回当前会话 ID

**验证：** `npx tsc --noEmit` 通过；调用 startSession → appendMessage，检查文件存在且格式正确

## T4: SessionRecovery 实现

**文件：** `src/memory/session_recovery.ts`
**依赖：** T1, T3
**步骤：**
1. 实现 `listSessions()` — 扫描 sessions 目录，读每个 JSONL 首行 meta + 总行数
2. 实现 `recover(sessionId)` —
   a. 逐行读 JSONL，JSON.parse 失败则跳过（坏行）
   b. 跳过 meta 行，提取 message 行转为 Message[]
   c. 检查最后一条 assistant 消息：如果含 tool_use block 但无对应 tool_result，移除未配对 block
   d. 检查 lastActiveAt，距今 > 24h 则插入时间跨度提醒 system 消息
   e. 估算 token 数，> 87K 则标记 needsCompress
3. 实现 `cleanExpired(maxAgeDays=30)` — 检查 mtime，删除过期文件

**验证：** `npx tsc --noEmit` 通过；构造坏行 JSONL 测试跳过，构造未配对 tool_use 测试截断

## T5: MemoryIndex 实现

**文件：** `src/memory/memory_index.ts`
**依赖：** T1
**步骤：**
1. 实现 `load()` — 读 MEMORY.md，检查行数 ≤ 200、大小 ≤ 25KB，超限按 mtime 截断保留最新
2. 实现 `rebuild()` — 扫描 memory 目录所有 .md（除 MEMORY.md），读 frontmatter 提取 name/description/metadata.type，生成索引行
3. 实现 `getContent()` — 返回缓存的索引内容
4. 索引行格式：`- [description](filename.md) — 一句话描述`

**验证：** `npx tsc --noEmit` 通过；创建 mock 笔记文件，调用 rebuild() 检查 MEMORY.md 生成内容

## T6: AutoNotes 实现

**文件：** `src/memory/auto_notes.ts`
**依赖：** T1, T5
**步骤：**
1. 构造提取 prompt：包含四分类说明 + 对话摘要 + 现有 MEMORY.md 内容
2. 实现 `tryExtract(messages, cwd)` —
   a. 调 Provider.streamChat（不带 tools）
   b. 解析 LLM 返回的结构化结果（要求 LLM 返回 JSON 格式的 MemoryNote[]）
   c. 对每条结果：新增或更新 .md 文件（frontmatter + body）
   d. 调用 MemoryIndex.rebuild() 刷新索引
3. 错误处理：LLM 调用失败时静默跳过，不抛异常

**验证：** `npx tsc --noEmit` 通过

## T7: MemoryManager 实现

**文件：** `src/memory/memory_manager.ts`
**依赖：** T2, T3, T4, T5, T6
**步骤：**
1. 构造器创建所有子模块实例
2. 实现 `initialize()` — 并行加载指令和索引，清理过期会话，返回可恢复会话列表
3. 实现 `startSession(cwd)` — 委托 SessionArchiver
4. 实现 `archiveMessage(role, content)` — 委托 SessionArchiver
5. 实现 `extractMemories(messages)` — fire-and-forget 调 AutoNotes.tryExtract
6. 实现 `recoverSession(id)` — 委托 SessionRecovery.recover

**验证：** `npx tsc --noEmit` 通过

## T8: PromptManager 改造

**文件：** `src/prompt/manager.ts`
**依赖：** T7
**步骤：**
1. `getSystemPrompt()` 已支持 `long_term_memory` 变量，确认模板变量替换正确
2. `long_term_memory` 模块（priority 90）当前为空，确保有内容时正确渲染

**验证：** 传入 `long_term_memory: 'test memory'`，确认 system prompt 中包含该内容

## T9: ChatManager 改造

**文件：** `src/chat/manager.ts`
**依赖：** T7
**步骤：**
1. 添加 `setSessionArchiver(archiver)` 方法接收 SessionArchiver 引用
2. 在 `addUserMessage()`、`addAssistantMessage()`、`addToolResult()` 中调用 archiver.appendMessage()

**验证：** `npm test` 中原有 chat 测试通过

## T10: Agent 改造

**文件：** `src/agent/agent.ts`
**依赖：** T7
**步骤：**
1. 添加 `setMemoryManager(mm)` 方法
2. 在 `run()` 方法返回前（task_completed 处），调用 `memoryManager.extractMemories(messages)`（fire-and-forget）
3. 也处理 max_iterations 结束时的记忆提取

**验证：** `npm test` 中原有 agent 测试通过

## T11: main.ts 接入

**文件：** `src/main.ts`
**依赖：** T7, T8, T9, T10
**步骤：**
1. 创建 MemoryManager 实例
2. 调用 `await memoryManager.initialize()` 获取指令和记忆
3. 将 customInstructions 和 longTermMemory 传给 PromptManager.getSystemPrompt()
4. 将 SessionArchiver 注入 ChatManager
5. 将 MemoryManager 注入 Agent
6. 启动时展示可恢复会话列表（如有），用户可选择恢复
7. 新对话时调用 `memoryManager.startSession()`

**验证：** `npm run dev` 启动，观察启动日志，确认指令和记忆被加载

## T12: 记忆系统测试

**文件：** `src/memory/memory.test.ts`
**依赖：** T2-T7
**步骤：**
1. InstructionLoader：三层加载优先级、@include 展开、深度限制、防环、路径拦截
2. SessionArchiver：会话创建、消息追加、ID 格式
3. SessionRecovery：坏行跳过、未配对截断、时间跨度提醒、过期清理
4. MemoryIndex：索引重建、大小限制截断
5. MemoryManager：initialize 集成

**验证：** `npm test` 全部通过

## 执行顺序

```
T1 ──→ T2 ──→ T7 ──→ T8 ──→ T9 ──→ T10 ──→ T11
  │                      │
  ├──→ T3 ──→ T4 ──→ T7 ─┘
  │
  ├──→ T5 ──→ T6 ──→ T7
  │
  └──→ (T12 在所有实现完成后)
```

T2、T3、T5 可并行开发；T4 依赖 T3；T6 依赖 T5；T7 依赖 T2-T6 全部；T8-T11 串行集成；T12 最后。
