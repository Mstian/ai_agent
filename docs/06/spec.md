# MewCode 第六阶段 · MCP 客户端 Spec

## 背景

目前 MewCode 的工具都是内置的 6 个（read_file、write_file、edit_file、run_command、glob、grep）。如果需要更多工具——比如调用 GitHub API、操作数据库、访问文件系统——就必须修改 MewCode 源码。

MCP（Model Context Protocol）是标准化的大模型工具协议。市面上已有大量 MCP Server（如 filesystem、github、postgres、puppeteer 等）。实现 MCP 客户端后，MewCode 可以通过配置直接接入任意 MCP Server，工具数量从 6 个变成无限。

## 目标

- 实现一个 MCP 客户端，启动时自动发现并注册外部 MCP Server 提供的工具
- 通过标准化 JSON-RPC 2.0 协议与 MCP Server 通信
- 用适配层把远端工具包装成 Tool 接口，Agent 调用时完全无感

## 功能需求

### F1: 两种传输方式

- **stdio**：启动本地子进程，通过 stdin/stdout 管道收发 JSON-RPC 消息
- **Streamable HTTP**：通过 HTTP POST 请求收发 JSON-RPC 消息

两种传输实现同一个 Transport 接口，上层协议逻辑不感知传输差异。

### F2: JSON-RPC 2.0 协议

按 JSON-RPC 2.0 规范收发消息：

**请求格式：**
```json
{ "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {} }
```

**响应格式：**
```json
{ "jsonrpc": "2.0", "id": 1, "result": { "tools": [...] } }
```

**错误格式：**
```json
{ "jsonrpc": "2.0", "id": 1, "error": { "code": -32600, "message": "..." } }
```

- 请求带唯一 id（自增整数），响应按 id 关联回原请求
- 支持异步配对：发送多个请求后，响应可以乱序到达
- 通知（不带 id 的消息）不需要响应

### F3: 会话三步流程

与每个 MCP Server 的会话分三步：

1. **初始化握手（initialize）**
   - 客户端发送 `initialize` 请求，声明协议版本和能力（tools: {}）
   - 服务端返回协议版本和能力
   - 客户端发送 `notifications/initialized` 通知

2. **列出工具（tools/list）**
   - 客户端发送 `tools/list` 请求
   - 服务端返回工具列表，每个工具包含 name、description、inputSchema

3. **调用工具（tools/call）**
   - Agent 调用工具时，客户端发送 `tools/call` 请求
   - 服务端执行并返回结果（content 数组）

### F4: 工具适配层

MCP Server 返回的工具定义需要适配为 MewCode 的 Tool 接口：

- MCP 的 `name` → Tool 的 `name`（加 `mcp/<server_name>/` 前缀区分来源）
- MCP 的 `description` → Tool 的 `description`
- MCP 的 `inputSchema` → Tool 的 `parameters`
- 适配后的 execute 方法内部：构造 `tools/call` 请求 → 发给对应 Server → 转换响应为 ToolResult

Agent 调用工具时不需要知道它来自内置还是 MCP——都是 Tool 接口。

### F5: 连接生命周期管理

- 启动时按配置列表初始化所有 MCP Server
- 每个 Server 维护一个连接实例，复用直到退出
- 单个 Server 初始化失败不影响其他 Server（日志警告，继续启动）
- 程序退出时逐个关闭连接（发送关闭信号、终止子进程）

### F6: 配置管理

在 `.mewcode.yaml` 中增加 `mcp_servers` 字段：

```yaml
mcp_servers:
  filesystem:
    type: stdio
    command: npx
    args:
      - "@anthropic/mcp-server-filesystem"
      - "/allowed/path"
    env:
      NODE_ENV: production
      HOME: ${HOME}

  remote_tool:
    type: http
    url: https://example.com/mcp
    headers:
      Authorization: Bearer ${TOKEN}
```

- 支持用户级（`~/.mewcode.yaml`）和项目级（`.mewcode.yaml`）两层合并
- 项目级配置覆盖用户级同名 Server
- env 和 headers 的值支持 `${VAR}` 环境变量展开

### F7: 工具名冲突处理

- 内置工具和 MCP 工具同名时，MCP 工具跳过注册（内置优先）
- 多个 MCP Server 提供同名工具时，按配置顺序，后注册的覆盖先注册的
- 冲突发生时打印警告日志

## 非功能需求

### N1: 可靠性
- 单个 MCP Server 出错不影响其他 Server 和内置工具
- 子进程异常退出时，该 Server 的工具调用返回错误而不崩溃
- HTTP 请求失败时，返回结构化错误给模型

### N2: 性能
- 所有 MCP Server 并行初始化，不串行等待
- 连接复用：整个会话期间保持连接，不每次调用都重新握手

## 不做的事

- ❌ MCP 的资源（resources）、提示词（prompts）、采样（sampling）能力
- ❌ Server 健康检查和自动重连
- ❌ 动态加载/卸载 Server（启动后不增删）
- ❌ 工具列表热更新
- ❌ MCP Server 作为 MewCode 的插件市场

## 验收标准

- AC1: 配置 filesystem MCP Server 后，启动 MewCode 能看到 mcp/filesystem/read_file 等工具
- AC2: Agent 调用 mcp/filesystem/read_file 工具，能正确读取文件并返回内容
- AC3: 内置 read_file 工具不受 MCP 同名工具影响（内置优先）
- AC4: 配置中某个 Server 启动失败时，MewCode 正常启动，其他工具可用
- AC5: HTTP 类型 MCP Server 同样能正常列出和调用工具
- AC6: 工具调用失败时（Server 返回 error），模型收到错误信息而不崩溃
- AC7: 所有现有测试继续通过，类型检查零错误
