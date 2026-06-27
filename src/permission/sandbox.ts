/**
 * SandboxChecker — 第二层：路径沙箱
 * 限制文件操作只能落在项目目录内，解析符号链接防逃逸
 */

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PermissionResult } from './types.js';

const FILE_TOOLS = new Set([
  'read_file',
  'write_file',
  'edit_file',
  'glob',
  'grep',
]);

export class SandboxChecker {
  private projectRoot: string;

  constructor(projectRoot: string) {
    // 规范化项目根目录（去掉尾部斜杠）
    this.projectRoot = realpathSync(projectRoot).replace(/\/+$/, '');
  }

  /** 对文件工具生效 */
  check(toolName: string, params: Record<string, unknown>): PermissionResult | null {
    if (!FILE_TOOLS.has(toolName)) return null;

    const path = (params.file_path ?? params.path ?? '') as string;
    if (!path) return null;

    const normalized = this.projectRoot;

    try {
      // 用 realpath 解析符号链接
      const resolved = realpathSync(path);
      const prefix = normalized + (normalized.endsWith('/') ? '' : '/');

      if (!resolved.startsWith(prefix) && resolved !== normalized) {
        return {
          allowed: false,
          reason: `路径超出项目范围: "${path}" → "${resolved}"（不在 ${normalized} 下）`,
          deniedBy: 'sandbox',
        };
      }
    } catch {
      // 文件不存在等情况，允许通过（后续工具执行会处理文件不存在的错误）
      // 但检查相对路径是否可能逃逸
      if (path.includes('..')) {
        // 尝试解析父目录
        try {
          const abs = resolve(this.projectRoot, path);
          const real = realpathSync(abs);
          const prefix = normalized + (normalized.endsWith('/') ? '' : '/');
          if (!real.startsWith(prefix) && real !== normalized) {
            return {
              allowed: false,
              reason: `路径超出项目范围: "${path}" → "${real}"`,
              deniedBy: 'sandbox',
            };
          }
        } catch {
          // 无法解析，按逃逸处理
          if (path.startsWith('/') || path.includes('..')) {
            return {
              allowed: false,
              reason: `路径疑似逃逸: "${path}"（无法解析实际路径）`,
              deniedBy: 'sandbox',
            };
          }
        }
      }
    }

    return null;
  }
}
