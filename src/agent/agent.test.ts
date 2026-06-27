/**
 * Agent 层单元测试
 * 覆盖 StreamCollector、ToolExecutor、Agent 循环
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StreamCollector } from './stream_collector.js';
import { ToolExecutor } from './tool_executor.js';
import { Agent } from './agent.js';
import { ChatManager } from '../chat/manager.js';
import { ToolRegistry } from '../tools/registry.js';
import { ReadFileTool } from '../tools/read_file.js';
import { WriteFileTool } from '../tools/write_file.js';
import { GlobTool } from '../tools/glob.js';
import { PromptManager } from '../prompt/manager.js';
import type { Provider, Message, StreamEvent, ContentBlock } from '../provider/types.js';
import type { ToolExecuteContext, ToolResult } from '../tools/types.js';
import type { Tool, ToolParameters } from '../tools/types.js';
import type { AgentEvent } from './types.js';

// ===== Mock Provider =====

function createMockProvider(
  responses: StreamEvent[][],
): Provider {
  let callIndex = 0;
  return {
    protocol: 'mock',
    model: 'mock-model',
    async *streamChat(
      _messages: Message[],
      _signal?: AbortSignal,
      _tools?: unknown[],
    ) {
      const events = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      for (const event of events) {
        yield event;
      }
    },
  };
}

// ===== 辅助：创建 sleep 工具用于测试并发 =====

class SleepTool implements Tool {
  name = 'sleep';
  category = 'readonly' as const;
  description = 'sleep tool for testing';
  parameters: ToolParameters = {
    type: 'object',
    properties: { ms: { type: 'number', description: 'milliseconds' } },
    required: ['ms'],
  };
  async execute(
    input: Record<string, unknown>,
    _context: ToolExecuteContext,
  ): Promise<ToolResult> {
    const ms = (input.ms as number) ?? 10;
    await new Promise((r) => setTimeout(r, ms));
    return { success: true, output: `slept ${ms}ms` };
  }
}

class SleepMutationTool implements Tool {
  name = 'sleep_mutation';
  category = 'mutation' as const;
  description = 'sleep mutation tool';
  parameters: ToolParameters = {
    type: 'object',
    properties: { ms: { type: 'number', description: 'milliseconds' } },
    required: ['ms'],
  };
  async execute(
    input: Record<string, unknown>,
    _context: ToolExecuteContext,
  ): Promise<ToolResult> {
    const ms = (input.ms as number) ?? 10;
    await new Promise((r) => setTimeout(r, ms));
    return { success: true, output: `slept ${ms}ms` };
  }
}

// ===== StreamCollector =====

describe('StreamCollector', () => {
  it('透传 text_delta 并累积', async () => {
    async function* mockStream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text_delta', text: 'Hello ' };
      yield { type: 'text_delta', text: 'World' };
      yield { type: 'done', content: [] };
    }

    const collector = new StreamCollector();
    const received: string[] = [];
    for await (const event of collector.collect(mockStream())) {
      if (event.type === 'text_delta') {
        received.push(event.text);
      }
    }

    assert.deepStrictEqual(received, ['Hello ', 'World']);
    const blocks = collector.getBlocks();
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].type, 'text');
    assert.strictEqual(blocks[0].text, 'Hello World');
  });

  it('检测 tool_use', async () => {
    async function* mockStream(): AsyncGenerator<StreamEvent> {
      yield { type: 'tool_use', tool_use_id: '1', tool_name: 'read_file', tool_input: { file_path: 'a.ts' } };
      yield { type: 'done', content: [] };
    }

    const collector = new StreamCollector();
    for await (const _ of collector.collect(mockStream())) {
      // 消费
    }

    assert.strictEqual(collector.hasToolUse(), true);
    assert.strictEqual(collector.getToolUseBlocks().length, 1);
    assert.strictEqual(collector.getToolUseBlocks()[0].tool_name, 'read_file');
  });

  it('纯文本时 hasToolUse 返回 false', async () => {
    async function* mockStream(): AsyncGenerator<StreamEvent> {
      yield { type: 'text_delta', text: 'Hello' };
      yield { type: 'done', content: [] };
    }

    const collector = new StreamCollector();
    for await (const _ of collector.collect(mockStream())) {
      // 消费
    }

    assert.strictEqual(collector.hasToolUse(), false);
  });
});

// ===== ToolExecutor =====

describe('ToolExecutor', () => {
  it('readonly 工具并发执行', async () => {
    const registry = new ToolRegistry();
    registry.register(new SleepTool());

    const executor = new ToolExecutor(registry);
    const blocks: ContentBlock[] = [
      { type: 'tool_use', tool_use_id: '1', tool_name: 'sleep', tool_input: { ms: 30 } },
      { type: 'tool_use', tool_use_id: '2', tool_name: 'sleep', tool_input: { ms: 30 } },
    ];

    const start = Date.now();
    const events: StreamEvent[] = [];
    for await (const event of executor.executeBatch(blocks, {
      cwd: process.cwd(),
      timeout: 5000,
    })) {
      events.push(event);
    }
    const elapsed = Date.now() - start;

    // 并发执行应 < 200ms（30ms 并发 + 权限检查开销）
    assert.ok(elapsed < 200, `并发执行耗时 ${elapsed}ms，应 < 200ms`);
    const results = events.filter((e) => e.type === 'tool_result');
    assert.strictEqual(results.length, 2);
  });

  it('mutation 工具串行执行', async () => {
    const registry = new ToolRegistry();
    registry.register(new SleepMutationTool());

    const executor = new ToolExecutor(registry);
    const blocks: ContentBlock[] = [
      { type: 'tool_use', tool_use_id: '1', tool_name: 'sleep_mutation', tool_input: { ms: 30 } },
      { type: 'tool_use', tool_use_id: '2', tool_name: 'sleep_mutation', tool_input: { ms: 30 } },
    ];

    const start = Date.now();
    for await (const _ of executor.executeBatch(blocks, {
      cwd: process.cwd(),
      timeout: 5000,
    })) {
      // 消费
    }
    const elapsed = Date.now() - start;

    // 串行执行应 >= 50ms
    assert.ok(elapsed >= 50, `串行执行耗时 ${elapsed}ms，应 >= 50ms`);
  });
});

// ===== Agent =====

describe('Agent', () => {
  it('模型直接返回文本 → 1 轮完成', async () => {
    const provider = createMockProvider([
      [
        { type: 'text_delta', text: '你好！' },
        { type: 'done', content: [{ type: 'text', text: '你好！' }] },
      ],
    ]);
    const chatManager = new ChatManager(provider);
    const registry = new ToolRegistry();
    const executor = new ToolExecutor(registry);
    const promptManager = new PromptManager();
    const agent = new Agent(chatManager, executor, registry, promptManager, { maxIterations: 5, mode: 'full' });

    const events: AgentEvent[] = [];
    for await (const event of agent.run('hello')) {
      events.push(event);
    }

    const doneEvent = events.find((e) => e.type === 'agent_done');
    assert.ok(doneEvent);
    if (doneEvent && doneEvent.type === 'agent_done') {
      assert.strictEqual(doneEvent.stopReason, 'task_completed');
      assert.strictEqual(doneEvent.totalTurns, 1);
    }
  });

  it('先 tool_use 再文本 → 2 轮完成', async () => {
    const provider = createMockProvider([
      // Turn 1: tool_use
      [
        {
          type: 'tool_use',
          tool_use_id: 'call_1',
          tool_name: 'read_file',
          tool_input: { file_path: 'test.txt' },
        },
        { type: 'done', content: [] },
      ],
      // Turn 2: text response
      [
        { type: 'text_delta', text: '任务完成' },
        { type: 'done', content: [{ type: 'text', text: '任务完成' }] },
      ],
    ]);

    const registry = new ToolRegistry();
    registry.register(new ReadFileTool());
    const executor = new ToolExecutor(registry);
    const chatManager = new ChatManager(provider);
    const promptManager = new PromptManager();
    const agent = new Agent(chatManager, executor, registry, promptManager, { maxIterations: 5, mode: 'full' });

    // 创建临时文件给 read_file 读取
    const tempDir = join(tmpdir(), `mewcode-agent-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, 'test.txt'), 'hello', 'utf-8');

    const events: AgentEvent[] = [];
    for await (const event of agent.run('read test.txt')) {
      events.push(event);
    }

    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });

    const toolUseEvents = events.filter((e) => e.type === 'tool_use');
    assert.strictEqual(toolUseEvents.length, 1);

    const doneEvent = events.find((e) => e.type === 'agent_done');
    assert.ok(doneEvent);
    if (doneEvent && doneEvent.type === 'agent_done') {
      assert.strictEqual(doneEvent.stopReason, 'task_completed');
      assert.strictEqual(doneEvent.totalTurns, 2);
    }

    // 对话历史：user + 2 injected system + assistant(tool_use) + tool(tool_result) + assistant(text) = 6
    const msgs = agent.getMessages();
    assert.strictEqual(msgs.length, 6);
  });

  it('连续 tool_use 达到上限 → max_iterations', async () => {
    // 每轮都返回 tool_use，触发 maxIterations=3
    const toolUseResponse: StreamEvent[] = [
      {
        type: 'tool_use',
        tool_use_id: 'call_1',
        tool_name: 'glob',
        tool_input: { pattern: '*.ts' },
      },
      { type: 'done', content: [] },
    ];

    const provider = createMockProvider([
      toolUseResponse,
      toolUseResponse,
      toolUseResponse,
      toolUseResponse,
    ]);

    const registry = new ToolRegistry();
    registry.register(new GlobTool());
    const executor = new ToolExecutor(registry);
    const chatManager = new ChatManager(provider);
    const promptManager = new PromptManager();
    const agent = new Agent(chatManager, executor, registry, promptManager, { maxIterations: 3, mode: 'full' });

    const events: AgentEvent[] = [];
    for await (const event of agent.run('find files')) {
      events.push(event);
    }

    const doneEvent = events.find((e) => e.type === 'agent_done');
    assert.ok(doneEvent);
    if (doneEvent && doneEvent.type === 'agent_done') {
      assert.strictEqual(doneEvent.stopReason, 'max_iterations');
      assert.strictEqual(doneEvent.totalTurns, 3);
    }
  });

  it('plan 模式只提供只读工具', async () => {
    // 用 mock Provider 记录收到的 tools
    let receivedTools: unknown[] | undefined;
    const provider: Provider = {
      protocol: 'mock',
      model: 'mock',
      async *streamChat(
        _messages: Message[],
        _signal?: AbortSignal,
        tools?: unknown[],
      ) {
        receivedTools = tools;
        yield { type: 'text_delta', text: 'OK' };
        yield { type: 'done', content: [{ type: 'text', text: 'OK' }] };
      },
    };

    const registry = new ToolRegistry();
    registry.register(new ReadFileTool());
    registry.register(new GlobTool());
    registry.register(new WriteFileTool());
    const executor = new ToolExecutor(registry);
    const chatManager = new ChatManager(provider);
    const promptManager = new PromptManager();
    const agent = new Agent(chatManager, executor, registry, promptManager, { maxIterations: 5, mode: 'plan' });

    for await (const _event of agent.run('analyze')) {
      // 消费
    }

    assert.ok(receivedTools);
    const toolNames = (receivedTools as Array<{ name: string }>).map((t) => t.name);
    assert.ok(toolNames.includes('read_file'));
    assert.ok(toolNames.includes('glob'));
    assert.ok(!toolNames.includes('write_file'), 'plan 模式不应包含 write_file');
  });

  it('流出错 → stream_error', async () => {
    const provider: Provider = {
      protocol: 'mock',
      model: 'mock',
      async *streamChat() {
        yield { type: 'error', message: '网络错误' };
      },
    };

    const registry = new ToolRegistry();
    const executor = new ToolExecutor(registry);
    const chatManager = new ChatManager(provider);
    const promptManager = new PromptManager();
    const agent = new Agent(chatManager, executor, registry, promptManager, { maxIterations: 5, mode: 'full' });

    const events: AgentEvent[] = [];
    for await (const event of agent.run('test')) {
      events.push(event);
    }

    const doneEvent = events.find((e) => e.type === 'agent_done');
    assert.ok(doneEvent);
    if (doneEvent && doneEvent.type === 'agent_done') {
      assert.strictEqual(doneEvent.stopReason, 'stream_error');
    }
  });

  it('setMode 切换模式', () => {
    const provider = createMockProvider([]);
    const registry = new ToolRegistry();
    const executor = new ToolExecutor(registry);
    const chatManager = new ChatManager(provider);
    const promptManager = new PromptManager();
    const agent = new Agent(chatManager, executor, registry, promptManager);

    assert.strictEqual(agent.getMode(), 'full');
    agent.setMode('plan');
    assert.strictEqual(agent.getMode(), 'plan');
    agent.setMode('full');
    assert.strictEqual(agent.getMode(), 'full');
  });
});
