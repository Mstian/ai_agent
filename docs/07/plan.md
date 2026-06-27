# MewCode 第七阶段 Plan

## 架构概览

新增上下文管理层，在 Agent 循环中每次 LLM 调用前自动执行：

```
Agent.run() 每轮循环
  │
  ├── 1. injectTurnMessages()
  │
  ├── 2. ContextManager.autoCompress()  ← 新增
  │       ├── ToolResultOffloader.offload()    (Layer 1)
  │       └── ConversationSummarizer.summarize() (Layer 2, 按需)
  │
  ├── 3. callLLM(tools, signal)
  │       → 返回 usage.input_tokens（锚点）
  │
  └── 4. 更新 token 估算
```

## 核心数据结构

### TokenEstimate

```typescript
interface TokenEstimate {
  lastKnownInputTokens: number;   // 上次 API 返回的确切值
  estimatedTotal: number;         // 估算当前总 token
}
```

### OffloadRecord

```typescript
interface OffloadRecord {
  originalBlock: ContentBlock;     // 原始 tool_result
  filePath: string;                // 存盘路径
  preview: string;                 // 前 200 字符预览
  charCount: number;              // 原始字符数
}
```

## 模块设计

### 模块 AA: TokenEstimator

**职责：** Token 近似估算。

```typescript
class TokenEstimator {
  private lastKnownInputTokens = 0;
  private lastMessageCount = 0;

  // 收到 API 响应时更新锚点
  updateAnchor(usageInputTokens: number, messageCount: number): void;

  // 估算当前 messages 的 token 数
  estimate(messages: Message[]): TokenEstimate;
  // 逻辑: lastKnownInputTokens + (新增消息字符数 × 0.4)
}
```

### 模块 AB: ToolResultOffloader（Layer 1）

**职责：** 大工具结果存盘。

```typescript
class ToolResultOffloader {
  private offloadDir: string;

  // 存单条结果
  private offloadSingle(block: ContentBlock): OffloadRecord;

  // 检查并处理所有消息
  offload(messages: Message[]): OffloadRecord[];
  // 1. 遍历所有 tool role 消息
  // 2. 单条超 3000 字符 → 存盘替换
  // 3. 同组 tool_result 合计超 8000 → 挑最大存盘
}
```

### 模块 AC: ConversationSummarizer（Layer 2）

**职责：** LLM 摘要对话历史。

```typescript
class ConversationSummarizer {
  private consecutiveFailures = 0;
  private fused = false;

  async summarize(
    messages: Message[],
    provider: Provider,
  ): Promise<SummarizeResult>;
  // 1. 检查熔断状态
  // 2. 计算摘要范围（留尾部 ~10K token，至少 5 条）
  // 3. 构造摘要 Prompt（禁止工具 + 先草稿再正式）
  // 4. 调用 Provider（不带 tools）
  // 5. 成功 → 替换消息，重置失败计数
  // 6. 失败 → consecutiveFailures++，≥3 则熔断
  // 7. 注入边界消息
}
```

**摘要 Prompt 核心约束：**
```
你是一个对话摘要器。当前对话历史过长，需要压缩为结构化摘要。
规则：
1. 禁止调用任何工具
2. 先写分析草稿（用 thinking），再写正式摘要
3. 摘要按以下结构组织：
   - 任务目标
   - 已完成工作
   - 关键发现
   - 当前状态
   - 待解决问题
4. 用户消息保持原意，不要改写
5. 工具结果只保留关键结论，不要抄原文
```

### 模块 AD: ContextManager

**职责：** 上下文管理总入口。

```typescript
class ContextManager {
  private estimator: TokenEstimator;
  private offloader: ToolResultOffloader;
  private summarizer: ConversationSummarizer;

  async autoCompress(
    messages: Message[],
    provider: Provider,
    manual?: boolean,
  ): Promise<CompressResult>;

  // manual = false (自动):
  //   1. offloader.offload(messages)
  //   2. estimator.estimate(messages) > 87K → summarizer.summarize()
  // manual = true:
  //   1. offloader.offload(messages)
  //   2. 强制执行 summarizer.summarize()（3K 余量）
}
```

### 模块 G'''：Agent 扩展

Agent.run() 每轮在 callLLM 前调用 `contextManager.autoCompress(messages, provider)`。

### 模块 D'''''：TUI 扩展

main.ts 新增 `/compress` 命令，调用 `agent.manualCompress()`。

## 文件组织

```
mewcode/
├── src/
│   ├── context/                   # 新建
│   │   ├── token_estimator.ts     # Token 近似估算
│   │   ├── tool_result_offloader.ts # 工具结果存盘
│   │   ├── conversation_summarizer.ts # LLM 摘要
│   │   ├── context_manager.ts     # 总入口
│   │   └── context.test.ts        # 测试
│   ├── agent/
│   │   └── agent.ts              # 修改：每轮调用 ContextManager
│   └── main.ts                   # 修改：创建 ContextManager + /compress
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 压缩时机 | 每轮 callLLM 前 | 确保每次 API 调用都检查，不会漏 |
| 摘要 LLM | 复用现有 Provider | 不引入新依赖 |
| 摘要禁止工具 | tools 传 undefined | 摘要模型不应调工具 |
| 用户消息保留 | 不在摘要范围或原文保留 | 用户意图不可被改写 |
| Token 估算系数 | 0.4 | 中英文折中，误差在 15% 以内 |
| 熔断计数器 | Agent 实例级别 | clear 时重置 |
