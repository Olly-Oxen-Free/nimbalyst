// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaProvider } from '../OllamaProvider';

function sseStream(lines: string[]): { ok: true; body: { getReader: () => any } } {
  const encoder = new TextEncoder();
  const chunks = lines.map((line) => encoder.encode(line));
  let index = 0;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => {
          if (index >= chunks.length) return { done: true, value: undefined };
          return { done: false, value: chunks[index++] };
        },
      }),
    },
  };
}

describe('OllamaProvider', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('initialize', () => {
    it('resolves the caller-requested model when it is among Ollama\'s available models', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'qwen3:14b' }, { id: 'gemma3:12b' }, { id: 'deepseek-coder:1.3b' }],
        }),
      });

      const provider = new OllamaProvider();
      await provider.initialize({ model: 'gemma3:12b' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/v1/models',
        expect.objectContaining({ signal: expect.anything() })
      );
      // Verified indirectly: sendMessage uses resolvedModel in its request body.
      mockFetch.mockResolvedValueOnce(
        sseStream(['data: {"choices":[{"delta":{"content":"hi"}}]}\n', 'data: [DONE]\n'])
      );
      const gen = provider.sendMessage('hello');
      for await (const _ of gen) { /* drain */ }
      const requestBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(requestBody.model).toBe('gemma3:12b');
    });

    it('falls back to the first available model when the requested one is not loaded', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ id: 'qwen3:14b' }, { id: 'gemma3:12b' }] }),
      });

      const provider = new OllamaProvider();
      await provider.initialize({ model: 'not-pulled:latest' });

      mockFetch.mockResolvedValueOnce(sseStream(['data: [DONE]\n']));
      const gen = provider.sendMessage('hello');
      for await (const _ of gen) { /* drain */ }
      const requestBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(requestBody.model).toBe('qwen3:14b');
    });

    it('throws a clear error when the daemon is unreachable', async () => {
      mockFetch.mockRejectedValueOnce(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));

      const provider = new OllamaProvider();
      await expect(provider.initialize({})).rejects.toThrow(/Cannot connect to Ollama/);
    });

    it('throws when the daemon is reachable but no models are pulled', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });

      const provider = new OllamaProvider();
      await expect(provider.initialize({})).rejects.toThrow(/no models are available/);
    });
  });

  describe('sendMessage', () => {
    it('streams text content and a final usage-bearing complete event', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'qwen3:14b' }] }) });
      const provider = new OllamaProvider();
      await provider.initialize({});

      mockFetch.mockResolvedValueOnce(
        sseStream([
          'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
          'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
          'data: {"usage":{"prompt_tokens":10,"completion_tokens":2}}\n',
          'data: [DONE]\n',
        ])
      );

      const chunks: any[] = [];
      for await (const chunk of provider.sendMessage('hi')) chunks.push(chunk);

      expect(chunks.filter((c) => c.type === 'text').map((c) => c.content).join('')).toBe('Hello');
      const complete = chunks.find((c) => c.type === 'complete');
      expect(complete.usage).toEqual({ input_tokens: 10, output_tokens: 2, total_tokens: 12 });
    });

    it('emits a tool_call event when the model requests a tool', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'qwen2.5-coder:14b' }] }) });
      const provider = new OllamaProvider();
      await provider.initialize({});

      mockFetch.mockResolvedValueOnce(
        sseStream([
          'data: {"choices":[{"delta":{"tool_calls":[{"id":"call_1","type":"function","function":{"name":"noop","arguments":""}}]}}]}\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"{}"}}]}}]}\n',
          'data: [DONE]\n',
        ])
      );

      const chunks: any[] = [];
      for await (const chunk of provider.sendMessage('use a tool')) chunks.push(chunk);

      const toolCall = chunks.find((c) => c.type === 'tool_call');
      expect(toolCall?.toolCall).toMatchObject({ id: 'call_1', name: 'noop', arguments: {} });
    });

    it('surfaces an upstream error frame as an error chunk', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'qwen3:14b' }] }) });
      const provider = new OllamaProvider();
      await provider.initialize({});

      mockFetch.mockResolvedValueOnce(
        sseStream(['data: {"error":{"message":"model is overloaded"}}\n'])
      );

      const chunks: any[] = [];
      for await (const chunk of provider.sendMessage('hi')) chunks.push(chunk);

      expect(chunks).toEqual([{ type: 'error', error: 'model is overloaded' }]);
    });
  });

  describe('getCapabilities', () => {
    it('reports the chat-provider profile: no MCP, no file tools, no session resume', () => {
      const provider = new OllamaProvider();
      expect(provider.getCapabilities()).toEqual({
        streaming: true,
        tools: true,
        mcpSupport: false,
        edits: true,
        resumeSession: false,
        supportsFileTools: false,
      });
    });
  });
});
