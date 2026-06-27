/**
 * 子 Agent 系统测试
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { RoleLoader } from './role_loader.js';
import { TaskManager } from './task_manager.js';
import type { BackgroundTask } from './types.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `mewcode-subagent-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ===== RoleLoader =====

describe('RoleLoader', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('加载内置角色', () => {
    const loader = new RoleLoader(tmpDir);
    const roles = loader.listAll();
    assert.ok(roles.length >= 1, `至少应有 1 个内置角色，实际: ${roles.length}`);
    const names = roles.map((r) => r.name);
    assert.ok(names.includes('code-reviewer'), '应包含 code-reviewer');
  });

  it('加载完整角色定义', () => {
    const loader = new RoleLoader(tmpDir);
    const role = loader.load('code-reviewer');
    assert.ok(role);
    assert.strictEqual(role!.name, 'code-reviewer');
    assert.ok(role!.body.length > 50, '正文应有内容');
    assert.ok(role!.tools!.includes('read_file'));
    assert.strictEqual(role!.max_iterations, 8);
  });

  it('项目级覆盖内置', () => {
    const dir = join(tmpDir, '.mewcode', 'subagents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'code-reviewer.md'), [
      '---',
      'name: code-reviewer',
      'description: 自定义审查',
      'tools: [read_file]',
      'max_iterations: 5',
      '---',
      '',
      '自定义审查指令',
    ].join('\n'), 'utf-8');

    const loader = new RoleLoader(tmpDir);
    const role = loader.load('code-reviewer');
    assert.ok(role);
    assert.strictEqual(role!.source, 'project');
    assert.strictEqual(role!.max_iterations, 5);
    assert.ok(role!.body.includes('自定义审查指令'));
  });

  it('解析失败跳过不阻断', () => {
    const dir = join(tmpDir, '.mewcode', 'subagents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'bad.md'), '没有 frontmatter', 'utf-8');

    const loader = new RoleLoader(tmpDir);
    const role = loader.load('code-reviewer');
    assert.ok(role, '内置角色应仍然可用');
  });
});

// ===== TaskManager =====

describe('TaskManager', () => {
  let mgr: TaskManager;

  beforeEach(() => { mgr = new TaskManager(); });

  it('注册并追踪任务', () => {
    const task: BackgroundTask = {
      id: 't1', status: 'pending',
      prompt: 'test', startedAt: new Date(),
    };
    mgr.register(task);
    mgr.markRunning('t1');
    assert.strictEqual(mgr.getStatus('t1'), 'running');
  });

  it('标记完成并通知', () => {
    const task: BackgroundTask = {
      id: 't2', status: 'pending',
      prompt: 'test', startedAt: new Date(),
    };
    mgr.register(task);
    mgr.markDone('t2', {
      taskId: 't2', finalText: 'done', turns: 3,
      tokenUsage: { input: 100, output: 50 },
      stopReason: 'task_completed', durationMs: 100,
    });

    const completed = mgr.checkCompleted();
    assert.strictEqual(completed.length, 1);
    assert.strictEqual(completed[0].id, 't2');
    assert.strictEqual(completed[0].status, 'done');

    // 第二次查询应为空
    assert.strictEqual(mgr.checkCompleted().length, 0);
  });

  it('标记失败', () => {
    const task: BackgroundTask = {
      id: 't3', status: 'pending',
      prompt: 'test', startedAt: new Date(),
    };
    mgr.register(task);
    mgr.markError('t3', 'something broke');

    const completed = mgr.checkCompleted();
    assert.strictEqual(completed[0].status, 'error');
    assert.strictEqual(completed[0].error, 'something broke');
  });

  it('listActive 只返回活跃任务', () => {
    mgr.register({ id: 'a1', status: 'pending', prompt: 'p1', startedAt: new Date() });
    mgr.register({ id: 'a2', status: 'running', prompt: 'p2', startedAt: new Date() });
    mgr.register({ id: 'a3', status: 'done', prompt: 'p3', startedAt: new Date() });

    const active = mgr.listActive();
    assert.strictEqual(active.length, 2);
    const ids = active.map((t) => t.id);
    assert.ok(ids.includes('a1'));
    assert.ok(ids.includes('a2'));
    assert.ok(!ids.includes('a3'));
  });
});
