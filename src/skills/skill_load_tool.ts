/**
 * skill_load 系统工具 — 供模型调用以激活 Skill
 *
 * 系统级工具，始终在可用工具列表中，不受白名单约束。
 * 模型调用此工具传入 Skill 名称和可选参数，激活完整 Skill 指令。
 */

import type { Tool, ToolExecuteContext, ToolResult } from '../tools/types.js';
import { SkillManager } from './skill_manager.js';

export class SkillLoadTool implements Tool {
  name = 'skill_load';
  description =
    '激活指定的 Skill，加载其完整操作指令和工具约束。' +
    '调用前确认用户确实需要该 Skill 的功能。' +
    '激活后 Skill 指令会钉在上下文最前面，请严格遵循。';
  category: 'readonly' | 'mutation' = 'readonly';
  parameters = {
    type: 'object' as const,
    properties: {
      name: {
        type: 'string',
        description: '要激活的 Skill 名称，如 commit、review、test',
      },
      params: {
        type: 'object',
        description:
          'Skill 正文中的参数替换（可选）。如正文含 {{branch}}，传入 {"branch": "main"}',
      },
    },
    required: ['name'],
  };

  private manager: SkillManager;

  constructor(manager: SkillManager) {
    this.manager = manager;
  }

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecuteContext,
  ): Promise<ToolResult> {
    const name = input.name as string;
    if (!name) {
      return {
        success: false,
        output: '缺少必填参数: name（Skill 名称）',
        meta: { tool: 'skill_load' },
      };
    }

    // 检查是否已激活
    if (this.manager.isActive(name)) {
      const active = this.manager.getActive().find((s) => s.name === name);
      return {
        success: true,
        output: `Skill "${name}" 已激活，无需重复加载。\n\n当前已激活 Skill: ${this.manager.getActiveNames().join(', ') || '(无)'}`,
        meta: { tool: 'skill_load', skillName: name, alreadyActive: true },
      };
    }

    // 刷新 Skill 缓存（支持热更新：Agent 写入新 Skill 文件后立即可用）
    this.manager.getLoader().reload();

    // 激活 Skill
    const params = (input.params as Record<string, string>) ?? {};
    try {
      const result = this.manager.activate(name, params);
      if (!result) {
        return {
          success: false,
          output: `Skill "${name}" 不存在。\n可用 Skill: ${this.manager.listAvailable().map((s) => s.name).join(', ')}`,
          meta: { tool: 'skill_load', skillName: name },
        };
      }

      const whitelistInfo =
        result.toolWhitelist.length > 0
          ? `\n工具白名单: ${result.toolWhitelist.join(', ')}`
          : '\n工具白名单: 无限制';

      return {
        success: true,
        output: [
          `Skill "${name}" 已激活。`,
          `执行模式: ${result.skill.mode}`,
          whitelistInfo,
          `\n指令预览（前 200 字符）:`,
          result.skill.body.slice(0, 200) +
            (result.skill.body.length > 200 ? '...' : ''),
          `\n\n请严格遵循以上 Skill 指令执行。`,
        ].join('\n'),
        meta: {
          tool: 'skill_load',
          skillName: name,
          toolWhitelist: result.toolWhitelist,
          mode: result.skill.mode,
        },
      };
    } catch (err) {
      return {
        success: false,
        output: `Skill "${name}" 激活失败: ${(err as Error).message}`,
        meta: { tool: 'skill_load', skillName: name },
      };
    }
  }
}
