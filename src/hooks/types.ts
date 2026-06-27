/**
 * Hook 系统类型定义
 */

/** 生命周期事件 */
export type HookEvent =
  | 'session_start'
  | 'session_end'
  | 'turn_start'
  | 'turn_end'
  | 'message_received'
  | 'pre_tool_execute'
  | 'post_tool_execute'
  | 'agent_done'
  | 'error';

/** 有效事件列表 */
export const VALID_EVENTS: HookEvent[] = [
  'session_start', 'session_end', 'turn_start', 'turn_end',
  'message_received', 'pre_tool_execute', 'post_tool_execute',
  'agent_done', 'error',
];

/** 条件匹配项 */
export interface ConditionItem {
  field: string;
  pattern: string;
}

/** 条件表达式 */
export interface HookCondition {
  tools?: string[];
  matchMode?: 'all' | 'any';
  conditions?: ConditionItem[];
}

/** 动作类型 */
export type HookAction =
  | { type: 'command'; command: string; timeout?: number }
  | { type: 'prompt'; text: string; position?: 'before' | 'after' }
  | { type: 'http'; url: string; method?: string; headers?: Record<string, string>; body?: string }
  | { type: 'agent'; prompt: string; model?: string };

/** 一条 Hook 规则 */
export interface HookRule {
  event: HookEvent;
  if?: HookCondition;
  action: HookAction;
  /** 直接拒绝（仅 pre_tool_execute 生效），无需写 exit 1 脚本 */
  reject?: boolean;
  /** 拒绝时反馈给模型的原因 */
  rejectReason?: string;
  runOnce?: boolean;
  async?: boolean;
  timeout?: number;
}

/** Hook 触发上下文 */
export interface HookContext {
  event: HookEvent;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  turnNumber?: number;
  cwd: string;
  sessionId?: string;
}

/** Hook 触发结果 */
export interface HookFireResult {
  allowed: boolean;
  reason?: string;
  promptInjections: string[];
}

/** YAML 配置中的 Hook 定义（加载前） */
export interface HookConfig {
  event?: string;
  if?: HookCondition;
  action?: {
    type?: string;
    command?: string;
    text?: string;
    position?: string;
    url?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    prompt?: string;
    model?: string;
    timeout?: number;
  };
  reject?: boolean;
  rejectReason?: string;
  runOnce?: boolean;
  async?: boolean;
  timeout?: number;
}
