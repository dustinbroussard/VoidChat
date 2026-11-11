import { OpenRouterModel, ChatMessage } from '../types';

function normalizeOllamaHost(host?: string): string {
  if (!host || !host.trim()) return 'http://127.0.0.1:11434';
  let cleaned = host.trim();
  if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
    cleaned = `http://${cleaned}`;
  }
  return cleaned.replace(/\/+$/, '');
}

export interface StreamResult {
  content: string;
  aborted?: boolean;
}

export const ApiService = {
  /**
   * Probes Ollama connectivity safely without triggering uncontrolled SSRF.
   */
  async checkOllama(host?: string): Promise<boolean> {
    const targetHost = normalizeOllamaHost(host);

    // 1. Try direct fetch from browser (local development scenario)
    try {
      const res = await fetch(`${targetHost}/api/tags`, {
        signal: AbortSignal.timeout(1800),
      });
      if (res.ok) return true;
    } catch {
      // Direct call failed (likely CORS or mixed-content)
    }

    // 2. Try server-side loopback proxy probe
    try {
      const res = await fetch(`/api/ollama/status?host=${encodeURIComponent(targetHost)}`, {
        signal: AbortSignal.timeout(2500),
      });
      if (res.ok) {
        const data = await res.json();
        return Boolean(data.connected);
      }
    } catch {
      // Both failed
    }

    return false;
  },

  /**
   * Fetches installed Ollama models.
   */
  async fetchOllamaModels(host?: string): Promise<OpenRouterModel[]> {
    const targetHost = normalizeOllamaHost(host);
    let modelsData: any = null;

    // 1. Try direct fetch
    try {
      const res = await fetch(`${targetHost}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        modelsData = await res.json();
      }
    } catch {
      // Fall through to server proxy
    }

    // 2. Try server proxy if direct failed
    if (!modelsData) {
      try {
        const res = await fetch(`/api/ollama/tags?host=${encodeURIComponent(targetHost)}`, {
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          modelsData = await res.json();
        }
      } catch (err) {
        console.warn('Ollama proxy fetch failed:', err);
      }
    }

    if (!modelsData?.models || !Array.isArray(modelsData.models)) {
      return [];
    }

    return modelsData.models.map((m: any) => ({
      id: `ollama/${m.name}`,
      name: `Ollama: ${m.name}`,
      pricing: { prompt: "0", completion: "0" },
      context_length: 4096,
      source: 'ollama' as const,
    }));
  },

  /**
   * Fetches models from all configured providers.
   */
  async fetchModels(ollamaHost?: string): Promise<OpenRouterModel[]> {
    let cloudModels: OpenRouterModel[] = [];
    try {
      const response = await fetch('/api/models');
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data?.data)) {
          cloudModels = data.data.map((m: any) => ({
            id: m.id,
            name: m.name,
            pricing: m.pricing || { prompt: "0", completion: "0" },
            context_length: m.context_length || 32768,
            source: m.source || (m.id.startsWith('google/') ? 'gemini' : 'openrouter'),
          }));
        }
      }
    } catch (err) {
      console.warn('Failed to fetch cloud models:', err);
    }

    let ollamaModels: OpenRouterModel[] = [];
    try {
      ollamaModels = await this.fetchOllamaModels(ollamaHost);
    } catch (err) {
      console.warn('Failed to fetch Ollama models:', err);
    }

    const mergedMap = new Map<string, OpenRouterModel>();

    for (const model of ollamaModels) {
      mergedMap.set(model.id, model);
    }

    for (const model of cloudModels) {
      if (!mergedMap.has(model.id)) {
        mergedMap.set(model.id, model);
      }
    }

    return Array.from(mergedMap.values());
  },

  /**
   * Real-time incremental streaming chat completion using Server-Sent Events (SSE).
   */
  async chatCompletionStream(
    model: string,
    messages: ChatMessage[],
    temperature: number = 0.7,
    ollamaHost?: string,
    signal?: AbortSignal,
    onChunk?: (delta: string, accumulated: string) => void
  ): Promise<StreamResult> {
    if (signal?.aborted) {
      return { content: '', aborted: true };
    }

    const targetHost = normalizeOllamaHost(ollamaHost);
    const cleanMessages = messages
      .filter(m => !m.isError)
      .map(m => ({ role: m.role, content: m.content }));

    let accumulated = '';

    // Direct browser fetch for Ollama if running on loopback
    if (model.startsWith('ollama/')) {
      const rawModel = model.replace(/^ollama\//, '');
      let directStreamSuccessful = false;

      try {
        const directRes = await fetch(`${targetHost}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            model: rawModel,
            messages: cleanMessages,
            stream: true,
            options: { temperature },
          }),
        });

        if (directRes.ok && directRes.body) {
          directStreamSuccessful = true;
          const reader = directRes.body.getReader();
          const decoder = new TextDecoder();
          let lineBuffer = '';

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              lineBuffer += decoder.decode(value, { stream: true });
              const lines = lineBuffer.split('\n');
              lineBuffer = lines.pop() || '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                  const parsed = JSON.parse(trimmed);
                  const token = parsed.message?.content || '';
                  if (token) {
                    accumulated += token;
                    onChunk?.(token, accumulated);
                  }
                  if (parsed.done) {
                    return { content: accumulated };
                  }
                } catch {
                  // Partial JSON
                }
              }
            }
            return { content: accumulated };
          } catch (err: any) {
            if (err?.name === 'AbortError' || signal?.aborted) {
              return { content: accumulated, aborted: true };
            }
            throw err;
          }
        }
      } catch (directErr: any) {
        if (directErr?.name === 'AbortError' || signal?.aborted) {
          return { content: accumulated, aborted: true };
        }
        // Direct fetch failed (CORS/offline); fall through to server proxy
      }
    }

    if (signal?.aborted) {
      return { content: accumulated, aborted: true };
    }

    // Server-side SSE Stream
    let response: Response;
    try {
      response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          model,
          messages: cleanMessages,
          temperature,
          stream: true,
          ollamaHost: targetHost,
        }),
      });
    } catch (fetchErr: any) {
      if (fetchErr?.name === 'AbortError' || signal?.aborted) {
        return { content: accumulated, aborted: true };
      }
      throw new Error(`Network connection error: ${fetchErr?.message || 'Could not reach server endpoint.'}`);
    }

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const errMsg = errData?.error || errData?.details || `Request failed with status ${response.status}`;
      throw new Error(String(errMsg));
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Streaming response body is not readable.');
    }

    const decoder = new TextDecoder();
    let lineBuffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;

          const jsonPayload = trimmed.slice(5).trim();
          if (jsonPayload === '[DONE]') {
            return { content: accumulated };
          }

          try {
            const event = JSON.parse(jsonPayload);
            if (event.type === 'chunk' && typeof event.text === 'string') {
              accumulated += event.text;
              onChunk?.(event.text, accumulated);
            } else if (event.type === 'error') {
              throw new Error(event.error || 'Upstream provider streaming error.');
            } else if (event.type === 'done') {
              return { content: accumulated };
            }
          } catch (jsonErr: any) {
            if (jsonErr?.message?.includes('Upstream provider')) {
              throw jsonErr;
            }
            // Ignore incomplete JSON chunks
          }
        }
      }
      return { content: accumulated };
    } catch (streamErr: any) {
      if (streamErr?.name === 'AbortError' || signal?.aborted) {
        return { content: accumulated, aborted: true };
      }
      throw streamErr;
    } finally {
      reader.cancel().catch(() => undefined);
    }
  },

  /**
   * Non-streaming fallback for summarization and utility tasks.
   */
  async chatCompletion(
    model: string,
    messages: ChatMessage[],
    temperature: number = 0.7,
    ollamaHost?: string,
    signal?: AbortSignal
  ): Promise<string> {
    const result = await this.chatCompletionStream(
      model,
      messages,
      temperature,
      ollamaHost,
      signal
    );
    return result.content;
  },

  /**
   * Summarizes reusable context for persona memory.
   */
  async summarizeMemory(
    model: string,
    messages: ChatMessage[],
    ollamaHost?: string
  ): Promise<string> {
    const summaryPrompt = "Summarize the key reusable context from this conversation. Focus on durable facts, user preferences, project decisions, terminology, constraints, and implementation details. Do not include small talk. Limit to at most 4 concise bullet points. This memory will be saved for the currently active persona.";

    const summaryMessages: ChatMessage[] = [
      ...messages.slice(-10), // Limit to last 10 messages to avoid token blow-up
      { id: 'summary-prompt', role: 'user', content: summaryPrompt, timestamp: Date.now() }
    ];

    return this.chatCompletion(model, summaryMessages, 0.3, ollamaHost);
  }
};
