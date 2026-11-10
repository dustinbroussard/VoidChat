import { OpenRouterModel, ChatMessage } from '../types';

async function parseApiError(response: Response, fallbackMessage: string): Promise<Error> {
  let data: any = null;

  try {
    data = await response.json();
  } catch {
    try {
      const text = await response.text();
      if (text) {
        return new Error(text);
      }
    } catch {
      // Ignore response parsing failures and fall back to a generic message.
    }
  }

  const message =
    data?.details?.error?.message ||
    data?.hint ||
    data?.error ||
    fallbackMessage;

  return new Error(message);
}

function normalizeOllamaHost(host?: string): string {
  if (!host || !host.trim()) return 'http://localhost:11434';
  let cleaned = host.trim();
  if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
    cleaned = `http://${cleaned}`;
  }
  return cleaned.replace(/\/+$/, '');
}

export const ApiService = {
  async checkOllama(host?: string): Promise<boolean> {
    const targetHost = normalizeOllamaHost(host);
    // 1. Try direct fetch with short timeout
    try {
      const res = await fetch(`${targetHost}/api/tags`, {
        signal: AbortSignal.timeout(1800),
      });
      if (res.ok) return true;
    } catch {
      // Direct call failed (likely CORS, mixed-content, or offline)
    }

    // 2. Try server-side proxy probe
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
      // Direct fetch failed, fallback to server proxy
    }

    // 2. Try proxy if direct failed
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

  async fetchModels(ollamaHost?: string): Promise<OpenRouterModel[]> {
    // 1. Fetch OpenRouter & Gemini models from server route
    let openRouterModels: OpenRouterModel[] = [];
    try {
      const response = await fetch('/api/models');
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data?.data)) {
          openRouterModels = data.data.map((m: any) => ({
            id: m.id,
            name: m.name,
            pricing: m.pricing,
            context_length: m.context_length,
            source: m.source || (m.id.startsWith('google/') ? 'gemini' : 'openrouter'),
          }));
        }
      }
    } catch (err) {
      console.warn('Failed to fetch standard models:', err);
    }

    // 2. Fetch local models from Ollama
    let ollamaModels: OpenRouterModel[] = [];
    try {
      ollamaModels = await this.fetchOllamaModels(ollamaHost);
    } catch (err) {
      console.warn('Failed to fetch Ollama models:', err);
    }

    // 3. Merge models with Ollama models prepended for quick access
    const mergedMap = new Map<string, OpenRouterModel>();

    for (const model of ollamaModels) {
      mergedMap.set(model.id, model);
    }

    for (const model of openRouterModels) {
      if (!mergedMap.has(model.id)) {
        mergedMap.set(model.id, model);
      }
    }

    return Array.from(mergedMap.values());
  },

  async chatCompletion(
    model: string,
    messages: ChatMessage[],
    temperature: number = 0.7,
    ollamaHost?: string
  ): Promise<string> {
    const targetHost = normalizeOllamaHost(ollamaHost);

    // If this is an Ollama model, attempt direct local call first, then server proxy
    if (model.startsWith('ollama/')) {
      const rawModel = model.replace(/^ollama\//, '');
      const formattedMessages = messages.map(m => ({ role: m.role, content: m.content }));

      // 1. Direct browser fetch to Ollama
      try {
        const res = await fetch(`${targetHost}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: rawModel,
            messages: formattedMessages,
            stream: false,
            options: { temperature },
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data?.message?.content) {
            return data.message.content;
          }
        }
      } catch {
        // Direct call failed, fall back to server proxy
      }

      // 2. Server proxy fallback
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: formattedMessages,
          temperature,
          ollamaHost: targetHost,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || data?.details || 'Ollama request failed');
      }

      if (data?.choices?.[0]?.message?.content) {
        return data.choices[0].message.content;
      }
      if (data?.message?.content) {
        return data.message.content;
      }
      throw new Error('Invalid response from Ollama model');
    }

    // Standard OpenRouter / Gemini flow
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        temperature,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      const message = data.details?.error?.message || data.error || 'Chat completion failed';
      throw new Error(message);
    }

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Invalid response from AI model');
    }

    return data.choices[0].message.content;
  },

  async summarizeMemory(
    model: string,
    messages: ChatMessage[],
    ollamaHost?: string
  ): Promise<string> {
    const summaryPrompt = "Summarize the key reusable context from this conversation. Focus on durable facts, user preferences, project decisions, terminology, constraints, and implementation details. Do not include small talk. Do not include temporary mood unless it is relevant to the project. Write concise bullet points. This memory will be saved only for the currently active persona.";

    const summaryMessages: ChatMessage[] = [
      ...messages,
      { id: 'summary-prompt', role: 'user', content: summaryPrompt, timestamp: Date.now() }
    ];

    return this.chatCompletion(model, summaryMessages, 0.3, ollamaHost);
  }
};
