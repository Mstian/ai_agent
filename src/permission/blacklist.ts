/**
 * BlacklistChecker — 第一层：硬编码黑名单正则匹配
 * 不可被配置关闭，不可被规则覆盖
 */

import type { PermissionResult } from './types.js';

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

export class BlacklistChecker {
  /** 检查所有工具 */
  check(toolName: string, params: Record<string, unknown>): PermissionResult | null {
    // 文件工具不允许通配符路径
    if (toolName === 'read_file' || toolName === 'write_file' || toolName === 'edit_file' ||
        toolName === 'ReadFile' || toolName === 'WriteFile' || toolName === 'EditFile') {
      const filePath = (params.file_path as string) ?? '';
      if (filePath && /[*?]/.test(filePath)) {
        return {
          allowed: false,
          reason: `不允许使用通配符路径: "${filePath}"。请先用 glob 找到具体文件，再逐个用 ${toolName} 读取`,
          deniedBy: 'blacklist',
        };
      }
    }

    if (toolName !== 'run_command') return null;

    const command = (params.command as string) ?? '';
    if (!command.trim()) return null;

    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command.trim())) {
        return {
          allowed: false,
          reason: `危险命令被拦截: 匹配模式 "${pattern.source}"`,
          deniedBy: 'blacklist',
        };
      }
    }

    return null;
  }
}
