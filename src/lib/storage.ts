import { v4 as uuidv4 } from 'uuid';
import { Conversation, Persona, AppSettings, ChatMessage } from '../types';

const STORAGE_KEYS = {
  CONVERSATIONS: 'void_chat_conversations',
  PERSONAS: 'void_chat_personas',
  SETTINGS: 'void_chat_settings',
  ACTIVE_CONVO: 'void_chat_active_conversation_id',
};

export const StorageService = {
  getConversations(): Conversation[] {
    const data = localStorage.getItem(STORAGE_KEYS.CONVERSATIONS);
    return data ? JSON.parse(data) : [];
  },

  saveConversations(conversations: Conversation[]) {
    try {
      localStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify(conversations));
    } catch (err) {
      console.error('Failed to save conversations to localStorage:', err);
    }
  },

  getActiveConversationId(): string | null {
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_CONVO);
  },

  saveActiveConversationId(id: string | null) {
    if (id) {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_CONVO, id);
    } else {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_CONVO);
    }
  },

  getPersonas(): Persona[] {
    const data = localStorage.getItem(STORAGE_KEYS.PERSONAS);
    if (!data) {
      // Default persona
      const defaultPersona: Persona = {
        id: 'default',
        name: 'Default',
        systemPrompt: 'You are a helpful, clear, practical AI assistant.',
        memories: [],
      };
      const personas = [defaultPersona];
      this.savePersonas(personas);
      return personas;
    }
    return JSON.parse(data);
  },

  savePersonas(personas: Persona[]) {
    localStorage.setItem(STORAGE_KEYS.PERSONAS, JSON.stringify(personas));
  },

  getSettings(): AppSettings {
    const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    const defaults: AppSettings = {
      theme: 'dark',
      selectedModelId: 'google/gemini-2.0-flash-lite-preview-02-05:free', // Default free model
      activePersonaId: 'default',
      ollamaHost: 'http://localhost:11434',
      autoScroll: true,
    };
    return data ? { ...defaults, ...JSON.parse(data) } : defaults;
  },

  saveSettings(settings: AppSettings) {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
  },

  createConversation(title: string, personaId: string, modelId: string): Conversation {
    const newConvo: Conversation = {
      id: uuidv4(),
      title,
      messages: [],
      lastUpdated: Date.now(),
      personaId,
      modelId,
    };
    const conversations = this.getConversations();
    this.saveConversations([newConvo, ...conversations]);
    this.saveActiveConversationId(newConvo.id);
    return newConvo;
  },

  updateConversation(updated: Conversation) {
    const conversations = this.getConversations();
    const index = conversations.findIndex(c => c.id === updated.id);
    if (index !== -1) {
      conversations[index] = { ...updated, lastUpdated: Date.now() };
      this.saveConversations(conversations);
    } else {
      this.saveConversations([updated, ...conversations]);
    }
  },

  updateConversationTitle(id: string, title: string) {
    const conversations = this.getConversations();
    const index = conversations.findIndex(c => c.id === id);
    if (index !== -1) {
      conversations[index].title = title;
      conversations[index].lastUpdated = Date.now();
      this.saveConversations(conversations);
    }
  },

  deleteConversation(id: string) {
    const conversations = this.getConversations();
    this.saveConversations(conversations.filter(c => c.id !== id));
    if (this.getActiveConversationId() === id) {
      const remaining = conversations.filter(c => c.id !== id);
      this.saveActiveConversationId(remaining[0]?.id || null);
    }
  },

  exportChatHistory(conversations: Conversation[], specificId?: string) {
    const toExport = specificId
      ? conversations.filter(c => c.id === specificId)
      : conversations;

    const exportPayload = {
      app: 'Void Chat',
      version: '1.0',
      exportedAt: new Date().toISOString(),
      totalConversations: toExport.length,
      totalMessages: toExport.reduce((acc, c) => acc + (c.messages?.length || 0), 0),
      conversations: toExport,
    };

    const jsonString = JSON.stringify(exportPayload, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const dateStr = new Date().toISOString().split('T')[0];
    link.download = specificId && toExport[0]
      ? `void-chat-${toExport[0].title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}-${dateStr}.json`
      : `void-chat-history-${dateStr}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  parseImportData(rawJson: string): { conversations: Conversation[]; error?: string } {
    try {
      const parsed = JSON.parse(rawJson);
      let rawList: any[] = [];

      if (Array.isArray(parsed)) {
        rawList = parsed;
      } else if (parsed && Array.isArray(parsed.conversations)) {
        rawList = parsed.conversations;
      } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.messages)) {
        rawList = [parsed];
      } else {
        return {
          conversations: [],
          error: 'Unrecognized JSON structure. Expected a Void Chat export or JSON containing conversations/messages.'
        };
      }

      if (rawList.length === 0) {
        return { conversations: [], error: 'No conversations found in the selected file.' };
      }

      const validConversations: Conversation[] = rawList.map((item, index) => {
        const id = typeof item.id === 'string' && item.id.trim() ? item.id : uuidv4();
        const title = typeof item.title === 'string' && item.title.trim() ? item.title : `Imported Conversation ${index + 1}`;
        const personaId = typeof item.personaId === 'string' ? item.personaId : 'default';
        const modelId = typeof item.modelId === 'string' ? item.modelId : 'google/gemini-2.0-flash-lite-preview-02-05:free';
        const lastUpdated = typeof item.lastUpdated === 'number' ? item.lastUpdated : Date.now();

        const messages: ChatMessage[] = Array.isArray(item.messages)
          ? item.messages.map((m: any, mIdx: number) => ({
              id: typeof m.id === 'string' && m.id.trim() ? m.id : uuidv4(),
              role: (m.role === 'user' || m.role === 'assistant' || m.role === 'system') ? m.role : 'user',
              content: typeof m.content === 'string' ? m.content : '',
              timestamp: typeof m.timestamp === 'number' ? m.timestamp : Date.now() + mIdx,
            }))
          : [];

        return {
          id,
          title,
          messages,
          lastUpdated,
          personaId,
          modelId,
        };
      });

      return { conversations: validConversations };
    } catch (err) {
      return {
        conversations: [],
        error: err instanceof Error ? err.message : 'Invalid JSON file syntax.'
      };
    }
  },

  importConversations(importedConvos: Conversation[], mode: 'merge' | 'replace' = 'merge'): Conversation[] {
    const existing = this.getConversations();
    let finalConversations: Conversation[];

    if (mode === 'replace') {
      finalConversations = importedConvos;
    } else {
      // Merge: avoid ID collisions by generating new IDs for matching existing ones
      const existingIdSet = new Set(existing.map(c => c.id));
      const normalizedImported = importedConvos.map(c => {
        if (existingIdSet.has(c.id)) {
          return { ...c, id: uuidv4() };
        }
        return c;
      });
      finalConversations = [...normalizedImported, ...existing];
    }

    this.saveConversations(finalConversations);
    if (finalConversations.length > 0) {
      this.saveActiveConversationId(finalConversations[0].id);
    }
    return finalConversations;
  }
};
