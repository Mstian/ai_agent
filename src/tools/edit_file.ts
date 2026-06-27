/**
 * edit_file — 原文唯一匹配替换工具
 *
 * 核心规则：
 * - old_string 在文件中必须精确匹配 1 次（不多不少）
 * - 匹配 0 次 → 报错"未找到匹配内容"
 * - 匹配 ≥2 次 → 报错"匹配 N 处，请提供更多上下文"
 * - 匹配 1 次 → 执行替换
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { Tool, ToolExecuteContext, ToolResult } from './types.js';
import { resolvePath, ok, fail } from './helpers.js';

export class EditFileTool implements Tool {
  readonly name = 'edit_file';
  readonly category = 'mutation' as const;
  readonly description =
    '精确替换文件中的特定文本段落。**使用前必须先 read_file 查看文件当前内容**。old_string 必须在文件中出现恰好一次，否则报错。用于修改代码、修复 bug、添加功能等。';
  readonly parameters = {
    type: 'object' as const,
    properties: {
      file_path: {
        type: 'string',
        description: '要编辑的文件路径（相对于项目根目录）',
      },
      old_string: {
        type: 'string',
        description: '要被替换的原始文本。必须与文件中的内容完全一致（包括空格和缩进）',
      },
      new_string: {
        type: 'string',
        description: '替换后的新文本',
      },
    },
    required: ['file_path', 'old_string', 'new_string'],
  };

  async execute(
    input: Record<string, unknown>,
    context: ToolExecuteContext,
  ): Promise<ToolResult> {
    const rawPath = input.file_path;
    const oldStr = input.old_string;
    const newStr = input.new_string;

    if (typeof rawPath !== 'string' || !rawPath.trim()) {
      return fail('参数 file_path 不能为空');
    }
    if (typeof oldStr !== 'string' || oldStr.length === 0) {
      return fail('参数 old_string 不能为空');
    }
    if (typeof newStr !== 'string') {
      return fail('参数 new_string 必须是字符串');
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

    let original: string;
    try {
      original = readFileSync(absPath, 'utf-8');
    } catch (err) {
      return fail(`读取文件失败: ${(err as Error).message}`);
    }

    // 计算 old_string 出现次数
    const count = countOccurrences(original, oldStr);

    if (count === 0) {
      return fail(
        `未找到匹配内容。请核对 old_string 的精确原文（包括空格、缩进、换行），确保与文件内容完全一致。\n` +
        `提示：用 read_file 查看文件的精确内容。`,
      );
    }

    if (count > 1) {
      return fail(
        `匹配到 ${count} 处相同内容，无法确定要替换哪一处。\n` +
        `请提供更多上下文（包含周围代码行），使 old_string 在文件中唯一。`,
      );
    }

    // 唯一匹配，执行替换
    const modified = original.replace(oldStr, newStr);

    try {
      writeFileSync(absPath, modified, 'utf-8');
    } catch (err) {
      return fail(`写入文件失败: ${(err as Error).message}`);
    }

    return ok(`文件编辑成功: ${rawPath}`, {
      file_path: rawPath,
      replaced: true,
    });
  }
}

/** 计算字符串 sub 在 str 中出现的次数 */
function countOccurrences(str: string, sub: string): number {
  if (sub.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while (true) {
    pos = str.indexOf(sub, pos);
    if (pos === -1) break;
    count++;
    pos += sub.length;
  }
  return count;
}
