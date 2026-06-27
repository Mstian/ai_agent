import type { Provider } from './types.js';
import type { ProviderConfig } from '../config/types.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';

// ProviderFactory — 根据配置中的 protocol 字段创建对应的 Provider 实例
export class ProviderFactory {
  // 创建 Provider 实例
  static create(config: ProviderConfig): Provider {
    switch (config.protocol) {
      case 'anthropic':
        return new AnthropicProvider(config);
      case 'openai':
      case 'deepseek':
        // DeepSeek 使用 OpenAI 兼容的 API 格式
        return new OpenAIProvider(config);
      default:
        // 理论上不会到达（ConfigManager.validate 已校验 protocol）
        throw new Error(
          `不支持的 protocol: "${(config as ProviderConfig).protocol}"，可选值：anthropic | openai | deepseek`
        );
    }
  }
}
