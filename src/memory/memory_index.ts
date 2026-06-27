/**
 * MemoryIndex — 记忆索引读写 + 大小限制
 *
 * 管理 MEMORY.md 文件：加载索引内容、从笔记文件重建索引、控制大小。
 * 索引行格式：- [description](filename.md) — 一句话描述
 * 大小限制：≤ 200 行 / 25KB
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  mkdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import type { MemoryNoteFrontmatter } from './types.js';

/** 索引文件名 */
const INDEX_FILE = 'MEMORY.md';
/** 最大行数 */
const MAX_LINES = 200;
/** 最大大小 */
const MAX_SIZE = 25_000; // 25KB

export class MemoryIndex {
  private memoryDir: string;
  private cachedContent = '';

  constructor(memoryDir: string) {
    this.memoryDir = memoryDir;
  }

  /** 加载索引内容 */
  load(): string {
    const indexPath = join(this.memoryDir, INDEX_FILE);
    if (!existsSync(indexPath)) {
      this.cachedContent = '';
      return '';
    }

    let content = readFileSync(indexPath, 'utf-8');

    // 大小检查：超过 25KB 截断
    if (Buffer.byteLength(content, 'utf-8') > MAX_SIZE) {
      const lines = content.split('\n');
      content = lines.slice(0, MAX_LINES).join('\n');
      process.stderr.write(
        `[MewCode] MEMORY.md 超过大小限制 (25KB)，已截断保留前 ${MAX_LINES} 行\n`,
      );
    }

    // 行数检查
    const lines = content.split('\n');
    if (lines.length > MAX_LINES) {
      content = lines.slice(0, MAX_LINES).join('\n');
      process.stderr.write(
        `[MewCode] MEMORY.md 超过行数限制 (${MAX_LINES})，已截断\n`,
      );
    }

    this.cachedContent = content;
    return content;
  }

  /** 根据 memory 目录的笔记文件重建索引 */
  rebuild(): void {
    if (!existsSync(this.memoryDir)) {
      mkdirSync(this.memoryDir, { recursive: true });
      this.cachedContent = '';
      return;
    }

    const entries: Array<{ name: string; mtime: Date; line: string }> = [];

    let dirEntries: string[];
    try {
      dirEntries = readdirSync(this.memoryDir);
    } catch {
      return;
    }

    for (const entry of dirEntries) {
      if (!entry.endsWith('.md')) continue;
      if (entry === INDEX_FILE) continue;

      const fullPath = join(this.memoryDir, entry);
      try {
        if (!statSync(fullPath).isFile()) continue;
      } catch {
        continue;
      }

      const frontmatter = this.parseFrontmatter(fullPath);
      if (!frontmatter) continue;

      const line = `- [${frontmatter.description}](${entry}) — ${frontmatter.metadata.type}`;
      const mtime = statSync(fullPath).mtime;

      entries.push({ name: entry, mtime, line });
    }

    // 按更新时间降序排列
    entries.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    // 生成索引内容，最多 200 行
    const lines = entries.slice(0, MAX_LINES).map((e) => e.line);
    const content = lines.join('\n') + '\n';

    writeFileSync(join(this.memoryDir, INDEX_FILE), content, 'utf-8');
    this.cachedContent = content;
  }

  /** 获取缓存的索引内容 */
  getContent(): string {
    return this.cachedContent;
  }

  /** 解析笔记文件的 frontmatter */
  private parseFrontmatter(filePath: string): MemoryNoteFrontmatter | null {
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch {
      return null;
    }

    // 匹配 YAML frontmatter: ---\n...\n---
    const match = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;

    const yamlBlock = match[1];
    const fields: Record<string, string> = {};

    for (const line of yamlBlock.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      const key = line.slice(0, colonIdx).trim();
      let value = line.slice(colonIdx + 1).trim();
      // 去除引号
      if ((value.startsWith("'") && value.endsWith("'")) ||
          (value.startsWith('"') && value.endsWith('"'))) {
        value = value.slice(1, -1);
      }
      fields[key] = value;
    }

    // 处理嵌套 metadata.type（简单解析，不引入完整 YAML 解析器）
    // 格式：metadata:\n  type: user_preference
    const typeMatch = yamlBlock.match(/metadata:\s*\n\s+type:\s*['"]?(\w+)['"]?/);
    const type = typeMatch ? typeMatch[1] : 'reference';

    if (!fields.name || !fields.description) return null;

    return {
      name: fields.name,
      description: fields.description,
      metadata: { type },
    };
  }
}
