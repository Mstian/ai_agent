import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ChatManager } from './manager.js';
import type { Provider, Message, StreamEvent } from '../provider/types.js';

// 创建 mock Provider，返回固定的 StreamEvent 序列
function createMockProvider(
  events: StreamEvent[],
): Provider {
  return {
    protocol: 'mock',
    model: 'mock-model',
    async *streamChat(_messages: Message[], _signal?: AbortSignal) {
      for (const event of events) {
        yield event;
      }
    },
  };
}

describe('ChatManager', () => {
  describe('初始化', () => {
    it('无 system prompt 时消息列表为空', () => {
      const provider = createMockProvider([]);
      const manager = new ChatManager(provider);
      assert.strictEqual(manager.getMessages().length, 0);
    });

    it('有 system prompt 时消息列表包含 system 消息', () => {
      const provider = createMockProvider([]);
      const manager = new ChatManager(provider, '你是一个有用的助手');
      const msgs = manager.getMessages();
      assert.strictEqual(msgs.length, 1);
      assert.strictEqual(msgs[0].role, 'system');
      assert.strictEqual(msgs[0].content, '你是一个有用的助手');
    });
  });

  describe('sendMessage', () => {
    it('发送消息后消息列表长度增加', async () => {
      const provider = createMockProvider([
        { type: 'text_delta', text: '你好！' },
        { type: 'done', content: [{ type: 'text', text: '你好！' }] },
      ]);
      const manager = new ChatManager(provider);

      const received: StreamEvent[] = [];
      for await (const event of manager.sendMessage('你好')) {
        received.push(event);
      }

      // 消息列表应有 user + assistant 两条
      const msgs = manager.getMessages();
      assert.strictEqual(msgs.length, 2);
      assert.strictEqual(msgs[0].role, 'user');
      assert.strictEqual(msgs[1].role, 'assistant');
    });

    it('流式事件正确透传', async () => {
      const provider = createMockProvider([
        { type: 'text_delta', text: 'H' },
        { type: 'text_delta', text: 'i' },
        { type: 'done', content: [{ type: 'text', text: 'Hi' }] },
      ]);
      const manager = new ChatManager(provider);

      const received: StreamEvent[] = [];
      for await (const event of manager.sendMessage('hello')) {
        received.push(event);
      }

      assert.strictEqual(received.length, 3);
      assert.strictEqual(received[0].type, 'text_delta');
      assert.strictEqual((received[0] as { text: string }).text, 'H');
      assert.strictEqual(received[1].type, 'text_delta');
      assert.strictEqual((received[1] as { text: string }).text, 'i');
      assert.strictEqual(received[2].type, 'done');
    });

    it('连续 3 轮对话后消息列表有 6 条', async () => {
      const provider = createMockProvider([
        { type: 'text_delta', text: '回复' },
        { type: 'done', content: [{ type: 'text', text: '回复' }] },
      ]);
      const manager = new ChatManager(provider);

      for (let i = 0; i < 3; i++) {
        for await (const _ of manager.sendMessage(`问题${i + 1}`)) {
          // 消费流
        }
      }

      assert.strictEqual(manager.getMessages().length, 6);
    });

    it('error 事件后消息列表只有 user 消息', async () => {
      const provider = createMockProvider([
        { type: 'error', message: 'API 错误' },
      ]);
      const manager = new ChatManager(provider);

      for await (const _ of manager.sendMessage('测试')) {
        // 消费流
      }

      const msgs = manager.getMessages();
      assert.strictEqual(msgs.length, 1);
      assert.strictEqual(msgs[0].role, 'user');
    });
  });

  describe('clear', () => {
    it('清空后仅保留 system prompt', async () => {
      const provider = createMockProvider([
        { type: 'text_delta', text: '好' },
        { type: 'done', content: [{ type: 'text', text: '好' }] },
      ]);
      const manager = new ChatManager(provider, 'system prompt');

      // 发一条消息
      for await (const _ of manager.sendMessage('你好')) {
        // 消费
      }
      assert.strictEqual(manager.getMessages().length, 3); // system + user + assistant

      manager.clear();
      const msgs = manager.getMessages();
      assert.strictEqual(msgs.length, 1);
      assert.strictEqual(msgs[0].role, 'system');
    });
  });

  describe('getMessages', () => {
    it('返回副本不影响内部状态', async () => {
      const provider = createMockProvider([
        { type: 'text_delta', text: 'ok' },
        { type: 'done', content: [{ type: 'text', text: 'ok' }] },
      ]);
      const manager = new ChatManager(provider);

      for await (const _ of manager.sendMessage('test')) {
        // 消费
      }

      const copy = manager.getMessages();
      copy.push({ role: 'user', content: '外部修改' });

      // 内部状态不受影响
      assert.strictEqual(manager.getMessages().length, 2);
    });
  });
});
