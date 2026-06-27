# MewCode 第五阶段 · 权限系统 Spec

## 背景

目前 MewCode 只有一层简易的硬编码黑名单（`checkDangerousCommand`），拦截 `rm -rf /` 等明显危险命令。但实际使用中需要更完善的权限控制：

- 用户可能想让 agent 自由读代码但限制写文件的范围
- 有些命令虽然不在黑名单里但用户不想让 agent 执行
- 不同项目、不同用户的权限偏好不同
- 碰到不确定的操作时，用户希望能看一眼再决定

第五阶段给 MewCode 装上五层防御的权限系统，从硬拦截到人确认，层层递进。

## 目标

- 五层防御：黑名单 → 路径沙箱 → 规则引擎 → 权限模式 → 人在回路
- 权限被拒时不终止 Agent Loop，让模型能调整策略
- 可配置规则支持三层 YAML 文件，按优先级逐层覆盖
- 用户在终端通过 y/N 对不确定操作做最终裁决

## 功能需求

### F1: 第一层——危险操作黑名单

在工具执行前用正则匹配拦截已知高危命令。这一层是硬编码的，不可被配置关闭。

- 匹配逻辑：对 run_command 的 command 参数做正则匹配
- 黑名单模式包括：`rm -rf /`、`mkfs.*`、`dd` 写块设备、fork bomb、`chmod -R 000 /`、`wget/curl | sh` 管道执行、`> /dev/sd*` 直接写设备
- 命中后直接拒绝，不进入后续层
- 拒绝信息告诉模型"该命令被安全策略拦截"，附上被拦截的模式

> 注：此层已在第二阶段实现（`helpers.ts` 的 `checkDangerousCommand`），本次升级为五层体系的第一层。

### F2: 第二层——路径沙箱

限制所有文件操作只能落在项目目录内。

- 适用于 read_file、write_file、edit_file、glob、grep 的路径参数
- 对传入路径做 `realpath`（解析符号链接）后再判断是否以项目根目录为前缀
- 符号链接指向项目外的文件也被拦截
- 拦截信息包含被解析后的实际路径，方便模型理解为什么被拒

### F3: 第三层——可配置规则引擎

规则按「工具名(参数或路径模式)」声明，每条规则结果为 allow 或 deny。

**规则格式：**
```
规则语法: ToolName(pattern)
结果: allow 或 deny

示例:
- Bash(git *): allow       # 放行所有 git 命令
- Bash(npm publish): deny  # 拦截 npm publish
- WriteFile(.env): deny    # 拦截写入 .env 文件
- ReadFile(*): allow       # 放行所有读文件操作
- Glob(*): allow           # 放行所有 glob 操作
```

**匹配方式：**
- 对 run_command：匹配 command 字符串
- 对文件工具：匹配 file_path 参数
- 支持精确匹配和 glob 通配符（`*`、`**`、`?`）
- 一条规则可匹配多个工具调用

**规则文件（三层 YAML）：**

每层一个 YAML 文件，结构相同：
```yaml
rules:
  - tool: Bash
    pattern: "git *"
    action: allow
  - tool: WriteFile
    pattern: ".env"
    action: deny
  - tool: ReadFile
    pattern: "*"
    action: allow
```

三层文件位置和优先级（从高到低）：
1. **本地级** `.mewcode/rules.local.yaml` — 个人偏好，应加入 .gitignore
2. **项目级** `.mewcode/rules.yaml` — 团队共享，提交到仓库
3. **用户级** `~/.mewcode/rules.yaml` — 全局默认

优先级：本地级 > 项目级 > 用户级。同名规则高层覆盖低层。

### F4: 第四层——权限模式

用户可整体切换信任等级，作用在规则引擎之上：

| 模式 | 行为 |
|------|------|
| **严格 (strict)** | 所有操作都需要确认。只读工具也需要用户批准 |
| **默认 (default)** | 黑名单 + 沙箱 + 规则引擎。规则未命中时询问用户 |
| **放行 (permissive)** | 仅黑名单 + 沙箱生效。规则未命中时自动放行，不询问 |

- 模式通过命令切换：`/mode strict`、`/mode default`、`/mode permissive`
- 默认模式为 default
- 提示符显示当前模式（如 `[default] >`）
- strict 和 plan mode 有重叠但不同：plan mode 限制工具列表，strict 限制所有操作需确认

### F5: 第五层——人在回路

当规则引擎未命中（没有规则匹配当前操作）且当前模式为 default 时，暂停 Agent 等待用户确认。

**交互流程：**
1. Agent 检测到需要确认的操作
2. 暂停循环，终端显示：
   ```
   [权限确认] 即将执行 run_command("npm test")，是否允许？[y/N]
   ```
3. 用户输入 y（允许）、N（拒绝，默认）、或 /stop（停止当前任务）
4. Agent 根据用户选择继续或拒绝

**三种放行方式：**
- 本次（输入 y）——仅本次操作放行
- 本次会话（输入 `y session`）——本条规则（工具名+模式）缓存到内存，本次会话自动放行
- 永久（输入 `y always`）——写入本地级规则文件（`.mewcode/rules.local.yaml`），后续永久生效

默认超时 60 秒无输入视为拒绝。

### F6: 权限拒绝不终止循环

权限被拒绝时不终止 Agent Loop。拒绝信息作为结构化 tool_result 返回给模型：
```
错误: 操作被权限系统拒绝
原因: 未匹配任何 allow 规则，且用户选择拒绝
建议: 尝试用其他方式完成，或使用只读工具先调研
```

模型看到这个结果后可以：
- 调整策略（如用 glob 代替 find 命令）
- 用只读工具获取信息后重新规划
- 向用户解释为什么需要这个权限

### F7: 模式命令扩展

新增命令：
- `/mode strict` — 切换到严格模式
- `/mode default` — 切换到默认模式
- `/mode permissive` — 切换到放行模式
- 提示符显示当前权限模式（与 plan mode 共存，如 `[plan] [default] >`）

## 非功能需求

### N1: 性能
- 黑名单和沙箱在工具执行前同步判断，不增加额外延迟
- 规则匹配在 O(n) 完成（n = 已加载规则数，通常 < 50 条）
- 确认等待不阻塞其他逻辑

### N2: 可扩展性
- 新增权限层只需在 PermissionManager 的检查链中插入
- 规则语法后续可扩展（如支持正则匹配）
- 权限模式后续可增加新档位

### N3: 安全性
- 黑名单不可被规则文件覆盖
- 沙箱不可被配置关闭
- 符号链接解析防逃逸

## 不做的事

- ❌ 网络请求限制（限制 agent 访问外网）
- ❌ 资源配额（限制 token、内存、CPU 使用量）
- ❌ 审计日志（记录所有权限决策到文件）
- ❌ 规则热加载（修改规则文件后需重启）
- ❌ 按时间或频率限制操作
- ❌ 多用户权限模型

## 验收标准

- AC1: 执行 `rm -rf /` 被黑名单拦截，不可通过配置文件放行
- AC2: 读取 `/etc/passwd` 被沙箱拦截（路径逃逸）
- AC3: `.mewcode/rules.yaml` 中配置 `Bash(git *): allow`，执行 `git status` 自动放行
- AC4: `.mewcode/rules.local.yaml` 中的规则覆盖项目级同名规则
- AC5: strict 模式下，read_file 也需要用户确认
- AC6: permissive 模式下，未命中规则的操作自动放行不询问
- AC7: 用户输入 N 拒绝操作后，Agent 不崩溃，收到权限拒绝的 tool_result 并可能调整策略
- AC8: 用户输入 `y always` 后，规则写入 `.mewcode/rules.local.yaml`，下次启动仍生效
- AC9: 切换权限模式后提示符正确显示
- AC10: 所有现有测试继续通过，类型检查零错误
