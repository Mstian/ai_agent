/**
 * ToolExecutor — 按安全性分批执行工具
 *
 * - readonly 工具（read_file、glob、grep）：无副作用，Promise.all 并发
 * - mutation 工具（write_file、edit_file、run_command）：有副作用，串行执行
 */

import type { ContentBlock, ToolUseEvent, ToolResultEvent, ToolExecutingEvent } from '../provider/types.js';
import type { ToolExecuteContext, ToolResult } from '../tools/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { PermissionManager } from '../permission/manager.js';
import type { ConfirmCallback } from '../permission/types.js';
import { DEFAULT_TOOL_TIMEOUT } from '../tools/helpers.js';

type ExecEvent = ToolExecutingEvent | ToolResultEvent;

export class ToolExecutor {
  private registry: ToolRegistry;
  private permissionManager: PermissionManager | null = null;

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  setPermissionManager(pm: PermissionManager): void {
    this.permissionManager = pm;
  }

  /**
   * 执行一批 tool_use block，按安全性分批：
   * 1. readonly 组 → 并发执行
   * 2. mutation 组 → 串行执行
   *
   * yield tool_executing + tool_result 事件。
   * 返回按原始 toolUseBlocks 顺序排列的 tool_result ContentBlock[]。
   */
  async *executeBatch(
    toolUseBlocks: ContentBlock[],
    context: ToolExecuteContext,
    onConfirm?: ConfirmCallback,
  ): AsyncGenerator<ExecEvent> {
    // 权限预检
    const allowed: { block: ContentBlock; index: number }[] = [];
    for (let i = 0; i < toolUseBlocks.length; i++) {
      const block = toolUseBlocks[i];
      if (this.permissionManager) {
        const result = await this.permissionManager.check(
          block.tool_name ?? '',
          block.tool_input ?? {},
          onConfirm,
        );
        if (!result.allowed) {
          yield {
            type: 'tool_result',
            tool_use_id: block.tool_use_id ?? '',
            tool_name: block.tool_name ?? '',
            success: false,
            output: `权限拒绝: ${result.reason ?? '未知原因'}`,
          };
          continue;
        }
      }
      allowed.push({ block, index: i });
    }

    if (allowed.length === 0) return;

    // 按原始索引记录，保证结果顺序
    const indexed = allowed;

    const readonly = indexed.filter(({ block }) => {
      const tool = this.registry.get(block.tool_name ?? '');
      return tool?.category === 'readonly';
    });

    const mutation = indexed.filter(({ block }) => {
      const tool = this.registry.get(block.tool_name ?? '');
      return tool?.category === 'mutation' || !tool; // 未知工具当 mutation 串行
    });

    // 结果数组，按原顺序填入
    const results: (ContentBlock | null)[] = new Array(toolUseBlocks.length).fill(null);

    // Phase 1: readonly 工具并发执行
    if (readonly.length > 0) {
      const promises = readonly.map(async ({ block, index }) => {
        const resultBlock = await this.executeOne(block, context, true);
        results[index] = resultBlock;
        return resultBlock;
      });

      const settled = await Promise.allSettled(promises);
      // 如果某个工具抛异常，results 中对应位置保持 null，后续填充错误
      for (let i = 0; i < settled.length; i++) {
        const s = settled[i];
        if (s.status === 'rejected') {
          const { index } = readonly[i];
          results[index] = {
            type: 'tool_result',
            tool_use_id: toolUseBlocks[index].tool_use_id ?? '',
            text: `工具执行异常: ${(s.reason as Error)?.message ?? String(s.reason)}`,
          };
        }
      }
    }

    // Phase 2: mutation 工具串行执行
    for (const { block, index } of mutation) {
      const resultBlock = await this.executeOne(block, context, false);
      results[index] = resultBlock;
    }

    yield* this.collectResults(results.filter(Boolean) as ContentBlock[]);
  }

  /** 执行单个工具 */
  private async executeOne(
    block: ContentBlock,
    context: ToolExecuteContext,
    _concurrent: boolean,
  ): Promise<ContentBlock> {
    const tool = this.registry.get(block.tool_name ?? '');

    if (!tool) {
      const errorText = `未知工具 "${block.tool_name}"`;
      return {
        type: 'tool_result',
        tool_use_id: block.tool_use_id ?? '',
        text: errorText,
      };
    }

    let result: ToolResult;
    try {
      result = await tool.execute(block.tool_input ?? {}, context);
    } catch (err) {
      result = {
        success: false,
        output: '',
        error: `工具执行异常: ${(err as Error).message}`,
      };
    }

    const resultText = result.success
      ? result.output
      : `错误: ${result.error ?? result.output}`;

    return {
      type: 'tool_result',
      tool_use_id: block.tool_use_id ?? '',
      text: resultText,
    };
  }

  /** 将结果转为事件流 */
  private async *collectResults(
    results: ContentBlock[],
  ): AsyncGenerator<ExecEvent> {
    for (const r of results) {
      yield {
        type: 'tool_result',
        tool_use_id: r.tool_use_id ?? '',
        tool_name: '', // tool_result 事件层面不需要 tool_name
        success: !r.text?.startsWith('错误:') && !r.text?.startsWith('未知工具'),
        output: r.text ?? '',
      };
    }
  }
}
