/**
 * Worktree 系统测试
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { WorktreeManager } from './worktree_manager.js';

// ===== 安全校验 =====

describe('WorktreeManager.validateName', () => {
  it('合法名称通过', () => {
    assert.ok(WorktreeManager.validateName('task-abc').valid);
    assert.ok(WorktreeManager.validateName('sub_code-reviewer').valid);
    assert.ok(WorktreeManager.validateName('nested/path').valid);
    assert.ok(WorktreeManager.validateName('a').valid);
    assert.ok(WorktreeManager.validateName('A-Z_0-9').valid);
  });

  it('空名称拒绝', () => {
    const r = WorktreeManager.validateName('');
    assert.ok(!r.valid);
    assert.ok(r.reason!.includes('空'));
  });

  it('.. 段拒绝', () => {
    const r = WorktreeManager.validateName('..');
    assert.ok(!r.valid);
    assert.ok(r.reason!.includes('非法'));
  });

  it('. 段拒绝', () => {
    const r = WorktreeManager.validateName('sub/./agent');
    assert.ok(!r.valid);
  });

  it('/ 开头拒绝', () => {
    const r = WorktreeManager.validateName('/absolute/path');
    assert.ok(!r.valid);
  });

  it('超长拒绝', () => {
    const long = 'a'.repeat(65);
    const r = WorktreeManager.validateName(long);
    assert.ok(!r.valid);
  });

  it('非法字符拒绝', () => {
    assert.ok(!WorktreeManager.validateName('task name').valid, '空格应拒绝');
    assert.ok(!WorktreeManager.validateName('task@name').valid, '@应拒绝');
    assert.ok(!WorktreeManager.validateName('任务名').valid, '中文应拒绝');
  });

  it('64 字符刚好通过', () => {
    const max = 'a'.repeat(64);
    assert.ok(WorktreeManager.validateName(max).valid);
  });
});
