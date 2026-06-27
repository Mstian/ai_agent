/**
 * Hook 系统测试
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { HookMatcher } from './hook_matcher.js';
import { HookExecutor } from './hook_executor.js';
import { HookManager } from './hook_manager.js';
import type { HookContext } from './types.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `mewcode-hook-test-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ===== HookMatcher =====

describe('HookMatcher', () => {
  let matcher: HookMatcher;
  let ctx: HookContext;

  beforeEach(() => {
    matcher = new HookMatcher();
    ctx = { event: 'pre_tool_execute', toolName: 'run_command', cwd: '/test' };
  });

  it('无条件规则返回 true', () => {
    assert.ok(matcher.match({ event: 'turn_start', action: { type: 'prompt', text: 'x' } }, ctx));
  });

  it('精确匹配', () => {
    assert.ok(matcher.matchSingle('run_command', 'run_command'));
    assert.ok(!matcher.matchSingle('write_file', 'run_command'));
  });

  it('反向匹配 !', () => {
    assert.ok(matcher.matchSingle('!write_file', 'run_command'));
    assert.ok(!matcher.matchSingle('!run_command', 'run_command'));
  });

  it('正则匹配 /pattern/', () => {
    assert.ok(matcher.matchSingle('/run/', 'run_command'));
    assert.ok(matcher.matchSingle('/^rm\\s/', 'rm -rf /'));
    assert.ok(!matcher.matchSingle('/^write/', 'run_command'));
  });

  it('glob 匹配 *', () => {
    assert.ok(matcher.matchSingle('*.test.ts', 'agent.test.ts'));
    assert.ok(matcher.matchSingle('run_*', 'run_command'));
    assert.ok(!matcher.matchSingle('write_*', 'run_command'));
  });

  it('条件 matchMode all (AND)', () => {
    const rule = {
      event: 'pre_tool_execute' as const,
      if: {
        tools: ['run_command'],
        matchMode: 'all' as const,
        conditions: [
          { field: 'tool_name', pattern: 'run_command' },
          { field: 'cwd', pattern: '/test' },
        ],
      },
      action: { type: 'prompt' as const, text: 'x' },
    };
    assert.ok(matcher.match(rule, ctx));
    ctx.cwd = '/other';
    assert.ok(!matcher.match(rule, ctx));
  });

  it('条件 matchMode any (OR)', () => {
    const rule = {
      event: 'pre_tool_execute' as const,
      if: {
        matchMode: 'any' as const,
        conditions: [
          { field: 'tool_name', pattern: 'write_file' },
          { field: 'cwd', pattern: '/test' },
        ],
      },
      action: { type: 'prompt' as const, text: 'x' },
    };
    // tool_name 不匹配但 cwd 匹配 → any 通过
    assert.ok(matcher.match(rule, ctx));
  });
});

// ===== HookExecutor =====

describe('HookExecutor', () => {
  let executor: HookExecutor;
  let ctx: HookContext;

  beforeEach(() => {
    executor = new HookExecutor();
    ctx = {
      event: 'turn_start',
      toolName: 'run_command',
      toolInput: { command: 'echo hello' },
      cwd: '/test',
      turnNumber: 1,
      sessionId: 'session-1',
    };
  });

  it('模板变量替换', () => {
    const result = executor.expandVars('Tool: {{tool_name}}, Event: {{event}}', ctx);
    assert.strictEqual(result, 'Tool: run_command, Event: turn_start');
  });

  it('command 动作执行', async () => {
    const result = await executor.execute(
      { type: 'command', command: 'echo "hello hook"' },
      ctx,
    );
    assert.strictEqual(result.exitCode, 0);
  });

  it('command 失败返回非零退出码', async () => {
    const result = await executor.execute(
      { type: 'command', command: 'nonexistent_cmd_xyz_123' },
      ctx,
    );
    assert.ok(result.exitCode !== 0);
  });

  it('prompt 动作返回文本', async () => {
    const result = await executor.execute(
      { type: 'prompt', text: '请使用中文回复' },
      ctx,
    );
    assert.strictEqual(result.promptText, '请使用中文回复');
  });

  it('prompt 支持模板变量', async () => {
    const result = await executor.execute(
      { type: 'prompt', text: 'Tool: {{tool_name}}, Turn: {{turn_number}}' },
      ctx,
    );
    assert.ok(result.promptText!.includes('Tool: run_command'));
    assert.ok(result.promptText!.includes('Turn: 1'));
  });

  it('agent 动作占位不报错', async () => {
    const result = await executor.execute(
      { type: 'agent', prompt: '审查代码' },
      ctx,
    );
    assert.strictEqual(result.promptText, '');
  });
});

// ===== HookManager =====

describe('HookManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('无配置文件时规则数为 0', () => {
    const mgr = new HookManager();
    mgr.load(tmpDir);
    assert.strictEqual(mgr.getRuleCount(), 0);
  });

  it('加载合法配置', () => {
    const mewcodeDir = join(tmpDir, '.mewcode');
    mkdirSync(mewcodeDir, { recursive: true });
    writeFileSync(
      join(mewcodeDir, 'hooks.yaml'),
      [
        '- event: turn_start',
        '  action:',
        '    type: prompt',
        '    text: "请使用中文回复"',
        '- event: pre_tool_execute',
        '  if:',
        '    tools: [run_command]',
        '  action:',
        '    type: command',
        '    command: "exit 0"',
      ].join('\n'),
      'utf-8',
    );

    const mgr = new HookManager();
    mgr.load(tmpDir);
    assert.strictEqual(mgr.getRuleCount(), 2);
  });

  it('非法 event 跳过不阻断', () => {
    const mewcodeDir = join(tmpDir, '.mewcode');
    mkdirSync(mewcodeDir, { recursive: true });
    writeFileSync(
      join(mewcodeDir, 'hooks.yaml'),
      [
        '- event: invalid_event',
        '  action:',
        '    type: prompt',
        '    text: "test"',
        '- event: turn_start',
        '  action:',
        '    type: prompt',
        '    text: "valid"',
      ].join('\n'),
      'utf-8',
    );

    const mgr = new HookManager();
    mgr.load(tmpDir);
    assert.strictEqual(mgr.getRuleCount(), 1, '非法 event 应被跳过');
  });

  it('fire 触发匹配事件', async () => {
    const mewcodeDir = join(tmpDir, '.mewcode');
    mkdirSync(mewcodeDir, { recursive: true });
    writeFileSync(
      join(mewcodeDir, 'hooks.yaml'),
      [
        '- event: turn_start',
        '  action:',
        '    type: prompt',
        '    text: "injected prompt"',
      ].join('\n'),
      'utf-8',
    );

    const mgr = new HookManager();
    mgr.load(tmpDir);

    const result = await mgr.fire('turn_start', {
      event: 'turn_start',
      cwd: tmpDir,
    });

    assert.ok(result.allowed);
    assert.strictEqual(result.promptInjections.length, 1);
    assert.strictEqual(result.promptInjections[0], 'injected prompt');
  });

  it('pre_tool_execute 拦截生效', async () => {
    const mewcodeDir = join(tmpDir, '.mewcode');
    mkdirSync(mewcodeDir, { recursive: true });
    writeFileSync(
      join(mewcodeDir, 'hooks.yaml'),
      [
        '- event: pre_tool_execute',
        '  if:',
        '    tools: [run_command]',
        '    conditions:',
        '      - field: command',
        '        pattern: "/rm/"',
        '  action:',
        '    type: command',
        '    command: "exit 1"',
      ].join('\n'),
      'utf-8',
    );

    const mgr = new HookManager();
    mgr.load(tmpDir);

    const result = await mgr.fire('pre_tool_execute', {
      event: 'pre_tool_execute',
      toolName: 'run_command',
      toolInput: { command: 'rm -rf /' },
      cwd: tmpDir,
    });

    assert.ok(!result.allowed, '应拦截 rm 命令');
    assert.ok(result.reason!.includes('Hook 拦截'));
  });
});
