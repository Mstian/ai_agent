/**
 * 记忆系统类型定义
 */

import type { Message, ContentBlock } from '../provider/types.js';

// ===== 记忆笔记 =====

/** 笔记分类 */
export type MemoryNoteType =
  | 'user_preference'   // 用户偏好：编码风格、工具偏好、交互习惯
  | 'correction'        // 纠正反馈：用户指出的错误和纠正方式
  | 'project_knowledge' // 项目知识：架构、技术决策、关键文件
  | 'reference';        // 参考资料：外部文档链接、API 用法

/** 一条长期记忆笔记 */
export interface MemoryNote {
  /** kebab-case slug，作为文件名 */
  name: string;
  /** 一行摘要，用于索引展示 */
  description: string;
  /** 元数据 */
  metadata: {
    type: MemoryNoteType;
  };
  /** Markdown 正文 */
  content: string;
}

/** 笔记文件 frontmatter 结构（YAML 区） */
export interface MemoryNoteFrontmatter {
  name: string;
  description: string;
  metadata: {
    type: string;
  };
}

// ===== 会话存档 =====

/** JSONL 行：会话元信息 */
export interface SessionMetaRecord {
  type: 'session_meta';
  session_id: string;
  started_at: string;
  cwd: string;
}

/** JSONL 行：一条消息 */
export interface SessionMessageRecord {
  type: 'message';
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | ContentBlock[];
  timestamp: string;
}

/** JSONL 行的联合类型 */
export type SessionRecord = SessionMetaRecord | SessionMessageRecord;

/** 会话摘要（列表展示用，从 JSONL 扫描得出） */
export interface SessionSummary {
  /** 会话 ID: YYYYMMDD-HHMMSS-xxxx */
  id: string;
  /** 开始时间 ISO 字符串 */
  startedAt: string;
  /** 消息数（JSONL 行数 - 1 行 meta） */
  messageCount: number;
  /** 最后活跃时间 */
  lastActiveAt: string;
  /** 工作目录 */
  cwd: string;
}

/** 会话恢复结果 */
export interface SessionRecoverResult {
  messages: Message[];
  meta: {
    cwd: string;
    startedAt: string;
    sessionId: string;
  };
  /** 是否需要压缩（token 超限） */
  needsCompress: boolean;
}

// ===== 项目指令文件 =====

/** 指令文件来源层级 */
export type InstructionLayer = 'project' | 'project_config' | 'user';

/** 加载后的指令文件 */
export interface InstructionFile {
  /** 文件绝对路径 */
  path: string;
  /** 来源层级 */
  layer: InstructionLayer;
  /** 展开 @include 后的完整内容 */
  content: string;
}

// ===== MemoryManager 初始化结果 =====

export interface MemoryInitResult {
  /** 拼装好的项目指令文本 */
  customInstructions: string;
  /** MEMORY.md 索引内容 */
  longTermMemory: string;
  /** 可恢复的会话列表 */
  recoverableSessions: SessionSummary[];
}
