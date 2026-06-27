/** 权限系统类型定义 */

export type PermissionMode = 'strict' | 'default' | 'permissive';

export type LayerName = 'blacklist' | 'sandbox' | 'rule_engine' | 'mode' | 'human';

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
  deniedBy?: LayerName;
  confirmRequired?: boolean;
}

export interface PermissionRule {
  tool: string;
  pattern: string;
  action: 'allow' | 'deny';
  source: 'user' | 'project' | 'local' | 'session';
}

export type ConfirmAnswer = 'allow' | 'deny' | 'allow_session' | 'allow_always';

export type ConfirmCallback = (
  toolName: string,
  paramsSummary: string,
) => Promise<ConfirmAnswer>;
