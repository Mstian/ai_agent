/**
 * 子 Agent 系统类型定义
 */

import type { Message, ContentBlock } from '../provider/types.js';

/** 角色来源 */
export type RoleSource = 'builtin' | 'user' | 'project';

/** 角色定义（frontmatter） */
export interface AgentRoleFrontmatter {
  name: string;
  description: string;
  tools?: string[];
  blocked_tools?: string[];
  model?: string;
  max_iterations?: number;
  permission_mode?: 'strict' | 'default' | 'permissive';
}

/** 完整角色定义 */
export interface AgentRole {
  name: string;
  description: string;
  tools?: string[];
  blocked_tools?: string[];
  model: string;
  max_iterations: number;
  permission_mode: 'strict' | 'default' | 'permissive';
  /** Markdown 正文 = 子 Agent 的系统提示 */
  body: string;
  source: RoleSource;
  filePath: string;
}

/** agent 工具输入 */
export interface AgentToolInput {
  type: 'defined' | 'fork';
  name?: string;
  prompt: string;
  background?: boolean;
}

/** 子 Agent 执行结果 */
export interface SubAgentResult {
  taskId: string;
  roleName?: string;
  finalText: string;
  turns: number;
  tokenUsage: { input: number; output: number };
  stopReason: string;
  durationMs: number;
}

/** 后台任务状态 */
export type TaskStatus = 'pending' | 'running' | 'done' | 'error';

/** 后台任务 */
export interface BackgroundTask {
  id: string;
  status: TaskStatus;
  roleName?: string;
  prompt: string;
  result?: SubAgentResult;
  error?: string;
  startedAt: Date;
}
