/**
 * SkillLoader — 三级目录扫描 + frontmatter 解析 + 优先级覆盖
 *
 * 三级目录：
 *   1. 内置: src/skills/builtins/（最低优先级）
 *   2. 用户级: ~/.mewcode/skills/
 *   3. 项目级: <project>/.mewcode/skills/（最高优先级）
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type {
  SkillDef,
  SkillSource,
  SkillSummary,
  SkillFrontmatter,
} from './types.js';
import { SOURCE_PRIORITY } from './types.js';

export class SkillLoader {
  private projectRoot: string;
  /** 缓存：name → SkillDef（按优先级已合并） */
  private cache: Map<string, SkillDef> | null = null;

  constructor(projectRoot: string) {
    this.projectRoot = resolve(projectRoot);
  }

  /** 阶段一：列出所有 Skill 的名称和描述 */
  listAll(): SkillSummary[] {
    this.ensureLoaded();
    const result: SkillSummary[] = [];
    for (const [, def] of this.cache!) {
      result.push({
        name: def.name,
        description: def.description,
        source: def.source,
      });
    }
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }

  /** 阶段二：加载指定 Skill 的完整定义 */
  load(name: string): SkillDef | null {
    this.ensureLoaded();
    return this.cache!.get(name) ?? null;
  }

  /** 重新扫描（热更新） */
  reload(): void {
    this.cache = null;
    this.ensureLoaded();
  }

  /** 确保已加载 */
  private ensureLoaded(): void {
    if (this.cache) return;
    this.cache = new Map();

    // 按优先级从低到高扫描（后扫的覆盖先扫的）
    const scans: Array<{ dir: string; source: SkillSource }> = [
      { dir: this.getBuiltinDir(), source: 'builtin' },
      { dir: join(homedir(), '.mewcode', 'skills'), source: 'user' },
      { dir: join(this.projectRoot, '.mewcode', 'skills'), source: 'project' },
    ];

    for (const { dir, source } of scans) {
      this.scanDir(dir, source);
    }
  }

  /** 扫描单个目录 */
  private scanDir(dir: string, source: SkillSource): void {
    if (!existsSync(dir)) return;

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      // 支持单文件 Skill（.md）和目录型 Skill（目录内有 skill.md）
      let filePath: string;
      const fullPath = join(dir, entry);

      try {
        const st = statSync(fullPath);
        if (st.isFile() && entry.endsWith('.md')) {
          filePath = fullPath;
        } else if (st.isDirectory()) {
          // 目录型 Skill：查找 skill.md
          const skillMd = join(fullPath, 'skill.md');
          if (existsSync(skillMd)) {
            filePath = skillMd;
          } else {
            continue;
          }
        } else {
          continue;
        }
      } catch {
        continue;
      }

      // 解析 frontmatter
      const def = this.parseFile(filePath, source, entry.replace(/\.md$/, ''));
      if (!def) continue;

      // 优先级覆盖：高优先级覆盖低优先级
      const existing = this.cache!.get(def.name);
      if (existing) {
        const existingPrio = SOURCE_PRIORITY[existing.source];
        const newPrio = SOURCE_PRIORITY[def.source];
        if (newPrio >= existingPrio) continue; // 优先级不高于现有，跳过
      }

      this.cache!.set(def.name, def);
    }
  }

  /** 解析单个 Skill 文件 */
  private parseFile(
    filePath: string,
    source: SkillSource,
    fallbackName: string,
  ): SkillDef | null {
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch {
      process.stderr.write(
        `[MewCode] Skill 文件读取失败，跳过: ${filePath}\n`,
      );
      return null;
    }

    const fm = this.parseFrontmatter(raw);
    if (!fm || !fm.name || !fm.description) {
      process.stderr.write(
        `[MewCode] Skill 文件 frontmatter 缺少必填字段 (name/description)，跳过: ${filePath}\n`,
      );
      return null;
    }

    // 提取正文（frontmatter 之后的内容）
    const bodyMatch = raw.match(/^---\n[\s\S]*?\n---\n*([\s\S]*)$/);
    const body = bodyMatch ? bodyMatch[1].trim() : '';

    return {
      name: fm.name,
      description: fm.description,
      tools: fm.tools,
      mode: fm.mode ?? 'shared',
      history: fm.history ?? 10,
      model: fm.model,
      body,
      source,
      filePath,
    };
  }

  /** 解析 YAML frontmatter（简单行级解析，不引入完整 YAML 库） */
  private parseFrontmatter(raw: string): SkillFrontmatter | null {
    const match = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;

    const yamlBlock = match[1];
    const fm: Record<string, any> = {};

    // 行级解析
    const lines = yamlBlock.split('\n');
    for (const line of lines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;

      const key = line.slice(0, colonIdx).trim();
      let value = line.slice(colonIdx + 1).trim();

      // 去除引号
      if (
        (value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))
      ) {
        value = value.slice(1, -1);
      }

      if (key === 'tools') {
        // tools: [a, b, c] → 解析数组
        const arrMatch = value.match(/^\[(.*)\]$/);
        if (arrMatch) {
          fm[key] = arrMatch[1]
            .split(',')
            .map((s) => s.trim().replace(/['"]/g, ''))
            .filter(Boolean);
        } else {
          fm[key] = [value];
        }
      } else if (key === 'history') {
        fm[key] = parseInt(value, 10);
      } else {
        fm[key] = value;
      }
    }

    return fm as SkillFrontmatter;
  }

  /** 获取内置 Skill 目录 */
  private getBuiltinDir(): string {
    // src/skills/builtins/ 相对于当前文件
    return join(dirname(fileURLToPath(import.meta.url)), 'builtins');
  }

  /** 暴露所有已加载 Skill（供验证用） */
  getAll(): SkillDef[] {
    this.ensureLoaded();
    return Array.from(this.cache!.values());
  }
}
