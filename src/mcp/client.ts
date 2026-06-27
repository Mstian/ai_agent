/**
 * MCPClient — JSON-RPC 消息层：请求/响应异步配对
 */

import type { Transport, JsonRpcMessage, JsonRpcResponse } from './types.js';

export class MCPClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private transport: Transport;

  constructor(transport: Transport) {
    this.transport = transport;
    this.transport.onMessage((msg: JsonRpcMessage) => {
      if ('id' in msg && 'result' in msg) {
        this.handleResponse(msg as JsonRpcResponse);
      } else if ('id' in msg && 'error' in msg) {
        this.handleResponse(msg as JsonRpcResponse);
      }
    });
  }

  async start(): Promise<void> {
    await this.transport.start();
  }

  /** 发送请求，返回 Promise 等待响应 */
  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const req = { jsonrpc: '2.0' as const, id, method, params };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.transport.send(req).catch(reject);
    });
  }

  /** 发送通知（不需要响应） */
  async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    const msg = { jsonrpc: '2.0' as const, method, params };
    await this.transport.send(msg);
  }

  async close(): Promise<void> {
    await this.transport.close();
  }

  private handleResponse(res: JsonRpcResponse): void {
    const pending = this.pending.get(res.id);
    if (!pending) return;

    this.pending.delete(res.id);

    if (res.error) {
      pending.reject(new Error(`MCP Error ${res.error.code}: ${res.error.message}`));
    } else {
      pending.resolve(res.result);
    }
  }
}
