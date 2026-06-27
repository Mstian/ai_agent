/**
 * AutoNotes — 异步 LLM 记忆提取
 *
 * Agent 循环自然结束后，异步调 LLM 从对话中提取长期记忆。
 * 四分类：user_preference / correction / project_knowledge / reference
 * 去重交给 LLM 判断，更新后刷新 MemoryIndex。
 */

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Message, Provider, ContentBlock } from '../provider/types.js';
import type { MemoryNote } from './types.js';
import { MemoryIndex } from './memory_index.js';
import { StreamCollector } from '../agent/stream_collector.js';

/** 记忆提取 prompt */
const EXTRACT_PROMPT = `你是一个记忆提取助手。从以下对话中提取值得长期保留的信息，分为四类：

1. **user_preference**（用户偏好）— 编码风格、工具偏好、交互习惯、语言偏好
2. **correction**（纠正反馈）— 用户指出的错误和你纠正的方式
3. **project_knowledge**（项目知识）— 项目架构、技术决策、关键文件位置、技术栈
4. **reference**（参考资料）— 外部文档链接、API 用法、配置说明

规则：
- 只提取有长期价值的信息，忽略一次性的临时细节
- 如果和现有记忆重复或相似，标记为"skip"（不新增）
- 如果现有记忆需要更新，标记为"update"并提供新的完整内容
- 如果是全新信息，标记为"add"
- 每条记忆用 name（kebab-case slug）、description（一行摘要）、content（Markdown 正文）描述
- 输出严格的 JSON 格式，不要包含其他文字

现有记忆索引：
{{existing_memory}}

对话记录：
{{conversation}}

请输出 JSON 数组：`;

/**
 * 要求 LLM 输出的 JSON 结构
 * [{
 *   "action": "add" | "update" | "skip",
 *   "name": "kebab-case-slug",
 *   "description": "一行摘要",
 *   "type": "user_preference" | "correction" | "project_knowledge" | "reference",
 *   "content": "Markdown 正文（update/add 时必填）"
 * }]
 */

interface ExtractResult {
  action: 'add' | 'update' | 'skip';
  name: string;
  description: string;
  type: string;
  content?: string;
}

export class AutoNotes {
  private memoryDir: string;
  private provider: Provider;
  private index: MemoryIndex;

  constructor(memoryDir: string, provider: Provider) {
    this.memoryDir = memoryDir;
    this.provider = provider;
    this.index = new MemoryIndex(memoryDir);
  }

  /**
   * 尝试从对话中提取记忆
   * 异步执行，不抛异常（失败静默跳过）
   */
  async tryExtract(messages: Message[]): Promise<void> {
    try {
      // 1. 加载现有记忆索引
      const existingMemory = this.index.getContent() || '（暂无现有记忆）';

      // 2. 构造对话摘要（取最后 20 条消息，控制 prompt 大小）
      const recentMessages = messages.slice(-20);
      const conversationText = recentMessages
        .map((m) => {
          const content =
            typeof m.content === 'string'
              ? m.content
              : (m.content as ContentBlock[])
                  .map((b) => b.text ?? b.thinking ?? '')
                  .filter(Boolean)
                  .join(' ');
          return `[${m.role}] ${content.slice(0, 500)}`;
        })
        .join('\n');

      // 3. 构造完整 prompt
      const prompt = EXTRACT_PROMPT
        .replace('{{existing_memory}}', existingMemory)
        .replace('{{conversation}}', conversationText);

      // 4. 调用 LLM（不带 tools）
      const stream = this.provider.streamChat(
        [
          { role: 'user', content: prompt },
        ],
        undefined, // signal
        undefined, // no tools — 禁止工具调用
      );

      // 5. 收集响应
      const collector = new StreamCollector();
      let responseText = '';
      for await (const event of collector.collect(stream)) {
        if (event.type === 'text_delta') {
          responseText += event.text;
        }
        if (event.type === 'error') {
          return; // 静默失败
        }
      }

      // 6. 解析 JSON 结果
      const results = this.parseResponse(responseText);
      if (!results || results.length === 0) return;

      // 7. 确保 memory 目录存在
      if (!existsSync(this.memoryDir)) {
        mkdirSync(this.memoryDir, { recursive: true });
      }

      // 8. 处理每条结果
      let changed = false;
      for (const r of results) {
        if (r.action === 'skip') continue;
        if (!r.content || !r.name) continue;

        const note: MemoryNote = {
          name: r.name,
          description: r.description || r.name,
          metadata: {
            type: this.normalizeType(r.type),
          },
          content: r.content,
        };

        this.writeNote(note);
        changed = true;
      }

      // 9. 有变更则重建索引
      if (changed) {
        this.index.rebuild();
      }
    } catch {
      // 静默失败，不影响主流程
    }
  }

  /** 解析 LLM 返回的 JSON */
  private parseResponse(text: string): ExtractResult[] | null {
    // 尝试提取 JSON 数组
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) return null;
      return parsed.filter(
        (item: any) => typeof item === 'object' && item.action && item.name,
      );
    } catch {
      return null;
    }
  }

  /** 写笔记文件 */
  private writeNote(note: MemoryNote): void {
    const fileName = `${note.name}.md`;
    const filePath = join(this.memoryDir, fileName);

    // 构造 frontmatter + 正文
    const content = [
      '---',
      `name: ${note.name}`,
      `description: ${note.description}`,
      'metadata:',
      `  type: ${note.metadata.type}`,
      '---',
      '',
      note.content,
    ].join('\n');

    writeFileSync(filePath, content, 'utf-8');
  }

  /** 标准化类型 */
  private normalizeType(
    type: string,
  ): 'user_preference' | 'correction' | 'project_knowledge' | 'reference' {
    const valid = [
      'user_preference',
      'correction',
      'project_knowledge',
      'reference',
    ] as const;
    if (valid.includes(type as any)) {
      return type as any;
    }
    return 'reference';
  }
}
