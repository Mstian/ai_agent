/**
 * MCP 层单元测试
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MCPToolAdapter } from './adapter.js';
import { MCPManager } from './manager.js';
import { ToolRegistry } from '../tools/registry.js';
import { StdioTransport } from './transport.js';

describe('StdioTransport', () => {
  it('基本创建不报错', () => {
    const t = new StdioTransport('echo', ['hello']);
    assert.ok(t);
  });

  it('env 变量展开', () => {
    process.env.TEST_VAR = 'test_value';
    const t = new StdioTransport('cmd', [], { FOO: '${TEST_VAR}' });
    // env 在 start() 时才展开，这里只验证创建不报错
    assert.ok(t);
    delete process.env.TEST_VAR;
  });
});

describe('MCPToolAdapter', () => {
  it('name 格式为 mcp__<server>__<tool>', () => {
    const session = {} as any;
    const adapter = new MCPToolAdapter('filesystem', {
      name: 'read_file',
      description: 'Read a file',
      inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'File path' } } },
    }, session);

    assert.strictEqual(adapter.name, 'mcp__filesystem__read_file');
    assert.strictEqual(adapter.category, 'readonly');
    assert.ok(adapter.description.includes('[MCP:filesystem]'));
  });

  it('mutation 工具推断为 mutation category', () => {
    const session = {} as any;
    const adapter = new MCPToolAdapter('db', {
      name: 'insert_record',
      description: 'Insert a record',
      inputSchema: { type: 'object', properties: {} },
    }, session);

    assert.strictEqual(adapter.category, 'mutation');
  });

  it('list_ 前缀推断为 readonly', () => {
    const session = {} as any;
    const adapter = new MCPToolAdapter('github', {
      name: 'list_repos',
      description: 'List repos',
      inputSchema: { type: 'object', properties: {} },
    }, session);
    assert.strictEqual(adapter.category, 'readonly');
  });

  it('search_ 前缀推断为 readonly', () => {
    const session = {} as any;
    const adapter = new MCPToolAdapter('db', {
      name: 'search_records',
      description: 'Search records',
      inputSchema: { type: 'object', properties: {} },
    }, session);
    assert.strictEqual(adapter.category, 'readonly');
  });
});

describe('MCPManager', () => {
  it('无配置时不报错', async () => {
    const registry = new ToolRegistry();
    const manager = new MCPManager({});
    await manager.initialize(registry);
    // 不抛异常即通过
  });
});
