# MewCode 第六阶段 Plan

## 架构概览

新增 MCP 客户端层，位于工具系统和配置系统之间：

```
main.ts
  │
  ├── config/loader.ts (修改：加载 mcp_servers 字段)
  │
  ├── mcp/ (新增)
  │   ├── types.ts          — MCP 协议类型
  │   ├── transport.ts      — Transport 接口 + StdioTransport + HttpTransport
  │   ├── client.ts         — MCPClient：JSON-RPC 消息收发 + 请求/响应配对
  │   ├── session.ts        — MCPSession：initialize → list → call 三步流程
  │   ├── adapter.ts        — MCPToolAdapter：MCP 工具 → Tool 接口
  │   ├── manager.ts        — MCPManager：加载配置 → 并行初始化 → 注册到 ToolRegistry
  │   └── mcp.test.ts       — MCP 层测试
  │
  └── tools/registry.ts     (不变：ToolRegistry 已支持 register)
```

## 核心数据结构

### Transport 接口

```typescript
interface Transport {
  start(): Promise<void>;        // 建立连接
  send(message: JsonRpcMessage): Promise<void>;  // 发送消息
  onMessage(handler: (msg: JsonRpcMessage) => void): void;  // 接收消息
  close(): Promise<void>;        // 关闭连接
}
```

### JsonRpcMessage

```typescript
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}
```

### MCP 协议级别类型

```typescript
// initialize 请求
interface InitializeRequest extends JsonRpcRequest {
  method: 'initialize';
  params: {
    protocolVersion: string;
    capabilities: { tools: {} };
    clientInfo: { name: string; version: string };
  };
}

// tools/list 响应
interface ToolsListResult {
  tools: MCPTool[];
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// tools/call 请求 & 响应
interface ToolsCallRequest extends JsonRpcRequest {
  method: 'tools/call';
  params: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface ToolsCallResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}
```

### 配置类型

```typescript
interface MCPServerConfig {
  type: 'stdio' | 'http';
  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // http
  url?: string;
  headers?: Record<string, string>;
}
```

## 模块设计

### 模块 V: Transport（transport.ts）

**StdioTransport：**
- `start()`: 用 `child_process.spawn(command, args)` 启动子进程
- `send(message)`: 序列化 JSON + `\n` → `process.stdin.write()`
- `onMessage(handler)`: 监听 `process.stdout` 的 data 事件，按行分割 → JSON.parse → 调 handler
- `close()`: 子进程 stdin.end() → setTimeout → kill

**HttpTransport：**
- `start()`: 无需操作（无状态 HTTP）
- `send(message)`: `fetch(url, { method: 'POST', body: JSON.stringify(message), headers })`
- `onMessage(handler)`: 不适用——HTTP 是请求-响应模型，在 send 中直接返回响应更合理
- `close()`: 无需操作

**设计决策：** HTTP Transport 不走事件回调模型。改为 `send()` 方法返回 `Promise<JsonRpcMessage>`，直接等 HTTP 响应。

### 模块 W: MCPClient（client.ts）

**职责：** JSON-RPC 消息层的收发和请求/响应配对。

```typescript
class MCPClient {
  private nextId = 1;
  private pending: Map<number, { resolve, reject }>;
  private transport: Transport;

  // 发送请求，返回 Promise 等待对应 id 的响应
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;

  // 发送通知（不需要响应）
  notify(method: string, params?: Record<string, unknown>): void;

  close(): Promise<void>;
}
```

**request() 实现：**
1. 构造 JsonRpcRequest（id = nextId++）
2. 创建 Promise，存入 pending Map（key = id）
3. transport.send(request)
4. 等待 pending Promise resolve
5. transport 收到响应 → 按 id 找到 pending条目 → resolve/reject

### 模块 X: MCPSession（session.ts）

**职责：** 封装与一个 MCP Server 的完整会话。

```typescript
class MCPSession {
  private client: MCPClient;
  private tools: MCPTool[];

  static async create(config: MCPServerConfig): Promise<MCPSession>;
  // 内部执行三步流程：
  // 1. transport.start()
  // 2. client.request('initialize', {...})
  // 3. client.notify('notifications/initialized')
  // 4. result = client.request('tools/list')
  // 5. this.tools = result.tools

  getTools(): MCPTool[];

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolsCallResult>;
  // 内部：client.request('tools/call', { name, arguments: args })

  close(): Promise<void>;
}
```

### 模块 Y: MCPToolAdapter（adapter.ts）

**职责：** 将 MCP 工具定义包装为 MewCode Tool 接口。

```typescript
class MCPToolAdapter implements Tool {
  name: string;        // "mcp/<server_name>/<tool_name>"
  category: 'readonly' | 'mutation';
  description: string;
  parameters: ToolParameters;

  constructor(serverName: string, mcpTool: MCPTool, session: MCPSession);

  async execute(input: Record<string, unknown>, context: ToolExecuteContext): Promise<ToolResult>;
  // 内部：session.callTool(mcpTool.name, input) → 转换响应为 ToolResult
}
```

**category 推断：** MCP 工具不声明副作用。默认所有 MCP 工具 category = 'mutation'（保守安全），除非工具名匹配已知只读模式（如 read*、list*、search*、get*、find*）。

### 模块 Z: MCPManager（manager.ts）

**职责：** 加载配置 → 并行初始化 → 注册工具。

```typescript
class MCPManager {
  private sessions: Map<string, MCPSession>;

  constructor(configs: Record<string, MCPServerConfig>);

  async initialize(): Promise<void>;
  // 1. 并行创建所有 MCPSession
  // 2. 每个 session.getTools()
  // 3. 每个 MCP 工具 → new MCPToolAdapter()
  // 4. 注册到 ToolRegistry（冲突时跳过/覆盖）
  // 5. 失败的 session 不影响整体

  getRegisteredTools(): Tool[];

  async shutdown(): Promise<void>;
}
```

### 配置层扩展

ConfigLoader 增加 `mcp_servers` 字段加载和校验：
- 必填字段：`type`
- stdio 必填：`command`
- http 必填：`url`
- env 和 headers 值做 `${VAR}` 展开

## 文件组织

```
mewcode/
├── src/
│   ├── mcp/                    # 新建
│   │   ├── types.ts            # MCP 协议类型 + 配置类型
│   │   ├── transport.ts        # StdioTransport + HttpTransport
│   │   ├── client.ts           # MCPClient：JSON-RPC 配对
│   │   ├── session.ts          # MCPSession：init/list/call
│   │   ├── adapter.ts          # MCPToolAdapter：MCP 工具 → Tool
│   │   ├── manager.ts          # MCPManager：配置加载 + 并行初始化
│   │   └── mcp.test.ts         # MCP 层测试
│   ├── config/
│   │   ├── types.ts            # 修改：加 MCPServerConfig 类型
│   │   └── loader.ts           # 修改：加载 mcp_servers 字段
│   └── main.ts                 # 修改：创建 MCPManager，启动时初始化
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| JSON-RPC 配对 | Promise + Map<id> | 简单可靠，支持乱序响应 |
| HTTP Transport 模式 | 请求-响应（非事件） | HTTP 天然是 request-response，不需要模拟流 |
| MCP 工具名 | mcp/<server>/<tool> | 区分来源，避免重名 |
| 并行初始化 | Promise.allSettled | 单个失败不影响其他 |
| category 推断 | 工具名模式匹配 | MCP 不声明副作用，只能靠命名约定推断 |
| 内置 vs MCP 冲突 | 内置优先 | 核心工具不可被覆盖 |
| ${VAR} 展开 | 简单正则替换 | 不需要模板引擎 |