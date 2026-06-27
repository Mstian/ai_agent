# MewCode 第四阶段 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/prompt/types.ts` | PromptModule、ModuleKey、InjectionContext、SystemMessage、CacheInfo |
| 新建 | `src/prompt/modules.ts` | 7 个固定模块 + 可选模块的默认内容 |
| 新建 | `src/prompt/builder.ts` | PromptBuilder：注册、启用/禁用、按优先级拼装 |
| 新建 | `src/prompt/manager.ts` | PromptManager：模板替换、system 消息注入、轮次控制 |
| 新建 | `src/prompt/cache_monitor.ts` | CacheMonitor：解析 Anthropic usage 缓存字段 |
| 新建 | `src/prompt/prompt.test.ts` | 提示系统单元测试 |
| 修改 | `src/provider/types.ts` | DoneEvent 加 cacheInfo 可选字段 |
| 修改 | `src/provider/anthropic.ts` | message_start 解析 usage → 收集缓存信息 → done 携带 |
| 修改 | `src/agent/types.ts` | TurnEndEvent / AgentDoneEvent 加 cacheInfo |
| 修改 | `src/agent/agent.ts` | 集成 PromptManager：每轮注入 system 消息、收集缓存 |
| 修改 | `src/tools/read_file.ts` | description 强化（说明适用场景） |
| 修改 | `src/tools/edit_file.ts` | description 强化（使用前必先读） |
| 修改 | `src/tools/write_file.ts` | description 强化（存在时先读） |
| 修改 | `src/tools/run_command.ts` | description 强化（优先用专用工具） |
| 修改 | `src/tools/glob.ts` | description 强化（说明比 find 更合适） |
| 修改 | `src/tools/grep.ts` | description 强化（说明比 grep 命令更合适） |
| 修改 | `src/main.ts` | 创建 PromptManager，注入 Agent；显示缓存信息 |

## T1: 提示系统类型定义

**文件：** `src/prompt/types.ts`
**依赖：** 无
**步骤：**
1. 定义 ModuleKey 联合类型（10 个 key）
2. 定义 PromptModule 接口：key、priority、content、enabled
3. 定义 InjectionContext 接口：mode、cwd、gitBranch?、date
4. 定义 SystemMessage 接口：role: 'system'、content
5. 定义 CacheInfo 接口：cacheCreationTokens、cacheReadTokens、inputTokens

**验证：** `npx tsc --noEmit` 通过

## T2: 固定模块内容定义

**文件：** `src/prompt/modules.ts`
**依赖：** T1
**步骤：**
1. 定义 identity 模块（priority=1）
2. 定义 constraints 模块（priority=2，含 {{cwd}} 模板变量）
3. 定义 task_mode 模块（priority=3，含 {{mode_label}} 和 {{mode_rules}}）
4. 定义 actions 模块（priority=4）
5. 定义 tool_use 模块（priority=5，含关键规则）
6. 定义 tone 模块（priority=6）
7. 定义 output 模块（priority=7）
8. 定义 custom_instructions / active_skills / long_term_memory 可选模块（默认 disabled）
9. mode_rules 为 plan 和 full 两种模式的规则文本
10. 导出 getDefaultModules(): PromptModule[] 函数

**验证：** `npx tsc --noEmit` 通过

## T3: PromptBuilder 实现

**文件：** `src/prompt/builder.ts`
**依赖：** T1
**步骤：**
1. 实现 PromptBuilder 类
2. register(module)：存入内部 Map<ModuleKey, PromptModule>
3. enable/disable(key)：切换模块启用状态
4. build(variables?)：过滤 enabled → 按 priority 升序 → content 用 \n\n 拼接 → 模板替换 {{key}}
5. getModule(key)：获取单个模块，供 PromptManager 动态修改

**验证：** `npx tsc --noEmit` 通过

## T4: PromptManager 实现

**文件：** `src/prompt/manager.ts`
**依赖：** T2、T3
**步骤：**
1. 实现 PromptManager 类
2. constructor()：创建 PromptBuilder + 注册 7 个默认模块
3. getSystemPrompt(variables?)：委托 builder.build(variables)
4. updateModule(key, content)：更新模块内容（用于 mode 切换）
5. generateSystemMessages(turn, context)：按轮次频率控制生成 system 消息数组
   - turn=1：环境信息 + mode 完整规则
   - turn % 3 === 0：mode 完整规则
   - 其余：plan mode 时一行精简提醒
6. system 消息格式：[SystemInstruction]\ntype: xxx\n---\ncontent
7. enableModule/disableModule 透传

**验证：** `npx tsc --noEmit` 通过

## T5: CacheMonitor 实现

**文件：** `src/prompt/cache_monitor.ts`
**依赖：** T1
**步骤：**
1. 实现 CacheMonitor 类（静态方法）
2. extractFromUsage(usage: Record<string, unknown>): CacheInfo
   - 提取 cache_creation_input_tokens → cacheCreationTokens
   - 提取 cache_read_input_tokens → cacheReadTokens
   - 提取 input_tokens → inputTokens
3. hitRate(info: CacheInfo): number — 计算缓存命中率

**验证：** `npx tsc --noEmit` 通过

## T6: Provider 层缓存字段支持

**文件：** `src/provider/types.ts`、`src/provider/anthropic.ts`
**依赖：** T1
**步骤：**
1. types.ts：DoneEvent 增加 cacheInfo?: CacheInfo 字段
2. anthropic.ts：在类中新增 cacheInfo 成员变量
3. message_start 事件处理：提取 eventData.message.usage → 调用 CacheMonitor.extractFromUsage → 存入 cacheInfo
4. message_delta 事件处理：更新 usage 信息
5. done 事件 yield 时携带 cacheInfo

**验证：** `npx tsc --noEmit` 通过；`npm test` 中原有 AnthropicProvider 测试通过

## T7: Agent 集成 PromptManager

**文件：** `src/agent/types.ts`、`src/agent/agent.ts`
**依赖：** T4、T6
**步骤：**
1. types.ts：TurnEndEvent 和 AgentDoneEvent 增加 cacheInfo?: CacheInfo
2. agent.ts：
   a. constructor 增加 promptManager 参数
   b. 移除硬编码的 SYSTEM_PROMPT 依赖（改为从 promptManager 获取）
   c. run() 每轮 LLM 调用前：
      - 构造 InjectionContext
      - promptManager.generateSystemMessages(turn, context)
      - 将返回的 system 消息注入 chatManager（新增 injectSystemMessage 方法或直接操作 messages）
   d. 收到 done 事件时提取 cacheInfo → 附加到 turn_end / agent_done
   e. setMode() 增加：调用 promptManager.updateModule('task_mode', ...)
3. ChatManager 新增 injectSystemMessages(msgs: SystemMessage[]) 方法：
   - 将 system 消息插入到 messages 数组末尾（在 LLM 调用前）

**验证：** `npx tsc --noEmit` 通过；`npm test` 中 Agent 相关测试通过

## T8: 工具描述强化

**文件：** `src/tools/edit_file.ts`、`write_file.ts`、`run_command.ts`、`glob.ts`、`grep.ts`、`read_file.ts`
**依赖：** 无
**步骤：**
1. edit_file.ts：description 开头加"**使用前必须先 read_file 查看文件当前内容**。"
2. write_file.ts：description 加"**如果目标是已有文件，先 read_file 确认内容**。"
3. run_command.ts：description 加"**优先使用 glob/grep/read_file 等专用工具**。仅在没有专用工具或需要执行构建/测试等命令时使用。"
4. read_file.ts：description 加"在编辑文件前使用此工具查看文件内容。"
5. glob.ts：description 加"比 find 命令更快更安全，优先使用。"
6. grep.ts：description 加"比 grep 命令更安全，自动忽略 node_modules 等目录。"

**验证：** `npm test` 中原有工具测试通过

## T9: main.ts 接入

**文件：** `src/main.ts`
**依赖：** T7
**步骤：**
1. 创建 PromptManager 实例
2. 传入 Agent constructor
3. 移除 main.ts 中的 SYSTEM_PROMPT 常量
4. agent_done 事件处理：如有 cacheInfo，显示缓存信息
   - 如 `<缓存: 命中率 85% · 节省 12000 tokens>`
5. /plan 和 /do 命令的提示信息改为由 PromptManager 管理

**验证：** `npm run dev` 启动，system prompt 正常，/plan /do 切换正常

## T10: 提示系统测试

**文件：** `src/prompt/prompt.test.ts`
**依赖：** T2-T5
**步骤：**
1. PromptBuilder 测试：注册/启用/禁用/拼装顺序/模板替换
2. PromptManager 测试：
   - getSystemPrompt 返回正确拼装结果
   - updateModule 后拼装结果更新
   - generateSystemMessages turn=1 返回完整消息
   - generateSystemMessages turn=4 返回完整消息（每 3 轮）
   - generateSystemMessages turn=2 返回精简提醒（plan mode）
   - generateSystemMessages turn=2 full mode 不返回额外消息
3. CacheMonitor 测试：从 mock usage 对象提取字段

**验证：** `npm test` 中提示系统测试通过

## 执行顺序

```
T1 ──→ T2 ──→ T3 ──→ T4 ──→ T7 ──→ T9
  │                 └──→ T5 ──→ T6 ──┘  │
  │                                      │
  └──→ T8 ──────────────────────────────→ T10
```

T1 是基础。T2-T5 依赖 T1。T4+T6 → T7。T7+T8 → T9。T10 在所有组件完成后。

T8（工具描述强化）可与其他任务完全并行。
