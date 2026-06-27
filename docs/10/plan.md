# MewCode 第十阶段 Plan

## 架构概览

新增 `src/skills/` 模块，位于提示系统和工具系统之间：

```
启动时（Phase 1）:
  SkillLoader.scan() → SkillDef[]（仅 name + description）
    → PromptManager.active_skills 模块注入 Skill 列表

激活时（Phase 2）:
  用户 /commit 或 模型调用 skill_load 工具
    → SkillLoader.load(name) → 完整 SkillDef（含正文 + 工具白名单）
      → SkillManager.activate(skill)
        ├── 注入完整指令到 system prompt 前缀
        ├── 应用工具白名单（收窄可用工具）
        └── 注册为斜杠命令

卸载时:
  /skill unload <name> 或 /clear
    → SkillManager.deactivate(name)
      ├── 移除指令
      ├── 恢复工具列表
      └── 移除斜杠命令
```

## 核心数据结构

### SkillDef（Skill 定义）

```typescript
interface SkillDef {
  name: string;                    // 唯一标识 kebab-case
  description: string;             // 一句话说明
  tools?: string[];               // 工具白名单
  mode: 'shared' | 'isolated';    // 执行模式
  history?: number;               // isolated 模式携带历史数（默认 10）
  model?: string;                 // 指定模型
  body: string;                   // Markdown 正文（SOP 指令）
  source: 'builtin' | 'user' | 'project';  // 来源
}
```

### SkillFrontmatter（YAML 头部）

```typescript
interface SkillFrontmatter {
  name: string;
  description: string;
  tools?: string[];
  mode?: 'shared' | 'isolated';
  history?: number;
  model?: string;
}
```

### SkillLoadResult（激活结果）

```typescript
interface SkillLoadResult {
  skill: SkillDef;
  replacedParams: Record<string, string>;
  toolWhitelist: string[];
}
```

## 模块设计

### 模块 A: SkillLoader（skill_loader.ts）

**职责：** 三级目录扫描、YAML frontmatter 解析、按优先级加载、缓存。

```typescript
class SkillLoader {
  constructor(projectRoot: string);
  
  /** 扫描所有 Skill，只返回 name + description（阶段一） */
  listAll(): Pick<SkillDef, 'name' | 'description' | 'source'>[];
  
  /** 加载指定 Skill 的完整定义（阶段二） */
  load(name: string): SkillDef | null;
  
  /** 重新扫描（热更新） */
  reload(): void;
}
```

**内部逻辑：**
1. 扫描三级目录（内置 → 用户 → 项目），收集 `.md` 文件
2. 解析 YAML frontmatter（简单正则提取，不引入完整 YAML 解析器）
3. 解析失败的文件跳过 + stderr 警告
4. 同名按 source 优先级覆盖（project > user > builtin）
5. 正文中的 `{{param}}` 不做替换，留给调用方处理

### 模块 B: SkillManager（skill_manager.ts）

**职责：** 激活/卸载/查询 Skill，管理指令注入和工具白名单。

```typescript
class SkillManager {
  private activeSkills: Map<string, SkillDef>;
  
  /** 激活 Skill，返回加载结果 */
  activate(name: string, params?: Record<string, string>): SkillLoadResult;
  
  /** 卸载指定 Skill */
  deactivate(name: string): boolean;
  
  /** 清空所有已激活 Skill */
  clear(): void;
  
  /** 获取已激活 Skill 列表 */
  getActive(): SkillDef[];
  
  /** 获取当前有效工具白名单（合并所有激活 Skill 的 tools） */
  getToolWhitelist(): string[] | null;  // null = 无限制（全工具）
  
  /** 生成注入用的指令文本 */
  buildActivePrompt(): string;
}
```

### 模块 C: SkillLoadTool（skill_load_tool.ts）

**职责：** 实现 `skill_load` 工具，供模型调用。

```typescript
class SkillLoadTool implements Tool {
  name: 'skill_load';
  category: 'readonly';
  description: '激活指定 Skill，加载完整指令和工具约束';
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Skill 名称' },
      params: { type: 'object', description: '参数替换（可选）' },
    },
    required: ['name'],
  };
  
  execute(input, context): Promise<ToolResult>;
}
```

**系统级工具：** 此工具始终在可用工具列表中，不受白名单约束。

### 模块 D: SkillCommand（skill_command.ts）

**职责：** `/skill` 命令组（list / unload）和激活后自动注册的斜杠命令。

```typescript
// /skill list — 列出已激活 Skill
// /skill unload <name> — 卸载指定 Skill
// /skill ls — 列出所有可用 Skill（含未激活）

// 激活后自动注册：/<skill_name> → 快捷激活
```

每个已激活 Skill 自动注册一个 `/name` 斜杠命令，执行时注入 Skill prompt 到对话。

### 模块 E: builtins/ 内置 Skill

三个内置 Skill 文件：
- `src/skills/builtins/commit.md`
- `src/skills/builtins/review.md`
- `src/skills/builtins/test.md`

### 模块 F: Agent 集成

- Agent 每轮构造 toolDefs 时应用工具白名单
- `skill_load` 工具始终在 toolDefs 中
- `/clear` 时调用 SkillManager.clear()

### 模块 G: PromptManager 集成

- 启动时将 Skill 列表注入 `active_skills` 模块
- 每轮系统 prompt 前缀包含已激活 Skill 的完整指令

## 模块交互

```
启动流程:
  SkillLoader.scan() → SkillManager
    → listAll() → PromptManager.active_skills（阶段一列表）
  
  ToolRegistry.register(skillLoadTool)

激活流程（模型调用 skill_load）:
  skillLoadTool.execute(name: "commit")
    → SkillLoader.load("commit") → SkillDef
    → SkillManager.activate("commit")
      → 注册斜杠命令 /commit
      → 下一轮 LLM 调用时注入完整指令 + 应用白名单

卸载流程:
  /clear
    → Agent.clear()
    → SkillManager.clear()
    → 移除所有已激活斜杠命令
    → 恢复全工具列表
```

## 文件组织

```
mewcode/
├── src/
│   ├── skills/                    # 新建
│   │   ├── types.ts               # Skill 类型定义
│   │   ├── skill_loader.ts        # A: 三级扫描 + frontmatter 解析
│   │   ├── skill_manager.ts       # B: 激活/卸载/白名单管理
│   │   ├── skill_load_tool.ts     # C: skill_load 系统工具
│   │   ├── skill_command.ts       # D: /skill 命令组
│   │   ├── builtins/              # E: 内置 Skill 文件
│   │   │   ├── commit.md
│   │   │   ├── review.md
│   │   │   └── test.md
│   │   └── skills.test.ts         # 测试
│   ├── agent/
│   │   └── agent.ts               # 修改：工具白名单过滤 + skill_load 始终可用
│   ├── prompt/
│   │   └── manager.ts             # 修改：注入已激活 Skill 指令
│   ├── commands/
│   │   └── builtins.ts            # 修改：动态注册/移除 Skill 斜杠命令
│   └── main.ts                    # 修改：创建 Skill 组件 + 启动注入
```

## 技术决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| YAML 解析 | 简单正则行级解析 | 不引入 js-yaml 依赖，frontmatter 字段简单 |
| 三级覆盖 | 先扫后合并（Map + 后覆盖先） | 优先级语义清晰，O(n) 完成 |
| 工具白名单 | Agent.getToolDefs() 中 filter | 最小改动，不侵入 ToolRegistry |
| skill_load | 实现为 Tool 接口 | 复用现有工具执行链路，模型可直接调用 |
| 斜杠命令动态注册 | CommandRegistry 支持 unregister | 每激活一个 Skill 就注册一条命令 |
| isolated 模式 | 新建 ChatManager + 独立 Provider 调用 | 完全隔离，不影响主对话 |
| 指令注入位置 | system prompt 前缀（priority 0） | 最显眼位置，模型优先遵循 |
