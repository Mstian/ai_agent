/**
 * glob — 按模式查找文件工具
 *
 * 不增加外部依赖，手写递归目录遍历 + 轻量 glob 模式匹配
 * 支持 * （匹配任意非 / 字符）、** （递归匹配）、? （匹配单个字符）
 */

import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Tool, ToolExecuteContext, ToolResult } from './types.js';
import { resolvePath, ok, fail } from './helpers.js';

/** 默认忽略的目录 */
const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  'build',
  '.cache',
  '.idea',
  '.vscode',
]);

export class GlobTool implements Tool {
  readonly name = 'glob';
  readonly category = 'readonly' as const;
  readonly description =
    '按文件名模式查找文件。支持 *、**（递归）、? 通配符。**比 find 命令更快更安全，优先使用**。用于在项目中搜索特定类型的文件。';
  readonly parameters = {
    type: 'object' as const,
    properties: {
      pattern: {
        type: 'string',
        description: '文件匹配模式，如 "src/**/*.ts" 或 "*.json"',
      },
      path: {
        type: 'string',
        description: '搜索起始目录（相对于项目根目录），默认为项目根目录',
        default: '.',
      },
    },
    required: ['pattern'],
  };

  async execute(
    input: Record<string, unknown>,
    context: ToolExecuteContext,
  ): Promise<ToolResult> {
    const pattern = input.pattern;
    const basePath = (input.path as string) ?? '.';

    if (typeof pattern !== 'string' || !pattern.trim()) {
      return fail('参数 pattern 不能为空');
    }

    let absPath: string;
    try {
      absPath = resolvePath(basePath, context.cwd);
    } catch (err) {
      return fail((err as Error).message);
    }

    // 规范化 pattern 分隔符为当前系统分隔符
    const normalizedPattern = pattern.replace(/\//g, sep);

    const results: string[] = [];
    const prefix = join(absPath, '');
    const maxResults = 500;

    try {
      walk(absPath, prefix, normalizedPattern, results, maxResults);
    } catch (err) {
      return fail(`遍历目录失败: ${(err as Error).message}`);
    }

    if (results.length === 0) {
      return ok(`未找到匹配 "${pattern}" 的文件`, { count: 0 });
    }

    // 转为相对路径
    const relativePaths = results
      .map((abs) => relative(context.cwd, abs))
      .sort();

    return ok(
      `找到 ${relativePaths.length} 个匹配 "${pattern}" 的文件:\n${relativePaths.join('\n')}`,
      { count: relativePaths.length },
    );
  }
}

/** 递归遍历目录 */
function walk(
  dir: string,
  prefix: string,
  pattern: string,
  results: string[],
  maxResults: number,
) {
  if (results.length >= maxResults) return;

  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return; // 权限不足等，静默跳过
  }

  for (const entry of entries) {
    if (results.length >= maxResults) return;

    const fullPath = join(dir, entry);
    const relativePath = fullPath.slice(prefix.length);

    if (IGNORE_DIRS.has(entry)) continue;

    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      walk(fullPath, prefix, pattern, results, maxResults);
      continue;
    }

    if (stat.isFile()) {
      if (matchGlob(relativePath, pattern)) {
        results.push(fullPath);
      }
    }
  }
}

/**
 * 轻量 glob 模式匹配
 * 将 glob 模式转为正则，然后匹配路径
 * 支持 **、*、?
 */
function matchGlob(path: string, pattern: string): boolean {
  // 将 glob 转为正则
  const regex = globToRegex(pattern);
  // 去掉路径开头的分隔符以便匹配
  const clean = path.startsWith(sep) ? path.slice(1) : path;
  return regex.test(clean);
}

/** 将 glob 模式转为 RegExp */
function globToRegex(pattern: string): RegExp {
  let regexStr = '';
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === sep && pattern[i + 1] === sep && pattern[i + 2] === sep) {
      // 把多个连续分隔符合并（处理 ** 在不同系统的情况）
      i++;
      continue;
    }

    if (ch === '*' && pattern[i + 1] === '*') {
      // **：匹配任意路径段
      if (pattern[i + 2] === sep || i + 2 >= pattern.length) {
        regexStr += '.*';
        i += 2;
        if (pattern[i] === sep) i++;
        continue;
      }
    }

    if (ch === '*') {
      // *：匹配除分隔符外的任意字符
      regexStr += `[^${escapeRegExp(sep)}]*`;
      i++;
      continue;
    }

    if (ch === '?') {
      // ?：匹配单个非分隔符字符
      regexStr += `[^${escapeRegExp(sep)}]`;
      i++;
      continue;
    }

    // 转义正则特殊字符
    if ('^$\\.[]{}()+|'.includes(ch)) {
      regexStr += '\\' + ch;
    } else {
      regexStr += ch;
    }
    i++;
  }

  return new RegExp('^' + regexStr + '$');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
