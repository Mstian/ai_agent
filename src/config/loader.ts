import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parse } from 'yaml';
import type { ProviderConfig } from './types.js';

// ConfigManager — 负责搜索、加载、校验 YAML 配置文件
export class ConfigManager {
  // 配置文件名
  private static readonly CONFIG_FILE = '.mewcode.yaml';

  // 自动搜索并加载配置：先项目目录，再用户 home 目录
  static load(): ProviderConfig {
    // 1. 先在当前工作目录查找
    const cwdPath = join(process.cwd(), this.CONFIG_FILE);
    if (existsSync(cwdPath)) {
      return this.readAndValidate(cwdPath);
    }

    // 2. 再在用户 home 目录查找
    const homePath = join(homedir(), this.CONFIG_FILE);
    if (existsSync(homePath)) {
      return this.readAndValidate(homePath);
    }

    // 3. 两处都未找到，抛出描述性错误
    throw new Error(
      `未找到配置文件 "${this.CONFIG_FILE}"。\n` +
      `已在以下位置搜索：\n` +
      `  - ${cwdPath}\n` +
      `  - ${homePath}\n` +
      `请创建配置文件，包含以下字段：\n` +
      `  protocol: anthropic  # 或 openai\n` +
      `  model: claude-sonnet-4-6\n` +
      `  base_url: https://api.anthropic.com\n` +
      `  api_key: sk-ant-...`
    );
  }

  // 从指定路径读取并校验配置
  private static readAndValidate(filePath: string): ProviderConfig {
    const raw = readFileSync(filePath, 'utf-8');
    let parsed: unknown;

    try {
      parsed = parse(raw);
    } catch (e) {
      throw new Error(`配置文件解析失败: ${filePath}\n${(e as Error).message}`);
    }

    return this.validate(parsed, filePath);
  }

  // 校验配置的必填字段和合法性
  static validate(config: unknown, filePath?: string): ProviderConfig {
    const prefix = filePath ? `配置文件 "${filePath}"` : '配置';

    if (typeof config !== 'object' || config === null) {
      throw new Error(`${prefix} 格式错误：应为 YAML 对象，包含 protocol、model、base_url、api_key 字段`);
    }

    const obj = config as Record<string, unknown>;

    // 校验 protocol
    if (!obj.protocol || typeof obj.protocol !== 'string') {
      throw new Error(`${prefix} 缺少必填字段 "protocol"，可选值：anthropic | openai | deepseek`);
    }
    if (obj.protocol !== 'anthropic' && obj.protocol !== 'openai' && obj.protocol !== 'deepseek') {
      throw new Error(`${prefix} 字段 "protocol" 的值 "${obj.protocol}" 无效，可选值：anthropic | openai | deepseek`);
    }

    // 校验 model
    if (!obj.model || typeof obj.model !== 'string') {
      throw new Error(`${prefix} 缺少必填字段 "model"，请指定模型名称`);
    }

    // 校验 base_url
    if (!obj.base_url || typeof obj.base_url !== 'string') {
      throw new Error(`${prefix} 缺少必填字段 "base_url"，请指定 API 请求地址`);
    }

    // 校验 api_key
    if (!obj.api_key || typeof obj.api_key !== 'string') {
      throw new Error(`${prefix} 缺少必填字段 "api_key"，请提供认证密钥`);
    }

    return {
      protocol: obj.protocol as 'anthropic' | 'openai' | 'deepseek',
      model: obj.model,
      base_url: obj.base_url,
      api_key: obj.api_key,
      mcp_servers: obj.mcp_servers as Record<string, import('../mcp/types.js').MCPServerConfig> | undefined,
    };
  }
}
