import type { Provider, Message, StreamEvent, ContentBlock } from './types.js';
import type { ProviderConfig } from '../config/types.js';
import type { ToolDefinition } from '../tools/types.js';
import type { CacheInfo } from '../prompt/types.js';
import { MessageConverter } from './converter.js';
import { CacheMonitor } from '../prompt/cache_monitor.js';

// AnthropicProvider — 封装 Anthropic Messages API 的 HTTP 请求和 SSE 流解析
export class AnthropicProvider implements Provider {
  readonly protocol: string;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  // 拼装 tool_use 的 input_json_delta 碎片
  private partialJsonBuffers: Map<number, string> = new Map();
  // 缓存命中信息
  private cacheInfo: CacheInfo | null = null;

  constructor(config: ProviderConfig) {
    this.protocol = config.protocol;
    this.model = config.model;
    // 去掉 base_url 尾部斜杠
    this.baseUrl = config.base_url.replace(/\/+$/, '');
    this.apiKey = config.api_key;
    // 注意：api_key 仅保存在内存中，不会输出到日志
  }

  // 发送消息并以异步生成器返回流式事件
  async *streamChat(
    messages: Message[],
    signal?: AbortSignal,
    tools?: ToolDefinition[],
  ): AsyncGenerator<StreamEvent> {
    const { system, messages: anthropicMessages } =
      MessageConverter.toAnthropicMessages(messages);

    // 构建请求体
    const body: Record<string, unknown> = {
      model: this.model,
      messages: anthropicMessages,
      stream: true,
      max_tokens: 4096,
      // 启用 extended thinking
      thinking: {
        type: 'enabled',
        budget_tokens: 4096,
      },
    };

    // system prompt 作为顶层参数
    if (system) {
      body.system = system;
    }

    // 工具定义
    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      }));
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return; // 用户取消，静默退出
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

    // 确保 response.body 存在
    if (!response.body) {
      yield { type: 'error', message: '响应体为空' };
      return;
    }

    // 读取 SSE 流
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const contentBlocks: ContentBlock[] = [];
    let currentBlockIndex = -1;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // 保留最后一个不完整的行
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();

          // 跳过空行、注释行、非 data 行
          if (!trimmed) continue;
          if (!trimmed.startsWith('data: ')) continue;

          const jsonStr = trimmed.slice(6); // 去掉 "data: "
          let eventData: Record<string, unknown>;
          try {
            eventData = JSON.parse(jsonStr);
          } catch {
            continue; // 解析失败的行跳过
          }

          const eventType = eventData.type as string;

          switch (eventType) {
            case 'message_start': {
              // 提取 usage 中的缓存信息
              const msg = eventData.message as Record<string, unknown> | undefined;
              if (msg?.usage) {
                this.cacheInfo = CacheMonitor.extractFromUsage(
                  msg.usage as Record<string, unknown>,
                );
              }
              break;
            }

            case 'content_block_start': {
              const block = eventData.content_block as Record<string, unknown>;
              const index = eventData.index as number;
              // 确保数组长度足够
              while (contentBlocks.length <= index) {
                contentBlocks.push({ type: 'text', text: '' });
              }
              currentBlockIndex = index;

              if (block.type === 'thinking') {
                contentBlocks[index] = { type: 'thinking', thinking: '' };
              } else if (block.type === 'text') {
                contentBlocks[index] = { type: 'text', text: '' };
              } else if (block.type === 'tool_use') {
                contentBlocks[index] = {
                  type: 'tool_use',
                  tool_use_id: block.id as string,
                  tool_name: block.name as string,
                  tool_input: {},
                };
              }
              break;
            }

            case 'content_block_delta': {
              const delta = eventData.delta as Record<string, unknown>;
              const deltaType = delta.type as string;
              const index = eventData.index as number;

              if (deltaType === 'text_delta') {
                const text = delta.text as string;
                yield { type: 'text_delta', text };
              } else if (deltaType === 'thinking_delta') {
                const thinking = delta.thinking as string;
                yield { type: 'thinking_delta', text: thinking };
              } else if (deltaType === 'input_json_delta') {
                // 拼装 tool_use 的 JSON 参数碎片
                const partial = delta.partial_json as string;
                const existing = this.partialJsonBuffers.get(index) ?? '';
                this.partialJsonBuffers.set(index, existing + partial);
              }
              // signature_delta 当前阶段忽略
              break;
            }

            case 'content_block_stop': {
              const index = eventData.index as number;
              // tool_use block 完成：解析拼接的 JSON 缓冲区
              const block = contentBlocks[index];
              if (block && block.type === 'tool_use') {
                const jsonBuf = this.partialJsonBuffers.get(index) ?? '';
                try {
                  block.tool_input = jsonBuf
                    ? (JSON.parse(jsonBuf) as Record<string, unknown>)
                    : {};
                } catch {
                  // JSON 解析失败，保留原始字符串
                  block.tool_input = { _raw: jsonBuf };
                }
                this.partialJsonBuffers.delete(index);

                // yield ToolUseEvent，让 ChatManager 知道有工具调用
                yield {
                  type: 'tool_use',
                  tool_use_id: block.tool_use_id!,
                  tool_name: block.tool_name!,
                  tool_input: block.tool_input,
                };
              }
              break;
            }

            case 'message_delta': {
              // stop_reason 和 usage 信息，记录但当前阶段不暴露
              break;
            }

            case 'message_stop':
              // 流结束，yield Done 事件（携带缓存信息）
              yield {
                type: 'done',
                content: contentBlocks.filter((b) => b.text || b.thinking),
                cacheInfo: this.cacheInfo ?? undefined,
              };
              return;
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return; // 用户取消
      }
      yield { type: 'error', message: `流读取失败: ${(err as Error).message}` };
    } finally {
      reader.releaseLock();
    }
  }
}
