/**
 * grep — 搜索代码内容工具
 *
 * 递归遍历目录，对匹配 include 模式的文件用 RegExp 搜索
 * 忽略 node_modules、.git、dist 等目录
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Tool, ToolExecuteContext, ToolResult } from './types.js';
import {
  resolvePath,
  truncateOutput,
  MAX_GREP_FILES,
  ok,
  fail,
} from './helpers.js';

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
  'coverage',
]);

/** 文本文件扩展名（仅在 include 未指定时作为默认过滤） */
const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.yaml', '.yml', '.toml',
  '.md', '.mdx', '.txt', '.csv',
  '.html', '.css', '.scss', '.less',
  '.py', '.rs', '.go', '.java', '.kt', '.swift',
  '.c', '.cpp', '.h', '.hpp',
  '.sh', '.bash', '.zsh',
  '.sql', '.graphql', '.prisma',
  '.xml', '.svg',
  '.env', '.gitignore', '.dockerignore',
  'Dockerfile', 'Makefile',
]);

export class GrepTool implements Tool {
  readonly name = 'grep';
  readonly category = 'readonly' as const;
  readonly description =
    '在文件内容中搜索文本或正则表达式。**比 grep 命令更安全（自动忽略 node_modules），优先使用**。返回匹配的文件路径、行号和内容。用于在代码库中查找函数定义、变量使用、错误信息等。';
  readonly parameters = {
    type: 'object' as const,
    properties: {
      pattern: {
        type: 'string',
        description: '搜索模式（文本字符串或正则表达式）',
      },
      include: {
        type: 'string',
        description: '文件名过滤模式（glob），如 "*.ts" 或 "*.{ts,js}"。不指定时搜索所有文本文件',
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
    const include = input.include as string | undefined;
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

    // 构建搜索正则
    let regex: RegExp;
    try {
      // 如果 pattern 看起来像正则（以 / 开头结尾），尝试解析
      if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
        const lastSlash = pattern.lastIndexOf('/');
        const body = pattern.slice(1, lastSlash);
        const flags = pattern.slice(lastSlash + 1);
        regex = new RegExp(body, flags);
      } else {
        // 普通文本搜索，转义特殊字符
        regex = new RegExp(escapeRegExp(pattern), 'gi');
      }
    } catch {
      // 正则解析失败，按纯文本搜索
      regex = new RegExp(escapeRegExp(pattern), 'gi');
    }

    const results: string[] = [];
    let filesScanned = 0;
    const prefix = join(absPath, '');

    try {
      walkAndSearch(absPath, prefix, regex, include, results, { count: 0 });
    } catch (err) {
      return fail(`搜索失败: ${(err as Error).message}`);
    }

    if (results.length === 0) {
      return ok(`未找到匹配 "${pattern}" 的内容`, { count: 0 });
    }

    const output = results.join('\n');
    return ok(truncateOutput(output, 20_000), {
      count: results.length,
      truncated: output.length > 20_000,
    });
  }
}

/** 递归遍历并搜索 */
function walkAndSearch(
  dir: string,
  prefix: string,
  regex: RegExp,
  include: string | undefined,
  results: string[],
  counter: { count: number },
) {
  if (counter.count >= MAX_GREP_FILES) return;

  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (counter.count >= MAX_GREP_FILES) return;

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
      walkAndSearch(fullPath, prefix, regex, include, results, counter);
      continue;
    }

    if (!stat.isFile()) continue;

    // 文件名过滤
    if (include && !simpleGlobMatch(entry, include)) continue;
    // 如果没有指定 include，只搜索文本文件
    if (!include && !isTextFile(entry)) continue;

    counter.count++;

    let content: string;
    try {
      content = readFileSync(fullPath, 'utf-8');
    } catch {
      continue; // 读取失败 → 跳过
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      // 重置 lastIndex（带 g 标志的 RegExp 需要）
      regex.lastIndex = 0;
      if (regex.test(lines[i])) {
        results.push(
          `${relativePath}:${i + 1}: ${lines[i].trim().slice(0, 200)}`,
        );
        // 每个文件最多 10 个匹配行
        if (results.filter((r) => r.startsWith(relativePath + ':')).length >= 10) {
          break;
        }
      }
    }
  }
}

/** 判断文件是否为文本类型 */
function isTextFile(name: string): boolean {
  // 无扩展名的文件也可能（如 Dockerfile、Makefile）
  if (TEXT_EXTENSIONS.has(name)) return true;
  const dot = name.lastIndexOf('.');
  if (dot === -1) {
    // 检查常见无扩展名文件
    const basename = name.toLowerCase();
    return ['dockerfile', 'makefile', 'license', 'changelog', 'readme'].includes(basename);
  }
  return TEXT_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

/** 简单 glob 匹配文件名（支持 * 和 ?） */
function simpleGlobMatch(name: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp('^' + regexStr + '$', 'i').test(name);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
