// ===== 对话消息类型 =====

// ContentBlock — 消息内容块，支持文本、思考、工具调用/结果（后续扩展）
export interface ContentBlock {
  // 内容块类型
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  // 纯文本内容
  text?: string;
  // extended thinking 思考内容
  thinking?: string;
  // 工具调用 ID（tool_use 和 tool_result 共用）
  tool_use_id?: string;
  // 工具名称（tool_use 时使用）
  tool_name?: string;
  // 工具参数（tool_use 时使用）
  tool_input?: Record<string, unknown>;
}

// Message — 对话消息，所有层共享
export interface Message {
  // 角色：user / assistant / system / tool
  role: 'user' | 'assistant' | 'system' | 'tool';
  // 消息内容，可以是简单字符串或 ContentBlock 数组
  content: string | ContentBlock[];
}

// ===== 流式事件类型 =====

// TextDelta — 文本增量事件
export interface TextDelta {
  type: 'text_delta';
  text: string;
}

// ThinkingDelta — extended thinking 增量事件
export interface ThinkingDelta {
  type: 'thinking_delta';
  text: string;
}

// ToolUseEvent — 模型发起的工具调用（从流式解析中得出完整调用）
export interface ToolUseEvent {
  type: 'tool_use';
  tool_use_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

// ToolExecutingEvent — 正在执行工具
export interface ToolExecutingEvent {
  type: 'tool_executing';
  tool_use_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

// ToolResultEvent — 工具执行完成
export interface ToolResultEvent {
  type: 'tool_result';
  tool_use_id: string;
  tool_name: string;
  success: boolean;
  output: string;
  meta?: Record<string, unknown>;
}

// Done — 流结束事件，携带最终的完整 ContentBlock 列表
export interface DoneEvent {
  type: 'done';
  content: ContentBlock[];
  cacheInfo?: CacheInfo;
}

// ErrorEvent — 错误事件
export interface ErrorEvent {
  type: 'error';
  message: string;
}

// StreamEvent — 流式事件的联合类型
export type StreamEvent =
  | TextDelta
  | ThinkingDelta
  | ToolUseEvent
  | ToolExecutingEvent
  | ToolResultEvent
  | DoneEvent
  | ErrorEvent;

// ===== Tool 定义引用 =====
// 从 tools 模块导入，避免循环依赖
import type { ToolDefinition } from '../tools/types.js';
import type { CacheInfo } from '../prompt/types.js';

// ===== Provider 抽象接口 =====

// Provider — 大模型供应商抽象接口
// 新增 Provider 只需实现此接口，无需修改 TUI 或配置层
export interface Provider {
  // 协议标识（对应配置中的 protocol 字段）
  readonly protocol: string;
  // 当前使用的模型名
  readonly model: string;

  // 发送消息并以异步生成器返回流式事件
  // signal 用于取消请求（AbortController）
  // tools 可选，传入工具定义让模型在回复中返回 tool_use
  streamChat(
    messages: Message[],
    signal?: AbortSignal,
    tools?: ToolDefinition[],
  ): AsyncGenerator<StreamEvent>;
}
