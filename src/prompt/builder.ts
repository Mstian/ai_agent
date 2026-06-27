/**
 * PromptBuilder — 注册、启用/禁用、按优先级拼装模块
 */

import type { PromptModule, ModuleKey } from './types.js';

export class PromptBuilder {
  private modules: Map<ModuleKey, PromptModule> = new Map();

  /** 注册一个模块 */
  register(module: PromptModule): void {
    this.modules.set(module.key, module);
  }

  /** 批量注册 */
  registerAll(modules: PromptModule[]): void {
    for (const m of modules) {
      this.register(m);
    }
  }

  /** 启用模块 */
  enable(key: ModuleKey): void {
    const m = this.modules.get(key);
    if (m) m.enabled = true;
  }

  /** 禁用模块 */
  disable(key: ModuleKey): void {
    const m = this.modules.get(key);
    if (m) m.enabled = false;
  }

  /** 获取单个模块（供外部动态修改 content） */
  getModule(key: ModuleKey): PromptModule | undefined {
    return this.modules.get(key);
  }

  /**
   * 按优先级拼装最终的 system prompt
   * - 过滤 enabled 模块
   * - 按 priority 升序排列
   * - 模块间用空行分隔
   * - 替换模板变量 {{key}}
   */
  build(variables?: Record<string, string>): string {
    const enabled = Array.from(this.modules.values())
      .filter((m) => m.enabled)
      .sort((a, b) => a.priority - b.priority);

    let result = enabled.map((m) => m.content).join('\n\n');

    // 模板变量替换
    if (variables) {
      for (const [key, value] of Object.entries(variables)) {
        result = result.replaceAll(`{{${key}}}`, value);
      }
    }

    return result;
  }
}
