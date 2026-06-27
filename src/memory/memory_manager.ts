/**
 * MemoryManager — 项目记忆系统总入口
 *
 * 协调所有子模块：
 * - InstructionLoader: 项目指令文件加载
 * - SessionArchiver: 会话 JSONL 存档
 * - SessionRecovery: 会话恢复 + 清理
 * - AutoNotes: 异步 LLM 记忆提取
 * - MemoryIndex: 记忆索引管理
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Provider, Message } from '../provider/types.js';
import { InstructionLoader } from './instruction_loader.js';
import { SessionArchiver } from './session_archiver.js';
import { SessionRecovery } from './session_recovery.js';
import { AutoNotes } from './auto_notes.js';
import { MemoryIndex } from './memory_index.js';
import type { MemoryInitResult, SessionRecoverResult } from './types.js';

export class MemoryManager {
  private projectRoot: string;
  private provider: Provider;

  private instructionLoader: InstructionLoader;
  private sessionArchiver: SessionArchiver;
  private sessionRecovery: SessionRecovery;
  private autoNotes: AutoNotes;
  private projectMemoryIndex: MemoryIndex;

  /** 项目 sessions 目录 */
  private projectSessionsDir: string;
  /** 项目 memory 目录 */
  private projectMemoryDir: string;

  constructor(projectRoot: string, provider: Provider) {
    this.projectRoot = projectRoot;
    this.provider = provider;

    this.projectSessionsDir = join(projectRoot, '.mewcode', 'sessions');
    this.projectMemoryDir = join(projectRoot, '.mewcode', 'memory');

    this.instructionLoader = new InstructionLoader(projectRoot);
    this.sessionArchiver = new SessionArchiver(this.projectSessionsDir);
    this.sessionRecovery = new SessionRecovery(this.projectSessionsDir);
    this.autoNotes = new AutoNotes(this.projectMemoryDir, provider);
    this.projectMemoryIndex = new MemoryIndex(this.projectMemoryDir);
  }

  /** 启动时初始化：加载指令、记忆索引、清理过期会话 */
  async initialize(): Promise<MemoryInitResult> {
    // 加载项目指令文件
    const customInstructions = this.instructionLoader.load();

    // 加载记忆索引（项目级）
    const projectMemory = this.projectMemoryIndex.load();

    // 也尝试加载用户级记忆索引
    const userMemoryIndex = new MemoryIndex(
      join(homedir(), '.mewcode', 'memory'),
    );
    const userMemory = userMemoryIndex.load();

    // 合并记忆索引（项目级 + 用户级）
    const longTermMemory = [projectMemory, userMemory]
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n\n');

    // 列出可恢复会话
    const recoverableSessions = this.sessionRecovery.listSessions();

    // 异步清理过期会话
    this.sessionRecovery.cleanExpired(30);

    return { customInstructions, longTermMemory, recoverableSessions };
  }

  /** 开始新会话 */
  startSession(cwd: string): string {
    return this.sessionArchiver.startSession(cwd);
  }

  /** 追加消息到会话存档 */
  archiveMessage(
    role: 'user' | 'assistant' | 'system' | 'tool',
    content: unknown,
  ): void {
    this.sessionArchiver.appendMessage(role, content);
  }

  /** Agent 循环结束后异步提取记忆（fire-and-forget） */
  extractMemories(messages: Message[]): void {
    // 异步执行，不 await
    this.autoNotes.tryExtract(messages).catch(() => {
      // 静默失败
    });
  }

  /** 恢复指定会话 */
  recoverSession(sessionId: string): SessionRecoverResult {
    return this.sessionRecovery.recover(sessionId);
  }

  /** 获取会话存档器（供 ChatManager 使用） */
  getSessionArchiver(): SessionArchiver {
    return this.sessionArchiver;
  }

  /** 刷新记忆索引（供外部在笔记更新后调用） */
  refreshMemoryIndex(): void {
    this.projectMemoryIndex.rebuild();
  }
}
