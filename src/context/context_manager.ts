/**
 * ContextManager — 上下文管理总入口
 * 每轮 LLM 调用前自动执行两层压缩
 */

import type { Message } from '../provider/types.js';
import type { Provider } from '../provider/types.js';
import { TokenEstimator } from './token_estimator.js';
import { ToolResultOffloader } from './tool_result_offloader.js';
import { ConversationSummarizer } from './conversation_summarizer.js';

export class ContextManager {
  private estimator: TokenEstimator;
  private offloader: ToolResultOffloader;
  private summarizer: ConversationSummarizer;

  constructor(projectRoot: string) {
    this.estimator = new TokenEstimator();
    this.offloader = new ToolResultOffloader(projectRoot);
    this.summarizer = new ConversationSummarizer();
  }

  /** 每轮 LLM 调用前自动执行 */
  async autoCompress(
    messages: Message[],
    provider: Provider,
    manual = false,
  ): Promise<{ messages: Message[]; compressed: boolean; offloaded: number; summarized: boolean }> {
    // Layer 1: 工具结果存盘（每次都跑）
    const offloadedCount = this.offloader.offload(messages);

    // Layer 2: 摘要（按需）
    const estimated = this.estimator.estimate(messages);
    const threshold = manual ? 97_000 : 5_000; // 用当前 AUTO_TRIGGER_TOKENS
    const shouldSummarize = manual
      ? this.summarizer.needsManualSummarize(estimated)
      : this.summarizer.needsAutoSummarize(estimated);

    if (!shouldSummarize) {
      return { messages, compressed: false, offloaded: offloadedCount, summarized: false };
    }

    const result = await this.summarizer.summarize(
      messages,
      provider,
      this.estimator,
      manual,
    );

    return {
      messages: result,
      compressed: result !== messages,
      offloaded: offloadedCount,
      summarized: result !== messages,
    };
  }

  /** API 调用后更新 token 锚点 */
  updateTokenAnchor(inputTokens: number, messageCount: number): void {
    this.estimator.updateAnchor(inputTokens);
    this.estimator.setBaseline(messageCount);
  }

  /** /clear 时重置 */
  reset(): void {
    this.summarizer.reset();
  }
}
