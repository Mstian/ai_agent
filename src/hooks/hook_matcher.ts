/**
 * HookMatcher — 条件匹配引擎
 * 复用权限规则匹配语法：精确/反向(!)/正则(/pattern/)/glob(*)
 */

import type { HookRule, HookCondition, ConditionItem, HookContext } from './types.js';

export class HookMatcher {
  /** 检查单条规则的条件是否匹配当前上下文 */
  match(rule: HookRule, ctx: HookContext): boolean {
    if (!rule.if) return true;

    const cond = rule.if;
    const results: boolean[] = [];

    // 工具名匹配
    if (cond.tools && cond.tools.length > 0) {
      results.push(this.matchTools(cond.tools, ctx));
    }

    // 字段级条件匹配
    if (cond.conditions && cond.conditions.length > 0) {
      for (const item of cond.conditions) {
        results.push(this.matchCondition(item, ctx));
      }
    }

    if (results.length === 0) return true;

    const mode = cond.matchMode ?? 'all';
    return mode === 'all'
      ? results.every(Boolean)
      : results.some(Boolean);
  }

  /** 工具名列表匹配 */
  private matchTools(tools: string[], ctx: HookContext): boolean {
    if (!ctx.toolName) return false;
    const name = ctx.toolName.toLowerCase();
    return tools.some((t) => name === t.toLowerCase());
  }

  /** 单条条件匹配 */
  private matchCondition(item: ConditionItem, ctx: HookContext): boolean {
    const value = this.getFieldValue(item.field, ctx);
    if (value === undefined) return false;
    return this.matchSingle(item.pattern, String(value));
  }

  /**
   * 单值匹配
   * - /pattern/ → 正则
   * - !value → 反向
   * - 含 * 或 ? → glob
   * - 否则 → 精确匹配
   */
  matchSingle(pattern: string, value: string): boolean {
    // 正则匹配：/pattern/flags
    const regexMatch = pattern.match(/^\/(.+)\/([gimsu]*)$/);
    if (regexMatch) {
      try {
        const re = new RegExp(regexMatch[1], regexMatch[2] || undefined);
        return re.test(value);
      } catch {
        return false;
      }
    }

    // 反向匹配：!value
    if (pattern.startsWith('!')) {
      const negated = pattern.slice(1);
      return value !== negated;
    }

    // Glob 匹配：含 * 或 ?
    if (pattern.includes('*') || pattern.includes('?')) {
      const regexStr = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
      try {
        return new RegExp(`^${regexStr}$`, 'i').test(value);
      } catch {
        return false;
      }
    }

    // 精确匹配
    return value === pattern;
  }

  /** 从上下文提取字段值 */
  private getFieldValue(field: string, ctx: HookContext): string | undefined {
    switch (field) {
      case 'tool_name':
      case 'toolName':
        return ctx.toolName;
      case 'command':
        return ctx.toolInput?.command as string | undefined;
      case 'file_path':
        return ctx.toolInput?.file_path as string | undefined;
      case 'tool_use_id':
        return ctx.toolInput?.tool_use_id as string | undefined;
      case 'cwd':
        return ctx.cwd;
      case 'session_id':
      case 'sessionId':
        return ctx.sessionId;
      default:
        // 尝试从 toolInput 中取
        return ctx.toolInput?.[field] as string | undefined;
    }
  }
}
