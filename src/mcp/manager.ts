/**
 * MCPManager — 加载配置 → 并行初始化 → 注册工具到 ToolRegistry
 */

import type { MCPServerConfig } from './types.js';
import { MCPSession } from './session.js';
import { MCPToolAdapter } from './adapter.js';
import type { ToolRegistry } from '../tools/registry.js';

export class MCPManager {
  private configs: Record<string, MCPServerConfig>;
  private sessions: Map<string, MCPSession> = new Map();
  private initialized = false;

  constructor(configs: Record<string, MCPServerConfig>) {
    this.configs = configs;
  }

  /** 并行初始化所有 Server，注册工具到 ToolRegistry */
  async initialize(registry: ToolRegistry): Promise<void> {
    if (this.initialized) return;

    const entries = Object.entries(this.configs);
    if (entries.length === 0) {
      process.stderr.write(`[MCP] 未配置 MCP Server\n`);
      this.initialized = true;
      return;
    }

    const results = await Promise.allSettled(
      entries.map(async ([name, config]) => {
        const session = await MCPSession.create(config);
        this.sessions.set(name, session);
        return { name, session };
      }),
    );

    let totalTools = 0;

    for (const result of results) {
      if (result.status === 'rejected') {
        process.stderr.write(`[MCP] Server 初始化失败: ${(result.reason as Error).message}\n`);
        continue;
      }

      const { name, session } = result.value;
      const tools = session.getTools();
      process.stderr.write(`[MCP] ${name}: 发现 ${tools.length} 个工具\n`);

      for (const mcpTool of tools) {
        const adapter = new MCPToolAdapter(name, mcpTool, session);

        // 内置工具优先，MCP 之间后注册覆盖
        const existing = registry.get(adapter.name);
        if (existing) {
          process.stderr.write(`[MCP] 工具 "${adapter.name}" 已存在，跳过（内置或先注册的 Server 优先）\n`);
          continue;
        }

        try {
          registry.register(adapter);
          totalTools++;
        } catch (err) {
          process.stderr.write(`[MCP] 注册工具 "${adapter.name}" 失败: ${(err as Error).message}\n`);
        }
      }
    }

    process.stderr.write(`[MCP] 已加载 ${totalTools} 个 MCP 工具（${this.sessions.size} 个 Server）\n`);
    this.initialized = true;
  }

  /** 关闭所有连接 */
  async shutdown(): Promise<void> {
    for (const [name, session] of this.sessions) {
      try {
        await session.close();
      } catch {
        // 静默关闭
      }
    }
    this.sessions.clear();
    this.initialized = false;
  }
}
