/**
 * TaskManager — 后台任务管理
 *
 * 追踪所有运行中的子 Agent，支持异步执行和结果查询。
 * 三种进入后台方式：显式 background:true、超时自动、Fork 强制
 */

import type { BackgroundTask, SubAgentResult, TaskStatus } from './types.js';

export class TaskManager {
  private tasks: Map<string, BackgroundTask> = new Map();
  /** 已完成但尚未被查询的任务 */
  private pendingNotifications: BackgroundTask[] = [];

  /** 注册一个待启动的后台任务 */
  register(task: BackgroundTask): void {
    this.tasks.set(task.id, task);
  }

  /** 标记任务为运行中 */
  markRunning(id: string): void {
    const task = this.tasks.get(id);
    if (task) task.status = 'running';
  }

  /** 标记任务完成 */
  markDone(id: string, result: SubAgentResult): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = 'done';
    task.result = result;
    this.pendingNotifications.push(task);
  }

  /** 标记任务失败 */
  markError(id: string, error: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = 'error';
    task.error = error;
    this.pendingNotifications.push(task);
  }

  /** 获取刚完成待通知的任务 */
  checkCompleted(): BackgroundTask[] {
    const result = [...this.pendingNotifications];
    this.pendingNotifications = [];
    return result;
  }

  /** 获取任务状态 */
  getStatus(id: string): TaskStatus | null {
    return this.tasks.get(id)?.status ?? null;
  }

  /** 获取任务结果 */
  getResult(id: string): SubAgentResult | null {
    return this.tasks.get(id)?.result ?? null;
  }

  /** 列出所有活跃任务 */
  listActive(): BackgroundTask[] {
    return Array.from(this.tasks.values()).filter(
      (t) => t.status === 'pending' || t.status === 'running',
    );
  }

  /** 列出所有任务 */
  listAll(): BackgroundTask[] {
    return Array.from(this.tasks.values());
  }
}
