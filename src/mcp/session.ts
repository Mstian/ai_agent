/**
 * MCPSession — 封装与一个 MCP Server 的完整会话
 * initialize → notify initialized → tools/list → tools/call
 */

import { MCPClient } from './client.js';
import { StdioTransport, HttpTransport } from './transport.js';
import type { Transport } from './types.js';
import type { MCPTool, ToolsListResult, ToolsCallResult, MCPServerConfig } from './types.js';

export class MCPSession {
  private client: MCPClient;
  private transport: Transport;
  private tools: MCPTool[] = [];
  private config: MCPServerConfig;

  private constructor(
    client: MCPClient,
    transport: Transport,
    config: MCPServerConfig,
  ) {
    this.client = client;
    this.transport = transport;
    this.config = config;
  }

  static async create(config: MCPServerConfig): Promise<MCPSession> {
    const transport = MCPSession.createTransport(config);
    const client = new MCPClient(transport);
    const session = new MCPSession(client, transport, config);

    // 三步流程
    await session.initialize();

    return session;
  }

  private static createTransport(config: MCPServerConfig): Transport {
    if (config.type === 'stdio') {
      return new StdioTransport(
        config.command ?? '',
        config.args ?? [],
        config.env,
      );
    }
    return new HttpTransport(config.url ?? '', config.headers);
  }

  private async initialize(): Promise<void> {
    // 1. 启动 transport
    await this.client.start();

    // 2. 初始化握手
    await this.client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'MewCode', version: '0.1.0' },
    });

    // 3. 通知已初始化
    await this.client.notify('notifications/initialized');

    // 4. 列出工具
    const result = (await this.client.request('tools/list')) as ToolsListResult;
    this.tools = result?.tools ?? [];
  }

  getTools(): MCPTool[] {
    return this.tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolsCallResult> {
    const result = (await this.client.request('tools/call', {
      name,
      arguments: args,
    })) as ToolsCallResult;
    return result;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
