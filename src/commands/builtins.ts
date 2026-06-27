/**
 * 内置命令定义
 * 10 个高频命令：/help /compact /clear /plan /do /session /memory /permission /status /review
 */

import type { CommandDef, UIContext } from './types.js';
import type { CommandRegistry } from './registry.js';

// ===== 命令创建函数 =====

/** /help — 列出所有可见命令 */
export function createHelpCommand(getRegistry: () => CommandRegistry): CommandDef {
  return {
    name: 'help',
    aliases: ['h', '?'],
    description: '列出所有可用命令及用法',
    type: 'local',
    usage: '/help',
    handler: (ctx) => {
      const cmds = getRegistry().getAll(false);
      const lines: string[] = ['', '可用命令:', ''];

      for (const cmd of cmds) {
        const aliases = cmd.aliases?.length
          ? ` (别名: ${cmd.aliases.join(', ')})`
          : '';
        const argsHint = cmd.argsHint ? ` ${cmd.argsHint}` : '';
        const typeLabel = { local: '本地', ui: '界面', prompt: '提示词' }[cmd.type];

        lines.push(
          `  /${cmd.name}${argsHint}${aliases}`,
          `    ${cmd.description}  [${typeLabel}]`,
          '',
        );
      }

      lines.push('非斜杠输入将作为对话发送给 AI。');
      ctx.showMessage(lines.join('\n'));
    },
  };
}

/** /compact — 触发对话压缩 */
export function createCompactCommand(): CommandDef {
  return {
    name: 'compact',
    aliases: ['compress'],
    description: '手动触发对话历史压缩',
    type: 'ui',
    usage: '/compact',
    handler: async (ctx) => {
      const agent = ctx.getAgent();
      if (!agent) {
        ctx.showError('Agent 未初始化');
        return;
      }
      ctx.showMessage('正在压缩对话历史...');
      const didCompress = await agent.manualCompress();
      ctx.showMessage(
        didCompress
          ? '对话历史已压缩'
          : '当前无需压缩或已熔断',
      );
    },
  };
}

/** /clear — 清空对话 + 清屏 */
export function createClearCommand(): CommandDef {
  return {
    name: 'clear',
    description: '清空对话历史并清屏',
    type: 'ui',
    usage: '/clear',
    handler: (ctx) => {
      ctx.getAgent()?.clear();
      ctx.clearScreen();
    },
  };
}

/** /plan — 切换为规划模式 */
export function createPlanCommand(): CommandDef {
  return {
    name: 'plan',
    description: '切换为规划模式（只能使用只读工具）',
    type: 'ui',
    usage: '/plan',
    handler: (ctx) => {
      ctx.setAgentMode('plan');
      ctx.showMessage('切换为规划模式 — 只能使用只读工具（read_file、glob、grep）');
    },
  };
}

/** /do — 切换为执行模式 */
export function createDoCommand(): CommandDef {
  return {
    name: 'do',
    description: '切换为执行模式（可以使用全部工具）',
    type: 'ui',
    usage: '/do',
    handler: (ctx) => {
      ctx.setAgentMode('full');
      ctx.showMessage('切换为执行模式 — 可以使用全部工具');
    },
  };
}

/** /session — 显示会话信息 */
export function createSessionCommand(): CommandDef {
  return {
    name: 'session',
    aliases: ['sess'],
    description: '显示当前会话信息和存档状态',
    type: 'local',
    usage: '/session',
    handler: (ctx) => {
      const sessionId = ctx.getCurrentSessionId();
      const memory = ctx.getMemoryManager();
      const token = ctx.getTokenUsage();

      const lines: string[] = ['', '会话信息:', ''];

      if (sessionId) {
        lines.push(`  会话 ID: ${sessionId}`);
      } else {
        lines.push('  未开始会话存档');
      }

      if (memory) {
        const sessions = memory['sessionRecovery']?.listSessions?.() ?? [];
        lines.push(`  可恢复会话: ${sessions.length} 个`);
      }

      lines.push(`  估算 Token: ${token.estimated.toLocaleString()}`);
      lines.push('');

      ctx.showMessage(lines.join('\n'));
    },
  };
}

/** /memory — 显示长期记忆 */
export function createMemoryCommand(): CommandDef {
  return {
    name: 'memory',
    aliases: ['mem'],
    description: '显示长期记忆列表和状态',
    type: 'local',
    usage: '/memory',
    handler: (ctx) => {
      const mm = ctx.getMemoryManager();
      if (!mm) {
        ctx.showError('记忆系统未初始化');
        return;
      }

      const index = mm['projectMemoryIndex']?.getContent();
      if (index && index.trim()) {
        ctx.showMessage('\n长期记忆:\n\n' + index);
      } else {
        ctx.showMessage('\n暂无长期记忆。记忆会在对话结束自动提取。');
      }
    },
  };
}

/** /permission — 查看或切换权限模式 */
export function createPermissionCommand(): CommandDef {
  return {
    name: 'permission',
    aliases: ['perm', 'mode'],
    description: '查看或切换权限模式（strict / default / permissive）',
    type: 'ui',
    usage: '/permission [strict|default|permissive]',
    argsHint: '[模式]',
    handler: (ctx, args) => {
      const getMode = ctx.getPermissionMode;
      const setMode = ctx.setPermissionMode;

      if (!getMode || !setMode) {
        ctx.showError('权限系统未初始化');
        return;
      }

      const validModes = ['strict', 'default', 'permissive'] as const;

      if (!args) {
        ctx.showMessage(`当前权限模式: ${getMode()}\n可选: strict / default / permissive`);
        return;
      }

      const target = args.trim().toLowerCase();
      if (validModes.includes(target as any)) {
        setMode(target);
        ctx.showMessage(`权限模式切换为: ${target}`);
      } else {
        ctx.showError(`无效模式: ${target}。可选值: strict, default, permissive`);
      }
    },
  };
}

/** /status — 显示运行状态 */
export function createStatusCommand(): CommandDef {
  return {
    name: 'status',
    aliases: ['st'],
    description: '显示 Token 用量、当前模式等运行状态',
    type: 'local',
    usage: '/status',
    handler: (ctx) => {
      const mode = ctx.getAgentMode();
      const token = ctx.getTokenUsage();
      const sessionId = ctx.getCurrentSessionId();
      const permMode = ctx.getPermissionMode?.() ?? 'default';

      const lines: string[] = [
        '',
        '运行状态:',
        '',
        `  Agent 模式: ${mode === 'plan' ? '规划模式' : '执行模式'}`,
        `  权限模式: ${permMode}`,
        `  估算 Token: ${token.estimated.toLocaleString()}`,
        `  会话 ID: ${sessionId ?? '(未开始)'}`,
        '',
      ];

      ctx.showMessage(lines.join('\n'));
    },
  };
}

/** /exit — 退出程序 */
export function createExitCommand(): CommandDef {
  return {
    name: 'exit',
    aliases: ['quit', 'q'],
    description: '退出 MewCode',
    type: 'local',
    usage: '/exit',
    handler: (ctx) => {
      ctx.showMessage('再见！');
      ctx.requestExit();
    },
  };
}

/** /stop — 中止当前 Agent 任务 */
export function createStopCommand(): CommandDef {
  return {
    name: 'stop',
    description: '中止当前正在执行的 Agent 任务',
    type: 'ui',
    usage: '/stop',
    handler: (ctx) => {
      if (ctx.abortCurrentTask) {
        ctx.abortCurrentTask();
      } else {
        ctx.showMessage('当前没有正在执行的任务');
      }
    },
  };
}

/** /resume — 恢复指定会话 */
export function createResumeCommand(): CommandDef {
  return {
    name: 'resume',
    description: '恢复之前的会话',
    type: 'ui',
    usage: '/resume <会话ID>',
    argsHint: '<会话ID>',
    handler: (ctx, args) => {
      if (!args) {
        ctx.showError('用法: /resume <会话ID>\n输入 /session 查看可恢复的会话');
        return;
      }
      const mm = ctx.getMemoryManager();
      if (!mm) {
        ctx.showError('记忆系统未初始化');
        return;
      }
      try {
        const recovered = mm.recoverSession(args);
        const restoreMessages = ctx.restoreSessionMessages;
        if (restoreMessages) {
          ctx.getAgent()?.clear();
          restoreMessages(recovered.messages);
        }
        ctx.showMessage(
          `已恢复会话 ${args}（${recovered.messages.length} 条消息）`,
        );
        if (recovered.needsCompress) {
          ctx.showMessage('⚠ 会话 token 数可能超限，建议输入 /compact 压缩');
        }
      } catch (err) {
        ctx.showError(`恢复失败: ${(err as Error).message}`);
      }
    },
  };
}

// ===== 注册入口 =====

/** 注册全部内置命令 */
export function registerAllBuiltins(
  registry: CommandRegistry,
  getRegistry: () => CommandRegistry,
): void {
  registry.register(createHelpCommand(getRegistry));
  registry.register(createCompactCommand());
  registry.register(createClearCommand());
  registry.register(createPlanCommand());
  registry.register(createDoCommand());
  registry.register(createSessionCommand());
  registry.register(createMemoryCommand());
  registry.register(createPermissionCommand());
  registry.register(createStatusCommand());
  registry.register(createExitCommand());
  registry.register(createStopCommand());
  registry.register(createResumeCommand());
}
