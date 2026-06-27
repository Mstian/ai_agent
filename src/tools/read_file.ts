/**
 * read_file — 读文件工具
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Tool, ToolExecuteContext, ToolResult } from './types.js';
import { resolvePath, isBinary, MAX_READ_SIZE, ok, fail } from './helpers.js';

export class ReadFileTool implements Tool {
  readonly name = 'read_file';
  readonly category = 'readonly' as const;
  readonly description =
    '读取指定文件的文本内容。用于查看代码、配置文件、文档等。**编辑文件前务必先用此工具查看文件当前内容**。';
  readonly parameters = {
    type: 'object' as const,
    properties: {
      file_path: {
        type: 'string',
        description: '要读取的文件路径（相对于项目根目录）',
      },
    },
    required: ['file_path'],
  };

  async execute(
    input: Record<string, unknown>,
    context: ToolExecuteContext,
  ): Promise<ToolResult> {
    const rawPath = input.file_path;
    if (typeof rawPath !== 'string' || !rawPath.trim()) {
      return fail('参数 file_path 不能为空');
    }

    // 安全解析路径
    let absPath: string;
    try {
      absPath = resolvePath(rawPath, context.cwd);
    } catch (err) {
      return fail((err as Error).message);
    }

    if (!existsSync(absPath)) {
      return fail(`文件不存在: ${rawPath}`);
    }

    const stat = statSync(absPath);
    if (stat.isDirectory()) {
      return fail(`"${rawPath}" 是目录，不是文件。请使用 glob 工具浏览目录。`);
    }

    if (stat.size > MAX_READ_SIZE) {
      return fail(
        `文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，超过 ${MAX_READ_SIZE / 1024 / 1024}MB 限制`,
      );
    }

    let buffer: Buffer;
    try {
      buffer = readFileSync(absPath);
    } catch (err) {
      return fail(`读取文件失败: ${(err as Error).message}`);
    }

    if (isBinary(buffer)) {
      return fail(
        `"${rawPath}" 看起来是二进制文件（检测到 null byte），无法以文本形式读取`,
      );
    }

    const content = buffer.toString('utf-8');
    return ok(content, {
      file_path: rawPath,
      size: stat.size,
      lines: content.split('\n').length,
    });
  }
}
