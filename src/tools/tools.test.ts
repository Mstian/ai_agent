/**
 * 工具系统测试
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ToolExecuteContext } from './types.js';
import { ToolRegistry } from './registry.js';
import { ReadFileTool } from './read_file.js';
import { WriteFileTool } from './write_file.js';
import { EditFileTool } from './edit_file.js';
import { RunCommandTool } from './run_command.js';
import { GlobTool } from './glob.js';
import { GrepTool } from './grep.js';
import {
  resolvePath,
  checkDangerousCommand,
  isBinary,
  withTimeout,
} from './helpers.js';

// 辅助：创建上下文（默认 cwd 为项目根目录）
function ctx(overrides?: Partial<ToolExecuteContext>): ToolExecuteContext {
  return { cwd: process.cwd(), timeout: 5000, ...overrides };
}

describe('helpers', () => {
  describe('resolvePath', () => {
    it('解析相对路径', () => {
      const result = resolvePath('src/main.ts', process.cwd());
      assert.ok(result.endsWith('src/main.ts'));
    });

    it('拒绝路径逃逸', () => {
      assert.throws(
        () => resolvePath('../../../etc/passwd', process.cwd()),
        /路径逃逸/,
      );
    });
  });

  describe('checkDangerousCommand', () => {
    it('拦截 rm -rf /', () => {
      const result = checkDangerousCommand('rm -rf /');
      assert.ok(result);
      assert.ok(result!.includes('安全检查'));
    });

    it('通过正常命令', () => {
      assert.strictEqual(checkDangerousCommand('echo hello'), null);
      assert.strictEqual(checkDangerousCommand('ls -la'), null);
      assert.strictEqual(checkDangerousCommand('npm test'), null);
    });
  });

  describe('isBinary', () => {
    it('文本 Buffer 不是二进制', () => {
      const buf = Buffer.from('console.log("hello");\n', 'utf-8');
      assert.strictEqual(isBinary(buf), false);
    });

    it('含 null byte 是二进制', () => {
      const buf = Buffer.alloc(10);
      buf[5] = 0;
      buf.write('hello');
      assert.strictEqual(isBinary(buf), true);
    });
  });

  describe('withTimeout', () => {
    it('正常完成的 Promise', async () => {
      const result = await withTimeout(Promise.resolve(42), 1000);
      assert.strictEqual(result, 42);
    });

    it('超时抛出错误', async () => {
      try {
        await withTimeout(new Promise(() => {}), 50);
        assert.fail('应该抛出超时错误');
      } catch (err) {
        assert.ok((err as Error).message.includes('超时'));
      }
    });
  });
});

describe('ToolRegistry', () => {
  it('注册并查找工具', () => {
    const registry = new ToolRegistry();
    const tool = new ReadFileTool();
    registry.register(tool);
    assert.strictEqual(registry.get('read_file'), tool);
    assert.strictEqual(registry.get('nonexistent'), undefined);
  });

  it('重复注册抛错', () => {
    const registry = new ToolRegistry();
    registry.register(new ReadFileTool());
    assert.throws(() => registry.register(new ReadFileTool()), /已注册/);
  });

  it('toAPIFormat 返回正确格式', () => {
    const registry = new ToolRegistry();
    registry.register(new ReadFileTool());
    const defs = registry.toAPIFormat();
    assert.strictEqual(defs.length, 1);
    assert.strictEqual(defs[0].name, 'read_file');
    assert.ok(defs[0].description.length > 0);
    assert.strictEqual(defs[0].input_schema.type, 'object');
  });
});

describe('ReadFileTool', () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = join(tmpdir(), `mewcode-read-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });
  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  it('读取存在的文件', async () => {
    writeFileSync(join(tempDir, 'test.txt'), 'Hello World', 'utf-8');
    const tool = new ReadFileTool();
    const result = await tool.execute(
      { file_path: 'test.txt' },
      ctx({ cwd: tempDir }),
    );
    assert.strictEqual(result.success, true);
    assert.ok(result.output.includes('Hello World'));
  });

  it('文件不存在返回失败', async () => {
    const tool = new ReadFileTool();
    const result = await tool.execute(
      { file_path: 'nonexistent.txt' },
      ctx({ cwd: tempDir }),
    );
    assert.strictEqual(result.success, false);
    assert.ok(result.error!.includes('不存在'));
  });

  it('目录返回失败', async () => {
    const tool = new ReadFileTool();
    const result = await tool.execute(
      { file_path: '.' },
      ctx({ cwd: tempDir }),
    );
    assert.strictEqual(result.success, false);
    assert.ok(result.error!.includes('目录'));
  });

  it('空路径返回失败', async () => {
    const tool = new ReadFileTool();
    const result = await tool.execute(
      { file_path: '' },
      ctx({ cwd: tempDir }),
    );
    assert.strictEqual(result.success, false);
  });
});

describe('WriteFileTool', () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = join(tmpdir(), `mewcode-write-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });
  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  it('创建新文件', async () => {
    const tool = new WriteFileTool();
    const result = await tool.execute(
      { file_path: 'new.txt', content: 'new content' },
      ctx({ cwd: tempDir }),
    );
    assert.strictEqual(result.success, true);
    assert.ok(existsSync(join(tempDir, 'new.txt')));
    assert.strictEqual(readFileSync(join(tempDir, 'new.txt'), 'utf-8'), 'new content');
  });

  it('覆盖已有文件', async () => {
    writeFileSync(join(tempDir, 'exist.txt'), 'old', 'utf-8');
    const tool = new WriteFileTool();
    const result = await tool.execute(
      { file_path: 'exist.txt', content: 'new' },
      ctx({ cwd: tempDir }),
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(readFileSync(join(tempDir, 'exist.txt'), 'utf-8'), 'new');
  });

  it('递归创建父目录', async () => {
    const tool = new WriteFileTool();
    const result = await tool.execute(
      { file_path: 'a/b/c.txt', content: 'deep' },
      ctx({ cwd: tempDir }),
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(readFileSync(join(tempDir, 'a', 'b', 'c.txt'), 'utf-8'), 'deep');
  });
});

describe('EditFileTool', () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = join(tmpdir(), `mewcode-edit-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });
  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  it('唯一匹配替换', async () => {
    writeFileSync(join(tempDir, 'code.ts'), 'const x = 1;\nconst y = 2;\n', 'utf-8');
    const tool = new EditFileTool();
    const result = await tool.execute(
      { file_path: 'code.ts', old_string: 'const x = 1;', new_string: 'const x = 10;' },
      ctx({ cwd: tempDir }),
    );
    assert.strictEqual(result.success, true);
    const modified = readFileSync(join(tempDir, 'code.ts'), 'utf-8');
    assert.ok(modified.includes('const x = 10;'));
    assert.ok(!modified.includes('const x = 1;'));
  });

  it('匹配不到返回失败', async () => {
    writeFileSync(join(tempDir, 'code.ts'), 'hello world', 'utf-8');
    const tool = new EditFileTool();
    const result = await tool.execute(
      { file_path: 'code.ts', old_string: 'nonexistent text', new_string: 'replacement' },
      ctx({ cwd: tempDir }),
    );
    assert.strictEqual(result.success, false);
    assert.ok(result.error!.includes('未找到匹配'));
  });

  it('多处匹配返回失败', async () => {
    writeFileSync(join(tempDir, 'code.ts'), 'TODO: fix\nTODO: fix\n', 'utf-8');
    const tool = new EditFileTool();
    const result = await tool.execute(
      { file_path: 'code.ts', old_string: 'TODO: fix', new_string: 'DONE' },
      ctx({ cwd: tempDir }),
    );
    assert.strictEqual(result.success, false);
    assert.ok(result.error!.includes('2 处'));
  });

  it('空 old_string 返回失败', async () => {
    writeFileSync(join(tempDir, 'code.ts'), 'content', 'utf-8');
    const tool = new EditFileTool();
    const result = await tool.execute(
      { file_path: 'code.ts', old_string: '', new_string: 'x' },
      ctx({ cwd: tempDir }),
    );
    assert.strictEqual(result.success, false);
  });
});

describe('RunCommandTool', () => {
  it('执行 echo 命令', async () => {
    const tool = new RunCommandTool();
    const result = await tool.execute({ command: 'echo hello' }, ctx());
    assert.strictEqual(result.success, true);
    assert.ok(result.output.includes('hello'));
    assert.strictEqual(result.meta?.exit_code, 0);
  });

  it('危险命令被拦截', async () => {
    const tool = new RunCommandTool();
    const result = await tool.execute({ command: 'rm -rf /' }, ctx());
    assert.strictEqual(result.success, false);
    assert.ok(result.error!.includes('安全检查'));
  });

  it('命令执行失败返回错误', async () => {
    const tool = new RunCommandTool();
    const result = await tool.execute(
      { command: 'nonexistentcmdxyz123' },
      ctx({ timeout: 3000 }),
    );
    assert.strictEqual(result.success, false);
  });

  it('空命令返回失败', async () => {
    const tool = new RunCommandTool();
    const result = await tool.execute({ command: '' }, ctx());
    assert.strictEqual(result.success, false);
  });
});

describe('GlobTool', () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = join(tmpdir(), `mewcode-glob-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, 'a.ts'), '');
    writeFileSync(join(tempDir, 'b.ts'), '');
    writeFileSync(join(tempDir, 'c.js'), '');
    writeFileSync(join(tempDir, 'data.json'), '');
    mkdirSync(join(tempDir, 'sub'), { recursive: true });
    writeFileSync(join(tempDir, 'sub', 'd.ts'), '');
  });
  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  it('按扩展名匹配文件', async () => {
    const tool = new GlobTool();
    const result = await tool.execute(
      { pattern: '*.ts', path: '.' },
      ctx({ cwd: tempDir }),
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.meta?.count, 2); // a.ts, b.ts
    assert.ok(result.output.includes('a.ts'));
  });

  it('递归匹配', async () => {
    const tool = new GlobTool();
    const result = await tool.execute(
      { pattern: '**/*.ts', path: '.' },
      ctx({ cwd: tempDir }),
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.meta?.count, 3); // a.ts, b.ts, sub/d.ts
  });

  it('无匹配返回成功但 count 为 0', async () => {
    const tool = new GlobTool();
    const result = await tool.execute(
      { pattern: '*.py', path: '.' },
      ctx({ cwd: tempDir }),
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.meta?.count, 0);
  });
});

describe('GrepTool', () => {
  let tempDir: string;
  beforeEach(() => {
    tempDir = join(tmpdir(), `mewcode-grep-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, 'a.ts'), 'function main() {\n  return 42;\n}', 'utf-8');
    writeFileSync(join(tempDir, 'b.ts'), 'const x = main();', 'utf-8');
    writeFileSync(join(tempDir, 'readme.md'), '# Project\nThis is a test project.', 'utf-8');
    mkdirSync(join(tempDir, 'node_modules'), { recursive: true });
    writeFileSync(join(tempDir, 'node_modules', 'dep.ts'), 'function main() {}', 'utf-8');
  });
  afterEach(() => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
  });

  it('搜索文本内容', async () => {
    const tool = new GrepTool();
    const result = await tool.execute(
      { pattern: 'function main', path: '.' },
      ctx({ cwd: tempDir }),
    );
    assert.strictEqual(result.success, true);
    const count = result.meta?.count as number;
    assert.ok(count! >= 1);
    assert.ok(result.output.includes('a.ts'));
  });

  it('忽略 node_modules', async () => {
    const tool = new GrepTool();
    const result = await tool.execute(
      { pattern: 'function main', path: '.' },
      ctx({ cwd: tempDir }),
    );
    assert.strictEqual(result.success, true);
    assert.ok(!result.output.includes('node_modules'));
  });

  it('include 过滤文件名', async () => {
    const tool = new GrepTool();
    const result = await tool.execute(
      { pattern: 'Project', include: '*.md', path: '.' },
      ctx({ cwd: tempDir }),
    );
    assert.strictEqual(result.success, true);
    assert.ok(result.output.includes('readme.md'));
  });

  it('无匹配返回成功但 count 为 0', async () => {
    const tool = new GrepTool();
    const result = await tool.execute(
      { pattern: 'ZZZ_NONEXISTENT_ZZZ', path: '.' },
      ctx({ cwd: tempDir }),
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.meta?.count, 0);
  });
});
