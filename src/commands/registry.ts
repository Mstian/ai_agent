/**
 * CommandRegistry — 命令注册中心
 * 管理命令元数据，注册时检测别名冲突（HashMap 实现 O(1) 查找）
 */

import type { CommandDef } from './types.js';
import { CommandConflictError } from './types.js';

export class CommandRegistry {
  /** 名称/别名 → CommandDef 映射 */
  private map: Map<string, CommandDef> = new Map();
  /** 主名称列表（保持注册顺序，/help 展示用） */
  private order: string[] = [];

  /** 注册一条命令 */
  register(def: CommandDef): void {
    const name = def.name.toLowerCase();
    const aliases = (def.aliases ?? []).map((a) => a.toLowerCase());

    // 收集所有要注册的名称
    const names = [name, ...aliases];

    // 冲突检测
    for (const n of names) {
      const existing = this.map.get(n);
      if (existing) {
        throw new CommandConflictError(n, existing.name, def.name);
      }
    }

    // 检测别名之间是否冲突（自身重复）
    const uniqueAliases = new Set(aliases);
    if (uniqueAliases.size !== aliases.length) {
      throw new CommandConflictError(
        aliases.find((a, i) => aliases.indexOf(a) !== i)!,
        def.name,
        def.name + '(自身别名重复)',
      );
    }

    // 注册所有名称
    for (const n of names) {
      this.map.set(n, def);
    }
    this.order.push(name);
  }

  /** 按名称或别名查找命令 */
  get(name: string): CommandDef | null {
    return this.map.get(name.toLowerCase()) ?? null;
  }

  /** 列出所有命令（排除隐藏命令） */
  getAll(includeHidden = false): CommandDef[] {
    const seen = new Set<string>();
    const result: CommandDef[] = [];
    for (const name of this.order) {
      const def = this.map.get(name);
      if (!def || seen.has(def.name)) continue;
      if (!includeHidden && def.hidden) continue;
      seen.add(def.name);
      result.push(def);
    }
    return result;
  }

  /** 列出所有命令名称（补全用） */
  getNames(includeHidden = false): string[] {
    return this.getAll(includeHidden).map((d) => d.name);
  }

  /** 注销命令（用于 Skill 卸载） */
  unregister(name: string): boolean {
    const def = this.map.get(name.toLowerCase());
    if (!def) return false;

    // 收集要删除的所有映射键
    const toDelete: string[] = [];
    for (const [key, mapped] of this.map) {
      if (mapped === def) {
        toDelete.push(key);
      }
    }

    // 删除所有映射
    for (const key of toDelete) {
      this.map.delete(key);
    }

    // 从 order 中移除
    const idx = this.order.indexOf(def.name.toLowerCase());
    if (idx !== -1) {
      this.order.splice(idx, 1);
    }

    return true;
  }
}
