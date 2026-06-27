import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { ProviderFactory } from './factory.js';
import { MessageConverter } from './converter.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import type { ProviderConfig } from '../config/types.js';
import type { Message, StreamEvent } from './types.js';

// 辅助：创建模拟的 ReadableStream，用于 mock fetch 的响应
function createMockResponse(
  sseData: string,
  status = 200,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseData));
      controller.close();
    },
  });

  return {
    ok: status >= 200 && status < 300,
    status,
    body: stream,
    text: () => Promise.resolve(sseData),
  } as unknown as Response;
}

// 辅助：收集异步生成器的所有事件
async function collectEvents(
  generator: AsyncGenerator<StreamEvent>,
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

describe('ProviderFactory', () => {
  it('创建 AnthropicProvider', () => {
    const config: ProviderConfig = {
      protocol: 'anthropic',
      model: 'claude-sonnet-4-6',
      base_url: 'https://api.anthropic.com',
      api_key: 'test-key',
    };
    const provider = ProviderFactory.create(config);
    assert.strictEqual(provider.protocol, 'anthropic');
    assert.strictEqual(provider.model, 'claude-sonnet-4-6');
  });

  it('创建 OpenAIProvider', () => {
    const config: ProviderConfig = {
      protocol: 'openai',
      model: 'gpt-4o',
      base_url: 'https://api.openai.com',
      api_key: 'test-key',
    };
    const provider = ProviderFactory.create(config);
    assert.strictEqual(provider.protocol, 'openai');
    assert.strictEqual(provider.model, 'gpt-4o');
  });

  it('创建 DeepSeek Provider（复用 OpenAIProvider）', () => {
    const config: ProviderConfig = {
      protocol: 'deepseek',
      model: 'deepseek-chat',
      base_url: 'https://api.deepseek.com',
      api_key: 'sk-test',
    };
    const provider = ProviderFactory.create(config);
    // DeepSeek 底层复用 OpenAIProvider，protocol 来自 config
    assert.strictEqual(provider.protocol, 'deepseek');
    assert.strictEqual(provider.model, 'deepseek-chat');
  });
});

describe('MessageConverter', () => {
  describe('toAnthropicMessages', () => {
    it('转换 user 和 assistant 消息', () => {
      const messages: Message[] = [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '你好！有什么可以帮助你的？' },
      ];
      const result = MessageConverter.toAnthropicMessages(messages);
      assert.strictEqual(result.system, undefined);
      assert.strictEqual(result.messages.length, 2);
      assert.strictEqual(result.messages[0].role, 'user');
      assert.strictEqual(result.messages[0].content, '你好');
    });

    it('提取 system 消息为顶层参数', () => {
      const messages: Message[] = [
        { role: 'system', content: '你是一个助手' },
        { role: 'user', content: '你好' },
      ];
      const result = MessageConverter.toAnthropicMessages(messages);
      assert.strictEqual(result.system, '你是一个助手');
      assert.strictEqual(result.messages.length, 1);
      assert.strictEqual(result.messages[0].role, 'user');
    });

    it('多条 system 消息取最后一条', () => {
      const messages: Message[] = [
        { role: 'system', content: '第一条' },
        { role: 'system', content: '最后一条' },
        { role: 'user', content: '你好' },
      ];
      const result = MessageConverter.toAnthropicMessages(messages);
      assert.strictEqual(result.system, '最后一条');
    });

    it('处理 ContentBlock 数组格式', () => {
      const messages: Message[] = [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '思考中...' },
            { type: 'text', text: '回答内容' },
          ],
        },
      ];
      const result = MessageConverter.toAnthropicMessages(messages);
      assert.strictEqual(result.messages.length, 1);
      const content = result.messages[0].content as Array<Record<string, unknown>>;
      assert.strictEqual(content.length, 2);
      assert.strictEqual(content[0].type, 'thinking');
      assert.strictEqual(content[1].type, 'text');
    });
  });

  describe('toOpenAIMessages', () => {
    it('转换所有消息类型', () => {
      const messages: Message[] = [
        { role: 'system', content: '你是一个助手' },
        { role: 'user', content: '你好' },
      ];
      const result = MessageConverter.toOpenAIMessages(messages);
      assert.strictEqual(result.length, 2);
      assert.strictEqual(result[0].role, 'system');
      assert.strictEqual(result[1].role, 'user');
    });

    it('thinking block 转为带前缀的文本', () => {
      const messages: Message[] = [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '思考内容' },
            { type: 'text', text: '回答' },
          ],
        },
      ];
      const result = MessageConverter.toOpenAIMessages(messages);
      const content = result[0].content as Array<Record<string, unknown>>;
      assert.strictEqual(content.length, 2);
      assert.strictEqual(content[0].type, 'text');
      assert.ok((content[0].text as string).includes('思考内容'));
    });
  });
});

describe('AnthropicProvider', () => {
  const config: ProviderConfig = {
    protocol: 'anthropic',
    model: 'claude-sonnet-4-6',
    base_url: 'https://api.anthropic.com',
    api_key: 'test-key',
  };

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('解析文本增量事件', async () => {
    // 模拟 Anthropic SSE 响应
    const sseResponse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
      '',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":0}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n');

    globalThis.fetch = (_input: RequestInfo | URL, _init?: RequestInit) => {
      return Promise.resolve(createMockResponse(sseResponse));
    };

    const provider = new AnthropicProvider(config);
    const events = await collectEvents(
      provider.streamChat([{ role: 'user', content: 'Hi' }]),
    );

    const textEvents = events.filter((e) => e.type === 'text_delta');
    assert.strictEqual(textEvents.length, 1);
    assert.strictEqual((textEvents[0] as { text: string }).text, 'Hello');

    const doneEvents = events.filter((e) => e.type === 'done');
    assert.strictEqual(doneEvents.length, 1);
  });

  it('解析 extended thinking 事件', async () => {
    const sseResponse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":1}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"让我思考一下..."}}',
      '',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":0}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"答案是..."}}',
      '',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":1}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n');

    globalThis.fetch = (_input: RequestInfo | URL, _init?: RequestInit) => {
      return Promise.resolve(createMockResponse(sseResponse));
    };

    const provider = new AnthropicProvider(config);
    const events = await collectEvents(
      provider.streamChat([{ role: 'user', content: '问题' }]),
    );

    const thinkingEvents = events.filter((e) => e.type === 'thinking_delta');
    assert.strictEqual(thinkingEvents.length, 1);
    assert.strictEqual(
      (thinkingEvents[0] as { text: string }).text,
      '让我思考一下...',
    );

    const textEvents = events.filter((e) => e.type === 'text_delta');
    assert.strictEqual(textEvents.length, 1);
  });

  it('API 返回错误时产生 error 事件', async () => {
    const errorBody = JSON.stringify({ error: { type: 'invalid_request_error', message: 'Invalid API key' } });

    globalThis.fetch = (_input: RequestInfo | URL, _init?: RequestInit) => {
      return Promise.resolve(createMockResponse(errorBody, 401));
    };

    const provider = new AnthropicProvider(config);
    const events = await collectEvents(
      provider.streamChat([{ role: 'user', content: 'Hi' }]),
    );

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'error');
  });
});

describe('OpenAIProvider', () => {
  const config: ProviderConfig = {
    protocol: 'openai',
    model: 'gpt-4o',
    base_url: 'https://api.openai.com',
    api_key: 'test-key',
  };

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('解析文本增量事件', async () => {
    const chunks = [
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { content: ' world' }, finish_reason: null }],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      },
    ];

    const sseResponse = chunks
      .map((chunk) => `data: ${JSON.stringify(chunk)}`)
      .concat(['data: [DONE]'])
      .join('\n\n');

    globalThis.fetch = (_input: RequestInfo | URL, _init?: RequestInit) => {
      return Promise.resolve(createMockResponse(sseResponse));
    };

    const provider = new OpenAIProvider(config);
    const events = await collectEvents(
      provider.streamChat([{ role: 'user', content: 'Hi' }]),
    );

    const textEvents = events.filter((e) => e.type === 'text_delta');
    assert.strictEqual(textEvents.length, 2);
    assert.strictEqual((textEvents[0] as { text: string }).text, 'Hello');
    assert.strictEqual((textEvents[1] as { text: string }).text, ' world');

    const doneEvents = events.filter((e) => e.type === 'done');
    assert.strictEqual(doneEvents.length, 1);
  });

  it('解析 reasoning_content 为 thinking_delta', async () => {
    const chunks = [
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        choices: [
          {
            index: 0,
            delta: { reasoning_content: '逐步推理...' },
            finish_reason: null,
          },
        ],
      },
      {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        choices: [
          {
            index: 0,
            delta: { content: '最终答案' },
            finish_reason: null,
          },
        ],
      },
    ];

    const sseResponse = chunks
      .map((chunk) => `data: ${JSON.stringify(chunk)}`)
      .concat(['data: [DONE]'])
      .join('\n\n');

    globalThis.fetch = (_input: RequestInfo | URL, _init?: RequestInit) => {
      return Promise.resolve(createMockResponse(sseResponse));
    };

    const provider = new OpenAIProvider(config);
    const events = await collectEvents(
      provider.streamChat([{ role: 'user', content: 'Hi' }]),
    );

    const thinkingEvents = events.filter((e) => e.type === 'thinking_delta');
    assert.strictEqual(thinkingEvents.length, 1);
    assert.strictEqual(
      (thinkingEvents[0] as { text: string }).text,
      '逐步推理...',
    );
  });

  it('API 返回错误时产生 error 事件', async () => {
    const errorBody = JSON.stringify({ error: { message: 'Invalid API key' } });

    globalThis.fetch = (_input: RequestInfo | URL, _init?: RequestInit) => {
      return Promise.resolve(createMockResponse(errorBody, 401));
    };

    const provider = new OpenAIProvider(config);
    const events = await collectEvents(
      provider.streamChat([{ role: 'user', content: 'Hi' }]),
    );

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'error');
  });
});
