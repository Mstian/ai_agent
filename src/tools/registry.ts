/**
 * ToolRegistry — 工具注册中心
 * 集中登记工具，按名查找，转成 API 工具列表格式
 */

import type { Tool, ToolDefinition } from './types.js';

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  /** 注册一个工具，重名会抛出错误 */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`工具 "${tool.name}" 已注册，不能重复注册`);
    }
    this.tools.set(tool.name, tool);
  }

  /** 按名称查找工具 */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** 获取所有已注册工具 */
  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /** 转换为 API 所需的工具列表格式 */
  toAPIFormat(): ToolDefinition[] {
    return this.getAll().map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }
}
