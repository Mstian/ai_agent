# MewCode 第十三阶段 · Worktree 文件隔离 Spec

## 背景

当前子 Agent 和主 Agent 共享同一个工作目录（`process.cwd()`）。当多个子 Agent 并行执行且都要写文件时，文件冲突、互相覆盖是必然的。主 Agent 改着源码，子 Agent 也在改同一个文件——灾难。

需要给子 Agent 提供独立的文件系统沙箱：基于 Git worktree，每个子 Agent 在自己的目录里操作，改完由上层决定是否合并回主分支。

## 目标

- 基于 `git worktree` 为子 Agent 创建隔离的工作目录
- 显式 cwd 传参（不 chdir），所有工具调用、缓存 key 天然按目录隔离
- 角色 frontmatter 声明 `isolation: worktree` 即可启用
- 退出时变更保护，防止误删有未提交修改的 worktree

## 功能需求

### F1: Git Worktree 管理

**创建：**
- 目录位置：`.mewcode/worktrees/<safe-name>/`
- 分支名：`mewcode/worktree-<taskId>`（不会被误认为功能分支）
- 基于当前 HEAD 创建新分支 + worktree
- 快速恢复：目录已存在时只做文件系统检查，不调 git（幂等）

**进入：** 返回 worktree 的绝对路径作为显式 cwd

**退出：**
- 有未提交修改 → 默认拒绝删除，force 可覆盖
- 有未推送 commit → 警告但允许
- 无变更 → 清理 worktree + 分支

**清理：** 启动时清理 7 天未修改的过期 worktree

### F2: 目录名安全校验

- 字符集：`[a-zA-Z0-9_-]` 加上 `/` 允许嵌套
- 长度限制：≤ 64 字符
- 拒绝：`.` 段、`..` 段、空段、`/` 开头
- 防 LLM 输入触发路径遍历

### F3: 环境初始化

创建 worktree 后：
- 复制 `.mewcode.yaml` 等本地配置到 worktree
- 软链 `node_modules` 等大型依赖目录（避免重复安装）
- 复制 `.gitignore` 中忽略但运行需要的文件（如 `.env.example`）

### F4: 显式 cwd 隔离

- 不通过 `process.chdir()` 切换全局工作目录
- 工具调用时传入 worktree 路径作为 `ToolExecuteContext.cwd`
- 所有路径相关缓存（文件内容、system prompt、项目指令、记忆）用绝对路径做 key
- 天然按目录隔离，切换时不需要清缓存

### F5: 子 Agent 集成

角色 frontmatter 加字段：
```yaml
isolation: worktree  # 默认 none，可选 worktree
```

定义式子 Agent 激活时检测 `isolation: worktree`：
1. 自动创建 worktree
2. 注入路径说明到 system prompt（"你的工作目录是 xxx"）
3. 所有工具调用 cwd 设为 worktree 路径
4. 完成后根据变更情况决定保留还是清掉

### F6: 变更保护

**退出时检查（三层）：**
1. `git status --porcelain` → 有未提交 → 拒绝删除（force 覆盖）
2. `git log @{u}..` → 有未推送 → 警告 + 允许
3. 两者都没 → 安全删除 worktree + 分支

### F7: 过期清理

启动时异步检查 `.mewcode/worktrees/`：
- 7 天未修改的目录 → 先检查 git status → 干净则清理
- 有变更的过期目录保留并警告

## 非功能需求

- N1: worktree 创建 < 5s（`git worktree add` 的速度）
- N2: 快速恢复（目录存在时）< 50ms
- N3: 路径校验 < 1ms

## 不做的事

- ❌ Worktree 之间的合并策略
- ❌ 跨目录代码同步
- ❌ 多 Agent 并行编排
- ❌ `git worktree` 不可用时的 fallback（直接报错）

## 验收标准

- AC1: 角色声明 `isolation: worktree` 后，子 Agent 在独立 worktree 中执行
- AC2: 子 Agent 的 write_file 写入 worktree 目录，不影响主工作区
- AC3: 非法目录名被安全校验拒绝
- AC4: 有未提交修改时退出被拒绝
- AC5: 创建后 node_modules 被正确软链
- AC6: 所有现有测试继续通过，类型检查零错误
