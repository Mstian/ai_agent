/**
 * Transport 实现：StdioTransport（子进程管道）+ HttpTransport（HTTP POST）
 */

import { spawn, ChildProcess } from 'node:child_process';
import type { Transport, JsonRpcMessage, JsonRpcResponse } from './types.js';

/** 展开环境变量 ${VAR} */
function expandEnv(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? '');
}

/** 展开 Record 中的环境变量 */
function expandEnvRecord(record?: Record<string, string>): Record<string, string> | undefined {
  if (!record) return undefined;
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    result[k] = expandEnv(v);
  }
  return result;
}

// ===== StdioTransport =====

export class StdioTransport implements Transport {
  private process: ChildProcess | null = null;
  private handlers: Array<(msg: JsonRpcMessage) => void> = [];
  private buffer = '';

  constructor(
    private command: string,
    private args: string[] = [],
    private env?: Record<string, string>,
  ) {}

  async start(): Promise<void> {
    const expandedEnv = expandEnvRecord(this.env);
    const childEnv = expandedEnv
      ? { ...process.env, ...expandedEnv }
      : process.env;

    this.process = spawn(this.command, this.args, {
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.on('error', (err) => {
      // 启动失败，通过 stderr 报告
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed) as JsonRpcMessage;
          for (const h of this.handlers) h(msg);
        } catch {
          // 解析失败，跳过（可能是非 JSON 日志输出）
        }
      }
    });
  }

  async send(message: JsonRpcMessage): Promise<void> {
    if (!this.process?.stdin) {
      throw new Error('Transport 未启动');
    }
    const json = JSON.stringify(message) + '\n';
    this.process.stdin.write(json);
  }

  onMessage(handler: (msg: JsonRpcMessage) => void): void {
    this.handlers.push(handler);
  }

  async close(): Promise<void> {
    if (this.process) {
      this.process.stdin?.end();
      setTimeout(() => {
        this.process?.kill();
      }, 500);
    }
  }
}

// ===== HttpTransport =====

export class HttpTransport implements Transport {
  private handlers: Array<(msg: JsonRpcMessage) => void> = [];
  private headers: Record<string, string>;

  constructor(private url: string, headers?: Record<string, string>) {
    this.headers = expandEnvRecord(headers) ?? {};
  }

  async start(): Promise<void> {
    // HTTP 无状态，无需启动
  }

  async send(message: JsonRpcMessage): Promise<void> {
    // HTTP Transport：发送请求后直接等响应，不通过 onMessage 回调
  }

  /** HTTP 专用：发送请求并返回响应 */
  async sendRequest(message: JsonRpcMessage): Promise<JsonRpcResponse> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text().catch(() => '')}`);
    }

    return (await response.json()) as JsonRpcResponse;
  }

  onMessage(handler: (msg: JsonRpcMessage) => void): void {
    this.handlers.push(handler);
  }

  async close(): Promise<void> {
    // 无连接需要关闭
  }
}
