# MewCode 第六阶段 Checklist

## 实现完整性

- [ ] StdioTransport 正确启动子进程并收发消息（验证：mock 子进程 echo JSON，收到响应）
- [ ] HttpTransport 正确发送 POST 请求并解析响应（验证：mock HTTP Server，请求到达）
- [ ] MCPClient 按 id 配对响应（验证：连续发 3 个请求，乱序收到响应，各 Promise 正确 resolve）
- [ ] MCPSession 三步流程完成（验证：mock Server 实现 initialize → notified → tools/list）
- [ ] MCPToolAdapter 实现 Tool 接口（验证：execute 调用 session.callTool 并返回 ToolResult）
- [ ] MCPManager 并行初始化所有 Server（验证：2 个 mock Server 同时启动，总时间接近最慢的那个）
- [ ] 单个 Server 失败不影响其他（验证：1 个失败 + 1 个成功，成功的工具仍然可用）
- [ ] 内置工具优先于 MCP 同名工具（验证：内置 read_file 不被 MCP read_file 覆盖）
- [ ] 配置加载支持 env 变量展开（验证：${HOME} 被替换为实际值）

## 集成

- [ ] main.ts 启动时初始化 MCPManager（验证：启动日志显示 MCP Server 加载状态）
- [ ] MCP 工具在 ToolRegistry 中可见（验证：registry.getAll() 包含 MCP 工具）
- [ ] MCP 工具出现在传给 LLM 的 tools 列表中（验证：toAPIFormat() 包含 MCP 工具定义）
- [ ] 程序退出时正确关闭所有连接（验证：子进程被 kill）

## 编译与测试

- [ ] `npx tsc --noEmit` 无类型错误
- [ ] `npm test` 全部测试通过
- [ ] 原有所有测试不受影响

## 端到端场景

### E2E1: 配置 stdio MCP Server（对应 AC1）
1. 在 .mewcode.yaml 中配置一个 filesystem MCP Server
2. 启动 MewCode
3. 输入 "列出当前目录的文件"
4. Agent 调用 mcp/filesystem/list_directory 工具
5. **期望结果：** 工具被正确发现和调用

### E2E2: 内置工具不受影响（对应 AC3）
1. 配置的 MCP Server 有 read_file 工具
2. 输入 "读取 src/main.ts"
3. Agent 调用的是内置 read_file（非 MCP 版本）
4. **期望结果：** 内置工具优先

### E2E3: Server 启动失败不影响启动（对应 AC4）
1. 配置一个不存在的 command（如 /nonexistent/tool）
2. 启动 MewCode
3. 看到警告日志，但仍正常进入交互界面
4. 内置工具正常可用
5. **期望结果：** 单个 Server 失败不阻塞整体
