/**
 * HookManager — Hook 系统总入口
 *
 * 职责：
 * - 加载 YAML 配置文件 + 校验
 * - 触发事件并执行匹配的 Hook
 * - 错误隔离（单条 Hook 失败不影响其他）
 * - pre_tool_execute 拦截处理
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse } from 'yaml';
import type {
  HookRule,
  HookEvent,
  HookContext,
  HookFireResult,
  HookConfig,
} from './types.js';
import { VALID_EVENTS } from './types.js';
import { HookMatcher } from './hook_matcher.js';
import { HookExecutor } from './hook_executor.js';

const VALID_ACTION_TYPES = ['command', 'prompt', 'http', 'agent'];

export class HookManager {
  private rules: HookRule[] = [];
  private matcher: HookMatcher = new HookMatcher();
  private executor: HookExecutor = new HookExecutor();
  /** runOnce 已执行的 rule 索引 */
  private executedOnce: Set<number> = new Set();

  /** 加载并校验所有 Hook 配置 */
  load(projectRoot: string): void {
    this.rules = [];

    // 1. 用户级（先加载，排在前面）
    this.loadFile(join(homedir(), '.mewcode', 'hooks.yaml'));

    // 2. 项目级（后加载，排在后面）
    this.loadFile(join(projectRoot, '.mewcode', 'hooks.yaml'));
  }

  /** 触发事件 */
  async fire(
    event: HookEvent,
    ctx: HookContext,
  ): Promise<HookFireResult> {
    const result: HookFireResult = {
      allowed: true,
      promptInjections: [],
    };

    const matching = this.rules.filter((r) => r.event === event);

    for (let i = 0; i < matching.length; i++) {
      const rule = matching[i];
      const ruleIdx = this.rules.indexOf(rule);

      // runOnce 检查
      if (rule.runOnce && this.executedOnce.has(ruleIdx)) continue;

      // 条件匹配
      if (!this.matcher.match(rule, ctx)) continue;

      // reject: true — 直接拦截（仅 pre_tool_execute 生效）
      if (rule.reject && event === 'pre_tool_execute') {
        result.allowed = false;
        result.reason = rule.rejectReason ?? `Hook 拦截: 规则拒绝执行 "${ctx.toolName ?? 'unknown'}"`;
        return result;
      }

      // 异步执行（拦截事件不允许异步）
      const isAsync = rule.async && event !== 'pre_tool_execute';

      if (isAsync) {
        // 后台执行，不等待
        this.executeSafe(rule, ctx, ruleIdx).catch(() => {});
        continue;
      }

      // 同步执行
      try {
        const execResult = await this.executor.execute(rule.action, ctx);

        // 收集 prompt 注入
        if (execResult.promptText) {
          result.promptInjections.push(execResult.promptText);
        }

        // pre_tool_execute 拦截：command 返回非零即拦截
        if (event === 'pre_tool_execute' && rule.action.type === 'command') {
          if (execResult.exitCode !== undefined && execResult.exitCode !== 0) {
            result.allowed = false;
            result.reason = `Hook 拦截: 命令 "${rule.action.command}" 返回退出码 ${execResult.exitCode}`;
            return result; // 第一个拦截立即生效
          }
        }

        // 标记 runOnce
        if (rule.runOnce) {
          this.executedOnce.add(ruleIdx);
        }
      } catch (err) {
        process.stderr.write(
          `[Hook] 规则执行失败: ${(err as Error).message}\n`,
        );
        // 错误隔离：不中断，继续下一条
      }
    }

    return result;
  }

  /** 安全执行（异步 + 错误隔离） */
  private async executeSafe(
    rule: HookRule,
    ctx: HookContext,
    idx: number,
  ): Promise<void> {
    try {
      await this.executor.execute(rule.action, ctx);
      if (rule.runOnce) {
        this.executedOnce.add(idx);
      }
    } catch (err) {
      process.stderr.write(
        `[Hook] 异步规则执行失败: ${(err as Error).message}\n`,
      );
    }
  }

  /** 获取已加载的规则数 */
  getRuleCount(): number {
    return this.rules.length;
  }

  /** 加载单个 YAML 文件 */
  private loadFile(filePath: string): void {
    if (!existsSync(filePath)) return;

    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch {
      process.stderr.write(`[Hook] 配置文件读取失败: ${filePath}\n`);
      return;
    }

    let parsed: unknown;
    try {
      parsed = parse(raw);
    } catch (err) {
      process.stderr.write(
        `[Hook] YAML 解析失败: ${filePath} — ${(err as Error).message}\n`,
      );
      return;
    }

    if (!Array.isArray(parsed)) {
      process.stderr.write(
        `[Hook] 配置文件格式错误: ${filePath} — 应为数组\n`,
      );
      return;
    }

    for (const item of parsed) {
      const rule = this.validateRule(item, filePath);
      if (rule) {
        this.rules.push(rule);
      }
    }
  }

  /** 校验并转换单条 Hook 配置 */
  private validateRule(
    config: unknown,
    filePath: string,
  ): HookRule | null {
    if (typeof config !== 'object' || config === null) {
      process.stderr.write(`[Hook] 规则格式错误，跳过: ${filePath}\n`);
      return null;
    }

    const c = config as HookConfig;

    // event 必填
    if (!c.event || !VALID_EVENTS.includes(c.event as HookEvent)) {
      process.stderr.write(
        `[Hook] 缺少或无效的 event: ${c.event}，跳过 (${filePath})\n`,
      );
      return null;
    }

    // action 必填
    if (!c.action) {
      process.stderr.write(
        `[Hook] 缺少 action，跳过 (event=${c.event}, ${filePath})\n`,
      );
      return null;
    }

    // action.type 必填且合法
    if (!c.action.type || !VALID_ACTION_TYPES.includes(c.action.type)) {
      process.stderr.write(
        `[Hook] 无效的 action.type: ${c.action.type}，跳过 (event=${c.event}, ${filePath})\n`,
      );
      return null;
    }

    return {
      event: c.event as HookEvent,
      if: c.if,
      action: c.action as HookRule['action'],
      reject: c.reject,
      rejectReason: c.rejectReason,
      runOnce: c.runOnce,
      async: c.async,
      timeout: c.timeout ?? c.action.timeout,
    };
  }
}
