/**
 * ChatManager — 消息管理和单轮 LLM 调用
 *
 * 职责简化为：
 * - 维护对话消息列表（messages[]）
 * - 提供 callLLM 纯调用方法（不做循环、不收集事件）
 * - 提供 addXxx 方法供 Agent 操作消息列表
 */

import type { Provider, Message, StreamEvent, ContentBlock } from '../provider/types.js';
import type { ToolDefinition } from '../tools/types.js';
import type { SessionArchiver } from '../memory/session_archiver.js';

export class ChatManager {
  private provider: Provider;
  private messages: Message[];
  private sessionArchiver: SessionArchiver | null = null;

  constructor(provider: Provider, systemPrompt?: string) {
    this.provider = provider;
    this.messages = [];

    if (systemPrompt) {
      this.messages.push({
        role: 'system',
        content: systemPrompt,
      });
    }
  }

  /** 注入会话存档器 */
  setSessionArchiver(archiver: SessionArchiver): void {
    this.sessionArchiver = archiver;
  }

  /** 纯 LLM 调用：发请求，返回异步生成器，不做任何消息收集 */
  callLLM(
    tools?: ToolDefinition[],
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    return this.provider.streamChat(this.messages, signal, tools);
  }

  /** 追加用户消息 */
  addUserMessage(content: string): void {
    this.messages.push({ role: 'user', content });
    this.sessionArchiver?.appendMessage('user', content);
  }

  /** 追加 assistant 消息（ContentBlock[] 格式） */
  addAssistantMessage(blocks: ContentBlock[]): void {
    if (blocks.length === 0) return;
    this.messages.push({ role: 'assistant', content: blocks });
    this.sessionArchiver?.appendMessage('assistant', blocks);
  }

  /** 追加 tool 消息（单个 tool_result ContentBlock） */
  addToolResult(toolResultBlock: ContentBlock): void {
    this.messages.push({
      role: 'tool',
      content: [toolResultBlock],
    });
    this.sessionArchiver?.appendMessage('tool', [toolResultBlock]);
  }

  /**
   * 发送用户消息（简化版，供基本对话使用）
   * 不做工具执行、不做循环。Agent 层负责这些。
   */
  async *sendMessage(
    userInput: string,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    this.addUserMessage(userInput);

    for await (const event of this.provider.streamChat(
      this.messages,
      signal,
    )) {
      yield event;

      if (event.type === 'done') {
        if (event.content && event.content.length > 0) {
          this.messages.push({ role: 'assistant', content: event.content });
        }
        return;
      }

      if (event.type === 'error') {
        return;
      }
    }
  }

  /** 注入 system 消息（用于运行时指令，不影响缓存） */
  injectSystemMessage(content: string): void {
    this.messages.push({ role: 'system', content });
  }

  /** 清空对话历史（保留 system prompt 消息） */
  clear(): void {
    this.messages = this.messages.filter((m) => m.role === 'system');
  }

  /** 返回当前消息列表的副本 */
  getMessages(): Message[] {
    return [...this.messages];
  }
}
