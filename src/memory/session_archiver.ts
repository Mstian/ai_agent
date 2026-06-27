/**
 * SessionArchiver — 会话 JSONL 追加写
 *
 * 每个会话一个 JSONL 文件，首行是 session_meta，后续每行一条 message。
 * 使用 fs.appendFileSync 同步追加，保证顺序，崩溃只丢最后一行。
 */

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { SessionRecord } from './types.js';

export class SessionArchiver {
  private sessionsDir: string;
  private currentSessionId: string | null = null;
  private currentFilePath: string | null = null;

  constructor(sessionsDir: string) {
    this.sessionsDir = sessionsDir;
  }

  /** 生成会话 ID: YYYYMMDD-HHMMSS-xxxx */
  static generateSessionId(): string {
    const now = new Date();
    const datePart = [
      now.getFullYear().toString(),
      (now.getMonth() + 1).toString().padStart(2, '0'),
      now.getDate().toString().padStart(2, '0'),
    ].join('');
    const timePart = [
      now.getHours().toString().padStart(2, '0'),
      now.getMinutes().toString().padStart(2, '0'),
      now.getSeconds().toString().padStart(2, '0'),
    ].join('');
    const rand = randomBytes(2).toString('hex');
    return `${datePart}-${timePart}-${rand}`;
  }

  /** 开始新会话，返回会话 ID */
  startSession(cwd: string): string {
    // 确保目录存在
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }

    const sessionId = SessionArchiver.generateSessionId();
    const filePath = join(this.sessionsDir, `${sessionId}.jsonl`);

    const meta: SessionRecord = {
      type: 'session_meta',
      session_id: sessionId,
      started_at: new Date().toISOString(),
      cwd,
    };

    writeFileSync(filePath, JSON.stringify(meta) + '\n', 'utf-8');

    this.currentSessionId = sessionId;
    this.currentFilePath = filePath;

    return sessionId;
  }

  /** 追加一条消息到当前会话 */
  appendMessage(
    role: 'user' | 'assistant' | 'system' | 'tool',
    content: unknown,
  ): void {
    if (!this.currentFilePath) return;

    const record: SessionRecord = {
      type: 'message',
      role,
      content: content as any,
      timestamp: new Date().toISOString(),
    };

    appendFileSync(this.currentFilePath, JSON.stringify(record) + '\n', 'utf-8');
  }

  /** 获取当前会话 ID（无当前会话返回 null） */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /** 结束当前会话 */
  endSession(): void {
    this.currentSessionId = null;
    this.currentFilePath = null;
  }
}
