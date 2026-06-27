/**
 * ConversationSummarizer — 第二层：LLM 结构化摘要
 * 超 87K token 时触发，保留尾部约 10K token 原文
 */

import type { Message, ContentBlock } from '../provider/types.js';
import type { Provider } from '../provider/types.js';
import { TokenEstimator } from './token_estimator.js';

const AUTO_TRIGGER_TOKENS = 87_000; // TODO: 测试用，正式改回 87000
const MANUAL_TRIGGER_TOKENS = 97_000; // 100K - 3K
const TAIL_KEEP_TOKENS = 2_000;
const MAX_CONSECUTIVE_FAILURES = 3;

const SUMMARY_PROMPT = `你是一个对话摘要器。当前对话历史过长，需要压缩为结构化摘要。

规则：
1. 禁止调用任何工具
2. 先用 thinking 写分析草稿，再写正式摘要。草稿用完就丢
3. 摘要按以下结构组织（每部分用 ## 标题）：
   ## 任务目标 — 用户最初要做什么
   ## 已完成工作 — 已执行的关键操作和结果
   ## 关键发现 — 重要的内容、错误信息
   ## 当前状态 — 正在做什么，下一步计划
   ## 待解决问题 — 还没解决的事项
4. 用户消息保持原意，不要改写
5. 工具结果只保留关键结论，不要抄原文`;

const BOUNDARY_MESSAGE: Message = {
  role: 'system',
  content: `[上下文已压缩] 早期对话已生成摘要。如需之前工具结果的完整内容，请用 read_file 重新读取 .mewcode/tool_results/ 目录下的存盘文件。不要根据摘要脑补具体代码或文件内容。`,
};

export class ConversationSummarizer {
  private consecutiveFailures = 0;
  private fused = false;

  /** 是否需要触发摘要（自动模式） */
  needsAutoSummarize(estimatedTokens: number): boolean {
    return !this.fused && estimatedTokens > AUTO_TRIGGER_TOKENS;
  }

  /** 是否需要触发摘要（手动模式） */
  needsManualSummarize(estimatedTokens: number): boolean {
    return estimatedTokens > 0; // 手动模式总是执行
  }

  /** 摘要阈值（手动模式更激进） */
  summarizeThreshold(manual: boolean): number {
    return manual ? MANUAL_TRIGGER_TOKENS : AUTO_TRIGGER_TOKENS;
  }

  /** 执行摘要 */
  async summarize(
    messages: Message[],
    provider: Provider,
    estimator: TokenEstimator,
    manual = false,
  ): Promise<Message[]> {
    if (this.fused) return messages;

    const estimated = estimator.estimate(messages);
    const threshold = manual ? MANUAL_TRIGGER_TOKENS : AUTO_TRIGGER_TOKENS;
    if (!manual && estimated <= threshold) return messages;

    // 计算保留范围：从尾部往前数 ~10K token 或至少 5 条
    const keepCount = this.calcKeepCount(messages, estimator);
    const keepMessages = messages.slice(-keepCount);
    const summarizeMessages = messages.slice(0, -keepCount);

    if (summarizeMessages.length === 0) return messages;

    try {
      // 调 LLM 生成摘要（不带工具）
      const summary = await this.callLLM(summarizeMessages, provider);

      // 构造新消息列表：摘要 + 边界消息 + 保留原文
      const result: Message[] = [
        ...messages.slice(0, 0), // 保留 system prompt（已在新列表开头）
      ];

      // 实际替换：去掉被摘要的消息，插入摘要+边界+尾部
      const newMessages = messages.slice(); // copy
      // 找到 system prompt 的位置，之后插入
      const sysCount = messages.filter(
        (m) => m.role === 'system' && !(typeof m.content === 'string' && m.content.includes('[上下文已压缩')),
      ).length;

      const rebuilt: Message[] = [
        ...messages.slice(0, sysCount),
        {
          role: 'system',
          content: `[对话摘要]\n${summary}`,
        },
        BOUNDARY_MESSAGE,
        ...keepMessages.filter(
          (m) => !(m.role === 'system' && typeof m.content === 'string' && m.content.includes('[对话摘要')),
        ),
      ];

      this.consecutiveFailures = 0;
      return rebuilt;
    } catch {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this.fused = true;
      }
      return messages; // 失败返回原列表
    }
  }

  reset(): void {
    this.consecutiveFailures = 0;
    this.fused = false;
  }

  private calcKeepCount(messages: Message[], estimator: TokenEstimator): number {
    let chars = 0;
    const tailKeep = TAIL_KEEP_TOKENS / 0.4; // 约 25000 字符
    const keep: number[] = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      const c = typeof m.content === 'string'
        ? m.content.length
        : (m.content as ContentBlock[]).reduce((s, b) => s + (b.text ?? '').length, 0);
      chars += c;
      keep.push(i);
      if (chars >= tailKeep && keep.length >= 5) break;
    }
    return keep.length;
  }

  private async callLLM(messages: Message[], provider: Provider): Promise<string> {
    const summaryMessages: Message[] = [
      ...messages,
      { role: 'user', content: SUMMARY_PROMPT },
    ];

    let fullText = '';
    for await (const event of provider.streamChat(summaryMessages, undefined, undefined)) {
      if (event.type === 'text_delta') {
        fullText += event.text;
      } else if (event.type === 'error') {
        throw new Error(event.message);
      }
    }
    return fullText;
  }
}
