/**
 * SubAgentRunner — 子 Agent 执行器
 *
 * 轻量工具循环：调 LLM → 如果有 tool_calls → 执行工具 → 追加结果 → 继续
 */

import { randomBytes } from 'node:crypto';
import type { Provider, Message, ContentBlock, StreamEvent } from '../provider/types.js';
import type { ToolDefinition, ToolResult } from '../tools/types.js';
import type { SubAgentResult } from './types.js';
import { ToolRegistry } from '../tools/registry.js';
import { ToolExecutor } from '../agent/tool_executor.js';
import { StreamCollector } from '../agent/stream_collector.js';

export class SubAgentRunner {
  private provider: Provider;

  constructor(provider: Provider) {
    this.provider = provider;
  }

  async run(
    messages: Message[],
    tools: ToolDefinition[],
    toolRegistry: ToolRegistry,
    config: {
      maxIterations: number;
      signal?: AbortSignal;
      cwd?: string;
    },
  ): Promise<SubAgentResult> {
    const taskId = randomBytes(4).toString('hex');
    const startTime = Date.now();

    let turns = 0;
    let finalText = '';
    let stopReason = 'task_completed';
    const writtenFiles: string[] = [];
    const toolExecutor = new ToolExecutor(toolRegistry);

    while (turns < config.maxIterations) {
      if (config.signal?.aborted) {
        stopReason = 'user_cancelled';
        break;
      }
      turns++;
      process.stderr.write(`[sub:${taskId}] 第 ${turns}/${config.maxIterations} 轮...\n`);

      // 调用 LLM
      let stream: AsyncGenerator<StreamEvent>;
      try {
        stream = this.provider.streamChat(
          messages,
          config.signal,
          tools.length > 0 ? tools : undefined,
        );
      } catch (err) {
        stopReason = 'stream_error';
        finalText = (err as Error).message;
        break;
      }

      // 收集响应
      const collector = new StreamCollector();
      let hasError = false;

      try {
        for await (const event of collector.collect(stream)) {
          if (event.type === 'error') {
            finalText = event.message;
            stopReason = 'stream_error';
            hasError = true;
            break;
          }
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError' || config.signal?.aborted) {
          stopReason = 'user_cancelled';
        } else {
          stopReason = 'stream_error';
          finalText = (err as Error).message;
        }
        break;
      }

      if (hasError) break;

      const blocks = collector.getBlocks();
      messages.push({ role: 'assistant', content: blocks });

      // 累积每轮的文本输出（不只是最后一轮）
      for (const b of blocks) {
        if (b.type === 'text' && b.text) finalText += b.text;
      }

      // 无工具调用 → 任务完成
      if (!collector.hasToolUse()) {
        break;
      }

      // 执行工具
      const toolUseBlocks = blocks.filter((b) => b.type === 'tool_use');
      for (const block of toolUseBlocks) {
        if (!block.tool_name || !block.tool_input) continue;

        const tool = toolRegistry.get(block.tool_name);
        let result: ToolResult;

        if (!tool) {
          result = {
            success: false,
            output: `工具 "${block.tool_name}" 不在子 Agent 可用工具列表中`,
            meta: { tool_use_id: block.tool_use_id },
          };
        } else {
          try {
            result = await tool.execute(
              block.tool_input as Record<string, unknown>,
              {
                cwd: config.cwd ?? process.cwd(),
                timeout: 30000,
                signal: config.signal,
              },
            );
          } catch (err) {
            result = {
              success: false,
              output: (err as Error).message,
              meta: { tool_use_id: block.tool_use_id },
            };
          }
        }

        // 记录写入/编辑的文件
        if (result.success && (block.tool_name === 'write_file' || block.tool_name === 'edit_file')) {
          const fp = (block.tool_input as any)?.file_path;
          if (fp && !writtenFiles.includes(fp)) writtenFiles.push(fp);
        }

        messages.push({
          role: 'tool',
          content: [{
            type: 'tool_result' as const,
            tool_use_id: block.tool_use_id ?? '',
            text: result.success ? result.output : `错误: ${result.output}`,
          }],
        });
      }
    }

    if (turns >= config.maxIterations && !finalText) {
      stopReason = 'max_iterations';
    }

    process.stderr.write(`[sub:${taskId}] 完成 (${turns}轮, ${stopReason})\n`);
    const durationMs = Date.now() - startTime;

    let totalChars = 0;
    for (const m of messages) {
      totalChars += typeof m.content === 'string'
        ? m.content.length
        : (m.content as ContentBlock[]).reduce((s, b) => s + (b.text ?? b.thinking ?? '').length, 0);
    }

    // 追加写入的文件列表
    let outputText = finalText.trim();
    if (writtenFiles.length > 0) {
      outputText += '\n\n---\n写入的文件:\n';
      for (const f of writtenFiles) {
        outputText += `- ${f}\n`;
      }
    }

    return {
      taskId,
      finalText: outputText,
      turns,
      tokenUsage: {
        input: Math.ceil(totalChars * 0.5),
        output: Math.ceil(finalText.length * 0.5),
      },
      stopReason,
      durationMs,
    };
  }
}
