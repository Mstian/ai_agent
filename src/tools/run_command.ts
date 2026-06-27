/**
 * run_command — 执行 shell 命令工具
 *
 * 安全措施：
 * - 黑名单拦截危险命令（rm -rf /, fork bomb, dd 等）
 * - 超时机制（默认 30s）
 * - 输出截断（最大 20000 字符）
 */

import { execSync } from 'node:child_process';
import type { Tool, ToolExecuteContext, ToolResult } from './types.js';
import {
  checkDangerousCommand,
  truncateOutput,
  DEFAULT_TOOL_TIMEOUT,
  ok,
  fail,
} from './helpers.js';

export class RunCommandTool implements Tool {
  readonly name = 'run_command';
  readonly category = 'mutation' as const;
  readonly description =
    '执行 shell 命令并返回输出。**优先使用 glob/grep/read_file 等专用工具**，仅在没有专用工具或需要构建/测试时使用此命令。';
  readonly parameters = {
    type: 'object' as const,
    properties: {
      command: {
        type: 'string',
        description: '要执行的 shell 命令',
      },
      timeout: {
        type: 'number',
        description: '超时时间（毫秒），默认 30000。对长时间命令可设置更大值',
        default: DEFAULT_TOOL_TIMEOUT,
      },
    },
    required: ['command'],
  };

  async execute(
    input: Record<string, unknown>,
    context: ToolExecuteContext,
  ): Promise<ToolResult> {
    const command = input.command;
    const timeout = (input.timeout as number) ?? context.timeout ?? DEFAULT_TOOL_TIMEOUT;

    if (typeof command !== 'string' || !command.trim()) {
      return fail('参数 command 不能为空');
    }

    // 安全检查
    const dangerous = checkDangerousCommand(command);
    if (dangerous) {
      return fail(dangerous);
    }

    try {
      const output = execSync(command, {
        cwd: context.cwd,
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        encoding: 'utf-8',
        // 合并 stderr 到 stdout
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const stdout = output.toString();
      const truncated = truncateOutput(stdout);

      return ok(truncated, {
        exit_code: 0,
        truncated: truncated.length !== stdout.length,
      });
    } catch (err) {
      const e = err as Error & {
        stdout?: Buffer | string;
        stderr?: Buffer | string;
        status?: number;
        code?: string;
      };

      // 收集已有的输出
      const partial = [e.stdout, e.stderr]
        .filter(Boolean)
        .map((s) => (typeof s === 'string' ? s : s?.toString() ?? ''))
        .join('\n');

      if (e.code === 'ETIMEDOUT' || e.message?.includes('timeout')) {
        return fail(
          `命令执行超时（${timeout}ms）: ${command}\n${partial ? '部分输出:\n' + truncateOutput(partial) : ''}`,
          { exit_code: null, timed_out: true },
        );
      }

      return fail(
        `命令执行失败 (exit code: ${(e as any).status ?? 'unknown'}): ${e.message}\n${partial ? truncateOutput(partial) : ''}`,
        { exit_code: (e as any).status ?? null },
      );
    }
  }
}
