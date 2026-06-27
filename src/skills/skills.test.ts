/**
 * Skill 系统测试
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { SkillLoader } from './skill_loader.js';
import { SkillManager } from './skill_manager.js';
import { SkillLoadTool } from './skill_load_tool.js';
import type { SkillDef } from './types.js';

// ===== 测试辅助 =====

function makeTmpDir(): string {
  const dir = join(tmpdir(), `mewcode-skill-test-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createSkillFile(dir: string, name: string, description: string, body: string, extra?: Record<string, unknown>): void {
  const frontmatter: Record<string, unknown> = {
    name,
    description,
    ...extra,
  };
  const lines = ['---'];
  for (const [k, v] of Object.entries(frontmatter)) {
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.join(', ')}]`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  lines.push('---', '', body);

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.md`), lines.join('\n'), 'utf-8');
}

// ===== SkillLoader =====

describe('SkillLoader', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('加载内置 Skill', () => {
    const loader = new SkillLoader(projectDir);
    const skills = loader.listAll();
    assert.ok(skills.length >= 3, `至少应有 3 个内置 Skill，实际: ${skills.length}`);
    const names = skills.map((s) => s.name);
    assert.ok(names.includes('commit'));
    assert.ok(names.includes('review'));
    assert.ok(names.includes('test'));
  });

  it('加载完整 Skill 定义', () => {
    const loader = new SkillLoader(projectDir);
    const commit = loader.load('commit');
    assert.ok(commit);
    assert.strictEqual(commit!.name, 'commit');
    assert.ok(commit!.body.length > 100, '正文应有内容');
    assert.strictEqual(commit!.mode, 'shared');
    assert.ok(commit!.tools);
    assert.ok(commit!.tools!.includes('run_command'));
  });

  it('项目级 Skill 覆盖内置', () => {
    // 创建项目级 commit Skill 覆盖内置
    const skillsDir = join(projectDir, '.mewcode', 'skills');
    createSkillFile(skillsDir, 'commit', '自定义 commit 生成器', '这是自定义的 commit 指令', {
      tools: ['read_file'],
    });

    const loader = new SkillLoader(projectDir);
    const commit = loader.load('commit');
    assert.ok(commit);
    assert.strictEqual(commit!.source, 'project');
    assert.ok(commit!.body.includes('自定义'), '应加载项目级内容');
    assert.deepStrictEqual(commit!.tools, ['read_file']);
  });

  it('解析失败的 Skill 不阻断加载', () => {
    const skillsDir = join(projectDir, '.mewcode', 'skills');
    mkdirSync(skillsDir, { recursive: true });
    // 写一个没有 frontmatter 的坏文件
    writeFileSync(join(skillsDir, 'bad.md'), '没有 frontmatter，就是纯文本', 'utf-8');

    const loader = new SkillLoader(projectDir);
    // 不应抛错，内置 Skill 依然可用
    const commit = loader.load('commit');
    assert.ok(commit);
    assert.strictEqual(commit!.source, 'builtin');
  });

  it('listAll 返回按名称排序的列表', () => {
    const loader = new SkillLoader(projectDir);
    const skills = loader.listAll();
    const names = skills.map((s) => s.name);
    const sorted = [...names].sort();
    assert.deepStrictEqual(names, sorted, '应按名称排序');
  });
});

// ===== SkillManager =====

describe('SkillManager', () => {
  let projectDir: string;
  let loader: SkillLoader;
  let manager: SkillManager;

  beforeEach(() => {
    projectDir = makeTmpDir();
    loader = new SkillLoader(projectDir);
    manager = new SkillManager(loader);
    manager.setValidToolNames(['read_file', 'write_file', 'edit_file', 'run_command', 'glob', 'grep', 'skill_load']);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('激活 Skill', () => {
    const result = manager.activate('commit');
    assert.ok(result);
    assert.strictEqual(result!.skill.name, 'commit');
    assert.ok(manager.isActive('commit'));
    assert.ok(manager.getActiveNames().includes('commit'));
  });

  it('激活不存在的 Skill 返回 null', () => {
    const result = manager.activate('nonexistent');
    assert.strictEqual(result, null);
  });

  it('重复激活返回已激活信息', () => {
    manager.activate('commit');
    const result = manager.activate('commit');
    assert.ok(result); // 仍返回结果
    assert.ok(manager.isActive('commit'));
  });

  it('卸载 Skill', () => {
    manager.activate('commit');
    assert.ok(manager.deactivate('commit'));
    assert.ok(!manager.isActive('commit'));
    assert.deepStrictEqual(manager.getActiveNames(), []);
  });

  it('clear 清空所有已激活', () => {
    manager.activate('commit');
    manager.activate('review');
    assert.strictEqual(manager.getActive().length, 2);
    manager.clear();
    assert.strictEqual(manager.getActive().length, 0);
  });

  it('工具白名单合并', () => {
    manager.activate('commit'); // tools: [read_file, run_command, glob, grep]
    manager.activate('test');   // tools: [read_file, run_command, glob, grep, write_file, edit_file]
    const whitelist = manager.getToolWhitelist();
    assert.ok(whitelist);
    assert.ok(whitelist!.includes('skill_load'), 'skill_load 始终在白名单中');
    assert.ok(whitelist!.includes('write_file'), '应包含 test skill 的 write_file');
    assert.ok(whitelist!.includes('edit_file'), '应包含 test skill 的 edit_file');
  });

  it('无激活 Skill 时 getToolWhitelist 返回 null', () => {
    assert.strictEqual(manager.getToolWhitelist(), null);
  });

  it('白名单中不存在的工具应在 activate 时抛错', () => {
    // 创建自定义 Skill 声明不存在的工具
    const skillsDir = join(projectDir, '.mewcode', 'skills');
    createSkillFile(skillsDir, 'bad-tools', '测试错误工具', '正文', {
      tools: ['nonexistent_tool'],
    });

    const loader2 = new SkillLoader(projectDir);
    const mgr2 = new SkillManager(loader2);
    mgr2.setValidToolNames(['read_file', 'skill_load']);

    assert.throws(() => {
      mgr2.activate('bad-tools');
    }, /不存在/);
  });

  it('buildActivePrompt 生成完整指令', () => {
    manager.activate('commit');
    const prompt = manager.buildActivePrompt();
    assert.ok(prompt.includes('[激活的 Skill]'));
    assert.ok(prompt.includes('commit'));
    assert.ok(prompt.includes('commit message'), '应包含 Skill 正文');
  });

  it('buildAvailableList 生成 Skill 列表', () => {
    const list = manager.buildAvailableList();
    assert.ok(list.includes('可用 Skill'));
    assert.ok(list.includes('commit'));
    assert.ok(list.includes('skill_load'));
  });
});

// ===== SkillLoadTool =====

describe('SkillLoadTool', () => {
  let projectDir: string;
  let loader: SkillLoader;
  let manager: SkillManager;
  let tool: SkillLoadTool;

  beforeEach(() => {
    projectDir = makeTmpDir();
    loader = new SkillLoader(projectDir);
    manager = new SkillManager(loader);
    manager.setValidToolNames(['read_file', 'write_file', 'edit_file', 'run_command', 'glob', 'grep', 'skill_load']);
    tool = new SkillLoadTool(manager);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('execute 激活 Skill', async () => {
    const result = await tool.execute({ name: 'commit' }, {} as any);
    assert.ok(result.success);
    assert.ok(result.output.includes('已激活'));
    assert.ok(manager.isActive('commit'));
  });

  it('execute 不存在的 Skill 返回失败', async () => {
    const result = await tool.execute({ name: 'nonexistent' }, {} as any);
    assert.ok(!result.success);
    assert.ok(result.output.includes('不存在'));
  });

  it('execute 缺少 name 参数返回失败', async () => {
    const result = await tool.execute({}, {} as any);
    assert.ok(!result.success);
    assert.ok(result.output.includes('缺少'));
  });

  it('Tool 接口定义正确', () => {
    assert.strictEqual(tool.name, 'skill_load');
    assert.strictEqual(tool.category, 'readonly');
    assert.ok(tool.parameters.properties.name);
    assert.ok(tool.parameters.required.includes('name'));
  });
});
