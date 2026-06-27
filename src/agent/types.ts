/**
 * Agent 层类型定义
 * AgentEvent、AgentConfig 等
 */

import type { StreamEvent, ContentBlock, ToolUseEvent, ToolExecutingEvent, ToolResultEvent, TextDelta, ThinkingDelta, ErrorEvent, DoneEvent } from '../provider/types.js';

// Re-export base events for convenience
export type { StreamEvent, ContentBlock };

/** 新一轮循环开始 */
export interface TurnStartEvent {
  type: 'turn_start';
  turn: number;
}

/** 一轮循环结束 */
export interface TurnEndEvent {
  type: 'turn_end';
  turn: number;
  stopReason: 'tools_executed' | 'no_tool_use';
  tokenUsage?: { input: number; output: number };
  cacheInfo?: import('../prompt/types.js').CacheInfo;
}

/** Agent 整体执行完成 */
export interface AgentDoneEvent {
  type: 'agent_done';
  totalTurns: number;
  stopReason:
    | 'task_completed'
    | 'max_iterations'
    | 'user_cancelled'
    | 'consecutive_unknown_tools'
    | 'stream_error';
  totalTokens?: { input: number; output: number };
  cacheInfo?: import('../prompt/types.js').CacheInfo;
}

/** Agent 事件联合类型 */
export type AgentEvent =
  | TextDelta
  | ThinkingDelta
  | ToolUseEvent
  | ToolExecutingEvent
  | ToolResultEvent
  | TurnStartEvent
  | TurnEndEvent
  | AgentDoneEvent
  | DoneEvent
  | ErrorEvent;

/** Agent 配置 */
export interface AgentConfig {
  /** 最大迭代次数，默认 5 */
  maxIterations: number;
  /** 当前模式 */
  mode: 'full' | 'plan';
}
