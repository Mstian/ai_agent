# MewCode 第六阶段 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/mcp/types.ts` | MCP 协议类型 + Transport 接口 + 配置类型 |
| 新建 | `src/mcp/transport.ts` | StdioTransport + HttpTransport |
| 新建 | `src/mcp/client.ts` | MCPClient：JSON-RPC 消息配对 |
| 新建 | `src/mcp/session.ts` | MCPSession：initialize/list/call |
| 新建 | `src/mcp/adapter.ts` | MCPToolAdapter：MCP→Tool 适配 |
| 新建 | `src/mcp/manager.ts` | MCPManager：配置加载 + 并行初始化 + 注册 |
| 新建 | `src/mcp/mcp.test.ts` | MCP 层测试 |
| 修改 | `src/config/types.ts` | 加 MCPServerConfig 类型 |
| 修改 | `src/config/loader.ts` | 加载 mcp_servers 字段 |
| 修改 | `src/main.ts` | 创建 MCPManager，启动时初始化 |

## T1: MCP 类型定义

**文件：** `src/mcp/types.ts`
**依赖：** 无
**步骤：**
1. JsonRpcRequest/JsonRpcResponse/JsonRpcNotification 类型
2. Transport 接口：start/send/onMessage/close
3. MCPTool 类型：name、description、inputSchema
4. InitializeRequest/Response、ToolsListResult、ToolsCallRequest/Result
5. MCPServerConfig 类型：type + stdio/http 字段

**验证：** `npx tsc --noEmit` 通过

## T2: Transport 实现

**文件：** `src/mcp/transport.ts`
**依赖：** T1
**步骤：**
1. StdioTransport：child_process.spawn → stdin/stdout 管道
   - 按行分割 stdout → JSON.parse → onMessage handler
   - send：JSON.stringify + \n → stdin.write
   - env 变量 ${VAR} 展开
2. HttpTransport：fetch POST
   - send 直接返回 Promise<JsonRpcResponse>
   - headers 变量展开

**验证：** `npx tsc --noEmit` 通过

## T3: MCPClient 实现

**文件：** `src/mcp/client.ts`
**依赖：** T2
**步骤：**
1. request(method, params)：构造请求 → Promise + pending Map → transport.send
2. 响应处理：按 id 从 pending Map 取出 Promise → resolve/reject
3. notify(method, params)：发送不带 id 的消息
4. nextId 自增

**验证：** `npx tsc --noEmit` 通过

## T4: MCPSession 实现

**文件：** `src/mcp/session.ts`
**依赖：** T3
**步骤：**
1. static create(config)：三步流程
   a. transport.start()
   b. client.request('initialize', { protocolVersion, capabilities, clientInfo })
   c. client.notify('notifications/initialized', {})
   d. result = client.request('tools/list')
   e. 保存 tools 列表
2. getTools()：返回已发现的工具
3. callTool(name, args)：client.request('tools/call', {...})
4. 错误处理：初始化失败抛出异常供 Manager 捕获

**验证：** `npx tsc --noEmit` 通过

## T5: MCPToolAdapter 实现

**文件：** `src/mcp/adapter.ts`
**依赖：** T1、T4
**步骤：**
1. 实现 Tool 接口
2. name：`mcp/<server_name>/<tool_name>`
3. category 推断：read*/list*/search*/get*/find* → readonly，其余 → mutation
4. description：`[MCP: <server_name>] <original_description>`
5. execute：session.callTool → 转换 content[] 为 ToolResult
6. 错误转换：MCP error → ToolResult { success: false, error: ... }

**验证：** `npx tsc --noEmit` 通过

## T6: MCPManager 实现

**文件：** `src/mcp/manager.ts`
**依赖：** T4、T5
**步骤：**
1. 构造器接收 Record<string, MCPServerConfig>
2. initialize()：
   a. 并行创建所有 MCPSession（Promise.allSettled）
   b. 每个成功的 session → getTools() → 创建 MCPToolAdapter
   c. 注册到 ToolRegistry（同名时内置优先，MCP 间后注册覆盖）
   d. 失败的 session 打印警告
3. getRegisteredTools()：返回已注册的工具列表
4. shutdown()：逐个 close session

**验证：** `npx tsc --noEmit` 通过

## T7: 配置层扩展

**文件：** `src/config/types.ts`、`src/config/loader.ts`
**依赖：** T1
**步骤：**
1. types.ts：ProviderConfig 加 mcp_servers 可选字段
2. loader.ts：加载时校验 mcp_servers 字段
   - type 必填且为 stdio/http
   - stdio 需 command 字段
   - http 需 url 字段
   - env/headers 值做 ${VAR} 展开

**验证：** `npm test` 中配置测试通过

## T8: main.ts 接入

**文件：** `src/main.ts`
**依赖：** T6、T7
**步骤：**
1. 从配置中读取 mcp_servers
2. 创建 MCPManager(config.mcp_servers ?? {})
3. await manager.initialize()
4. 将 MCP 工具注册到 ToolRegistry
5. 启动时打印已加载的 MCP 工具摘要
6. 退出时调用 manager.shutdown()

**验证：** `npm run dev` 启动，MCP Server 工具被正确加载

## T9: MCP 层测试

**文件：** `src/mcp/mcp.test.ts`
**依赖：** T2-T6
**步骤：**
1. 用 mock 子进程测试 StdioTransport
2. MCPClient 请求/响应配对
3. MCPSession 三步流程
4. MCPToolAdapter 适配
5. MCPManager 并行初始化 + 冲突处理

**验证：** `npm test` 全部通过

## 执行顺序

```
T1 ──→ T2 ──→ T3 ──→ T4 ──→ T6 ──→ T8
                    │       │
                    └──→ T5 ─┘
                    │
              T7 ──→ T8 ──→ T9
```
