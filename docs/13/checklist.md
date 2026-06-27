# MewCode 第十三阶段 Checklist

## 实现完整性

- [ ] 安全校验：合法名称通过、非法名称拒绝（含 `..`、超长、非法字符）
- [ ] Worktree 创建后目录存在、分支存在
- [ ] 目录已存在时快速恢复（不调 git）
- [ ] node_modules 被正确软链
- [ ] 退出时无变更 → 清理成功
- [ ] 退出时有未提交 → 拒绝删除
- [ ] 退出时 force → 强制删除
- [ ] 过期清理只删干净的 worktree

## 集成

- [ ] 角色 isolation: worktree 生效
- [ ] 子 Agent 工具调用 cwd 指向 worktree
- [ ] 启动时过期 worktree 被清理
- [ ] 子 Agent 写入不影响主工作区

## 编译与测试

- [ ] `npx tsc --noEmit` 无类型错误
- [ ] `npm test` 全部测试通过
- [ ] 原有测试不受影响

## 端到端场景

### E2E1: 隔离子 Agent 写文件
1. 角色设 isolation: worktree
2. 子 Agent 写文件到当前目录
3. 检查主工作区无该文件
4. 检查 worktree 目录下有该文件
