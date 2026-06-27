/**
 * 命令系统测试
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import { CommandRegistry } from './registry.js';
import { CommandParser } from './parser.js';
import { CommandCompleter } from './completer.js';
import {
  createHelpCommand,
  createPlanCommand,
  createDoCommand,
  createClearCommand,
  createExitCommand,
  createStatusCommand,
  registerAllBuiltins,
} from './builtins.js';
import type { CommandDef, UIContext } from './types.js';

// ===== 测试辅助 =====

function createMockUI(): UIContext & { messages: string[]; errors: string[]; mode: string; agentTexts: string[] } {
  const state = { messages: [] as string[], errors: [] as string[], mode: 'full', agentTexts: [] as string[] };
  return {
    showMessage(text: string) { state.messages.push(text); },
    showError(text: string) { state.errors.push(text); },
    sendToAgent(text: string) { state.agentTexts.push(text); },
    setAgentMode(mode: 'full' | 'plan') { state.mode = mode; },
    getAgentMode() { return state.mode as 'full' | 'plan'; },
    getTokenUsage() { return { estimated: 5000 }; },
    getCurrentSessionId() { return '20260619-120000-abcd'; },
    getMemoryManager() { return null; },
    clearScreen() {},
    requestExit() {},
    getAgent() { return null; },
    messages: state.messages,
    errors: state.errors,
    mode: state.mode,
    agentTexts: state.agentTexts,
  };
}

// ===== CommandRegistry =====

describe('CommandRegistry', () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
  });

  it('注册并查找命令', () => {
    const cmd: CommandDef = {
      name: 'test',
      description: '测试命令',
      type: 'local',
      handler: () => {},
    };
    registry.register(cmd);
    const found = registry.get('test');
    assert.ok(found);
    assert.strictEqual(found!.name, 'test');
    assert.strictEqual(found!.description, '测试命令');
  });

  it('通过别名查找', () => {
    const cmd: CommandDef = {
      name: 'compact',
      aliases: ['compress'],
      description: '压缩',
      type: 'ui',
      handler: () => {},
    };
    registry.register(cmd);
    assert.ok(registry.get('compress'));
    assert.ok(registry.get('COMPRESS')); // 大小写不敏感
  });

  it('别名冲突抛 CommandConflictError', () => {
    registry.register({
      name: 'compact',
      aliases: ['compress'],
      description: '压缩',
      type: 'ui',
      handler: () => {},
    });
    assert.throws(
      () => {
        registry.register({
          name: 'other',
          aliases: ['compress'], // 冲突！
          description: '其他',
          type: 'local',
          handler: () => {},
        });
      },
      /冲突/,
    );
  });

  it('getAll 排除隐藏命令', () => {
    registry.register({
      name: 'visible',
      description: '可见',
      type: 'local',
      handler: () => {},
    });
    registry.register({
      name: 'hidden_cmd',
      description: '隐藏',
      type: 'local',
      hidden: true,
      handler: () => {},
    });
    const all = registry.getAll(false);
    const names = all.map((c) => c.name);
    assert.ok(names.includes('visible'));
    assert.ok(!names.includes('hidden_cmd'));

    // includeHidden = true 应包含隐藏
    const allWithHidden = registry.getAll(true);
    assert.ok(allWithHidden.map((c) => c.name).includes('hidden_cmd'));
  });
});

// ===== CommandParser =====

describe('CommandParser', () => {
  let parser: CommandParser;

  beforeEach(() => {
    parser = new CommandParser();
  });

  it('解析斜杠命令（无参数）', () => {
    const result = parser.parse('/plan');
    assert.ok(result);
    assert.strictEqual(result!.commandName, 'plan');
    assert.strictEqual(result!.args, '');
  });

  it('解析斜杠命令（带参数）', () => {
    const result = parser.parse('/permission strict');
    assert.ok(result);
    assert.strictEqual(result!.commandName, 'permission');
    assert.strictEqual(result!.args, 'strict');
  });

  it('大小写不敏感', () => {
    assert.strictEqual(parser.parse('/PLAN')!.commandName, 'plan');
    assert.strictEqual(parser.parse('/Plan')!.commandName, 'plan');
    assert.strictEqual(parser.parse('/plan')!.commandName, 'plan');
  });

  it('非斜杠输入返回 null', () => {
    assert.strictEqual(parser.parse('hello'), null);
    assert.strictEqual(parser.parse('  hello  '), null);
  });

  it('空输入返回 null', () => {
    assert.strictEqual(parser.parse(''), null);
    assert.strictEqual(parser.parse('  '), null);
  });

  it('只有 / 返回 null', () => {
    assert.strictEqual(parser.parse('/'), null);
  });

  it('多参数保留为原始字符串', () => {
    const result = parser.parse('/resume 20260619-120000-abcd');
    assert.ok(result);
    assert.strictEqual(result!.args, '20260619-120000-abcd');
  });
});

// ===== CommandCompleter =====

describe('CommandCompleter', () => {
  let registry: CommandRegistry;
  let completer: CommandCompleter;

  beforeEach(() => {
    registry = new CommandRegistry();
    registerAllBuiltins(registry, () => registry);
    completer = new CommandCompleter(registry);
  });

  it('单匹配直接补全', () => {
    const [matches] = completer.complete('/com');
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0], 'compact');
  });

  it('多匹配返回列表', () => {
    const [matches] = completer.complete('/p');
    assert.ok(matches.length >= 2);
    assert.ok(matches.includes('plan'));
    assert.ok(matches.includes('permission'));
  });

  it('零匹配返回空', () => {
    const [matches] = completer.complete('/xyznotexist');
    assert.strictEqual(matches.length, 0);
  });

  it('非斜杠不补全', () => {
    const [matches] = completer.complete('hello');
    assert.strictEqual(matches.length, 0);
  });

  it('applyCompletion 单匹配返回完整命令', () => {
    const result = completer.applyCompletion('/com');
    assert.strictEqual(result.completed, '/compact');
    assert.strictEqual(result.matches.length, 0);
  });

  it('applyCompletion 多匹配返回原始行和匹配列表', () => {
    const result = completer.applyCompletion('/p');
    assert.strictEqual(result.completed, '/p');
    assert.ok(result.matches.length >= 2);
  });
});

// ===== 内置命令 =====

describe('内置命令', () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
    registerAllBuiltins(registry, () => registry);
  });

  it('/help 命令存在', () => {
    const cmd = registry.get('help');
    assert.ok(cmd);
    assert.strictEqual(cmd!.type, 'local');
  });

  it('/? 别名指向 help', () => {
    const cmd = registry.get('?');
    assert.ok(cmd);
    assert.strictEqual(cmd!.name, 'help');
  });

  it('/compact 和 /compress 等价', () => {
    const cmd1 = registry.get('compact');
    const cmd2 = registry.get('compress');
    assert.ok(cmd1);
    assert.strictEqual(cmd1, cmd2);
  });

  it('/plan 和 /do 类型为 ui', () => {
    assert.strictEqual(registry.get('plan')!.type, 'ui');
    assert.strictEqual(registry.get('do')!.type, 'ui');
  });

  it('所有 12 个内置命令已注册', () => {
    const all = registry.getAll(true);
    const names = all.map((c) => c.name);
    const expected = [
      'help', 'compact', 'clear', 'plan', 'do',
      'session', 'memory', 'permission', 'status',
      'exit', 'stop', 'resume',
    ];
    for (const name of expected) {
      assert.ok(names.includes(name), `应包含命令: ${name}`);
    }
    assert.strictEqual(all.length, expected.length);
  });

  it('/plan 切换模式为 plan', () => {
    const ui = createMockUI();
    const cmd = registry.get('plan')!;
    cmd.handler(ui, '');
    assert.strictEqual(ui.getAgentMode(), 'plan');
  });

  it('/do 切换模式为 full', () => {
    const ui = createMockUI();
    ui.setAgentMode('plan');
    const cmd = registry.get('do')!;
    cmd.handler(ui, '');
    assert.strictEqual(ui.getAgentMode(), 'full');
  });
});
