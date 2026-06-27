# MewCode 第七阶段 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/context/token_estimator.ts` | Token 近似估算 |
| 新建 | `src/context/tool_result_offloader.ts` | 工具结果存盘 |
| 新建 | `src/context/conversation_summarizer.ts` | LLM 结构化摘要 |
| 新建 | `src/context/context_manager.ts` | 上下文管理总入口 |
| 新建 | `src/context/context.test.ts` | 测试 |
| 修改 | `src/agent/agent.ts` | 每轮调用 ContextManager |
| 修改 | `src/main.ts` | 创建 ContextManager + /compress |

## T1: TokenEstimator

**文件：** `src/context/token_estimator.ts`
**步骤：**
1. updateAnchor(usageInputTokens, messageCount) — 保存锚点
2. estimate(messages) — lastKnown + 新增字符 × 0.4

**验证：** `npx tsc --noEmit` 通过

## T2: ToolResultOffloader

**文件：** `src/context/tool_result_offloader.ts`
**步骤：**
1. offload(messages)：遍历 tool role 消息
2. 单条 tool_result text 超 3000 → 存盘替换
3. 同组合计超 8000 → 按大小排序，逐个存盘
4. 生成预览+路径替换原文

**验证：** `npx tsc --noEmit` 通过

## T3: ConversationSummarizer

**文件：** `src/context/conversation_summarizer.ts`
**步骤：**
1. summarize(messages, provider)：计算范围 → 构造 Prompt → 调 LLM
2. 计算保留尾部 ~10K token / 至少 5 条
3. Prompt 禁止工具、要求先草稿再正式
4. 成功替换消息、注入边界消息
5. 连续 3 次失败熔断

**验证：** `npx tsc --noEmit` 通过

## T4: ContextManager

**文件：** `src/context/context_manager.ts`
**步骤：**
1. autoCompress(messages, provider, manual?) — 两层压缩
2. 自动：offload → 超 87K → summarize
3. 手动：offload → summarize（3K 余量）

**验证：** `npx tsc --noEmit` 通过

## T5: Agent 集成

**文件：** `src/agent/agent.ts`
**步骤：**
1. agent.ts 构造器接收 ContextManager
2. 每轮 callLLM 前：await contextManager.autoCompress(...)
3. 调用后：estimator.updateAnchor(usage.input_tokens)
4. 新增 manualCompress() 方法

**验证：** Agent 原有测试通过

## T6: main.ts 接入

**文件：** `src/main.ts`
**步骤：**
1. 创建 ContextManager
2. 注入 Agent
3. /compress 命令

**验证：** `npm test` 全部通过

## T7: 测试

**文件：** `src/context/context.test.ts`
**步骤：**
1. TokenEstimator 估算测试
2. ToolResultOffloader 存盘/替换
3. ConversationSummarizer mock 摘要
4. ContextManager 集成

**验证：** `npm test` 全部通过
