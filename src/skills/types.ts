/**
 * Skill 系统类型定义
 */

/** Skill 来源 */
export type SkillSource = 'builtin' | 'user' | 'project';

/** 执行模式 */
export type SkillMode = 'shared' | 'isolated';

/** YAML frontmatter 字段 */
export interface SkillFrontmatter {
  name: string;
  description: string;
  tools?: string[];
  mode?: SkillMode;
  history?: number;
  model?: string;
}

/** 完整 Skill 定义 */
export interface SkillDef {
  name: string;
  description: string;
  tools?: string[];
  mode: SkillMode;
  history: number;
  model?: string;
  /** Markdown 正文（SOP 指令，可能含 {{param}} 占位符） */
  body: string;
  /** 来源层级 */
  source: SkillSource;
  /** 文件路径 */
  filePath: string;
}

/** 阶段一：启动时注入的 Skill 摘要 */
export interface SkillSummary {
  name: string;
  description: string;
  source: SkillSource;
}

/** 激活结果 */
export interface SkillLoadResult {
  skill: SkillDef;
  /** 替换后的参数 */
  replacedParams: Record<string, string>;
  /** 有效的工具白名单 */
  toolWhitelist: string[];
}

/** 来源优先级映射（数字越小优先级越高） */
export const SOURCE_PRIORITY: Record<SkillSource, number> = {
  project: 0,
  user: 1,
  builtin: 2,
};
