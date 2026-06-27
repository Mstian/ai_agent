# MewCode 第八阶段 Plan

## 架构概览

新增 `src/memory/` 模块，位于提示系统和 Agent 系统之间：

```
main.ts
  │
  ├── MemoryManager（新增，启动时创建）
  │   ├── InstructionLoader    — F1: 三层加载 + @include 展开
  │   ├── SessionArchiver      — F2: JSONL 追加写
  │   ├── SessionRecovery      — F3: 会话恢复 + 清理
  │   ├── AutoNotes            — F4: 异步 LLM 提取记忆
  │   └── MemoryIndex          — F5: 索引读写 + 大小限制
  │
  ├── PromptManager（修改：接收 long_term_memory 内容）
  │
  ├── Agent（修改：每轮结束后触发 AutoNotes）
  │
  └── ChatManager（修改：消息追加时同步写 SessionArchiver）
```

**数据流：**

```
启动时:
  InstructionLoader.load() → 拼装指令内容 → PromptManager.getSystemPrompt({custom_instructions})
  MemoryIndex.load() → 读 MEMORY.md → PromptManager.getSystemPrompt({long_term_memory})
  SessionRecovery.listSessions() → 展示可恢复会话列表

对话中:
  ChatManager.addXxx() → SessionArchiver.append(message)
  Agent.run() 每轮结束 → AutoNotes.tryExtract()（异步，不阻塞）

恢复时:
  SessionRecovery.recover(sessionId) → 修复后的 Message[] → ChatManager 初始化
```

## 核心数据结构

### MemoryNote（记忆笔记）

```typescript
interface MemoryNote {
  name: string;           // kebab-case slug，作为文件名
  description: string;    // 一行摘要，用于索引
  metadata: {
    type: 'user_preference' | 'correction' | 'project_knowledge' | 'reference';
  };
  content: string;        // Markdown 正文
}
```

### SessionRecord（JSONL 行记录）

```typescript
type SessionRecord =
  | { type: 'session_meta'; session_id: string; started_at: string; cwd: string }
  | { type: 'message'; role: string; content: unknown; timestamp: string };
```

### SessionSummary（会话列表摘要）

```typescript
interface SessionSummary {
  id: string;            // YYYYMMDD-HHMMSS-xxxx
  startedAt: string;     // ISO 时间
  messageCount: number;  // 消息数（从 JSONL 扫出）
  lastActiveAt: string;  // 最后活跃时间
}
```

### InstructionFile（指令文件）

```typescript
interface InstructionFile {
  path: string;       // 文件绝对路径
  layer: 'project' | 'project_config' | 'user';  // 来源层级
  content: string;    // 展开 @include 后的完整内容
}
```

## 模块设计

### 模块 A: InstructionLoader（instruction_loader.ts）

**职责：** 三层加载项目指令文件，解析 @include 指令，按优先级拼装。

**对外接口：**
```typescript
class InstructionLoader {
  constructor(projectRoot: string);
  load(): string;
  // 返回按优先级拼装好的完整指令文本（高优先级在前）
}
```

**内部逻辑：**
1. 扫描三层目录，收集指令文件列表
2. 对每个文件解析 @include 指令，递归展开
3. @include 展开限制：嵌套深度 ≤ 3，visited 集合防环，路径拦截 `..` 跳出
4. 按 layer 优先级排序（project > project_config > user），拼接输出

**依赖：** 无外部模块，纯文件系统操作。

### 模块 B: SessionArchiver（session_archiver.ts）

**职责：** 管理会话 JSONL 文件的创建和追加写入。

**对外接口：**
```typescript
class SessionArchiver {
  constructor(sessionsDir: string);
  
  // 开始新会话，返回会话 ID
  startSession(cwd: string): string;
  
  // 追加一条消息
  appendMessage(role: string, content: unknown): void;
  
  // 获取当前会话 ID（无当前会话返回 null）
  getCurrentSessionId(): string | null;
  
  // 结束当前会话（关闭文件句柄等清理）
  endSession(): void;
}
```

**内部逻辑：**
- `startSession()`：生成会话 ID（YYYYMMDD-HHMMSS-4位随机），创建 JSONL 文件，写 meta 行
- `appendMessage()`：`fs.appendFileSync` 追加一行 JSON + `\n`
- 不缓存，每条消息直接落盘

**依赖：** node:fs, node:crypto（randomBytes）

### 模块 C: SessionRecovery（session_recovery.ts）

**职责：** 列出现有会话、恢复指定会话、处理各种异常、过期清理。

**对外接口：**
```typescript
class SessionRecovery {
  constructor(sessionsDir: string);
  
  // 列出所有可恢复会话
  listSessions(): SessionSummary[];
  
  // 恢复指定会话，返回修复后的消息列表
  recover(sessionId: string): { messages: Message[]; meta: { cwd: string; startedAt: string } };
  
  // 清理过期会话（>30天）
  cleanExpired(maxAgeDays?: number): number;
}
```

**内部逻辑：**
- `listSessions()`：扫描 sessions 目录，读每个 JSONL 的首行（meta）和行数，不读全部内容
- `recover()`：
  1. 逐行读 JSONL，跳过 parse 失败的行（坏行）
  2. 检查最后一条消息是否 assistant 含 tool_use 但无对应 tool_result → 移除未配对 block
  3. 检查 lastActiveAt 距今 > 24h → 插入时间跨度提醒 system 消息
  4. Token 超限（>87K）→ 标记需要压缩，由 ContextManager 处理
- `cleanExpired()`：检查文件 mtime，删除 >30 天的

**依赖：** node:fs, node:path, ContextManager（仅 token 检查，不直接调用压缩）

### 模块 D: AutoNotes（auto_notes.ts）

**职责：** Agent 循环自然结束后，异步调 LLM 从对话中提取/更新长期记忆。

**对外接口：**
```typescript
class AutoNotes {
  constructor(memoryDir: string, provider: Provider);
  
  // 尝试从对话中提取记忆（异步，不阻塞）
  tryExtract(messages: Message[], cwd: string): Promise<void>;
}
```

**内部逻辑：**
1. 构造提取 prompt（包含对话摘要 + 现有 MEMORY.md 内容）
2. 调 LLM（不带 tools），要求 LLM 返回结构化结果
3. LLM 判断新增 / 更新 / 合并 / 跳过
4. 写新笔记文件（frontmatter markdown）或更新已有文件
5. 更新 MEMORY.md 索引

**依赖：** Provider（复用现有 LLM 连接），MemoryIndex

### 模块 E: MemoryIndex（memory_index.ts）

**职责：** 读写 MEMORY.md 索引文件，控制大小。

**对外接口：**
```typescript
class MemoryIndex {
  constructor(memoryDir: string);
  
  // 加载索引内容（返回 Markdown 文本）
  load(): string;
  
  // 根据当前 memory 目录重建索引
  rebuild(): void;
  
  // 获取索引内容（缓存版本）
  getContent(): string;
}
```

**内部逻辑：**
- `load()`：读 MEMORY.md，检查行数和大小，超限则截断（保留最新 200 行）
- `rebuild()`：扫描 memory 目录下所有 .md 文件（除 MEMORY.md），读 frontmatter，生成索引行
- 索引行格式：`- [description](filename.md) — 简要说明`
- 按更新时间降序排列

**依赖：** 无外部模块，纯文件操作。

### 模块 F: MemoryManager（memory_manager.ts）

**职责：** 总入口，协调所有子模块，对上层（main.ts、Agent）提供统一接口。

**对外接口：**
```typescript
class MemoryManager {
  constructor(projectRoot: string, provider: Provider);
  
  // 启动时加载所有记忆
  async initialize(): Promise<{
    customInstructions: string;   // 项目指令文件内容
    longTermMemory: string;       // MEMORY.md 索引内容
    recoverableSessions: SessionSummary[];
  }>;
  
  // 开始新会话
  startSession(cwd: string): void;
  
  // 追加消息到会话存档
  archiveMessage(role: string, content: unknown): void;
  
  // Agent 循环结束后提取记忆
  extractMemories(messages: Message[]): void;  // fire-and-forget
  
  // 恢复指定会话
  recoverSession(sessionId: string): { messages: Message[]; meta: { cwd: string; startedAt: string } };
  
  // 获取会话存档器（供 ChatManager 使用）
  getSessionArchiver(): SessionArchiver | null;
}
```

**依赖：** 所有子模块（A-E）

## 模块交互

```
启动:
  main.ts
    → MemoryManager.initialize()
      → InstructionLoader.load() → customInstructions
      → MemoryIndex.load() → longTermMemory
      → SessionRecovery.listSessions() → recoverableSessions
      → SessionRecovery.cleanExpired()
    → PromptManager.getSystemPrompt({ custom_instructions, long_term_memory })

新对话:
  main.ts → MemoryManager.startSession(cwd)
    → SessionArchiver.startSession(cwd)

对话中:
  ChatManager.addUserMessage() → MemoryManager.archiveMessage('user', content)
  ChatManager.addAssistantMessage() → MemoryManager.archiveMessage('assistant', content)
  ChatManager.addToolResult() → MemoryManager.archiveMessage('tool', content)

循环结束:
  Agent.run() 返回前 → MemoryManager.extractMemories(messages)
    → AutoNotes.tryExtract(messages)  [异步，fire-and-forget]
      → LLM 调用 → MemoryIndex.rebuild()

会话恢复:
  main.ts → MemoryManager.recoverSession(id)
    → SessionRecovery.recover(id) → 修复后 Message[]
    → ChatManager 用恢复的消息初始化
```

## 文件组织

```
mewcode/
├── src/
│   ├── memory/                      # 新建
│   │   ├── types.ts                 # 记忆系统所有类型定义
│   │   ├── instruction_loader.ts    # A: 三层加载 + @include
│   │   ├── session_archiver.ts      # B: JSONL 追加写
│   │   ├── session_recovery.ts      # C: 会话恢复 + 清理
│   │   ├── auto_notes.ts            # D: 异步 LLM 记忆提取
│   │   ├── memory_index.ts          # E: 索引读写
│   │   ├── memory_manager.ts        # F: 总入口
│   │   └── memory.test.ts           # 测试
│   ├── agent/
│   │   └── agent.ts                 # 修改：循环结束后触发 AutoNotes
│   ├── chat/
│   │   └── manager.ts               # 修改：消息追加时通知 MemoryManager
│   ├── prompt/
│   │   └── manager.ts               # 修改：接收 long_term_memory 参数
│   └── main.ts                      # 修改：创建 MemoryManager，会话恢复
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| JSONL 写入方式 | `fs.appendFileSync` 同步追加 | 追加写极快（<1ms），同步保证顺序，崩溃只丢最后一行 |
| 会话 ID 生成 | 时间戳 + 4 位 crypto.randomBytes hex | 可读性好 + 同秒防撞 |
| @include 路径安全 | 解析后检查绝对路径是否在 projectRoot 内 | 简单可靠，不依赖正则 |
| 自动笔记触发 | Agent 循环自然结束后 fire-and-forget | 不阻塞用户，失败不影响主流程 |
| 记忆去重 | 完全交给 LLM 判断 | 语义去重需要理解力，规则匹配做不到 |
| 索引大小控制 | 200 行硬上限 + 按更新时间截断 | 简单可控，~2-3K tokens |
| 会话恢复 token 超限 | 标记需压缩 + 复用 ContextManager | 不重复实现压缩逻辑 |
| 项目指令文件加载时机 | 启动时一次性加载 | 手写文件不会在运行中变化 |
| @include 展开方式 | 递归 + visited set | 标准环路检测方案，简洁可靠 |
| 记忆存储格式 | 每个笔记一个 .md + frontmatter | 人可读、编辑器友好、与 Claude Code 兼容 |
