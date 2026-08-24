// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { OpenCodeConfigService } from '../OpenCodeConfigService';

vi.mock('fs/promises');
vi.mock('fs');
vi.mock('../../utils/logger', () => ({
  logger: { ai: { info: vi.fn(), error: vi.fn() } },
}));

describe('OpenCodeConfigService Ollama bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsSync.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined as unknown as string);
  });

  it('upsertOllamaBridge writes a provider.ollama block on an empty config', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    let written = '';
    vi.mocked(fs.writeFile).mockImplementation(async (_path, content) => {
      written = content as string;
    });

    const service = new OpenCodeConfigService();
    const result = await service.upsertOllamaBridge({
      baseUrl: 'http://localhost:11434',
      modelIds: ['qwen2.5-coder:14b', 'gemma3:12b'],
    });

    expect(result.provider?.ollama).toEqual({
      name: 'Ollama (local)',
      npm: '@ai-sdk/openai-compatible',
      options: { baseURL: 'http://localhost:11434/v1' },
      models: {
        'qwen2.5-coder:14b': { name: 'qwen2.5-coder:14b' },
        'gemma3:12b': { name: 'gemma3:12b' },
      },
    });
    const parsed = JSON.parse(written);
    expect(parsed.provider.ollama).toBeDefined();
  });

  it('upsertOllamaBridge merges into an existing config without disturbing other provider blocks', async () => {
    const existingConfig = {
      $schema: 'https://opencode.ai/config.json',
      model: 'anthropic/claude-sonnet',
      provider: {
        lmstudio: {
          name: 'LM Studio (local)',
          npm: '@ai-sdk/openai-compatible',
          options: { baseURL: 'http://127.0.0.1:8234/v1' },
          models: { 'local-model': { name: 'local-model' } },
        },
        ollama: {
          name: 'Ollama (local)',
          npm: '@ai-sdk/openai-compatible',
          options: { baseURL: 'http://localhost:11434/v1' },
          models: { 'qwen3:14b': { name: 'qwen3:14b' } },
        },
      },
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(existingConfig));
    let written = '';
    vi.mocked(fs.writeFile).mockImplementation(async (_path, content) => {
      written = content as string;
    });

    const service = new OpenCodeConfigService();
    const result = await service.upsertOllamaBridge({
      baseUrl: 'http://localhost:11434',
      modelIds: ['qwen3:14b', 'deepseek-coder:1.3b'],
    });

    expect(result.provider?.lmstudio).toEqual(existingConfig.provider.lmstudio);
    expect(result.provider?.ollama?.models).toEqual({
      'qwen3:14b': { name: 'qwen3:14b' },
      'deepseek-coder:1.3b': { name: 'deepseek-coder:1.3b' },
    });
    expect(result.model).toBe('anthropic/claude-sonnet');
    expect(JSON.parse(written).provider.lmstudio).toEqual(existingConfig.provider.lmstudio);
  });

  it('removeOllamaBridge deletes only the provider.ollama key', async () => {
    const existingConfig = {
      provider: {
        lmstudio: { name: 'LM Studio (local)' },
        ollama: { name: 'Ollama (local)' },
      },
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(existingConfig));
    let written = '';
    vi.mocked(fs.writeFile).mockImplementation(async (_path, content) => {
      written = content as string;
    });

    const service = new OpenCodeConfigService();
    const result = await service.removeOllamaBridge();

    expect(result?.provider?.ollama).toBeUndefined();
    expect(result?.provider?.lmstudio).toEqual({ name: 'LM Studio (local)' });
    expect(JSON.parse(written).provider.ollama).toBeUndefined();
  });

  it('removeOllamaBridge is a no-op when no bridge is configured', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));

    const service = new OpenCodeConfigService();
    const result = await service.removeOllamaBridge();

    expect(result).toBeNull();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});
