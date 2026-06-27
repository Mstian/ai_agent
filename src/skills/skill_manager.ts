/**
 * SkillManager — 激活/卸载/白名单/指令生成
 *
 * 管理已激活 Skill 的完整生命周期：
 * - 激活时加载完整 SkillDef，替换参数占位符
 * - 合并所有已激活 Skill 的工具白名单
 * - 生成注入用的完整指令文本
 */

import type { SkillDef, SkillLoadResult, SkillSummary } from './types.js';
import { SkillLoader } from './skill_loader.js';

export class SkillManager {
  private loader: SkillLoader;
  /** 已激活 Skill: name → SkillDef */
  private activeSkills: Map<string, SkillDef> = new Map();
  /** 替换后的参数: skillName → params */
  private skillParams: Map<string, Record<string, string>> = new Map();
  /** 工具白名单校验器（可选，由外部注入） */
  private validToolNames: Set<string> = new Set();

  constructor(loader: SkillLoader) {
    this.loader = loader;
  }

  /** 设置有效的工具名称集合（用于启动时白名单校验） */
  setValidToolNames(names: string[]): void {
    this.validToolNames = new Set(names.map((n) => n.toLowerCase()));
  }

  /** 阶段一：获取所有 Skill 摘要 */
  listAvailable(): SkillSummary[] {
    return this.loader.listAll();
  }

  /** 阶段二：激活指定 Skill */
  activate(name: string, params?: Record<string, string>): SkillLoadResult | null {
    const def = this.loader.load(name);
    if (!def) return null;

    // 校验工具白名单
    const toolWhitelist = this.validateToolWhitelist(def);

    // 替换参数占位符
    const resolvedParams = params ?? {};
    let body = def.body;
    for (const [key, value] of Object.entries(resolvedParams)) {
      body = body.replaceAll(`{{${key}}}`, value);
    }

    // 创建替换后的 SkillDef
    const activatedDef: SkillDef = {
      ...def,
      body,
      tools: toolWhitelist,
    };

    this.activeSkills.set(name, activatedDef);
    this.skillParams.set(name, resolvedParams);

    return {
      skill: activatedDef,
      replacedParams: resolvedParams,
      toolWhitelist,
    };
  }

  /** 卸载指定 Skill */
  deactivate(name: string): boolean {
    const removed = this.activeSkills.delete(name);
    this.skillParams.delete(name);
    return removed;
  }

  /** 清空所有已激活 Skill */
  clear(): void {
    this.activeSkills.clear();
    this.skillParams.clear();
  }

  /** 获取已激活 Skill 列表 */
  getActive(): SkillDef[] {
    return Array.from(this.activeSkills.values());
  }

  /** 获取已激活 Skill 名称列表 */
  getActiveNames(): string[] {
    return Array.from(this.activeSkills.keys());
  }

  /** 检查 Skill 是否已激活 */
  isActive(name: string): boolean {
    return this.activeSkills.has(name);
  }

  /**
   * 获取当前有效工具白名单
   * @returns null = 无限制（全工具），string[] = 白名单
   */
  getToolWhitelist(): string[] | null {
    if (this.activeSkills.size === 0) return null;

    const allTools = new Set<string>();
    for (const def of this.activeSkills.values()) {
      if (def.tools) {
        for (const t of def.tools) {
          allTools.add(t.toLowerCase());
        }
      }
    }

    if (allTools.size === 0) return null;

    // 确保 skill_load 始终在白名单中
    allTools.add('skill_load');
    return Array.from(allTools);
  }

  /**
   * 生成注入用的完整指令文本（钉在 system prompt 最前面）
   */
  buildActivePrompt(): string {
    if (this.activeSkills.size === 0) return '';

    const parts: string[] = [];
    parts.push('[激活的 Skill]\n');

    for (const def of this.activeSkills.values()) {
      parts.push(`## ${def.name}`);
      parts.push(def.body);
      parts.push('');
    }

    parts.push('---\n');
    return parts.join('\n');
  }

  /** 生成阶段一注入用的 Skill 列表 */
  buildAvailableList(): string {
    const skills = this.listAvailable();
    if (skills.length === 0) return '';

    const lines: string[] = [
      '## 可用 Skill',
      '',
      '**重要：在开始执行用户任务之前，请先检查以下 Skill 列表中是否有与任务相关的 Skill。**',
      '**如果有匹配的 Skill，必须先调用 skill_load 工具激活它，然后再按 Skill 指令执行。**',
      '**不要跳过这一步——Skill 包含专门的指令和工具约束，能帮助你更高效地完成任务。**',
      '',
    ];
    for (const s of skills) {
      lines.push(`- **${s.name}**: ${s.description}`);
    }
    lines.push('');
    lines.push('激活方式：调用 skill_load 工具，传入 Skill 名称；或用户输入 /<name>');
    lines.push('激活后 Skill 指令会钉在上下文最前面，请严格遵循。');
    return lines.join('\n');
  }

  /** 获取 SkillLoader（供外部使用） */
  getLoader(): SkillLoader {
    return this.loader;
  }

  /** 校验工具白名单，返回有效工具列表 */
  private validateToolWhitelist(def: SkillDef): string[] {
    if (!def.tools || def.tools.length === 0) return [];

    const invalid: string[] = [];
    for (const toolName of def.tools) {
      if (!this.validToolNames.has(toolName.toLowerCase())) {
        invalid.push(toolName);
      }
    }

    if (invalid.length > 0) {
      throw new Error(
        `Skill "${def.name}" 声明的工具白名单中包含不存在的工具: ${invalid.join(', ')}`,
      );
    }

    return def.tools.map((t) => t.toLowerCase());
  }
}
