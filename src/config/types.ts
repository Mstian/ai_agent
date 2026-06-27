// ProviderConfig — 从 YAML 配置文件加载的 LLM 供应商配置
export interface ProviderConfig {
  // 协议类型：anthropic 或 openai
  protocol: 'anthropic' | 'openai' | 'deepseek';
  // 模型名称，如 claude-sonnet-4-6、gpt-4o
  model: string;
  // API 请求地址
  base_url: string;
  // 认证密钥
  api_key: string;
  // MCP Server 配置（可选）
  mcp_servers?: Record<string, import('../mcp/types.js').MCPServerConfig>;
}
