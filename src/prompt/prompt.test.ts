/**
 * 提示系统单元测试
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PromptBuilder } from './builder.js';
import { PromptManager } from './manager.js';
import { CacheMonitor } from './cache_monitor.js';
import { getDefaultModules } from './modules.js';

describe('PromptBuilder', () => {
  it('按 priority 排序拼装', () => {
    const builder = new PromptBuilder();
    builder.register({
      key: 'tone',
      priority: 6,
      content: 'TONE_CONTENT',
      enabled: true,
    });
    builder.register({
      key: 'identity',
      priority: 1,
      content: 'IDENTITY_CONTENT',
      enabled: true,
    });

    const result = builder.build();
    const idxId = result.indexOf('IDENTITY_CONTENT');
    const idxTone = result.indexOf('TONE_CONTENT');
    assert.ok(idxId < idxTone, 'priority=1 应在 priority=6 之前');
  });

  it('禁用模块不出现在结果中', () => {
    const builder = new PromptBuilder();
    builder.register({
      key: 'tone',
      priority: 6,
      content: 'TONE',
      enabled: true,
    });
    builder.disable('tone');
    const result = builder.build();
    assert.strictEqual(result.includes('TONE'), false);
  });

  it('模板变量替换', () => {
    const builder = new PromptBuilder();
    builder.register({
      key: 'constraints',
      priority: 2,
      content: 'cwd: {{cwd}}, mode: {{mode}}',
      enabled: true,
    });
    const result = builder.build({ cwd: '/test', mode: 'plan' });
    assert.ok(result.includes('/test'));
    assert.ok(result.includes('plan'));
    assert.ok(!result.includes('{{cwd}}'), '模板变量应被替换');
  });

  it('多个模块间用空行分隔', () => {
    const builder = new PromptBuilder();
    builder.register({
      key: 'identity',
      priority: 1,
      content: 'A',
      enabled: true,
    });
    builder.register({
      key: 'tone',
      priority: 6,
      content: 'B',
      enabled: true,
    });
    const result = builder.build();
    assert.ok(result.includes('\n\n'));
  });
});

describe('PromptManager', () => {
  it('getSystemPrompt 返回非空字符串', () => {
    const manager = new PromptManager();
    const prompt = manager.getSystemPrompt({ cwd: '/test' });
    assert.ok(prompt.length > 50);
    assert.ok(prompt.includes('MewCode'));
    assert.ok(prompt.includes('/test'));
  });

  it('setMode plan 后 prompt 包含规划模式规则', () => {
    const manager = new PromptManager();
    manager.setMode('plan');
    const prompt = manager.getSystemPrompt();
    assert.ok(prompt.includes('规划模式'));
    assert.ok(prompt.includes('只读'));
  });

  it('setMode full 后 prompt 包含执行模式规则', () => {
    const manager = new PromptManager();
    manager.setMode('full');
    const prompt = manager.getSystemPrompt();
    assert.ok(prompt.includes('执行模式'));
    assert.ok(!prompt.includes('只读'));
  });

  it('generateSystemMessages turn=1 返回完整消息', () => {
    const manager = new PromptManager();
    const msgs = manager.generateSystemMessages(1, {
      mode: 'plan',
      cwd: '/test',
      date: '2026-01-01',
    });
    assert.ok(msgs.length >= 2, `期望 >=2 条消息，实际 ${msgs.length}`);
    // 首条应为环境信息
    assert.ok(msgs[0].content.includes('type: environment'));
    // mode 消息
    const hasModeMsg = msgs.some((m) => m.content.includes('type: mode_switch'));
    assert.ok(hasModeMsg, '应包含 mode_switch 消息');
  });

  it('generateSystemMessages turn=4（每3轮）返回完整 mode 消息', () => {
    const manager = new PromptManager();
    const msgs = manager.generateSystemMessages(4, {
      mode: 'plan',
      cwd: '/test',
      date: '2026-01-01',
    });
    const hasMode = msgs.some((m) => m.content.includes('type: mode_switch'));
    assert.ok(hasMode, '每3轮应重复完整 mode 消息');
  });

  it('generateSystemMessages turn=2 plan 返回精简提醒', () => {
    const manager = new PromptManager();
    const msgs = manager.generateSystemMessages(2, {
      mode: 'plan',
      cwd: '/test',
      date: '2026-01-01',
    });
    assert.strictEqual(msgs.length, 1);
    assert.ok(msgs[0].content.includes('type: reminder'));
    assert.ok(msgs[0].content.includes('规划模式'));
  });

  it('generateSystemMessages turn=2 full 不返回额外消息', () => {
    const manager = new PromptManager();
    const msgs = manager.generateSystemMessages(2, {
      mode: 'full',
      cwd: '/test',
      date: '2026-01-01',
    });
    assert.strictEqual(msgs.length, 0);
  });

  it('模块可启用/禁用', () => {
    const manager = new PromptManager();
    manager.disableModule('tone');
    const prompt = manager.getSystemPrompt();
    // tone 模块内容不应出现（"用中文回答"在 identity 里，"简洁精准"在 tone 里）
    assert.ok(!prompt.includes('简洁精准'));
    manager.enableModule('tone');
    const prompt2 = manager.getSystemPrompt();
    assert.ok(prompt2.includes('简洁精准'));
  });

  it('getDefaultModules 返回 10 个模块', () => {
    const modules = getDefaultModules();
    assert.strictEqual(modules.length, 10);
    // 7 个固定 enabled + 3 个可选 disabled
    const enabled = modules.filter((m) => m.enabled);
    assert.strictEqual(enabled.length, 7);
  });
});

describe('CacheMonitor', () => {
  it('extractFromUsage 正确提取字段', () => {
    const usage = {
      input_tokens: 1000,
      output_tokens: 200,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 500,
    };
    const info = CacheMonitor.extractFromUsage(usage);
    assert.strictEqual(info.inputTokens, 1000);
    assert.strictEqual(info.cacheReadTokens, 500);
    assert.strictEqual(info.cacheCreationTokens, 0);
  });

  it('hitRate 正确计算', () => {
    const info = {
      cacheCreationTokens: 0,
      cacheReadTokens: 800,
      inputTokens: 1000,
    };
    assert.strictEqual(CacheMonitor.hitRate(info), 0.8);
  });

  it('hitRate 无缓存时返回 0', () => {
    const info = {
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      inputTokens: 1000,
    };
    assert.strictEqual(CacheMonitor.hitRate(info), 0);
  });

  it('format 有缓存时返回描述', () => {
    const info = {
      cacheCreationTokens: 0,
      cacheReadTokens: 5000,
      inputTokens: 10000,
    };
    const formatted = CacheMonitor.format(info);
    assert.ok(formatted.includes('50%'));
    assert.ok(formatted.includes('5000'));
  });

  it('format 无缓存时返回空字符串', () => {
    const info = {
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      inputTokens: 1000,
    };
    assert.strictEqual(CacheMonitor.format(info), '');
  });
});
