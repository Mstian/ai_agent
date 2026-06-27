/**
 * MCPToolAdapter — 将 MCP 工具定义包装为 MewCode Tool 接口
 */

import type { Tool, ToolResult, ToolExecuteContext, ToolParameters } from '../tools/types.js';
import type { MCPTool } from './types.js';
import type { MCPSession } from './session.js';

/** 根据工具名推断 category */
function inferCategory(name: string): 'readonly' | 'mutation' {
  const readonlyPrefixes = ['read', 'list', 'search', 'get', 'find', 'query', 'fetch', 'view', 'show'];
  const lower = name.toLowerCase();
  for (const prefix of readonlyPrefixes) {
    if (lower.startsWith(prefix) || lower.includes('_' + prefix) || lower.includes('-' + prefix)) {
      return 'readonly';
    }
  }
  return 'mutation';
}

export class MCPToolAdapter implements Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: ToolParameters;
  readonly category: 'readonly' | 'mutation';

  private serverName: string;
  private toolName: string;
  private session: MCPSession;

  constructor(serverName: string, mcpTool: MCPTool, session: MCPSession) {
    this.serverName = serverName;
    this.toolName = mcpTool.name;
    this.name = `mcp__${serverName}__${mcpTool.name}`;
    this.category = inferCategory(mcpTool.name);
    this.description = `[MCP:${serverName}] ${mcpTool.description}`;
    this.parameters = {
      type: 'object',
      properties: (mcpTool.inputSchema?.properties ?? {}) as Record<string, any>,
      required: mcpTool.inputSchema?.required,
    };
    this.session = session;
  }

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecuteContext,
  ): Promise<ToolResult> {
    try {
      const result = await this.session.callTool(this.toolName, input);

      if (result.isError) {
        const errText = result.content
          .map((c) => c.text)
          .join('\n');
        return { success: false, output: '', error: errText };
      }

      const output = result.content
        .map((c) => c.text)
        .join('\n');
      return { success: true, output };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: `MCP 工具调用失败: ${(err as Error).message}`,
      };
    }
  }
}
