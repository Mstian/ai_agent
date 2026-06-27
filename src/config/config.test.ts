import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigManager } from './loader.js';

// 测试辅助：创建临时目录和配置文件
function createTempConfig(
  dir: string,
  content: Record<string, unknown>,
  filename = '.mewcode.yaml'
): string {
  const filePath = join(dir, filename);
  const yamlContent = Object.entries(content)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  writeFileSync(filePath, yamlContent, 'utf-8');
  return dir;
}

describe('ConfigManager', () => {
  let originalCwd: () => string;
  let tempDir: string;

  beforeEach(() => {
    originalCwd = process.cwd;
    tempDir = join(tmpdir(), `mewcode-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    process.cwd = originalCwd;
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // 测试 validate 方法，不依赖文件系统
  describe('validate', () => {
    it('正确配置通过校验', () => {
      const config = {
        protocol: 'anthropic',
        model: 'claude-sonnet-4-6',
        base_url: 'https://api.anthropic.com',
        api_key: 'sk-ant-test',
      };
      const result = ConfigManager.validate(config);
      assert.strictEqual(result.protocol, 'anthropic');
      assert.strictEqual(result.model, 'claude-sonnet-4-6');
    });

    it('deepseek 协议通过校验', () => {
      const config = {
        protocol: 'deepseek',
        model: 'deepseek-chat',
        base_url: 'https://api.deepseek.com',
        api_key: 'sk-test',
      };
      const result = ConfigManager.validate(config);
      assert.strictEqual(result.protocol, 'deepseek');
      assert.strictEqual(result.model, 'deepseek-chat');
    });

    it('缺少 protocol 字段时抛错', () => {
      const config = {
        model: 'test',
        base_url: 'https://example.com',
        api_key: 'key',
      };
      assert.throws(
        () => ConfigManager.validate(config),
        /缺少必填字段.*protocol/
      );
    });

    it('非法 protocol 值时抛错', () => {
      const config = {
        protocol: 'gemini',
        model: 'test',
        base_url: 'https://example.com',
        api_key: 'key',
      };
      assert.throws(
        () => ConfigManager.validate(config),
        /protocol.*无效/
      );
    });

    it('缺少 model 字段时抛错', () => {
      const config = {
        protocol: 'openai',
        base_url: 'https://example.com',
        api_key: 'key',
      };
      assert.throws(
        () => ConfigManager.validate(config),
        /缺少必填字段.*model/
      );
    });

    it('缺少 base_url 字段时抛错', () => {
      const config = {
        protocol: 'openai',
        model: 'test',
        api_key: 'key',
      };
      assert.throws(
        () => ConfigManager.validate(config),
        /缺少必填字段.*base_url/
      );
    });

    it('缺少 api_key 字段时抛错', () => {
      const config = {
        protocol: 'openai',
        model: 'test',
        base_url: 'https://example.com',
      };
      assert.throws(
        () => ConfigManager.validate(config),
        /缺少必填字段.*api_key/
      );
    });

    it('config 为 null 时抛错', () => {
      assert.throws(
        () => ConfigManager.validate(null),
        /格式错误/
      );
    });
  });

  // 测试 load 方法，需要临时文件
  describe('load', () => {
    it('从 cwd 加载配置文件', () => {
      const config = {
        protocol: 'openai',
        model: 'gpt-4o',
        base_url: 'https://api.openai.com',
        api_key: 'sk-test',
      };
      createTempConfig(tempDir, config);
      process.cwd = () => tempDir;

      const result = ConfigManager.load();
      assert.strictEqual(result.protocol, 'openai');
      assert.strictEqual(result.model, 'gpt-4o');
    });

    it('配置格式错误时抛错', () => {
      // 写入无效 YAML（虽然可能是合法的，但缺少字段会触发验证错误）
      const filePath = join(tempDir, '.mewcode.yaml');
      writeFileSync(filePath, ':invalid yaml: :::', 'utf-8');
      process.cwd = () => tempDir;

      assert.throws(
        () => ConfigManager.load(),
        /配置/
      );
    });
  });
});
