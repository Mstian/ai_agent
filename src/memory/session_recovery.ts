/**
 * SessionRecovery — 会话恢复 + 过期清理
 *
 * 处理 JSONL 会话文件的读取、异常修复、列表展示和过期清理。
 */

import {
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
  unlinkSync,
  mkdirSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import type { Message, ContentBlock } from '../provider/types.js';
import type {
  SessionSummary,
  SessionRecoverResult,
  SessionRecord,
  SessionMetaRecord,
  SessionMessageRecord,
} from './types.js';

/** 时间跨度提醒阈值（毫秒） */
const TIME_GAP_THRESHOLD = 24 * 60 * 60 * 1000; // 24 小时
/** 过期天数 */
const DEFAULT_MAX_AGE_DAYS = 30;
/** Token 超限阈值 */
const TOKEN_OVERFLOW_THRESHOLD = 87_000;

export class SessionRecovery {
  private sessionsDir: string;

  constructor(sessionsDir: string) {
    this.sessionsDir = sessionsDir;
  }

  /** 列出所有可恢复的会话 */
  listSessions(): SessionSummary[] {
    if (!existsSync(this.sessionsDir)) return [];

    const sessions: SessionSummary[] = [];
    let entries: string[];
    try {
      entries = readdirSync(this.sessionsDir);
    } catch {
      return [];
    }

    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const filePath = join(this.sessionsDir, entry);

      try {
        const stats = statSync(filePath);
        const lines = readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
        if (lines.length === 0) continue;

        // 解析首行 meta
        let meta: SessionMetaRecord | null = null;
        try {
          const parsed = JSON.parse(lines[0]);
          if (parsed.type === 'session_meta') {
            meta = parsed;
          }
        } catch {
          // 首行损坏，跳过
          continue;
        }

        if (!meta) continue;

        sessions.push({
          id: meta.session_id,
          startedAt: meta.started_at,
          messageCount: lines.length - 1, // 减去 meta 行
          lastActiveAt: stats.mtime.toISOString(),
          cwd: meta.cwd,
        });
      } catch {
        // 文件读失败，跳过
        continue;
      }
    }

    // 按开始时间降序排列
    sessions.sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );

    return sessions;
  }

  /** 恢复指定会话 */
  recover(sessionId: string): SessionRecoverResult {
    const filePath = join(this.sessionsDir, `${sessionId}.jsonl`);
    if (!existsSync(filePath)) {
      throw new Error(`会话文件不存在: ${filePath}`);
    }

    const raw = readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);

    let meta: SessionMetaRecord | null = null;
    const messages: Message[] = [];

    // 逐行解析，跳过坏行
    for (const line of lines) {
      let record: SessionRecord;
      try {
        record = JSON.parse(line);
      } catch {
        // 坏行：跳过
        process.stderr.write(
          `[MewCode] 会话 ${sessionId}: 跳过损坏的行\n`,
        );
        continue;
      }

      if (record.type === 'session_meta') {
        meta = record;
        continue;
      }

      // 防御性转换 role
      const msgRecord = record as SessionMessageRecord;
      const role = this.normalizeRole(msgRecord.role);

      messages.push({
        role,
        content: msgRecord.content,
      });
    }

    if (!meta) {
      throw new Error(`会话 ${sessionId} 缺少 meta 信息`);
    }

    // 修复未配对 tool_use
    const fixedMessages = this.fixUnpairedToolUse(messages);

    // 检查时间跨度
    const lastActiveAt = this.getLastActiveTime(filePath);
    const now = new Date();
    const gapMs = now.getTime() - lastActiveAt.getTime();

    if (gapMs > TIME_GAP_THRESHOLD) {
      const days = Math.floor(gapMs / (24 * 60 * 60 * 1000));
      const hours = Math.floor((gapMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
      const dateStr = lastActiveAt.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });

      const reminder: Message = {
        role: 'system',
        content: [
          '[会话恢复]',
          `上次对话于 ${dateStr}，距今已 ${days} 天 ${hours} 小时。`,
          '以下是之前的对话记录，请基于此继续工作。',
        ].join('\n'),
      };

      // 插入到消息列表最前面
      fixedMessages.unshift(reminder);
    }

    // 估算 token 数
    const needsCompress = this.estimateTokens(fixedMessages) > TOKEN_OVERFLOW_THRESHOLD;

    return {
      messages: fixedMessages,
      meta: {
        cwd: meta.cwd,
        startedAt: meta.started_at,
        sessionId,
      },
      needsCompress,
    };
  }

  /** 清理过期会话（> maxAgeDays 天未修改） */
  cleanExpired(maxAgeDays = DEFAULT_MAX_AGE_DAYS): number {
    if (!existsSync(this.sessionsDir)) return 0;

    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    let cleaned = 0;

    let entries: string[];
    try {
      entries = readdirSync(this.sessionsDir);
    } catch {
      return 0;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      const filePath = join(this.sessionsDir, entry);

      try {
        const stats = statSync(filePath);
        if (stats.mtimeMs < cutoff) {
          unlinkSync(filePath);
          cleaned++;
        }
      } catch {
        // 删除失败，跳过
        continue;
      }
    }

    if (cleaned > 0) {
      process.stderr.write(
        `[MewCode] 已清理 ${cleaned} 个过期会话（> ${maxAgeDays} 天）\n`,
      );
    }

    return cleaned;
  }

  /** 修复未配对 tool_use：最后一条 assistant 消息中的工具调用无对应结果时截断 */
  private fixUnpairedToolUse(messages: Message[]): Message[] {
    if (messages.length === 0) return messages;

    const result = [...messages];
    const last = result[result.length - 1];

    // 只有 assistant 消息可能包含 tool_use
    if (last.role !== 'assistant') return result;
    if (typeof last.content === 'string') return result;

    const blocks = last.content as ContentBlock[];
    const toolUseBlocks = blocks.filter((b) => b.type === 'tool_use');

    if (toolUseBlocks.length === 0) return result;

    // 检查每个 tool_use 是否有对应 tool_result
    // tool_result 在后续的 tool role 消息中
    const nextMessages = result.slice(result.indexOf(last) + 1);
    const toolResultIds = new Set<string>();
    for (const m of nextMessages) {
      if (m.role === 'tool' && typeof m.content !== 'string') {
        for (const b of m.content as ContentBlock[]) {
          if (b.type === 'tool_result' && b.tool_use_id) {
            toolResultIds.add(b.tool_use_id);
          }
        }
      }
    }

    // 移除没有对应 tool_result 的 tool_use block
    const pairedBlocks = blocks.filter((b) => {
      if (b.type !== 'tool_use') return true;
      if (!b.tool_use_id) return false;
      return toolResultIds.has(b.tool_use_id);
    });

    if (pairedBlocks.length === 0) {
      // 所有 block 都被移除，删除整条消息
      result.pop();
    } else if (pairedBlocks.length !== blocks.length) {
      // 部分移除
      result[result.length - 1] = {
        ...last,
        content: pairedBlocks,
      };
    }

    return result;
  }

  /** 获取文件的最后修改时间 */
  private getLastActiveTime(filePath: string): Date {
    try {
      return statSync(filePath).mtime;
    } catch {
      return new Date(0);
    }
  }

  /** 简单 token 估算（字符数 × 0.5，中文为主） */
  private estimateTokens(messages: Message[]): number {
    let totalChars = 0;
    for (const m of messages) {
      totalChars += typeof m.content === 'string'
        ? m.content.length
        : (m.content as ContentBlock[]).reduce(
            (s, b) => s + (b.text ?? b.thinking ?? '').length,
            0,
          );
    }
    return Math.ceil(totalChars * 0.5);
  }

  /** 标准化 role 字段 */
  private normalizeRole(role: string): Message['role'] {
    const validRoles = ['user', 'assistant', 'system', 'tool'] as const;
    if (validRoles.includes(role as any)) {
      return role as Message['role'];
    }
    return 'user'; // fallback
  }
}
