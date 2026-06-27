/**
 * PromptManager — 提示系统总入口
 *
 * 职责：
 * - 管理 PromptBuilder（模块注册、拼装）
 * - 生成顶层 system prompt（稳定，可缓存）
 * - 生成运行时 system 消息（变化内容，轮次频率控制）
 */

import { PromptBuilder } from './builder.js';
import {
  getDefaultModules,
  PLAN_MODE_RULES,
  FULL_MODE_RULES,
} from './modules.js';
import type {
  ModuleKey,
  InjectionContext,
  SystemMessage,
} from './types.js';

export class PromptManager {
  private builder: PromptBuilder;

  constructor() {
    this.builder = new PromptBuilder();
    this.builder.registerAll(getDefaultModules());
  }

  /** 获取顶层 system prompt（稳定内容，供 Provider 使用） */
  getSystemPrompt(variables?: Record<string, string>): string {
    // 提取 skill_prompt（不参与模板替换，直接前置注入）
    const skillPrompt = variables?.skill_prompt ?? '';
    const vars = { ...variables };
    delete vars.skill_prompt;

    // 默认变量
    const defaults: Record<string, string> = {
      mode_label: '当前模式: 执行模式',
      mode_rules: FULL_MODE_RULES,
      custom_instructions: '',
      active_skills: '',
      long_term_memory: '',
      ...vars,
    };

    // 根据变量内容自动启用/禁用对应模块
    if (defaults.custom_instructions) {
      this.builder.enable('custom_instructions');
    } else {
      this.builder.disable('custom_instructions');
    }

    if (defaults.long_term_memory) {
      this.builder.enable('long_term_memory');
    } else {
      this.builder.disable('long_term_memory');
    }

    if (defaults.active_skills) {
      this.builder.enable('active_skills');
    } else {
      this.builder.disable('active_skills');
    }

    const prompt = this.builder.build(defaults);

    // 已激活 Skill 指令钉在最前面
    if (skillPrompt) {
      return skillPrompt + '\n' + prompt;
    }

    return prompt;
  }

  /**
   * 生成运行时 system 消息（变化内容）
   * 轮次频率控制：首轮完整 → 每 3 轮重复 → 其余精简
   */
  generateSystemMessages(
    turn: number,
    context: InjectionContext,
  ): SystemMessage[] {
    const messages: SystemMessage[] = [];

    // 首轮：注入环境信息
    if (turn === 1) {
      messages.push(this.environmentMessage(context));
    }

    // 模式提醒（按轮次频率控制：首轮 + 每3轮重复）
    if (turn === 1 || (turn - 1) % 3 === 0) {
      // 完整版
      messages.push(this.modeMessage(context));
    } else if (context.mode === 'plan') {
      // 精简版（仅 plan mode 需要）
      messages.push(this.modeReminder());
    }

    return messages;
  }

  /** 更新模块内容（用于 mode 切换等动态场景） */
  updateModule(key: ModuleKey, content: string): void {
    const mod = this.builder.getModule(key);
    if (mod) {
      mod.content = content;
    }
  }

  /** 更新 task_mode 模块以反映当前模式 */
  setMode(mode: 'full' | 'plan'): void {
    const label =
      mode === 'plan' ? '当前模式: 规划模式（只读）' : '当前模式: 执行模式';
    const rules = mode === 'plan' ? PLAN_MODE_RULES : FULL_MODE_RULES;

    this.updateModule(
      'task_mode',
      `${label}\n${rules}`,
    );
  }

  /** 启用/禁用模块 */
  enableModule(key: ModuleKey): void {
    this.builder.enable(key);
  }

  disableModule(key: ModuleKey): void {
    this.builder.disable(key);
  }

  /** 暴露 builder 供外部直接操作 */
  getBuilder(): PromptBuilder {
    return this.builder;
  }

  // ---- 内部消息构造函数 ----

  private environmentMessage(context: InjectionContext): SystemMessage {
    const lines = [
      '[SystemInstruction]',
      'type: environment',
      '---',
      `工作目录: ${context.cwd}`,
      `当前日期: ${context.date}`,
    ];
    if (context.gitBranch) {
      lines.push(`Git 分支: ${context.gitBranch}`);
    }
    return { role: 'system', content: lines.join('\n') };
  }

  private modeMessage(context: InjectionContext): SystemMessage {
    const rules =
      context.mode === 'plan' ? PLAN_MODE_RULES : FULL_MODE_RULES;
    const label =
      context.mode === 'plan' ? '规划模式（只读）' : '执行模式（全工具）';

    return {
      role: 'system',
      content: [
        '[SystemInstruction]',
        'type: mode_switch',
        '---',
        `当前模式: ${label}`,
        rules,
      ].join('\n'),
    };
  }

  private modeReminder(): SystemMessage {
    return {
      role: 'system',
      content:
        '[SystemInstruction]\n' +
        'type: reminder\n' +
        '---\n' +
        '[提醒] 当前仍处于规划模式，只能使用只读工具（read_file、glob、grep），不能修改文件或执行命令。',
    };
  }
}
