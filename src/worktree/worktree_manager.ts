/**
 * WorktreeManager — Git Worktree 文件隔离管理
 *
 * 基于 git worktree 为子 Agent 创建独立工作目录。
 * 显式 cwd 传参（不 chdir），所有工具调用的 cwd 指向 worktree。
 */

import { execSync, exec } from 'node:child_process';
import {
  existsSync, mkdirSync, symlinkSync, readdirSync,
  statSync, cpSync, rmSync, readFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const WORKTREES_DIR = '.mewcode/worktrees';
const MAX_NAME_LENGTH = 64;
const VALID_NAME_RE = /^[a-zA-Z0-9_-][a-zA-Z0-9_/-]*$/;
const DEFAULT_MAX_AGE_DAYS = 7;

export interface WorktreeInfo {
  path: string;
  branch: string;
  name: string;
  taskId: string;
  createdAt: Date;
}

export class WorktreeManager {
  private projectRoot: string;
  private worktreesDir: string;

  constructor(projectRoot: string) {
    this.projectRoot = resolve(projectRoot);
    this.worktreesDir = join(this.projectRoot, WORKTREES_DIR);
  }

  /** 安全校验目录名 */
  static validateName(name: string): { valid: boolean; reason?: string } {
    if (!name || name.length === 0) return { valid: false, reason: '名称为空' };
    if (name.length > MAX_NAME_LENGTH) return { valid: false, reason: `名称超过 ${MAX_NAME_LENGTH} 字符` };
    if (name.startsWith('/')) return { valid: false, reason: '不能以 / 开头' };
    if (!VALID_NAME_RE.test(name)) return { valid: false, reason: `名称含非法字符，只允许 [a-zA-Z0-9_/-]` };

    const segments = name.split('/');
    for (const seg of segments) {
      if (seg === '' || seg === '.' || seg === '..') {
        return { valid: false, reason: `非法路径段: "${seg}"` };
      }
    }
    return { valid: true };
  }

  /** 检查是否在 git 仓库中 */
  private ensureGitRepo(): void {
    try {
      execSync('git rev-parse --git-dir', { cwd: this.projectRoot, stdio: 'pipe' });
    } catch {
      throw new Error('当前目录不是 git 仓库，无法创建 worktree');
    }
  }

  /** 创建 worktree */
  async create(opts: {
    taskId: string;
    name?: string;
    baseRef?: string;
  }): Promise<WorktreeInfo> {
    this.ensureGitRepo();

    const name = opts.name ?? `task-${opts.taskId}`;
    const validation = WorktreeManager.validateName(name);
    if (!validation.valid) {
      throw new Error(`Worktree 名称校验失败: ${validation.reason}`);
    }

    const branch = `mewcode/worktree-${name}`;
    const worktreePath = join(this.worktreesDir, name);

    // 快速恢复：目录已存在
    if (existsSync(worktreePath)) {
      process.stderr.write(`[Worktree] 目录已存在，快速恢复: ${worktreePath}\n`);
      return { path: worktreePath, branch, name, taskId: opts.taskId, createdAt: new Date() };
    }

    mkdirSync(this.worktreesDir, { recursive: true });

    const baseRef = opts.baseRef ?? 'HEAD';

    try {
      // 检查分支是否已存在
      const branchExists = this.branchExists(branch);
      if (branchExists) {
        // 分支存在但目录不存在 → 删除旧分支重建
        execSync(`git branch -D ${branch}`, { cwd: this.projectRoot, stdio: 'pipe' });
      }

      execSync(`git worktree add -b ${branch} "${worktreePath}" ${baseRef}`, {
        cwd: this.projectRoot,
        stdio: 'pipe',
      });

      // 环境初始化
      await this.initEnvironment(worktreePath);

      process.stderr.write(`[Worktree] 已创建: ${worktreePath} (分支: ${branch})\n`);
    } catch (err) {
      throw new Error(`Worktree 创建失败: ${(err as Error).message}`);
    }

    return { path: worktreePath, branch, name, taskId: opts.taskId, createdAt: new Date() };
  }

  /** 进入（幂等检查） */
  enter(name: string): WorktreeInfo | null {
    const worktreePath = join(this.worktreesDir, name);
    if (!existsSync(worktreePath)) return null;

    return {
      path: worktreePath,
      branch: `mewcode/worktree-${name}`,
      name,
      taskId: '',
      createdAt: statSync(worktreePath).birthtime,
    };
  }

  /** 退出 + 清理 */
  async exit(name: string, force = false): Promise<{ cleaned: boolean; reason?: string }> {
    const worktreePath = join(this.worktreesDir, name);
    if (!existsSync(worktreePath)) {
      return { cleaned: true, reason: '目录不存在' };
    }

    const branch = `mewcode/worktree-${name}`;

    // 检查未提交变更
    try {
      const status = execSync('git status --porcelain', {
        cwd: worktreePath, stdio: 'pipe',
      }).toString().trim();

      if (status && !force) {
        return { cleaned: false, reason: `有未提交的变更，拒绝删除。使用 force=true 强制删除。` };
      }
    } catch (err) {
      return { cleaned: false, reason: `git status 失败: ${(err as Error).message}` };
    }

    // 清理
    try {
      // 先回主目录再删除 worktree
      execSync(`git worktree remove "${worktreePath}" --force`, {
        cwd: this.projectRoot, stdio: 'pipe',
      });

      // 删除分支
      if (this.branchExists(branch)) {
        execSync(`git branch -D ${branch}`, {
          cwd: this.projectRoot, stdio: 'pipe',
        });
      }

      process.stderr.write(`[Worktree] 已清理: ${name}\n`);
      return { cleaned: true };
    } catch (err) {
      return { cleaned: false, reason: (err as Error).message };
    }
  }

  /** 过期清理 */
  async cleanExpired(maxAgeDays = DEFAULT_MAX_AGE_DAYS): Promise<number> {
    if (!existsSync(this.worktreesDir)) return 0;

    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    let cleaned = 0;

    let entries: string[];
    try { entries = readdirSync(this.worktreesDir); } catch { return 0; }

    for (const entry of entries) {
      const fullPath = join(this.worktreesDir, entry);
      try {
        const stats = statSync(fullPath);
        if (!stats.isDirectory()) continue;
        if (stats.mtimeMs > cutoff) continue;

        // 检查是否有未提交变更
        try {
          const status = execSync('git status --porcelain', {
            cwd: fullPath, stdio: 'pipe',
          }).toString().trim();
          if (status) {
            process.stderr.write(`[Worktree] 跳过清理（有未提交变更）: ${entry}\n`);
            continue;
          }
        } catch {
          // 不是 git 目录，直接删除
        }

        rmSync(fullPath, { recursive: true, force: true });
        cleaned++;
      } catch {
        continue;
      }
    }

    if (cleaned > 0) {
      process.stderr.write(`[Worktree] 已清理 ${cleaned} 个过期 worktree\n`);
    }
    return cleaned;
  }

  /** 获取 worktree 目录 */
  getWorktreesDir(): string {
    return this.worktreesDir;
  }

  /** 环境初始化：软链依赖 + 复制配置 */
  private async initEnvironment(worktreePath: string): Promise<void> {
    // 软链 node_modules
    const srcNodeModules = join(this.projectRoot, 'node_modules');
    const dstNodeModules = join(worktreePath, 'node_modules');
    if (existsSync(srcNodeModules) && !existsSync(dstNodeModules)) {
      try {
        symlinkSync(srcNodeModules, dstNodeModules, 'dir');
      } catch {
        // 软链失败不阻断
        process.stderr.write(`[Worktree] node_modules 软链失败，跳过\n`);
      }
    }

    // 复制 .mewcode.yaml
    const configFile = join(this.projectRoot, '.mewcode.yaml');
    if (existsSync(configFile)) {
      cpSync(configFile, join(worktreePath, '.mewcode.yaml'));
    }

    // 复制 .env（如果存在且被 gitignore）
    const envFile = join(this.projectRoot, '.env');
    if (existsSync(envFile) && !existsSync(join(worktreePath, '.env'))) {
      cpSync(envFile, join(worktreePath, '.env'));
    }
  }

  /** 检查分支是否存在 */
  private branchExists(branch: string): boolean {
    try {
      execSync(`git rev-parse --verify ${branch}`, {
        cwd: this.projectRoot, stdio: 'pipe',
      });
      return true;
    } catch {
      return false;
    }
  }
}
