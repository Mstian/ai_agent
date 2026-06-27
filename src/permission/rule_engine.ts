/**
 * RuleEngine — 第三层：可配置规则引擎
 * 加载三层 YAML 规则文件，按优先级 glob 匹配
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse } from 'yaml';
import type { PermissionRule, PermissionResult } from './types.js';

/** 工具名别名映射（规则名 → 内部工具名） */
const TOOL_ALIASES: Record<string, string> = {
  Bash: 'run_command',
  Read: 'read_file',
  Write: 'write_file',
  Edit: 'edit_file',
  Glob: 'glob',
  Grep: 'grep',
  ReadFile: 'read_file',
  WriteFile: 'write_file',
  EditFile: 'edit_file',
  RunCommand: 'run_command',
};

export class RuleEngine {
  private rules: PermissionRule[] = [];

  /** 加载三层规则：高优先级先 push → 在数组前面先被匹配 */
  load(projectRoot: string): void {
    this.rules = [];

    // 1. 本地级（优先级最高，先被检查）
    this.loadFile(join(projectRoot, '.mewcode', 'rules.local.yaml'), 'local');

    // 2. 项目级
    this.loadFile(join(projectRoot, '.mewcode', 'rules.yaml'), 'project');

    // 3. 用户级
    this.loadFile(join(homedir(), '.mewcode', 'rules.yaml'), 'user');

    // 4. 内置规则（最低优先级，最后被检查）
    this.addBuiltinRules();
  }

  /** 内置规则：敏感文件 deny + 读操作默认 allow（最低优先级） */
  private addBuiltinRules(): void {
    // 先加敏感文件 deny（先被检查）
    const sensitiveDenies: Array<{ tool: string; pattern: string }> = [
      { tool: 'ReadFile', pattern: '*.pem' },
      { tool: 'ReadFile', pattern: '*.key' },
      { tool: 'ReadFile', pattern: 'id_rsa*' },
      { tool: 'ReadFile', pattern: 'id_ed25519*' },
      { tool: 'ReadFile', pattern: '*.token' },
      { tool: 'WriteFile', pattern: '*.pem' },
      { tool: 'WriteFile', pattern: '*.key' },
      { tool: 'EditFile', pattern: '*.pem' },
      { tool: 'EditFile', pattern: '*.key' },
    ];
    for (const r of sensitiveDenies) {
      this.rules.push({ tool: r.tool, pattern: r.pattern, action: 'deny', source: 'user' });
    }

    // 再加默认 allow（后检查，不影响敏感 deny）
    const defaultAllows: Array<{ tool: string; pattern: string }> = [
      { tool: 'ReadFile', pattern: '*' },
      { tool: 'Glob', pattern: '*' },
      { tool: 'Grep', pattern: '*' },
      { tool: 'agent', pattern: '*' },
    ];
    for (const r of defaultAllows) {
      this.rules.push({ tool: r.tool, pattern: r.pattern, action: 'allow', source: 'user' });
    }
  }

  /** 匹配规则：提取参数字符串 → 遍历规则 → glob 匹配 */
  match(toolName: string, params: Record<string, unknown>): PermissionResult | null {
    const paramStr = this.extractParamStr(toolName, params);
    if (paramStr === undefined) return null;

    for (const rule of this.rules) {
      // 检查工具名是否匹配（支持别名：ReadFile ↔ read_file 等）
      if (!this.toolMatches(rule.tool, toolName)) continue;
      if (simpleGlobMatch(paramStr, rule.pattern)) {
        return {
          allowed: rule.action === 'allow',
          reason: rule.action === 'deny'
            ? `规则拒绝: ${rule.tool}(${rule.pattern}) → deny`
            : `规则放行: ${rule.tool}(${rule.pattern}) → allow`,
          deniedBy: rule.action === 'deny' ? 'rule_engine' : undefined,
        };
      }
    }

    return null;
  }

  /** 检查规则工具名是否匹配实际工具名（支持别名双向匹配） */
  private toolMatches(ruleTool: string, actualTool: string): boolean {
    if (ruleTool === actualTool) return true;
    const resolved = TOOL_ALIASES[ruleTool];
    if (resolved === actualTool) return true;
    return false;
  }

  /** 动态添加规则（供 y session / y always） */
  addRule(rule: PermissionRule): void {
    this.rules = this.rules.filter(
      (r) => !(r.tool === rule.tool && r.pattern === rule.pattern),
    );
    this.rules.unshift(rule);
  }

  /** 获取所有规则 */
  getRules(): PermissionRule[] {
    return [...this.rules];
  }

  // ---- 内部 ----

  private loadFile(filePath: string, source: PermissionRule['source']): void {
    if (!existsSync(filePath)) return;

    try {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = parse(raw) as { rules?: Array<{ tool: string; pattern: string; action: string }> };
      if (!parsed?.rules || !Array.isArray(parsed.rules)) return;

      for (const r of parsed.rules) {
        if (!r.tool || !r.pattern || !r.action) continue;
        if (r.action !== 'allow' && r.action !== 'deny') continue;

        this.rules = this.rules.filter(
          (existing) =>
            !(existing.tool === r.tool &&
              existing.pattern === r.pattern &&
              existing.source === source),
        );

        this.rules.push({
          tool: r.tool,
          pattern: r.pattern,
          action: r.action,
          source,
        });
      }
    } catch {
      // YAML 解析失败，静默跳过
    }
  }

  private extractParamStr(
    toolName: string,
    params: Record<string, unknown>,
  ): string | undefined {
    const isCommandTool =
      toolName === 'run_command' ||
      toolName === 'Bash' ||
      toolName === 'RunCommand';
    if (isCommandTool) {
      return (params.command as string) ?? '';
    }
    // glob/grep use 'pattern', file tools use 'file_path' or 'path'
    return (params.pattern ?? params.file_path ?? params.path ?? '') as string;
  }
}

/** 简单 glob 匹配 */
function simpleGlobMatch(str: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp('^' + regexStr + '$', 'i').test(str);
}
