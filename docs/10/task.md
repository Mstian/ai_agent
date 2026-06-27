# MewCode 第十阶段 Tasks

## 文件清单

| 操作 | 文件 | 职责 |
|------|------|------|
| 新建 | `src/skills/types.ts` | Skill 类型定义 |
| 新建 | `src/skills/skill_loader.ts` | 三级扫描 + frontmatter 解析 + 优先级覆盖 |
| 新建 | `src/skills/skill_manager.ts` | 激活/卸载/白名单/指令生成 |
| 新建 | `src/skills/skill_load_tool.ts` | skill_load 系统工具 |
| 新建 | `src/skills/skill_command.ts` | /skill 命令组 + 动态斜杠命令 |
| 新建 | `src/skills/builtins/commit.md` | 内置 commit skill |
| 新建 | `src/skills/builtins/review.md` | 内置 review skill |
| 新建 | `src/skills/builtins/test.md` | 内置 test skill |
| 新建 | `src/skills/skills.test.ts` | 测试 |
| 修改 | `src/agent/agent.ts` | 工具白名单过滤 |
| 修改 | `src/prompt/manager.ts` | 注入已激活 Skill 指令 |
| 修改 | `src/commands/builtins.ts` | 动态注册 Skill 斜杠命令 |
| 修改 | `src/main.ts` | 创建 Skill 组件 + 启动注入 |

## T1: Skill 类型定义

**文件：** `src/skills/types.ts`
**步骤：**
1. `SkillFrontmatter` 接口（name, description, tools?, mode?, history?, model?）
2. `SkillDef` 接口（含 body, source）
3. `SkillLoadResult` 接口

**验证：** `npx tsc --noEmit` 通过

## T2: SkillLoader 实现

**文件：** `src/skills/skill_loader.ts`
**步骤：**
1. 三级目录扫描（内置 `src/skills/builtins/`、用户 `~/.mewcode/skills/`、项目 `.mewcode/skills/`）
2. YAML frontmatter 解析（正则行级提取）
3. 同名按 source 优先级覆盖（project > user > builtin）
4. 解析失败跳过 + 警告
5. `listAll()` 返回 name + description（阶段一）
6. `load(name)` 返回完整 SkillDef（阶段二）

**验证：** `npx tsc --noEmit` 通过；创建测试 Skill 文件验证扫描和覆盖

## T3: SkillManager 实现

**文件：** `src/skills/skill_manager.ts`
**步骤：**
1. `activate(name, params?)` — 加载 Skill，替换 {{param}}，加入 activeSkills
2. `deactivate(name)` — 从 activeSkills 移除
3. `clear()` — 清空所有已激活
4. `getActive()` — 返回已激活列表
5. `getToolWhitelist()` — 合并所有激活 Skill 的 tools 白名单
6. `buildActivePrompt()` — 生成注入用的完整指令文本

**验证：** `npx tsc --noEmit` 通过

## T4: skill_load 工具

**文件：** `src/skills/skill_load_tool.ts`
**步骤：**
1. 实现 Tool 接口，name = 'skill_load'，category = 'readonly'
2. execute 中调用 SkillManager.activate()
3. 返回加载结果（Skill 名称、指令预览、工具白名单）
4. 标记为系统级工具（不受白名单约束）

**验证：** `npx tsc --noEmit` 通过

## T5: /skill 命令 + 动态斜杠命令

**文件：** `src/skills/skill_command.ts`
**步骤：**
1. `/skill list` — 列出已激活 Skill
2. `/skill ls` — 列出所有可用 Skill（含未激活）
3. `/skill unload <name>` — 卸载指定 Skill
4. `registerSkillCommand(name)` — 激活后自动注册 /<name> 命令
5. `unregisterSkillCommand(name)` — 卸载时移除
6. `unregisterAllSkillCommands()` — /clear 时全部移除

**验证：** `npx tsc --noEmit` 通过

## T6: 内置 Skill 文件

**文件：** `src/skills/builtins/commit.md`、`review.md`、`test.md`
**步骤：**
1. commit.md — git diff 分析 + 规范 commit message 生成
2. review.md — 代码审查（正确性/安全/性能/可读性）
3. test.md — 为当前变更生成测试
4. 每个文件含完整 YAML frontmatter + Markdown 正文

**验证：** SkillLoader 能正确解析三个文件

## T7: Agent 集成

**文件：** `src/agent/agent.ts`
**步骤：**
1. 注入 SkillManager 引用
2. `getToolDefs()` 中应用白名单过滤
3. `skill_load` 始终在 toolDefs 中
4. `/clear` 时调用 SkillManager.clear()

**验证：** 原有 agent 测试通过

## T8: PromptManager 集成

**文件：** `src/prompt/manager.ts`
**步骤：**
1. `getSystemPrompt()` 中注入已激活 Skill 指令（priority 0 位置）
2. 阶段一 Skill 列表注入 `active_skills` 模块

**验证：** system prompt 包含已激活 Skill 指令

## T9: Commands 集成

**文件：** `src/commands/builtins.ts`
**步骤：**
1. 暴露 `registerCommand()` 和 `unregisterCommand()` 方法
2. Skill 激活时动态注册斜杠命令

**验证：** Skill 激活后 `/commit` 可用

## T10: main.ts 接入

**文件：** `src/main.ts`
**步骤：**
1. 创建 SkillLoader + SkillManager
2. 创建 skill_load 工具注册到 ToolRegistry
3. 注册 /skill 命令组
4. 启动时将 Skill 列表注入 PromptManager
5. 将 SkillManager 注入 Agent

**验证：** `npm run dev` 启动，system prompt 含 Skill 列表

## T11: 测试

**文件：** `src/skills/skills.test.ts`
**步骤：**
1. SkillLoader 三级扫描 + 优先级覆盖 + 解析失败跳过
2. SkillManager 激活/卸载/白名单合并/指令生成
3. skill_load 工具执行
4. 内置 Skill 文件解析

**验证：** `npm test` 全部通过

## 执行顺序

```
T1 ──→ T2 ──→ T3 ──→ T4 ──→ T7 ──→ T10
  │                  │
  └──→ T6 ──────────→│
                      │
              T5 ──→ T9 ──→ T10
                      │
              T8 ──→ T10
                      │
                      └──→ T11
```

T2、T6 可并行；T5、T8 独立；T3 依赖 T2；T4 依赖 T3；T7、T9 依赖 T3-T5；T10 依赖 T7、T8、T9；T11 最后。
