/**
 * MCP 协议类型定义
 */

// ===== JSON-RPC 2.0 =====

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// ===== Transport =====

export interface Transport {
  start(): Promise<void>;
  send(message: JsonRpcMessage): Promise<void>;
  onMessage(handler: (msg: JsonRpcMessage) => void): void;
  close(): Promise<void>;
}

// ===== MCP 协议 =====

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolsListResult {
  tools: MCPTool[];
}

export interface ToolsCallResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

// ===== 配置 =====

export interface MCPServerConfig {
  type: 'stdio' | 'http';
  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // http
  url?: string;
  headers?: Record<string, string>;
}
