/**
 * PermissionManager — 五层权限检查链总入口
 */

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parse, stringify } from 'yaml';
import { BlacklistChecker } from './blacklist.js';
import { SandboxChecker } from './sandbox.js';
import { RuleEngine } from './rule_engine.js';
import { ModeResolver } from './mode_resolver.js';
import type {
  PermissionResult,
  PermissionMode,
  PermissionRule,
  ConfirmCallback,
} from './types.js';

export class PermissionManager {
  private blacklist: BlacklistChecker;
  private sandbox: SandboxChecker;
  private ruleEngine: RuleEngine;
  private modeResolver: ModeResolver;
  private projectRoot: string;
  private sessionRules: PermissionRule[] = []; // y session 临时规则

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.blacklist = new BlacklistChecker();
    this.sandbox = new SandboxChecker(projectRoot);
    this.ruleEngine = new RuleEngine();
    this.modeResolver = new ModeResolver();
    this.ruleEngine.load(projectRoot);
  }

  /** 五层检查 */
  async check(
    toolName: string,
    params: Record<string, unknown>,
    onConfirm?: ConfirmCallback,
  ): Promise<PermissionResult> {
    // Layer 1: 黑名单（不可跳过）
    const blacklistResult = this.blacklist.check(toolName, params);
    if (blacklistResult) return blacklistResult;

    // Layer 2: 沙箱
    const sandboxResult = this.sandbox.check(toolName, params);
    if (sandboxResult) return sandboxResult;

    // Layer 3: 规则引擎（先查 session 规则，再查文件规则）
    const sessionResult = this.matchSessionRules(toolName, params);
    if (sessionResult) return sessionResult;

    const ruleResult = this.ruleEngine.match(toolName, params);
    const ruleMatched = ruleResult !== null;

    // Layer 4: 权限模式
    if (ruleResult && !ruleResult.allowed) {
      return ruleResult; // deny 规则命中，直接拒绝
    }

    const modeResult = this.modeResolver.resolve(ruleMatched);
    // 如果 rule allow 且 mode 不需要确认，返回 ruleResult
    if (ruleResult && ruleResult.allowed && !modeResult?.confirmRequired) {
      return ruleResult;
    }
    // strict 需要确认，或 default 未命中需要确认
    if (modeResult?.confirmRequired) {
      // Layer 5: 人在回路
      if (!onConfirm) {
        return {
          allowed: false,
          reason: '需要用户确认但无可用的确认回调',
          deniedBy: 'human',
        };
      }

      const paramStr = this.paramsSummary(toolName, params);
      const answer = await onConfirm(toolName, paramStr);

      switch (answer) {
        case 'allow':
          return { allowed: true };
        case 'deny':
          return {
            allowed: false,
            reason: '用户拒绝',
            deniedBy: 'human',
          };
        case 'allow_session': {
          const sessionRule: PermissionRule = {
            tool: toolName,
            pattern: this.paramToPattern(toolName, paramStr),
            action: 'allow',
            source: 'session',
          };
          this.sessionRules.unshift(sessionRule);
          return { allowed: true };
        }
        case 'allow_always':
          this.addPermanentRule({
            tool: toolName,
            pattern: this.paramToPattern(toolName, paramStr),
            action: 'allow',
            source: 'local',
          });
          return { allowed: true };
      }
    }

    // permissive 且无规则命中 → 自动放行
    return { allowed: true };
  }

  setMode(mode: PermissionMode): void {
    this.modeResolver.setMode(mode);
  }

  getMode(): PermissionMode {
    return this.modeResolver.getMode();
  }

  addSessionRule(rule: PermissionRule): void {
    this.sessionRules.unshift(rule);
  }

  /** 永久规则写入本地级规则文件 */
  addPermanentRule(rule: PermissionRule): void {
    const dir = join(this.projectRoot, '.mewcode');
    const filePath = join(dir, 'rules.local.yaml');

    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    let existing: { rules?: Array<{ tool: string; pattern: string; action: string }> } = { rules: [] };
    if (existsSync(filePath)) {
      try {
        existing = parse(readFileSync(filePath, 'utf-8')) ?? { rules: [] };
      } catch {
        existing = { rules: [] };
      }
    }

    if (!existing.rules) existing.rules = [];
    existing.rules = existing.rules.filter(
      (r) => !(r.tool === rule.tool && r.pattern === rule.pattern),
    );
    existing.rules.push({
      tool: rule.tool,
      pattern: rule.pattern,
      action: rule.action,
    });

    writeFileSync(filePath, stringify(existing), 'utf-8');

    // 同步加载到规则引擎
    this.ruleEngine.addRule(rule);
  }

  // ---- 内部 ----

  private matchSessionRules(
    toolName: string,
    params: Record<string, unknown>,
  ): PermissionResult | null {
    const paramStr = this.paramSummaryStr(toolName, params);
    for (const rule of this.sessionRules) {
      if (rule.tool !== toolName) continue;
      if (simpleGlobMatch(paramStr, rule.pattern)) {
        return {
          allowed: rule.action === 'allow',
          reason: `会话规则: ${rule.tool}(${rule.pattern}) → ${rule.action}`,
        };
      }
    }
    return null;
  }

  private paramsSummary(toolName: string, params: Record<string, unknown>): string {
    const str = this.paramSummaryStr(toolName, params);
    const maxLen = 80;
    return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
  }

  private paramSummaryStr(toolName: string, params: Record<string, unknown>): string {
    if (toolName === 'run_command' || toolName === 'Bash' || toolName === 'RunCommand') {
      return (params.command as string) ?? '';
    }
    // glob/grep use 'pattern', file tools use 'file_path' or 'path'
    return (params.pattern ?? params.file_path ?? params.path ?? '') as string;
  }

  /** 将参数转为规则 pattern */
  private paramToPattern(toolName: string, paramSummary: string): string {
    // 对于命令，保留命令名 + 通配符
    if (toolName === 'run_command') {
      const cmd = paramSummary.trim();
      const firstSpace = cmd.indexOf(' ');
      if (firstSpace > 0) {
        return cmd.slice(0, firstSpace) + ' *';
      }
      return cmd + ' *';
    }
    // 路径：保留原样（可能已经是 pattern）
    return paramSummary;
  }
}

function simpleGlobMatch(str: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp('^' + regexStr + '$').test(str);
}
