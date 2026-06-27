/**
 * AgentTool — agent 系统工具
 *
 * 主 Agent 通过此工具委派子任务给独立子 Agent。
 * type='defined' → 加载预定义角色 + 空白上下文
 * type='fork' → 继承父对话历史 + 缓存命中
 */

import type { Tool, ToolExecuteContext, ToolResult, ToolDefinition } from '../tools/types.js';
import { ToolRegistry } from '../tools/registry.js';
import type { Provider, Message } from '../provider/types.js';
import type { AgentToolInput } from './types.js';
import { RoleLoader } from './role_loader.js';
import { SubAgentRunner } from './runner.js';
import { TaskManager } from './task_manager.js';

/** 工具过滤：永远禁止传给子 Agent 的工具 */
const GLOBAL_BLOCKED = ['agent'];

/** 后台任务只允许只读工具 */
const BACKGROUND_READONLY_PATTERNS = [
  'read_file', 'glob', 'grep',
  'list_', 'search_', 'get_', 'find_',
];

export class AgentTool implements Tool {
  name = 'agent';
  description =
    '委派子任务给独立的子 Agent。' +
    'type="defined" 使用预定义角色（如 code-reviewer），type="fork" 继承当前对话。' +
    '子 Agent 有独立上下文和受限工具，完成后返回结果摘要。';
  category: 'readonly' | 'mutation' = 'mutation';
  parameters = {
    type: 'object' as const,
    properties: {
      type: {
        type: 'string',
        enum: ['defined', 'fork'],
        description: 'defined=使用预定义角色, fork=继承当前对话',
      },
      name: {
        type: 'string',
        description: '角色名称（type=defined 时必填），如 code-reviewer',
      },
      prompt: {
        type: 'string',
        description: '子 Agent 的任务描述',
      },
      background: {
        type: 'boolean',
        description: '是否后台执行（type=fork 时强制后台）',
      },
    },
    required: ['type', 'prompt'],
  };

  private roleLoader: RoleLoader;
  private runner: SubAgentRunner;
  private taskManager: TaskManager;
  private getParentMessages: () => Message[];
  private getMainToolRegistry: () => ToolRegistry;

  constructor(
    roleLoader: RoleLoader,
    runner: SubAgentRunner,
    taskManager: TaskManager,
    getParentMessages: () => Message[],
    getMainToolRegistry: () => ToolRegistry,
  ) {
    this.roleLoader = roleLoader;
    this.runner = runner;
    this.taskManager = taskManager;
    this.getParentMessages = getParentMessages;
    this.getMainToolRegistry = getMainToolRegistry;
  }

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecuteContext,
  ): Promise<ToolResult> {
    const { type, name, prompt, background } = input as unknown as AgentToolInput;

    if (!prompt) {
      return { success: false, output: '缺少必填参数: prompt', meta: { tool: 'agent' } };
    }

    if (type === 'defined' && !name) {
      return { success: false, output: 'type=defined 时缺少必填参数: name', meta: { tool: 'agent' } };
    }

    try {
      let messages: Message[];
      let parentTools: ToolDefinition[];

      if (type === 'defined') {
        // 加载角色
        this.roleLoader.reload();
        const role = this.roleLoader.load(name!);
        if (!role) {
          const available = this.roleLoader.listAll().map((r) => r.name).join(', ');
          return {
            success: false,
            output: `角色 "${name}" 不存在。可用角色: ${available || '(无)'}`,
            meta: { tool: 'agent' },
          };
        }

        // 空白上下文 + 角色系统提示
        messages = [
          { role: 'system' as const, content: role.body },
          { role: 'user' as const, content: prompt },
        ];

        // 子 Agent 工具：构造过滤后的 ToolRegistry
        const subToolRegistry = this.buildFilteredRegistry(role.tools, role.blocked_tools);
        const filteredToolDefs = subToolRegistry.getAll().map((t) => ({
          name: t.name, description: t.description, input_schema: t.parameters,
        }));

        // 默认同步执行，直接拿到结果；显式传 background:true 才后台
        const isBackground = background === true;
        const maxIters = role.max_iterations;

        if (isBackground) {
          const taskId = await this.runBackground(messages, filteredToolDefs, subToolRegistry, {
            maxIterations: maxIters, roleName: role.name, prompt,
          });
          return {
            success: true,
            output: `子 Agent "${role.name}" 已在后台启动 (taskId: ${taskId})`,
            meta: { tool: 'agent', taskId, background: true },
          };
        }

        process.stderr.write(`[agent] 启动子 Agent "${role.name}", 最多 ${maxIters} 轮...\n`);
        const result = await this.runner.run(messages, filteredToolDefs, subToolRegistry, {
          maxIterations: maxIters,
        });
        result.roleName = role.name;
        process.stderr.write(`[agent] 子 Agent "${role.name}" 完成 (${result.turns}轮, ${result.durationMs}ms)\n`);

        return {
          success: true,
          output: this.formatResult(result),
          meta: { tool: 'agent', ...result },
        };
      } else {
        // Fork 式：继承父对话 + 强制后台
        const parentMsgs = this.getParentMessages();
        messages = [...parentMsgs, { role: 'user' as const, content: prompt }];

        const subToolRegistryFork = this.buildFilteredRegistry(undefined, undefined);
        const filteredToolDefsFork = subToolRegistryFork.getAll().map((t) => ({
          name: t.name, description: t.description, input_schema: t.parameters,
        }));

        const taskId = await this.runBackground(messages, filteredToolDefsFork, subToolRegistryFork, {
          maxIterations: 15, roleName: 'fork', prompt,
        });

        return {
          success: true,
          output: `Fork 子 Agent 已在后台启动 (taskId: ${taskId})，继承 ${parentMsgs.length} 条父对话消息。`,
          meta: { tool: 'agent', taskId, background: true, fork: true },
        };
      }
    } catch (err) {
      return {
        success: false,
        output: `子 Agent 执行失败: ${(err as Error).message}`,
        meta: { tool: 'agent' },
      };
    }
  }

  /** 构造过滤后的 ToolRegistry */
  private buildFilteredRegistry(
    allowlist?: string[],
    blocklist?: string[],
  ): ToolRegistry {
    const mainRegistry = this.getMainToolRegistry();
    const subRegistry = new ToolRegistry();

    for (const tool of mainRegistry.getAll()) {
      if (GLOBAL_BLOCKED.includes(tool.name)) continue;
      if (allowlist && !allowlist.map((n) => n.toLowerCase()).includes(tool.name.toLowerCase())) continue;
      if (blocklist && blocklist.map((n) => n.toLowerCase()).includes(tool.name.toLowerCase())) continue;
      subRegistry.register(tool);
    }

    return subRegistry;
  }

  /** 后台执行 */
  private async runBackground(
    messages: Message[],
    tools: ToolDefinition[],
    toolRegistry: ToolRegistry,
    opts: { maxIterations: number; roleName?: string; prompt: string },
  ): Promise<string> {
    const taskId = Math.random().toString(36).slice(2, 10);

    this.taskManager.register({
      id: taskId,
      status: 'pending',
      roleName: opts.roleName,
      prompt: opts.prompt,
      startedAt: new Date(),
    });

    // 异步执行
    setImmediate(async () => {
      this.taskManager.markRunning(taskId);
      try {
        const result = await this.runner.run(messages, tools, toolRegistry, {
          maxIterations: opts.maxIterations,
        });
        result.roleName = opts.roleName;
        result.taskId = taskId;
        this.taskManager.markDone(taskId, result);
      } catch (err) {
        this.taskManager.markError(taskId, (err as Error).message);
      }
    });

    return taskId;
  }

  /** 格式化结果 */
  private formatResult(result: import('./types.js').SubAgentResult): string {
    return [
      `[子Agent${result.roleName ? ` ${result.roleName}` : ''} 完成] (${result.turns} 轮, ~${(result.tokenUsage.input + result.tokenUsage.output).toLocaleString()} tokens, ${result.durationMs}ms)`,
      `停止原因: ${result.stopReason}`,
      '',
      result.finalText || '(无输出)',
    ].join('\n');
  }
}
