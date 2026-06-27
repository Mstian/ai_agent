import type { Provider, Message, StreamEvent, ContentBlock } from './types.js';
import type { ProviderConfig } from '../config/types.js';
import type { ToolDefinition } from '../tools/types.js';
import { MessageConverter } from './converter.js';

// OpenAIProvider — 封装 OpenAI Chat Completions API 的 HTTP 请求和 SSE 流解析
export class OpenAIProvider implements Provider {
  readonly protocol: string;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: ProviderConfig) {
    this.protocol = config.protocol;
    this.model = config.model;
    this.baseUrl = config.base_url.replace(/\/+$/, '');
    this.apiKey = config.api_key;
  }

  // 发送消息并以异步生成器返回流式事件
  async *streamChat(
    messages: Message[],
    signal?: AbortSignal,
    tools?: ToolDefinition[],
  ): AsyncGenerator<StreamEvent> {
    const openaiMessages = MessageConverter.toOpenAIMessages(messages);

    // 构建请求体
    const body: Record<string, unknown> = {
      model: this.model,
      messages: openaiMessages,
      stream: true,
      max_tokens: 4096,
    };

    // 工具定义（OpenAI function calling 格式）
    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }));
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return; // 用户取消
      }
      yield { type: 'error', message: `网络请求失败: ${(err as Error).message}` };
      return;
    }

    // 处理非 200 响应
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      yield {
        type: 'error',
        message: `API 返回错误 ${response.status}: ${errorText}`,
      };
      return;
    }

    if (!response.body) {
      yield { type: 'error', message: '响应体为空' };
      return;
    }

    // 读取 SSE 流
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let fullThinking = '';
    // tool_calls 索引 → { id, name, arguments 缓冲区 }
    const pendingToolCalls: Map<number, { id: string; name: string; argsBuf: string }> = new Map();
    let hasToolCalls = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();

          // 跳过空行和非 data 行
          if (!trimmed) continue;
          if (!trimmed.startsWith('data: ')) continue;

          const dataStr = trimmed.slice(6);

          // [DONE] 标记流结束
          if (dataStr === '[DONE]') {
            // 先 yield 所有收集到的 tool_use 事件
            for (const [, pending] of pendingToolCalls) {
              let toolInput: Record<string, unknown> = {};
              try {
                toolInput = pending.argsBuf
                  ? (JSON.parse(pending.argsBuf) as Record<string, unknown>)
                  : {};
              } catch {
                toolInput = { _raw: pending.argsBuf };
              }
              yield {
                type: 'tool_use',
                tool_use_id: pending.id || `call_${Date.now()}`,
                tool_name: pending.name || 'unknown',
                tool_input: toolInput,
              };
            }

            const contentBlocks: ContentBlock[] = [];
            if (fullContent) {
              contentBlocks.push({ type: 'text', text: fullContent });
            }
            if (fullThinking) {
              contentBlocks.push({ type: 'thinking', thinking: fullThinking });
            }
            // 将 tool_use 也加入 contentBlocks
            for (const [, pending] of pendingToolCalls) {
              let toolInput: Record<string, unknown> = {};
              try {
                toolInput = pending.argsBuf
                  ? (JSON.parse(pending.argsBuf) as Record<string, unknown>)
                  : {};
              } catch {
                toolInput = { _raw: pending.argsBuf };
              }
              contentBlocks.push({
                type: 'tool_use',
                tool_use_id: pending.id || `call_${Date.now()}`,
                tool_name: pending.name || 'unknown',
                tool_input: toolInput,
              });
            }
            yield { type: 'done', content: contentBlocks };
            return;
          }

          let chunk: Record<string, unknown>;
          try {
            chunk = JSON.parse(dataStr);
          } catch {
            continue;
          }

          // 提取 choices[0].delta
          const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
          if (!choices || choices.length === 0) continue;

          const delta = choices[0].delta as Record<string, unknown> | undefined;
          if (!delta) continue;

          // 处理文本增量
          if (delta.content && typeof delta.content === 'string') {
            fullContent += delta.content;
            yield { type: 'text_delta', text: delta.content };
          }

          // 处理思考增量（OpenAI o-series 模型的 reasoning_content）
          if (
            delta.reasoning_content &&
            typeof delta.reasoning_content === 'string'
          ) {
            fullThinking += delta.reasoning_content;
            yield {
              type: 'thinking_delta',
              text: delta.reasoning_content,
            };
          }

          // 处理 tool_calls 增量（OpenAI function calling）
          if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
            hasToolCalls = true;
            for (const tc of delta.tool_calls as Array<Record<string, unknown>>) {
              const idx = tc.index as number;
              if (!pendingToolCalls.has(idx)) {
                pendingToolCalls.set(idx, { id: '', name: '', argsBuf: '' });
              }
              const pending = pendingToolCalls.get(idx)!;
              if (tc.id) pending.id = tc.id as string;
              if (tc.function) {
                const fn = tc.function as Record<string, unknown>;
                if (fn.name) pending.name = fn.name as string;
                if (fn.arguments && typeof fn.arguments === 'string') {
                  pending.argsBuf += fn.arguments;
                }
              }
            }
          }

          // finish_reason 出现表示完成，但需等待 [DONE] 确认
        }
      }

      // 流意外结束（没有 [DONE]），仍然提交已收集的内容
      const contentBlocks: ContentBlock[] = [];
      if (fullContent) {
        contentBlocks.push({ type: 'text', text: fullContent });
      }
      if (fullThinking) {
        contentBlocks.push({ type: 'thinking', thinking: fullThinking });
      }
      yield { type: 'done', content: contentBlocks };
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return;
      }
      yield { type: 'error', message: `流读取失败: ${(err as Error).message}` };
    } finally {
      reader.releaseLock();
    }
  }
}
