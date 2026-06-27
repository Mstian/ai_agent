/**
 * TokenEstimator — Token 近似估算
 * 锚定上次 API usage.input_tokens + 新增消息字符数 × 0.4
 */

import type { Message, ContentBlock } from '../provider/types.js';

const CHAR_PER_TOKEN = 0.4;

/** 计算消息的近似字符数 */
function messageChars(msg: Message): number {
  if (typeof msg.content === 'string') return msg.content.length;
  return (msg.content as ContentBlock[])
    .map((b) => (b.text ?? b.thinking ?? '').length + JSON.stringify(b.tool_input ?? {}).length)
    .reduce((a, b) => a + b, 0);
}

export class TokenEstimator {
  private lastKnownInputTokens = 0;
  private lastMessageCount = 0;

  /** 收到 API 响应时更新锚点 */
  updateAnchor(inputTokens: number): void {
    this.lastKnownInputTokens = inputTokens;
  }

  /** 估算当前消息列表的 token 数 */
  estimate(messages: Message[]): number {
    if (this.lastKnownInputTokens === 0) {
      // 没有锚点，纯估算
      let total = 0;
      for (const m of messages) {
        total += Math.ceil(messageChars(m) * CHAR_PER_TOKEN);
      }
      return total;
    }

    // 有锚点：上次确切值 + 新增消息估算
    const newMessages = messages.slice(this.lastMessageCount);
    let increment = 0;
    for (const m of newMessages) {
      increment += Math.ceil(messageChars(m) * CHAR_PER_TOKEN);
    }

    return this.lastKnownInputTokens + increment;
  }

  /** 记录当前消息数作为下次的基线 */
  setBaseline(messageCount: number): void {
    this.lastMessageCount = messageCount;
  }
}
