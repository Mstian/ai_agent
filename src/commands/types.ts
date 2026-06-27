/**
 * 命令系统类型定义
 */

import type { Agent } from '../agent/agent.js';
import type { MemoryManager } from '../memory/memory_manager.js';

/** 命令类型 */
export type CommandType = 'local' | 'ui' | 'prompt';

/**
 * UIContext — 界面控制接口
 * 命令处理器通过此接口操作外部世界，不直接绑定渲染框架
 */
export interface UIContext {
  /** 显示普通消息 */
  showMessage(text: string): void;
  /** 显示错误消息 */
  showError(text: string): void;
  /** 将文本作为用户消息送入 Agent 循环 */
  sendToAgent(text: string): void;
  /** 切换 Agent 模式 */
  setAgentMode(mode: 'full' | 'plan'): void;
  /** 获取当前 Agent 模式 */
  getAgentMode(): 'full' | 'plan';
  /** 获取 Token 用量估算 */
  getTokenUsage(): { estimated: number };
  /** 获取当前会话 ID */
  getCurrentSessionId(): string | null;
  /** 获取 MemoryManager 实例 */
  getMemoryManager(): MemoryManager | null;
  /** 清屏 */
  clearScreen(): void;
  /** 退出程序 */
  requestExit(): void;
  /** 获取 Agent 实例 */
  getAgent(): Agent | null;
  /** 获取权限管理器的当前模式 */
  getPermissionMode?(): string;
  /** 设置权限模式 */
  setPermissionMode?(mode: string): void;
  /** 中止当前 Agent 任务 */
  abortCurrentTask?(): void;
  /** 恢复会话消息 */
  restoreSessionMessages?(messages: import('../provider/types.js').Message[]): void;
  /** 获取 system prompt 文本 */
  getSystemPrompt?(): string;
  /** 直接触发 Agent 执行指定 prompt（用于 Skill 一键执行） */
  executeAgentPrompt?(prompt: string): Promise<void>;
}

/** 命令处理函数 */
export type CommandHandler = (
  ctx: UIContext,
  args: string,
) => void | Promise<void>;

/** 命令定义 */
export interface CommandDef {
  /** 主名称（小写） */
  name: string;
  /** 别名列表 */
  aliases?: string[];
  /** 简短描述 */
  description: string;
  /** 用法示例 */
  usage?: string;
  /** 命令类型 */
  type: CommandType;
  /** 参数提示 */
  argsHint?: string;
  /** 是否隐藏（不参与 /help 和补全） */
  hidden?: boolean;
  /** 处理函数 */
  handler: CommandHandler;
}

/** 解析结果 */
export interface ParseResult {
  /** 命令名（已转小写） */
  commandName: string;
  /** 参数字符串（去除命令名后的部分） */
  args: string;
  /** 原始输入 */
  raw: string;
}

/** 命令冲突错误 */
export class CommandConflictError extends Error {
  constructor(
    public readonly conflictingName: string,
    public readonly existingCommand: string,
    public readonly newCommand: string,
  ) {
    super(
      `命令冲突: "${conflictingName}" 已被 "${existingCommand}" 使用，无法注册 "${newCommand}"`,
    );
    this.name = 'CommandConflictError';
  }
}
