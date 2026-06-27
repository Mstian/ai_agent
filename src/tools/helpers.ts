/**
 * 工具共享辅助函数：超时封装、路径规范化、安全校验
 */

import { resolve, normalize, relative, isAbsolute } from 'node:path';
import type { ToolResult } from './types.js';

/** 默认工具超时时间（毫秒） */
export const DEFAULT_TOOL_TIMEOUT = 30_000;

/** 读文件最大字节数（1MB） */
export const MAX_READ_SIZE = 1_048_576;

/** 命令输出最大字符数 */
export const MAX_COMMAND_OUTPUT = 20_000;

/** grep 扫描的最大文件数 */
export const MAX_GREP_FILES = 200;

/** 带超时的 Promise 包装 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) {
    throw new Error('操作已取消');
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`操作超时（${timeoutMs}ms）`));
    }, timeoutMs);
  });

  if (signal) {
    const abortPromise = new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => {
        reject(new Error('操作已取消'));
      }, { once: true });
    });
    try {
      return await Promise.race([promise, timeoutPromise, abortPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 同步超时包装（用于同步函数如 execSync） */
export function runWithTimeout<T>(
  fn: () => T,
  timeoutMs: number,
): T {
  const start = Date.now();
  const result = fn();
  const elapsed = Date.now() - start;
  if (elapsed > timeoutMs) {
    throw new Error(`操作超时（${timeoutMs}ms），实际耗时 ${elapsed}ms`);
  }
  return result;
}

/**
 * 规范化路径并检查是否在项目目录范围内
 * 返回解析后的绝对路径，如果路径逃逸则抛出错误
 */
export function resolvePath(inputPath: string, cwd: string): string {
  const resolved = resolve(cwd, inputPath);
  const normalized = normalize(resolved);

  // 检查是否在 cwd 范围内
  const rel = relative(cwd, normalized);
  if (rel.startsWith('..') || (isAbsolute(rel) && rel !== '')) {
    throw new Error(
      `路径逃逸拒绝: "${inputPath}" 超出项目目录范围`,
    );
  }

  return normalized;
}

/** 检测文件内容是否为二进制（检查前 8KB 是否含 null byte） */
export function isBinary(buffer: Buffer): boolean {
  // 检查前 8192 字节内是否有 null byte
  const limit = Math.min(buffer.length, 8192);
  for (let i = 0; i < limit; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/** 构造成功 ToolResult */
export function ok(output: string, meta?: Record<string, unknown>): ToolResult {
  return { success: true, output, meta };
}

/** 构造失败 ToolResult */
export function fail(error: string, meta?: Record<string, unknown>): ToolResult {
  return { success: false, output: '', error, meta };
}

/**
 * 危险命令黑名单（正则匹配）
 * 匹配则拒绝执行。完整的权限五层检查请使用 PermissionManager。
 */
const DANGEROUS_PATTERNS: RegExp[] = [
  /rm\s+-rf\s+\//,
  /rm\s+--no-preserve-root/,
  /mkfs\./,
  /dd\s+if=.*of=\/dev\//,
  />\/dev\/sd[a-z]/,
  /chmod\s+-R\s+0+\s+\//,
  /wget\s+.*\|/,
  /curl\s+.*\|/,
  /:\(\)\s*\{.*\};\s*:/,
  />\/etc\//,
];

export function checkDangerousCommand(command: string): string | null {
  const trimmed = command.trim();
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      return `命令被安全检查拒绝: 匹配危险模式 "${pattern.source}"`;
    }
  }
  return null;
}

/** 截断过长的输出 */
export function truncateOutput(output: string, maxLen: number = MAX_COMMAND_OUTPUT): string {
  if (output.length <= maxLen) return output;
  const half = Math.floor(maxLen / 2);
  const head = output.slice(0, half);
  const tail = output.slice(-half);
  return `${head}\n... [截断 ${output.length - maxLen} 字符] ...\n${tail}`;
}
