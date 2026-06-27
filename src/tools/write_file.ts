/**
 * write_file — 写/覆盖文件工具
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Tool, ToolExecuteContext, ToolResult } from './types.js';
import { resolvePath, ok, fail } from './helpers.js';

export class WriteFileTool implements Tool {
  readonly name = 'write_file';
  readonly category = 'mutation' as const;
  readonly description =
    '创建新文件或覆盖已有文件。**如果是覆盖已有文件，先 read_file 确认内容**。会递归创建不存在的父目录。';
  readonly parameters = {
    type: 'object' as const,
    properties: {
      file_path: {
        type: 'string',
        description: '要写入的文件路径（相对于项目根目录）',
      },
      content: {
        type: 'string',
        description: '要写入的完整文件内容',
      },
    },
    required: ['file_path', 'content'],
  };

  async execute(
    input: Record<string, unknown>,
    context: ToolExecuteContext,
  ): Promise<ToolResult> {
    const rawPath = input.file_path;
    const content = input.content;

    if (typeof rawPath !== 'string' || !rawPath.trim()) {
      return fail('参数 file_path 不能为空');
    }
    if (typeof content !== 'string') {
      return fail('参数 content 必须是字符串');
    }

    // 安全解析路径
    let absPath: string;
    try {
      absPath = resolvePath(rawPath, context.cwd);
    } catch (err) {
      return fail((err as Error).message);
    }

    // 确保父目录存在
    const dir = dirname(absPath);
    try {
      mkdirSync(dir, { recursive: true });
    } catch (err) {
      return fail(`创建目录失败: ${(err as Error).message}`);
    }

    const existed = existsSync(absPath);

    try {
      writeFileSync(absPath, content, 'utf-8');
    } catch (err) {
      return fail(`写入文件失败: ${(err as Error).message}`);
    }

    const action = existed ? '覆盖' : '创建';
    return ok(`${action}文件成功: ${rawPath} (${content.length} 字符)`, {
      file_path: rawPath,
      existed,
      size: content.length,
    });
  }
}
