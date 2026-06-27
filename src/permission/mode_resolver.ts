/**
 * ModeResolver — 第四层：权限模式
 * strict: 全部确认
 * default: 规则命中放行，未命中确认
 * permissive: 规则命中放行，未命中自动放行
 */

import type { PermissionMode, PermissionResult } from './types.js';

export class ModeResolver {
  private mode: PermissionMode = 'default';

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  /**
   * ruleMatched: 规则引擎是否命中
   * 返回是否需要进一步确认
   */
  resolve(ruleMatched: boolean): PermissionResult | null {
    switch (this.mode) {
      case 'strict':
        // 所有操作都需要确认
        return { allowed: false, confirmRequired: true };

      case 'default':
        if (ruleMatched) {
          return null; // 规则命中，放行（allow/deny 已由 RuleEngine 决定）
        }
        return { allowed: false, confirmRequired: true };

      case 'permissive':
        // 规则命中或未命中都放行
        return null;
    }
  }
}
