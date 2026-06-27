/**
 * StreamCollector — 双路流式收集器
 *
 * 一边实时透传 text_delta/thinking_delta/tool_use 给界面，
 * 一边在后台将 delta 拼接成完整 ContentBlock[]。
 */

import type { StreamEvent, ContentBlock } from '../provider/types.js';

export class StreamCollector {
  private contentBlocks: ContentBlock[] = [];
  private currentTextBlock: ContentBlock | null = null;
  private currentThinkingBlock: ContentBlock | null = null;

  /**
   * 消费 Provider 的异步生成器，同时做两件事：
   * 1. 实时透传事件给外界
   * 2. 后台拼接完整 ContentBlock[]
   */
  async *collect(
    stream: AsyncGenerator<StreamEvent>,
  ): AsyncGenerator<StreamEvent> {
    for await (const event of stream) {
      switch (event.type) {
        case 'text_delta':
          if (!this.currentTextBlock) {
            this.currentTextBlock = { type: 'text', text: '' };
            this.contentBlocks.push(this.currentTextBlock);
          }
          this.currentTextBlock.text =
            (this.currentTextBlock.text ?? '') + event.text;
          yield event;
          break;

        case 'thinking_delta':
          if (!this.currentThinkingBlock) {
            this.currentThinkingBlock = { type: 'thinking', thinking: '' };
            this.contentBlocks.push(this.currentThinkingBlock);
          }
          this.currentThinkingBlock.thinking =
            (this.currentThinkingBlock.thinking ?? '') + event.text;
          yield event;
          break;

        case 'tool_use':
          this.contentBlocks.push({
            type: 'tool_use',
            tool_use_id: event.tool_use_id,
            tool_name: event.tool_name,
            tool_input: event.tool_input,
          });
          yield event;
          break;

        case 'tool_executing':
        case 'tool_result':
          // 这些事件不会出现在原始 Provider 流中，
          // 但防御性地透传
          yield event;
          break;

        case 'done':
          // 如果 done 携带 content，用其覆盖内部 blocks
          if (event.content && event.content.length > 0) {
            this.contentBlocks = event.content;
          }
          yield event;
          return;

        case 'error':
          yield event;
          return;
      }
    }
  }

  /** 获取收集完的完整 ContentBlock 列表 */
  getBlocks(): ContentBlock[] {
    return this.contentBlocks;
  }

  /** 是否包含 tool_use block */
  hasToolUse(): boolean {
    return this.contentBlocks.some((b) => b.type === 'tool_use');
  }

  /** 获取所有 tool_use block */
  getToolUseBlocks(): ContentBlock[] {
    return this.contentBlocks.filter((b) => b.type === 'tool_use');
  }
}
