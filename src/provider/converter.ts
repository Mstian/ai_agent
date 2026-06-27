import type { Message, ContentBlock } from './types.js';

// MessageConverter — 将标准 Message 格式转换为各 API 所需的请求格式
export class MessageConverter {
  // 转换为 Anthropic Messages API 格式
  // system role 单独提取为顶层参数（非消息列表）
  static toAnthropicMessages(messages: Message[]): {
    system?: string;
    messages: Record<string, unknown>[];
  } {
    const systemMessages = messages.filter((m) => m.role === 'system');
    const otherMessages = messages.filter((m) => m.role !== 'system');

    // 取最后一条 system 消息作为 system prompt
    const systemPrompt = systemMessages.length > 0
      ? this.contentToString(systemMessages[systemMessages.length - 1].content)
      : undefined;

    return {
      system: systemPrompt,
      messages: otherMessages.map((m) => ({
        role: m.role,
        content: this.contentToAnthropic(m.content, m.role),
      })),
    };
  }

  // 转换为 OpenAI Chat Completions API 格式
  // system role 保留在消息列表中
  // assistant 消息中的 tool_use 转为 tool_calls 字段
  // tool role 消息用于 tool_result
  static toOpenAIMessages(messages: Message[]): Record<string, unknown>[] {
    return messages.map((m) => {
      if (typeof m.content === 'string') {
        return { role: m.role, content: m.content };
      }

      // tool role 消息：content 是 ContentBlock[]，取第一个 tool_result 的 text
      if (m.role === 'tool') {
        const toolResult = m.content.find((b) => b.type === 'tool_result');
        return {
          role: 'tool',
          tool_call_id: toolResult?.tool_use_id ?? '',
          content: toolResult?.text ?? '',
        };
      }

      // assistant 消息：分离 tool_use 和其他 block
      const toolUseBlocks = m.content.filter((b) => b.type === 'tool_use');
      const otherBlocks = m.content.filter((b) => b.type !== 'tool_use');

      const result: Record<string, unknown> = {
        role: m.role,
        content: this.contentToOpenAI(otherBlocks, m.role),
      };

      // 有 tool_use 时添加 tool_calls 字段
      if (toolUseBlocks.length > 0 && m.role === 'assistant') {
        result.tool_calls = toolUseBlocks.map((b) => ({
          id: b.tool_use_id ?? '',
          type: 'function',
          function: {
            name: b.tool_name ?? '',
            arguments: JSON.stringify(b.tool_input ?? {}),
          },
        }));
      }

      return result;
    });
  }

  // 将 ContentBlock 数组转回纯文本（用于 system prompt 等场景）
  private static contentToString(content: string | ContentBlock[]): string {
    if (typeof content === 'string') return content;
    return content
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
      .join('');
  }

  // 转换为 Anthropic content 格式
  private static contentToAnthropic(
    content: string | ContentBlock[],
    role: string
  ): string | Record<string, unknown>[] {
    if (typeof content === 'string') return content;

    return content.map((block) => {
      switch (block.type) {
        case 'text':
          return { type: 'text', text: block.text ?? '' };
        case 'thinking':
          // Anthropic assistant 消息可包含 thinking block
          return { type: 'thinking', thinking: block.thinking ?? '' };
        case 'tool_use':
          return {
            type: 'tool_use',
            id: block.tool_use_id ?? '',
            name: block.tool_name ?? '',
            input: block.tool_input ?? {},
          };
        case 'tool_result':
          return {
            type: 'tool_result',
            tool_use_id: block.tool_use_id ?? '',
            content: block.text ?? '',
          };
        default:
          return { type: 'text', text: '' };
      }
    });
  }

  // 转换为 OpenAI content 格式
  private static contentToOpenAI(
    content: string | ContentBlock[],
    role: string
  ): string | Record<string, unknown>[] {
    if (typeof content === 'string') return content;

    // OpenAI 支持在 content 字段中使用 ContentPart 数组
    return content
      .filter((b) => b.type === 'text' || b.type === 'thinking')
      .map((block) => {
        if (block.type === 'thinking') {
          return { type: 'text', text: `[思考] ${block.thinking ?? ''}` };
        }
        return { type: 'text', text: block.text ?? '' };
      });
  }
}
