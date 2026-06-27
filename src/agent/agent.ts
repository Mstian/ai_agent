/**
 * Agent — ReAct 循环引擎
 */

import type { AgentEvent, AgentConfig } from './types.js';
import type { ContentBlock, StreamEvent } from '../provider/types.js';
import type { ToolExecuteContext } from '../tools/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { CacheInfo } from '../prompt/types.js';
import type { PermissionManager } from '../permission/manager.js';
import type { ConfirmCallback } from '../permission/types.js';
import { ContextManager } from '../context/context_manager.js';
import type { MemoryManager } from '../memory/memory_manager.js';
import type { SkillManager } from '../skills/skill_manager.js';
import type { HookManager } from '../hooks/hook_manager.js';
import { ChatManager } from '../chat/manager.js';
import { StreamCollector } from './stream_collector.js';
import { ToolExecutor } from './tool_executor.js';
import { PromptManager } from '../prompt/manager.js';
import { DEFAULT_TOOL_TIMEOUT } from '../tools/helpers.js';

export class Agent {
  private chatManager: ChatManager;
  private toolExecutor: ToolExecutor;
  private registry: ToolRegistry;
  private promptManager: PromptManager;
  private permissionManager: PermissionManager | null = null;
  private onConfirm: ConfirmCallback | undefined;
  private contextManager: ContextManager | null = null;
  private memoryManager: MemoryManager | null = null;
  private skillManager: SkillManager | null = null;
  private hookManager: HookManager | null = null;
  private sessionStarted = false;
  private config: AgentConfig;

  constructor(
    chatManager: ChatManager,
    toolExecutor: ToolExecutor,
    registry: ToolRegistry,
    promptManager: PromptManager,
    config?: Partial<AgentConfig>,
  ) {
    this.chatManager = chatManager;
    this.toolExecutor = toolExecutor;
    this.registry = registry;
    this.promptManager = promptManager;
    this.config = {
      maxIterations: 30,
      mode: 'full',
      ...config,
    };
  }

  setContextManager(cm: ContextManager): void {
    this.contextManager = cm;
  }

  setMemoryManager(mm: MemoryManager): void {
    this.memoryManager = mm;
  }

  setSkillManager(sm: SkillManager): void {
    this.skillManager = sm;
  }

  setHookManager(hm: HookManager): void {
    this.hookManager = hm;
  }

  /** 手动触发压缩 */
  async manualCompress(): Promise<boolean> {
    if (!this.contextManager) return false;
    const msgs = this.chatManager.getMessages();
    const result = await this.contextManager.autoCompress(
      msgs,
      (this.chatManager as any).provider,
      true,
    );
    return result.compressed;
  }

  setPermissionManager(pm: PermissionManager, onConfirm?: ConfirmCallback): void {
    this.permissionManager = pm;
    this.onConfirm = onConfirm;
    this.toolExecutor.setPermissionManager(pm);
  }

  setMode(mode: 'full' | 'plan'): void {
    this.config.mode = mode;
    this.promptManager.setMode(mode);
  }

  getMode(): 'full' | 'plan' {
    return this.config.mode;
  }

  getMessages() {
    return this.chatManager.getMessages();
  }

  clear(): void {
    this.chatManager.clear();
    // 清空已激活 Skill
    if (this.skillManager) {
      this.skillManager.clear();
    }
  }

  async *run(
    userInput: string,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    if (signal?.aborted) {
      yield { type: 'agent_done', totalTurns: 0, stopReason: 'user_cancelled' };
      return;
    }

    // 追加用户消息
    this.chatManager.addUserMessage(userInput);

    let totalTokens = { input: 0, output: 0 };
    let consecutiveUnknownTools = 0;
    let lastCacheInfo: CacheInfo | undefined;

    for (let turn = 1; turn <= this.config.maxIterations; turn++) {
      if (signal?.aborted) {
        yield {
          type: 'agent_done',
          totalTurns: turn - 1,
          stopReason: 'user_cancelled',
          cacheInfo: lastCacheInfo,
        };
        return;
      }

      yield { type: 'turn_start', turn };

      // Hook: session_start（首轮触发一次）
      if (this.hookManager && !this.sessionStarted) {
        this.sessionStarted = true;
        await this.hookManager.fire('session_start', {
          event: 'session_start',
          cwd: process.cwd(),
          sessionId: (this as any).chatManager?.getMessages?.() ? 'active' : undefined,
        });
      }

      // Hook: turn_start
      if (this.hookManager) {
        const turnResult = await this.hookManager.fire('turn_start', {
          event: 'turn_start',
          turnNumber: turn,
          cwd: process.cwd(),
        });
        // 注入 Hook 返回的 prompt
        for (const p of turnResult.promptInjections) {
          this.chatManager.injectSystemMessage(`[Hook] ${p}`);
        }
      }

      // 注入运行时 system 消息（模式提醒、环境信息等）
      this.injectTurnMessages(turn);

      // 上下文压缩（每轮 LLM 调用前自动执行）
      if (this.contextManager) {
        const msgs = this.chatManager.getMessages();
        const result = await this.contextManager.autoCompress(
          msgs,
          (this.chatManager as any).provider,
        );
        if (result.offloaded > 0) {
          process.stderr.write(`\n📦 ${result.offloaded} 个工具结果已存盘到 .mewcode/tool_results/\n`);
        }
        if (result.summarized) {
          process.stderr.write(`\n📝 对话历史已生成摘要以节省 token\n`);
        }
        if (result.compressed) {
          (this.chatManager as any).messages = result.messages;
        }
      }

      // 准备工具列表
      const toolDefs = this.getToolDefs();

      // 调用 LLM + 流式收集
      const collector = new StreamCollector();
      let turnCacheInfo: CacheInfo | undefined;
      try {
        const stream = this.chatManager.callLLM(
          toolDefs.length > 0 ? toolDefs : undefined,
          signal,
        );

        for await (const event of collector.collect(stream)) {
          if (event.type === 'error') {
            yield event;
            yield {
              type: 'agent_done',
              totalTurns: turn,
              stopReason: 'stream_error',
              cacheInfo: lastCacheInfo,
            };
            return;
          }
          if (event.type === 'done' && event.cacheInfo) {
            turnCacheInfo = event.cacheInfo;
            lastCacheInfo = event.cacheInfo;
          }
          yield event;
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError' || signal?.aborted) {
          yield {
            type: 'agent_done',
            totalTurns: turn - 1,
            stopReason: 'user_cancelled',
            cacheInfo: lastCacheInfo,
          };
          return;
        }
        yield { type: 'error', message: `LLM 调用失败: ${(err as Error).message}` };
        yield {
          type: 'agent_done',
          totalTurns: turn,
          stopReason: 'stream_error',
          cacheInfo: lastCacheInfo,
        };
        return;
      }

      const blocks = collector.getBlocks();
      this.chatManager.addAssistantMessage(blocks);

      // 更新 token 锚点（用于后续压缩判断）
      if (this.contextManager) {
        const msgs = this.chatManager.getMessages();
        // 用字符估算作为锚点：每条消息平均字符数 × 0.4
        let totalChars = 0;
        for (const m of msgs) {
          totalChars += typeof m.content === 'string'
            ? m.content.length
            : (m.content as ContentBlock[]).reduce((s, b) => s + (b.text ?? b.thinking ?? '').length, 0);
        }
        const estimatedTokens = Math.ceil(totalChars * 0.5); // 中文为主用 0.5
        this.contextManager.updateTokenAnchor(estimatedTokens, msgs.length);
      }

      // 没有工具调用 → 任务完成
      if (!collector.hasToolUse()) {
        // 触发自动记忆提取（fire-and-forget）
        if (this.memoryManager) {
          const msgs = this.chatManager.getMessages();
          this.memoryManager.extractMemories(msgs);
        }

        // Hook: agent_done
        if (this.hookManager) {
          await this.hookManager.fire('agent_done', {
            event: 'agent_done',
            turnNumber: turn,
            cwd: process.cwd(),
          });
        }

        yield {
          type: 'turn_end',
          turn,
          stopReason: 'no_tool_use',
          cacheInfo: turnCacheInfo,
        };
        yield {
          type: 'agent_done',
          totalTurns: turn,
          stopReason: 'task_completed',
          cacheInfo: lastCacheInfo,
        };
        return;
      }

      // 检查连续未知工具
      const toolUseBlocks = collector.getToolUseBlocks();
      const unknownCount = toolUseBlocks.filter(
        (b) => !this.registry.get(b.tool_name ?? ''),
      ).length;

      if (unknownCount === toolUseBlocks.length) {
        consecutiveUnknownTools++;
        if (consecutiveUnknownTools >= 2) {
          yield {
            type: 'error',
            message: `连续 ${consecutiveUnknownTools} 次调用未知工具，终止循环`,
          };
          yield {
            type: 'agent_done',
            totalTurns: turn,
            stopReason: 'consecutive_unknown_tools',
            cacheInfo: lastCacheInfo,
          };
          return;
        }
      } else {
        consecutiveUnknownTools = 0;
      }

      // Hook: pre_tool_execute（检查每个工具）
      if (this.hookManager) {
        for (const block of toolUseBlocks) {
          const preResult = await this.hookManager.fire('pre_tool_execute', {
            event: 'pre_tool_execute',
            toolName: block.tool_name,
            toolInput: block.tool_input,
            turnNumber: turn,
            cwd: process.cwd(),
          });

          if (!preResult.allowed) {
            // 拦截：反馈拒绝原因作为 tool_result
            this.chatManager.addToolResult({
              type: 'tool_result',
              tool_use_id: block.tool_use_id ?? '',
              text: `[Hook 拦截] ${preResult.reason ?? '工具执行被拒绝'}`,
            });
            yield {
              type: 'tool_result',
              tool_use_id: block.tool_use_id ?? '',
              tool_name: block.tool_name ?? 'unknown',
              success: false,
              output: `[Hook 拦截] ${preResult.reason ?? '工具执行被拒绝'}`,
            };
            // 从 toolUseBlocks 中移除被拦截的（通过标记跳过）
            block.tool_input = { ...block.tool_input, __hook_blocked: true };
          }
        }
      }

      // 过滤被 Hook 拦截的工具
      const activeBlocks = toolUseBlocks.filter(
        (b) => !(b.tool_input as any)?.__hook_blocked,
      );

      // 执行工具（跳过全部被拦截时直接 continue）
      if (activeBlocks.length === 0) {
        yield {
          type: 'turn_end',
          turn,
          stopReason: 'tools_executed',
          cacheInfo: turnCacheInfo,
        };
        continue;
      }

      const context: ToolExecuteContext = {
        cwd: process.cwd(),
        timeout: DEFAULT_TOOL_TIMEOUT,
        signal,
      };

      for await (const event of this.toolExecutor.executeBatch(
        activeBlocks,
        context,
        this.onConfirm,
      )) {
        if (signal?.aborted) {
          yield {
            type: 'agent_done',
            totalTurns: turn,
            stopReason: 'user_cancelled',
            cacheInfo: lastCacheInfo,
          };
          return;
        }
        yield event;

        if (event.type === 'tool_result') {
          this.chatManager.addToolResult({
            type: 'tool_result',
            tool_use_id: event.tool_use_id,
            text: event.output,
          });
        }
      }

      yield {
        type: 'turn_end',
        turn,
        stopReason: 'tools_executed',
        cacheInfo: turnCacheInfo,
      };
    }

    // 达到迭代上限，仍尝试提取记忆
    if (this.memoryManager) {
      const msgs = this.chatManager.getMessages();
      this.memoryManager.extractMemories(msgs);
    }

    yield {
      type: 'agent_done',
      totalTurns: this.config.maxIterations,
      stopReason: 'max_iterations',
      cacheInfo: lastCacheInfo,
    };
  }

  private getToolDefs() {
    const allTools = this.registry.getAll();
    let filtered =
      this.config.mode === 'plan'
        ? allTools.filter((t) => t.category === 'readonly')
        : allTools;

    // 应用 Skill 工具白名单
    if (this.skillManager) {
      const whitelist = this.skillManager.getToolWhitelist();
      if (whitelist) {
        filtered = filtered.filter((t) => whitelist.includes(t.name.toLowerCase()));
        // skill_load 始终在列表中（系统级工具）
        const skillLoadTool = allTools.find((t) => t.name === 'skill_load');
        if (skillLoadTool && !filtered.includes(skillLoadTool)) {
          filtered.push(skillLoadTool);
        }
      }
    }

    return filtered.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  /** 每轮注入运行时 system 消息 */
  private injectTurnMessages(turn: number): void {
    // 已激活 Skill 指令（每轮都钉在最前面）
    if (this.skillManager) {
      const skillPrompt = this.skillManager.buildActivePrompt();
      if (skillPrompt) {
        this.chatManager.injectSystemMessage(skillPrompt);
      }
    }

    const date = new Date().toISOString().slice(0, 10);
    const messages = this.promptManager.generateSystemMessages(turn, {
      mode: this.config.mode,
      cwd: process.cwd(),
      date,
    });
    for (const msg of messages) {
      this.chatManager.injectSystemMessage(msg.content);
    }
  }
}
