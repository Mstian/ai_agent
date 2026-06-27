# MewCode 第十阶段 Checklist

> 每一项通过运行代码或观察行为来验证。

## 实现完整性

- [ ] SkillLoader 三级扫描（验证：三级目录都有 Skill 文件时，listAll() 返回合并后的列表）
- [ ] 同名 Skill 优先级覆盖（验证：项目级 commit.md 覆盖内置 commit.md）
- [ ] 解析失败的 Skill 文件跳过不阻断（验证：一个坏 frontmatter 文件不影响其他 Skill 加载）
- [ ] SkillManager 激活 Skill（验证：activate("commit") 后 getActive() 包含 commit）
- [ ] 参数替换（验证：正文中 {{branch}} 替换为传入的 params.branch）
- [ ] 工具白名单合并（验证：激活两个 Skill，白名单取并集）
- [ ] 白名单中不存在工具报错（验证：Skill 声明 tools: [nonexistent]，启动时报错）
- [ ] skill_load 工具可被模型调用（验证：Agent 能通过 tool_use 调用 skill_load）
- [ ] skill_load 始终在工具列表中（验证：白名单激活后 skill_load 仍可用）
- [ ] /skill list 列出已激活 Skill
- [ ] /skill unload <name> 卸载单个 Skill
- [ ] Skill 激活后自动注册 /<name> 斜杠命令
- [ ] /clear 清空所有已激活 Skill
- [ ] 内置三个 Skill 文件存在且格式正确

## 集成

- [ ] 启动时 system prompt 包含 Skill 名称和描述列表（阶段一）
- [ ] 激活 commit 后 system prompt 包含完整 commit 指令
- [ ] 工具白名单生效：激活 commit 后模型只看到白名单中的工具 + skill_load
- [ ] 多个 Skill 同时激活时互相不覆盖
- [ ] Agent 在每轮重建 toolDefs 时应用白名单过滤

## 编译与测试

- [ ] `npx tsc --noEmit` 无类型错误
- [ ] `npm test` 全部测试通过
- [ ] 原有测试不受影响

## 端到端场景

### E2E1: 模型调用 skill_load（对应 AC2, AC3, AC4）
1. 启动 MewCode，观察 system prompt 包含 Skill 列表
2. 输入"帮我写 commit message"
3. 观察模型调用 skill_load("commit")
4. 观察下一轮 system prompt 包含完整 commit 指令
5. 观察可用工具被收窄为白名单中的工具
6. 输入 /commit 也能直接激活

### E2E2: 项目级 Skill 覆盖内置（对应 AC5）
1. 在 .mewcode/skills/ 创建 review.md，自定义审查规则
2. 启动 MewCode，激活 review Skill
3. 观察加载的是项目级 review 内容

### E2E3: /clear 清理 Skill（对应 AC7）
1. 激活 commit 和 review 两个 Skill
2. 输入 /clear
3. 观察所有 Skill 被卸载
4. 观察工具列表恢复完整
5. 观察斜杠命令 /commit 和 /review 不再可用
