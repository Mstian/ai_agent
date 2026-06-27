/**
 * RoleLoader — 四级角色文件加载 + 优先级覆盖
 *
 * 四级来源（低→高）：
 *   1. 内置: src/subagent/builtins/
 *   2. 用户: ~/.mewcode/subagents/
 *   3. 项目: <project>/.mewcode/subagents/
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { AgentRole, AgentRoleFrontmatter, RoleSource } from './types.js';

const SOURCE_PRIORITY: Record<RoleSource, number> = {
  builtin: 0,
  user: 1,
  project: 2,
};

export class RoleLoader {
  private projectRoot: string;
  private cache: Map<string, AgentRole> | null = null;

  constructor(projectRoot: string) {
    this.projectRoot = resolve(projectRoot);
  }

  listAll(): Pick<AgentRole, 'name' | 'description' | 'source'>[] {
    this.ensureLoaded();
    return Array.from(this.cache!.values()).map((r) => ({
      name: r.name,
      description: r.description,
      source: r.source,
    })).sort((a, b) => a.name.localeCompare(b.name));
  }

  load(name: string): AgentRole | null {
    this.ensureLoaded();
    return this.cache!.get(name) ?? null;
  }

  reload(): void {
    this.cache = null;
    this.ensureLoaded();
  }

  private ensureLoaded(): void {
    if (this.cache) return;
    this.cache = new Map();

    const scans: Array<{ dir: string; source: RoleSource }> = [
      { dir: join(dirname(fileURLToPath(import.meta.url)), 'builtins'), source: 'builtin' },
      { dir: join(homedir(), '.mewcode', 'subagents'), source: 'user' },
      { dir: join(this.projectRoot, '.mewcode', 'subagents'), source: 'project' },
    ];

    for (const { dir, source } of scans) {
      this.scanDir(dir, source);
    }
  }

  private scanDir(dir: string, source: RoleSource): void {
    if (!existsSync(dir)) return;

    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }

    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      const filePath = join(dir, entry);
      try { if (!statSync(filePath).isFile()) continue; } catch { continue; }

      const role = this.parseFile(filePath, source);
      if (!role) continue;

      const existing = this.cache!.get(role.name);
      if (existing && SOURCE_PRIORITY[existing.source] >= SOURCE_PRIORITY[role.source]) continue;

      this.cache!.set(role.name, role);
    }
  }

  private parseFile(filePath: string, source: RoleSource): AgentRole | null {
    let raw: string;
    try { raw = readFileSync(filePath, 'utf-8'); } catch {
      process.stderr.write(`[SubAgent] 文件读取失败: ${filePath}\n`);
      return null;
    }

    const fm = this.parseFrontmatter(raw);
    if (!fm || !fm.name || !fm.description) {
      process.stderr.write(`[SubAgent] frontmatter 缺少 name/description: ${filePath}\n`);
      return null;
    }

    const bodyMatch = raw.match(/^---\n[\s\S]*?\n---\n*([\s\S]*)$/);
    const body = bodyMatch ? bodyMatch[1].trim() : '';

    return {
      name: fm.name,
      description: fm.description,
      tools: fm.tools,
      blocked_tools: fm.blocked_tools,
      model: fm.model ?? 'inherit',
      max_iterations: fm.max_iterations ?? 10,
      permission_mode: fm.permission_mode ?? 'default',
      body,
      source,
      filePath,
    };
  }

  private parseFrontmatter(raw: string): AgentRoleFrontmatter | null {
    const match = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;

    const fm: Record<string, any> = {};
    for (const line of match[1].split('\n')) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
        value = value.slice(1, -1);
      }
      if (key === 'tools' || key === 'blocked_tools') {
        const arr = value.match(/^\[(.*)\]$/);
        fm[key] = arr ? arr[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean) : [value];
      } else if (key === 'max_iterations') {
        fm[key] = parseInt(value, 10);
      } else {
        fm[key] = value;
      }
    }
    return fm as AgentRoleFrontmatter;
  }
}
