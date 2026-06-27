/**
 * 提示系统类型定义
 */

/** 模块唯一标识 */
export type ModuleKey =
  | 'identity'
  | 'constraints'
  | 'task_mode'
  | 'actions'
  | 'tool_use'
  | 'tone'
  | 'output'
  | 'custom_instructions'
  | 'active_skills'
  | 'long_term_memory';

/** 提示模块 */
export interface PromptModule {
  key: ModuleKey;
  priority: number;
  content: string;
  enabled: boolean;
}

/** 注入上下文（运行时变化的信息） */
export interface InjectionContext {
  mode: 'full' | 'plan';
  cwd: string;
  date: string;
  gitBranch?: string;
}

/** system 角色注入消息 */
export interface SystemMessage {
  role: 'system';
  content: string;
}

/** 缓存命中信息 */
export interface CacheInfo {
  cacheCreationTokens: number;
  cacheReadTokens: number;
  inputTokens: number;
}
