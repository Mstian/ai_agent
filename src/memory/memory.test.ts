/**
 * 记忆系统测试
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { InstructionLoader } from './instruction_loader.js';
import { SessionArchiver } from './session_archiver.js';
import { SessionRecovery } from './session_recovery.js';
import { MemoryIndex } from './memory_index.js';

// ===== 测试辅助 =====

function makeTmpDir(): string {
  const dir = join(tmpdir(), `mewcode-test-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ===== InstructionLoader =====

describe('InstructionLoader', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('加载项目根 CLAUDE.md', () => {
    writeFileSync(join(tmpDir, 'CLAUDE.md'), '本项目使用 TypeScript', 'utf-8');
    const loader = new InstructionLoader(tmpDir);
    const result = loader.load();
    assert.ok(result.includes('TypeScript'), '应包含 CLAUDE.md 内容');
  });

  it('三层加载按优先级排列', () => {
    // L1: 项目根
    writeFileSync(join(tmpDir, 'CLAUDE.md'), 'L1: 项目根', 'utf-8');
    // L2: 项目 .mewcode/
    const projMewcode = join(tmpDir, '.mewcode');
    mkdirSync(projMewcode, { recursive: true });
    writeFileSync(join(projMewcode, 'notes.md'), 'L2: 项目配置', 'utf-8');
    // L3: 用户 ~/.mewcode/ — 在测试中模拟非标准目录，这里仅验证两层优先级
    const loader = new InstructionLoader(tmpDir);
    const result = loader.load();
    const l1Idx = result.indexOf('L1');
    const l2Idx = result.indexOf('L2');
    assert.ok(l1Idx < l2Idx, 'L1(项目根)应排在 L2(项目配置)前面');
  });

  it('@include 正确展开', () => {
    const projMewcode = join(tmpDir, '.mewcode');
    mkdirSync(projMewcode, { recursive: true });
    writeFileSync(join(projMewcode, 'tech.md'), '技术栈: Node.js', 'utf-8');
    writeFileSync(
      join(tmpDir, 'CLAUDE.md'),
      '@include .mewcode/tech.md',
      'utf-8',
    );
    const loader = new InstructionLoader(tmpDir);
    const result = loader.load();
    assert.ok(result.includes('Node.js'), '应包含被引用文件的内容');
    assert.ok(!result.includes('@include'), '@include 指令应被替换');
  });

  it('@include 嵌套超过 3 层被跳过', () => {
    const projMewcode = join(tmpDir, '.mewcode');
    mkdirSync(projMewcode, { recursive: true });
    writeFileSync(join(projMewcode, 'a.md'), '@include .mewcode/b.md', 'utf-8');
    writeFileSync(join(projMewcode, 'b.md'), '@include .mewcode/c.md', 'utf-8');
    writeFileSync(join(projMewcode, 'c.md'), '@include .mewcode/d.md', 'utf-8');
    writeFileSync(join(projMewcode, 'd.md'), '第四层', 'utf-8');
    writeFileSync(
      join(tmpDir, 'CLAUDE.md'),
      '@include .mewcode/a.md',
      'utf-8',
    );
    const loader = new InstructionLoader(tmpDir);
    const result = loader.load();
    assert.ok(
      result.includes('已跳过') || !result.includes('第四层'),
      '第 4 层 @include 应被跳过',
    );
  });

  it('@include 防环（A→B→A）', () => {
    const projMewcode = join(tmpDir, '.mewcode');
    mkdirSync(projMewcode, { recursive: true });
    writeFileSync(join(projMewcode, 'a.md'), '@include .mewcode/b.md', 'utf-8');
    writeFileSync(join(projMewcode, 'b.md'), '@include .mewcode/a.md', 'utf-8');
    writeFileSync(
      join(tmpDir, 'CLAUDE.md'),
      '@include .mewcode/a.md',
      'utf-8',
    );
    const loader = new InstructionLoader(tmpDir);
    // 不应无限递归
    const result = loader.load();
    assert.ok(
      result.includes('已跳过') || result.includes('循环'),
      '循环引用应被检测并跳过',
    );
  });

  it('@include 路径越界被拦截', () => {
    writeFileSync(
      join(tmpDir, 'CLAUDE.md'),
      '@include ../../../etc/passwd',
      'utf-8',
    );
    const loader = new InstructionLoader(tmpDir);
    const result = loader.load();
    assert.ok(
      result.includes('已拦截') || !result.includes('root:'),
      '越界路径应被拦截',
    );
  });

  it('无指令文件时返回空字符串', () => {
    const loader = new InstructionLoader(tmpDir);
    const result = loader.load();
    assert.strictEqual(result, '');
  });
});

// ===== SessionArchiver =====

describe('SessionArchiver', () => {
  let sessionsDir: string;

  beforeEach(() => {
    sessionsDir = join(makeTmpDir(), 'sessions');
  });

  afterEach(() => {
    rmSync(sessionsDir, { recursive: true, force: true });
  });

  it('会话 ID 格式正确', () => {
    const id = SessionArchiver.generateSessionId();
    assert.ok(
      /^\d{8}-\d{6}-[0-9a-f]{4}$/.test(id),
      `会话 ID 格式应为 YYYYMMDD-HHMMSS-xxxx，实际: ${id}`,
    );
  });

  it('startSession 创建 JSONL 文件并写 meta 行', () => {
    const archiver = new SessionArchiver(sessionsDir);
    const id = archiver.startSession('/test');
    const filePath = join(sessionsDir, `${id}.jsonl`);
    assert.ok(existsSync(filePath), 'JSONL 文件应存在');

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    assert.strictEqual(lines.length, 1, '应只有 1 行 meta');

    const meta = JSON.parse(lines[0]);
    assert.strictEqual(meta.type, 'session_meta');
    assert.strictEqual(meta.session_id, id);
    assert.strictEqual(meta.cwd, '/test');
  });

  it('appendMessage 追加消息行', () => {
    const archiver = new SessionArchiver(sessionsDir);
    const id = archiver.startSession('/test');
    archiver.appendMessage('user', '你好');
    archiver.appendMessage('assistant', '你好！有什么可以帮你？');

    const filePath = join(sessionsDir, `${id}.jsonl`);
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    assert.strictEqual(lines.length, 3, '应有 3 行（1 meta + 2 message）');

    const msg1 = JSON.parse(lines[1]);
    assert.strictEqual(msg1.type, 'message');
    assert.strictEqual(msg1.role, 'user');
    assert.strictEqual(msg1.content, '你好');
  });

  it('getCurrentSessionId 返回当前会话 ID', () => {
    const archiver = new SessionArchiver(sessionsDir);
    assert.strictEqual(archiver.getCurrentSessionId(), null);
    const id = archiver.startSession('/test');
    assert.strictEqual(archiver.getCurrentSessionId(), id);
    archiver.endSession();
    assert.strictEqual(archiver.getCurrentSessionId(), null);
  });
});

// ===== SessionRecovery =====

describe('SessionRecovery', () => {
  let sessionsDir: string;

  beforeEach(() => {
    sessionsDir = join(makeTmpDir(), 'sessions');
  });

  afterEach(() => {
    rmSync(sessionsDir, { recursive: true, force: true });
  });

  it('listSessions 列出所有会话', () => {
    mkdirSync(sessionsDir, { recursive: true });
    // 创建两个假的 JSONL 文件
    const id1 = '20260619-120000-abcd';
    const id2 = '20260619-130000-ef01';
    writeFileSync(
      join(sessionsDir, `${id1}.jsonl`),
      JSON.stringify({ type: 'session_meta', session_id: id1, started_at: '2026-06-19T12:00:00Z', cwd: '/test' }) + '\n' +
      JSON.stringify({ type: 'message', role: 'user', content: 'hello', timestamp: '2026-06-19T12:00:01Z' }) + '\n',
      'utf-8',
    );
    writeFileSync(
      join(sessionsDir, `${id2}.jsonl`),
      JSON.stringify({ type: 'session_meta', session_id: id2, started_at: '2026-06-19T13:00:00Z', cwd: '/test2' }) + '\n' +
      JSON.stringify({ type: 'message', role: 'user', content: 'hi', timestamp: '2026-06-19T13:00:01Z' }) + '\n',
      'utf-8',
    );

    const recovery = new SessionRecovery(sessionsDir);
    const sessions = recovery.listSessions();
    assert.strictEqual(sessions.length, 2, '应列出 2 个会话');
    assert.strictEqual(sessions[0].messageCount, 1);
  });

  it('recover 跳过坏行', () => {
    mkdirSync(sessionsDir, { recursive: true });
    const id = '20260619-120000-abcd';
    // 构造有坏行的 JSONL
    writeFileSync(
      join(sessionsDir, `${id}.jsonl`),
      JSON.stringify({ type: 'session_meta', session_id: id, started_at: '2026-06-19T12:00:00Z', cwd: '/test' }) + '\n' +
      JSON.stringify({ type: 'message', role: 'user', content: 'hello', timestamp: '2026-06-19T12:00:01Z' }) + '\n' +
      '{broken json\n',  // 坏行
      'utf-8',
    );

    const recovery = new SessionRecovery(sessionsDir);
    const result = recovery.recover(id);
    assert.strictEqual(result.messages.length, 1, '坏行应被跳过，只有 1 条正常消息');
    assert.strictEqual(
      typeof result.messages[0].content,
      'string',
      '用户消息内容应是字符串',
    );
  });

  it('recover 无会话文件时抛错', () => {
    mkdirSync(sessionsDir, { recursive: true });
    const recovery = new SessionRecovery(sessionsDir);
    assert.throws(() => {
      recovery.recover('nonexistent');
    }, /不存在/);
  });

  it('cleanExpired 不删除未过期的会话', () => {
    mkdirSync(sessionsDir, { recursive: true });
    const id = '20260619-120000-abcd';
    const filePath = join(sessionsDir, `${id}.jsonl`);
    writeFileSync(
      filePath,
      JSON.stringify({ type: 'session_meta', session_id: id, started_at: '2026-06-19T12:00:00Z', cwd: '/test' }) + '\n',
      'utf-8',
    );

    const recovery = new SessionRecovery(sessionsDir);
    // 新创建的文件不应被默认 30 天过期策略删除
    const cleaned = recovery.cleanExpired(30);
    assert.strictEqual(cleaned, 0, '新文件不应被清理');
    assert.ok(existsSync(filePath), '文件应仍然存在');
  });
});

// ===== MemoryIndex =====

describe('MemoryIndex', () => {
  let memoryDir: string;

  beforeEach(() => {
    memoryDir = join(makeTmpDir(), 'memory');
  });

  afterEach(() => {
    rmSync(memoryDir, { recursive: true, force: true });
  });

  it('load 空目录返回空字符串', () => {
    const index = new MemoryIndex(memoryDir);
    const content = index.load();
    assert.strictEqual(content, '');
  });

  it('rebuild 从笔记文件生成索引', () => {
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(
      join(memoryDir, 'my-note.md'),
      [
        '---',
        'name: my-note',
        'description: 这是一个测试笔记',
        'metadata:',
        '  type: user_preference',
        '---',
        '',
        '正文内容',
      ].join('\n'),
      'utf-8',
    );

    const index = new MemoryIndex(memoryDir);
    index.rebuild();

    const indexPath = join(memoryDir, 'MEMORY.md');
    assert.ok(existsSync(indexPath), 'MEMORY.md 应被创建');

    const content = readFileSync(indexPath, 'utf-8');
    assert.ok(content.includes('my-note.md'), '索引应包含笔记文件名');
    assert.ok(content.includes('测试笔记'), '索引应包含描述');
    assert.ok(content.includes('user_preference'), '索引应包含类型');
  });

  it('MEMORY.md 超过 200 行时截断', () => {
    mkdirSync(memoryDir, { recursive: true });
    // 创建 250 条笔记
    for (let i = 0; i < 250; i++) {
      writeFileSync(
        join(memoryDir, `note-${i}.md`),
        [
          '---',
          `name: note-${i}`,
          `description: 笔记 ${i}`,
          'metadata:',
          '  type: reference',
          '---',
          '',
          '内容',
        ].join('\n'),
        'utf-8',
      );
    }

    const index = new MemoryIndex(memoryDir);
    index.rebuild();

    const content = readFileSync(join(memoryDir, 'MEMORY.md'), 'utf-8');
    const lines = content.trim().split('\n');
    assert.ok(lines.length <= 200, `索引行数应 ≤ 200，实际: ${lines.length}`);
  });

  it('load 加载已有 MEMORY.md', () => {
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(
      join(memoryDir, 'MEMORY.md'),
      '- [笔记1](note1.md) — user_preference\n',
      'utf-8',
    );

    const index = new MemoryIndex(memoryDir);
    const content = index.load();
    assert.ok(content.includes('笔记1'), '应加载已有索引内容');
    assert.strictEqual(index.getContent(), content, 'getContent 应返回缓存内容');
  });
});
