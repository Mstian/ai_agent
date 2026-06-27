/**
 * HookExecutor — 动作执行器
 * 支持 command/prompt/http/agent 四种动作类型
 */

import { exec } from 'node:child_process';
import type { HookAction, HookContext } from './types.js';

export class HookExecutor {
  /**
   * 执行 Hook 动作
   * @returns promptText（prompt 类型时返回注入文本）
   */
  async execute(
    action: HookAction,
    ctx: HookContext,
  ): Promise<{ promptText?: string; exitCode?: number }> {
    switch (action.type) {
      case 'command':
        return this.executeCommand(action, ctx);
      case 'prompt':
        return this.executePrompt(action, ctx);
      case 'http':
        return this.executeHttp(action, ctx);
      case 'agent':
        return this.executeAgent(action, ctx);
      default:
        return {};
    }
  }

  /** 执行 Shell 命令 */
  private executeCommand(
    action: HookAction & { type: 'command' },
    ctx: HookContext,
  ): Promise<{ exitCode?: number }> {
    const command = this.expandVars(action.command, ctx);
    const timeout = action.timeout ?? 10_000;

    return new Promise((resolve) => {
      const child = exec(command, { timeout }, (error, stdout, stderr) => {
        if (error) {
          process.stderr.write(
            `[Hook] 命令执行失败 (exit=${error.code}): ${command}\n${stderr}`,
          );
          resolve({ exitCode: error.code ?? 1 });
        } else {
          if (stdout.trim()) {
            process.stderr.write(`[Hook] 命令输出: ${stdout.trim()}\n`);
          }
          resolve({ exitCode: 0 });
        }
      });

      // 超时处理
      child.on('error', () => {
        resolve({ exitCode: -1 });
      });
    });
  }

  /** 注入提示词 */
  private executePrompt(
    action: HookAction & { type: 'prompt' },
    ctx: HookContext,
  ): { promptText: string } {
    const text = this.expandVars(action.text, ctx);
    return { promptText: text };
  }

  /** 发起 HTTP 请求 */
  private async executeHttp(
    action: HookAction & { type: 'http' },
    ctx: HookContext,
  ): Promise<{ exitCode?: number }> {
    const url = this.expandVars(action.url, ctx);
    const method = action.method ?? 'POST';
    const body = action.body ? this.expandVars(action.body, ctx) : undefined;

    try {
      const response = await fetch(url, {
        method,
        headers: action.headers ?? {},
        body,
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        process.stderr.write(
          `[Hook] HTTP 请求失败 (${response.status}): ${url}\n`,
        );
        return { exitCode: response.status };
      }

      return { exitCode: 0 };
    } catch (err) {
      process.stderr.write(
        `[Hook] HTTP 请求异常: ${url} — ${(err as Error).message}\n`,
      );
      return { exitCode: -1 };
    }
  }

  /** 子 Agent（占位） */
  private executeAgent(
    action: HookAction & { type: 'agent' },
    _ctx: HookContext,
  ): { promptText: string } {
    process.stderr.write(
      `[Hook] 子 Agent 动作尚未实现（prompt: ${action.prompt.slice(0, 100)}...）\n`,
    );
    return { promptText: '' };
  }

  /** 模板变量替换 */
  expandVars(text: string, ctx: HookContext): string {
    const vars: Record<string, string> = {
      event: ctx.event,
      tool_name: ctx.toolName ?? '',
      tool_input: ctx.toolInput ? JSON.stringify(ctx.toolInput) : '',
      tool_result: ctx.toolResult ?? '',
      turn_number: String(ctx.turnNumber ?? 0),
      cwd: ctx.cwd,
      session_id: ctx.sessionId ?? '',
    };

    let result = text;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replaceAll(`{{${key}}}`, value);
    }
    return result;
  }
}
