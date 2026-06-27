/**
 * CommandCompleter — Tab 补全
 * 单匹配直接补全，多匹配返回列表给调用方展示菜单
 */

import type { CommandRegistry } from './registry.js';

export class CommandCompleter {
  private registry: CommandRegistry;

  constructor(registry: CommandRegistry) {
    this.registry = registry;
  }

  /**
   * 补全斜杠命令
   * @returns [匹配列表, 已匹配的前缀]
   *   匹配列表长度 = 0: 无匹配
   *   匹配列表长度 = 1: 唯一匹配，调用方应直接补全
   *   匹配列表长度 > 1: 多匹配，调用方应展示菜单
   */
  complete(line: string): [string[], string] {
    const trimmed = line.trim();

    // 仅处理以 / 开头且无空格的输入
    if (!trimmed.startsWith('/')) return [[], trimmed];
    if (trimmed.includes(' ')) return [[], trimmed];

    const prefix = trimmed.slice(1).toLowerCase();
    const names = this.registry.getNames(false); // 不包含隐藏命令

    const matches = names.filter((n) => n.startsWith(prefix));

    if (matches.length === 0) {
      return [[], trimmed];
    }

    if (matches.length === 1) {
      return [matches, prefix];
    }

    return [matches, prefix];
  }

  /**
   * 获取补全后的行文本
   */
  applyCompletion(line: string): { completed: string; matches: string[] } {
    const [matches, prefix] = this.complete(line);

    if (matches.length === 1) {
      return { completed: `/${matches[0]}`, matches: [] };
    }

    return { completed: line, matches };
  }
}
