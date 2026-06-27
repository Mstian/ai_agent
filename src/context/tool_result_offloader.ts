/**
 * ToolResultOffloader — 第一层：大工具结果存盘
 * 单条 > 3000 字符存盘，同组合计 > 8000 字符挑大存
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Message, ContentBlock } from '../provider/types.js';

const SINGLE_THRESHOLD = 3000;
const GROUP_THRESHOLD = 8000;
const OFFLOAD_DIR = '.mewcode/tool_results';

export class ToolResultOffloader {
  private offloadDir: string;

  constructor(projectRoot: string) {
    this.offloadDir = join(projectRoot, OFFLOAD_DIR);
  }

  /** 检查并处理所有消息中的大工具结果，返回存盘数量 */
  offload(messages: Message[]): number {
    let count = 0;
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== 'tool') continue;
      if (typeof msg.content === 'string') continue;

      const blocks = msg.content as ContentBlock[];
      // 单条检查
      for (const block of blocks) {
        if (block.type !== 'tool_result') continue;
        const text = block.text ?? '';
        if (text.length > SINGLE_THRESHOLD) {
          this.offloadBlock(block, text);
          count++;
        }
      }
    }

    // 同组合计检查：遍历 assistant 消息，其后的 tool_result 合计
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== 'assistant') continue;
      if (typeof msg.content === 'string') continue;

      const blocks = msg.content as ContentBlock[];
      const hasToolUse = blocks.some((b) => b.type === 'tool_use');
      if (!hasToolUse) continue;

      // 收集后续 tool 消息中的 tool_result
      const toolResults: { block: ContentBlock; msgIndex: number }[] = [];
      for (let j = i + 1; j < messages.length; j++) {
        const tm = messages[j];
        if (tm.role !== 'tool') break; // 下一轮开始了
        if (typeof tm.content === 'string') continue;
        for (const b of tm.content as ContentBlock[]) {
          if (b.type === 'tool_result') {
            toolResults.push({ block: b, msgIndex: j });
          }
        }
      }

      const totalChars = toolResults.reduce((sum, tr) => sum + (tr.block.text ?? '').length, 0);
      if (totalChars <= GROUP_THRESHOLD) continue;

      // 按大小排序，挑大的存盘
      toolResults.sort((a, b) => (b.block.text ?? '').length - (a.block.text ?? '').length);
      let remaining = totalChars;
      for (const tr of toolResults) {
        if (remaining <= GROUP_THRESHOLD) break;
        const text = tr.block.text ?? '';
        this.offloadBlock(tr.block, text);
        count++;
        remaining -= text.length;
      }
    }

    return count;
  }

  private offloadBlock(block: ContentBlock, text: string): void {
    if (!existsSync(this.offloadDir)) {
      mkdirSync(this.offloadDir, { recursive: true });
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const toolId = (block.tool_use_id ?? 'unknown').slice(0, 20);
    const filename = `${ts}_${toolId}.txt`;
    const filePath = join(this.offloadDir, filename);

    writeFileSync(filePath, text, 'utf-8');

    const preview = text.slice(0, 200);
    block.text = `[工具结果已存盘: ${OFFLOAD_DIR}/${filename}]\n预览: ${preview}...\n完整内容请用 read_file 读取`;
  }
}
