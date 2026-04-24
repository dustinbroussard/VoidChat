import { v4 as uuidv4 } from 'uuid';
import { Conversation, Persona, AppSettings, ChatMessage } from '../types';

const STORAGE_KEYS = {
  CONVERSATIONS: 'void_chat_conversations',
  PERSONAS: 'void_chat_personas',
  SETTINGS: 'void_chat_settings',
};

export const StorageService = {
  getConversations(): Conversation[] {
    const data = localStorage.getItem(STORAGE_KEYS.CONVERSATIONS);
    return data ? JSON.parse(data) : [];
  },

  saveConversations(conversations: Conversation[]) {
    localStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify(conversations));
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
    return data ? JSON.parse(data) : {
      theme: 'dark',
      selectedModelId: 'google/gemini-2.0-flash-lite-preview-02-05:free', // Default free model
      activePersonaId: 'default',
    };
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
    return newConvo;
  },

  updateConversation(updated: Conversation) {
    const conversations = this.getConversations();
    const index = conversations.findIndex(c => c.id === updated.id);
    if (index !== -1) {
      conversations[index] = { ...updated, lastUpdated: Date.now() };
      this.saveConversations(conversations);
    }
  },

  deleteConversation(id: string) {
    const conversations = this.getConversations();
    this.saveConversations(conversations.filter(c => c.id !== id));
  }
};
