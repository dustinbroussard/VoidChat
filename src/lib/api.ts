import { OpenRouterModel, ChatMessage } from '../types';

export const ApiService = {
  async fetchModels(): Promise<OpenRouterModel[]> {
    const response = await fetch('/api/models');
    if (!response.ok) {
      throw new Error('Failed to fetch models');
    }
    const data = await response.json();
    return data.data.map((m: any) => ({
      id: m.id,
      name: m.name,
      pricing: m.pricing,
      context_length: m.context_length,
    }));
  },

  async chatCompletion(model: string, messages: ChatMessage[], temperature: number = 0.7): Promise<string> {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: messages.map(m => ({ role: m.role, content: m.content })), temperature }),
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

  async summarizeMemory(model: string, messages: ChatMessage[]): Promise<string> {
    const summaryPrompt = "Summarize the key reusable context from this conversation. Focus on durable facts, user preferences, project decisions, terminology, constraints, and implementation details. Do not include small talk. Do not include temporary mood unless it is relevant to the project. Write concise bullet points. This memory will be saved only for the currently active persona.";
    
    // Inject the summarization instruction as a system message at the end for the model to follow
    const summaryMessages = [
      ...messages.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: summaryPrompt }
    ];

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: summaryMessages, temperature: 0.3 }),
    });

    if (!response.ok) {
      throw new Error('Summarization failed');
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }
};
