/**
 * 工具系统核心类型定义
 */

/** 工具参数属性的 JSON Schema */
export interface ToolParameterProperty {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
}

/** 工具参数 JSON Schema */
export interface ToolParameters {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
}

/** 工具定义 — 供注册和 LLM API 使用 */
export interface Tool {
  /** 工具唯一名称，如 read_file */
  name: string;
  /** 工具简短描述，帮助模型理解何时使用 */
  description: string;
  /** 参数 JSON Schema */
  parameters: ToolParameters;
  /** 工具分类：readonly 无副作用可并发，mutation 有副作用必须串行 */
  category: 'readonly' | 'mutation';
  /** 执行函数 */
  execute(
    input: Record<string, unknown>,
    context: ToolExecuteContext,
  ): Promise<ToolResult>;
}

/** 工具执行上下文 */
export interface ToolExecuteContext {
  /** 当前工作目录 */
  cwd: string;
  /** 超时时间（毫秒），默认 30000 */
  timeout: number;
  /** AbortSignal 用于取消 */
  signal?: AbortSignal;
}

/** 工具执行结果 */
export interface ToolResult {
  /** 是否成功 */
  success: boolean;
  /** 输出内容 */
  output: string;
  /** 错误信息（仅 success=false 时可能有值） */
  error?: string;
  /** 元数据（如命令的 exit code） */
  meta?: Record<string, unknown>;
}

/** 给 LLM 注册工具的定义格式（转换为 API 参数） */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: ToolParameters;
}

/** 工具执行异常 —— 用于结构化错误返回 */
export class ToolError extends Error {
  constructor(
    message: string,
    public readonly toolName: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}
