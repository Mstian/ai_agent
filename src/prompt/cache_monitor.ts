/**
 * CacheMonitor — 解析 Anthropic API 返回的缓存命中信息
 */

import type { CacheInfo } from './types.js';

export class CacheMonitor {
  /**
   * 从 Anthropic API 的 usage 对象提取缓存信息
   * usage 位于 message_start 事件的 message.usage 中
   */
  static extractFromUsage(usage: Record<string, unknown>): CacheInfo {
    return {
      cacheCreationTokens:
        (usage.cache_creation_input_tokens as number) ?? 0,
      cacheReadTokens:
        (usage.cache_read_input_tokens as number) ?? 0,
      inputTokens:
        (usage.input_tokens as number) ?? 0,
    };
  }

  /** 计算缓存命中率（0-1） */
  static hitRate(info: CacheInfo): number {
    const cached = info.cacheReadTokens;
    const total = info.inputTokens;
    if (total === 0) return 0;
    return cached / total;
  }

  /** 格式化缓存信息供展示 */
  static format(info: CacheInfo): string {
    if (info.cacheReadTokens === 0 && info.cacheCreationTokens === 0) {
      return '';
    }
    const rate = this.hitRate(info);
    const pct = (rate * 100).toFixed(0);
    if (info.cacheReadTokens > 0) {
      return `缓存命中: ${pct}% · 节省 ${info.cacheReadTokens} tokens`;
    }
    if (info.cacheCreationTokens > 0) {
      return `缓存创建: ${info.cacheCreationTokens} tokens`;
    }
    return '';
  }
}
