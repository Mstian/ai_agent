/**
 * CommandParser + CommandDispatcher — 斜杠命令解析与分发
 *
 * 解析器：识别 / 前缀 → 提取命令名和参数 → 命令名转小写
 * 分发器：根据解析结果调度到命令处理器或返回 false 交给 Agent
 */

import type { ParseResult, UIContext } from './types.js';
import type { CommandRegistry } from './registry.js';

/** 斜杠命令解析器 */
export class CommandParser {
  /**
   * 解析用户输入
   * @returns ParseResult（斜杠命令）或 null（非命令）
   */
  parse(input: string): ParseResult | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (!trimmed.startsWith('/')) return null;

    // 找第一个空格
    const spaceIdx = trimmed.indexOf(' ');
    let commandName: string;
    let args: string;

    if (spaceIdx === -1) {
      commandName = trimmed.slice(1);
      args = '';
    } else {
      commandName = trimmed.slice(1, spaceIdx);
      args = trimmed.slice(spaceIdx + 1).trim();
    }

    // 命令名转小写（大小写不敏感）
    commandName = commandName.toLowerCase();

    // 空命令名（如只输入了 /）
    if (!commandName) return null;

    return { commandName, args, raw: trimmed };
  }
}

/** 命令分发器 */
export class CommandDispatcher {
  private registry: CommandRegistry;
  private parser: CommandParser;

  constructor(registry: CommandRegistry) {
    this.registry = registry;
    this.parser = new CommandParser();
  }

  /**
   * 分发输入到命令或返回 false
   * @returns true = 已作为命令处理，false = 非命令应送 Agent
   */
  async dispatch(input: string, ui: UIContext): Promise<boolean> {
    const parsed = this.parser.parse(input);
    if (!parsed) return false;

    const cmd = this.registry.get(parsed.commandName);
    if (!cmd) {
      // 未命中命令，显示引导
      ui.showError(
        `未知命令: /${parsed.commandName}\n输入 /help 查看可用命令`,
      );
      return true;
    }

    try {
      await cmd.handler(ui, parsed.args);
    } catch (err) {
      ui.showError(
        `命令 /${cmd.name} 执行失败: ${(err as Error).message}`,
      );
    }

    return true; // 已处理（无论成功或失败）
  }

  /** 暴露解析器供补全使用 */
  getParser(): CommandParser {
    return this.parser;
  }

  /** 暴露注册中心供 /help 使用 */
  getRegistry(): CommandRegistry {
    return this.registry;
  }
}
