/**
 * InstructionLoader — 项目指令文件三层加载 + @include 展开
 *
 * 三层加载：
 *   L1: 项目根目录 — CLAUDE.md / AGENTS.md
 *   L2: 项目 .mewcode/ 目录 — *.md
 *   L3: 用户 ~/.mewcode/ 目录 — *.md
 *
 * 优先级：project > project_config > user，高优先级内容排前面
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import type { InstructionFile, InstructionLayer } from './types.js';

/** @include 最大嵌套深度 */
const MAX_INCLUDE_DEPTH = 3;

export class InstructionLoader {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = resolve(projectRoot);
  }

  /** 主入口：加载所有指令文件并拼装返回 */
  load(): string {
    const files: InstructionFile[] = [];

    // L1: 项目根目录（最高优先级）
    for (const name of ['CLAUDE.md', 'AGENTS.md']) {
      const p = join(this.projectRoot, name);
      if (existsSync(p) && statSync(p).isFile()) {
        const raw = readFileSync(p, 'utf-8');
        files.push({
          path: resolve(p),
          layer: 'project',
          content: raw,
        });
      }
    }

    // L2: 项目 .mewcode/ 目录
    const projectConfigDir = join(this.projectRoot, '.mewcode');
    this.scanDir(projectConfigDir, 'project_config', files);

    // L3: 用户 ~/.mewcode/ 目录
    const userConfigDir = join(homedir(), '.mewcode');
    this.scanDir(userConfigDir, 'user', files);

    // 展开 @include（对每个文件）
    for (const f of files) {
      f.content = this.resolveIncludes(
        f.content,
        dirname(f.path),
        new Set([resolve(f.path)]),
        1,
      );
    }

    // 按优先级排序：高优先级在前（project > project_config > user）
    const layerOrder: Record<InstructionLayer, number> = {
      project: 0,
      project_config: 1,
      user: 2,
    };
    files.sort((a, b) => layerOrder[a.layer] - layerOrder[b.layer]);

    // 拼接输出
    return files.map((f) => f.content.trim()).filter(Boolean).join('\n\n');
  }

  /** 扫描目录中的 .md 文件 */
  private scanDir(
    dir: string,
    layer: InstructionLayer,
    out: InstructionFile[],
  ): void {
    if (!existsSync(dir)) return;

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // 权限不足等
    }

    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      // 跳过 MEMORY.md（那是记忆索引，不是指令文件）
      if (entry === 'MEMORY.md') continue;
      // 跳过 CLAUDE.md（已在 L1 加载）
      if (layer !== 'project' && entry === 'CLAUDE.md') continue;

      const fullPath = join(dir, entry);
      try {
        if (!statSync(fullPath).isFile()) continue;
      } catch {
        continue;
      }

      const raw = readFileSync(fullPath, 'utf-8');
      out.push({
        path: resolve(fullPath),
        layer,
        content: raw,
      });
    }
  }

  /**
   * 递归展开 @include 指令
   * @param content 文件内容
   * @param baseDir 当前文件所在目录
   * @param visited 已访问文件集合（防环）
   * @param depth 当前嵌套深度
   */
  private resolveIncludes(
    content: string,
    baseDir: string,
    visited: Set<string>,
    depth: number,
  ): string {
    // @include 语法：行级 @include <relative_path>
    const includeRe = /^@include\s+(.+)$/gm;

    return content.replace(includeRe, (_match: string, includePath: string) => {
      const trimmed = includePath.trim();

      if (depth > MAX_INCLUDE_DEPTH) {
        process.stderr.write(
          `[MewCode] @include 嵌套深度超过 ${MAX_INCLUDE_DEPTH} 层，跳过: ${trimmed}\n`,
        );
        return `<!-- @include 已跳过（深度超限）: ${trimmed} -->`;
      }

      // 解析目标绝对路径
      const targetPath = resolve(baseDir, trimmed);

      // 安全检查：目标路径必须在项目根目录内
      if (!targetPath.startsWith(this.projectRoot + sep)) {
        process.stderr.write(
          `[MewCode] @include 路径跳出项目目录，已拦截: ${trimmed} → ${targetPath}\n`,
        );
        return `<!-- @include 已拦截（路径越界）: ${trimmed} -->`;
      }

      // 防环检查
      if (visited.has(targetPath)) {
        process.stderr.write(
          `[MewCode] @include 检测到循环引用，跳过: ${trimmed}\n`,
        );
        return `<!-- @include 已跳过（循环引用）: ${trimmed} -->`;
      }

      // 文件存在检查
      if (!existsSync(targetPath)) {
        process.stderr.write(
          `[MewCode] @include 文件不存在，跳过: ${trimmed} → ${targetPath}\n`,
        );
        return `<!-- @include 已跳过（文件不存在）: ${trimmed} -->`;
      }

      // 读取并递归展开
      const raw = readFileSync(targetPath, 'utf-8');
      const newVisited = new Set(visited);
      newVisited.add(targetPath);

      return this.resolveIncludes(raw, dirname(targetPath), newVisited, depth + 1);
    });
  }
}
