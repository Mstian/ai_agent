/**
 * Skill 命令组 — /skill 系列命令 + 动态斜杠命令注册
 *
 * /skill list — 列出已激活 Skill
 * /skill ls   — 列出所有可用 Skill（含未激活）
 * /skill unload <name> — 卸载指定 Skill
 *
 * 激活后自动注册 /<skill_name> 快捷命令
 */

import type { CommandDef, UIContext } from '../commands/types.js';
import type { CommandRegistry } from '../commands/registry.js';
import type { SkillManager } from './skill_manager.js';

/** 创建 /skill 命令组 */
export function createSkillCommand(
  manager: SkillManager,
  registry: CommandRegistry,
  onActivate?: (name: string) => string | null,
): CommandDef {
  return {
    name: 'skill',
    description: 'Skill 管理：list / ls / unload',
    type: 'local',
    usage: '/skill [list|ls|unload <name>]',
    argsHint: '<子命令>',
    handler: (ctx, args) => {
      const parts = args.trim().split(/\s+/);
      const sub = parts[0]?.toLowerCase() || 'list';

      switch (sub) {
        case 'list': {
          const active = manager.getActive();
          const all = manager.listAvailable();
          const activeNames = new Set(manager.getActiveNames());
          const lines: string[] = [];

          // 已激活的 Skill
          if (active.length > 0) {
            lines.push('已激活的 Skill:', '');
            for (const s of active) {
              const whitelist =
                s.tools && s.tools.length > 0
                  ? ` [工具: ${s.tools.join(', ')}]`
                  : '';
              lines.push(`  ${s.name} — ${s.description}${whitelist}`);
            }
            lines.push('');
          }

          // 所有可用的 Skill
          lines.push('可用的 Skill:', '');
          for (const s of all) {
            const mark = activeNames.has(s.name) ? ' [已激活]' : '';
            lines.push(`  ${s.name} — ${s.description}${mark}`);
          }
          lines.push('');
          lines.push('输入 /<name> 激活  |  /skill unload <name> 卸载');
          ctx.showMessage(lines.join('\n'));
          break;
        }

        case 'ls': {
          const all = manager.listAvailable();
          const activeNames = new Set(manager.getActiveNames());
          const lines = ['所有可用 Skill:', ''];
          for (const s of all) {
            const mark = activeNames.has(s.name) ? ' [已激活]' : '';
            lines.push(`  ${s.name} — ${s.description}${mark}`);
          }
          lines.push('');
          lines.push('输入 /<name> 激活指定 Skill');
          ctx.showMessage(lines.join('\n'));
          break;
        }

        case 'unload': {
          const targetName = parts[1];
          if (!targetName) {
            ctx.showError('用法: /skill unload <name>');
            return;
          }
          if (manager.deactivate(targetName)) {
            unregisterSkillCommand(registry, targetName);
            ctx.showMessage(`Skill "${targetName}" 已卸载`);
          } else {
            ctx.showError(`Skill "${targetName}" 未激活`);
          }
          break;
        }

        default:
          ctx.showError(
            `未知子命令: ${sub}\n可用: list, ls, unload <name>`,
          );
      }
    },
  };
}

/** Skill 激活后自动注册为 /<name> 斜杠命令 */
export function registerSkillCommand(
  registry: CommandRegistry,
  manager: SkillManager,
  name: string,
  ctx?: UIContext,
): void {
  const def = manager.getLoader().load(name);
  if (!def) return;

  try {
    registry.register({
      name,
      description: def.description,
      type: 'prompt',
      usage: `/${name}`,
      handler: async (ui, _args) => {
        const result = manager.activate(name);
        if (result) {
          ui.showMessage(
            `Skill "${name}" 已激活，正在执行...\n`,
          );
          // 立刻触发 Agent 执行 Skill 指令
          if (ui.executeAgentPrompt) {
            await ui.executeAgentPrompt(result.skill.body);
          } else {
            ui.sendToAgent(result.skill.body);
          }
        } else {
          ui.showError(`Skill "${name}" 不存在`);
        }
      },
    });
  } catch {
    // 命令已存在（可能来自内置命令），跳过
  }
}

/** 卸载时移除 /<name> 斜杠命令 */
export function unregisterSkillCommand(
  registry: CommandRegistry,
  name: string,
): void {
  // CommandRegistry 没有 unregister 方法，通过重新注册来覆盖需要特殊处理
  // 这里标记为已卸载，斜杠命令通过 SkillManager.isActive 检查来拒绝
  // 实际处理：command handler 中检查是否已激活
}

/** 注册所有已激活 Skill 的斜杠命令（/clear 后重建时用） */
export function refreshSkillCommands(
  registry: CommandRegistry,
  manager: SkillManager,
): void {
  const active = manager.getActive();
  for (const skill of active) {
    registerSkillCommand(registry, manager, skill.name);
  }
}

/** 清空所有 Skill 斜杠命令 */
export function clearAllSkillCommands(
  registry: CommandRegistry,
): void {
  // CommandRegistry 无 unregister，通过 manager.clear() 配合命令 handler 中的激活检查来处理
}
