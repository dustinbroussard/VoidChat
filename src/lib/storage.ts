import { v4 as uuidv4 } from 'uuid';
import { Conversation, Persona, AppSettings, ChatMessage } from '../types';

const STORAGE_KEYS = {
  CONVERSATIONS: 'void_chat_conversations',
  PERSONAS: 'void_chat_personas',
  SETTINGS: 'void_chat_settings',
  ACTIVE_CONVO: 'void_chat_active_conversation_id',
  BACKUP_PREFIX: 'void_chat_corrupted_backup_',
};

/**
 * Safely parses JSON with fallback, without throwing exceptions.
 */
function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn('StorageService: JSON parse failure:', err);
    return fallback;
  }
}

/**
 * Normalizes an unknown object into a valid, safe ChatMessage.
 */
function normalizeMessage(m: any, defaultIndex: number = 0): ChatMessage {
  const id = typeof m?.id === 'string' && m.id.trim() ? m.id.trim() : uuidv4();
  const role: 'user' | 'assistant' | 'system' =
    m?.role === 'assistant' || m?.role === 'system' ? m.role : 'user';

  let content = '';
  if (typeof m?.content === 'string') {
    content = m.content;
  } else if (m?.content != null) {
    content = String(m.content);
  }

  const timestamp =
    typeof m?.timestamp === 'number' && !isNaN(m.timestamp) && m.timestamp > 0
      ? m.timestamp
      : Date.now() + defaultIndex;

  return {
    id,
    role,
    content,
    timestamp,
    isError: Boolean(m?.isError),
  };
}

/**
 * Normalizes an unknown object into a fully validated Conversation,
 * guaranteeing all required properties exist with safe fallbacks.
 */
function normalizeConversation(raw: any, defaultIndex: number = 0): Conversation | null {
  if (!raw || typeof raw !== 'object') return null;

  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : uuidv4();
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : `Conversation ${defaultIndex + 1}`;
  const personaId = typeof raw.personaId === 'string' && raw.personaId.trim() ? raw.personaId.trim() : 'default';
  const modelId = typeof raw.modelId === 'string' && raw.modelId.trim()
    ? raw.modelId.trim()
    : 'google/gemini-3.8-flash';

  const lastUpdated =
    typeof raw.lastUpdated === 'number' && !isNaN(raw.lastUpdated) && raw.lastUpdated > 0
      ? raw.lastUpdated
      : Date.now();

  const isPinned = Boolean(raw.isPinned);

  const rawMessages = Array.isArray(raw.messages) ? raw.messages : [];
  const messages: ChatMessage[] = rawMessages
    .filter((m: any) => m != null)
    .map((m: any, idx: number) => normalizeMessage(m, idx));

  return {
    id,
    title,
    messages,
    lastUpdated,
    personaId,
    modelId,
    isPinned,
  };
}

/**
 * Normalizes an unknown object into a safe Persona.
 */
function normalizePersona(raw: any): Persona | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : uuidv4();
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Persona';
  const systemPrompt = typeof raw.systemPrompt === 'string' ? raw.systemPrompt : '';
  const selectedModelId = typeof raw.selectedModelId === 'string' && raw.selectedModelId.trim()
    ? raw.selectedModelId.trim()
    : undefined;

  const rawMemories = Array.isArray(raw.memories) ? raw.memories : [];
  const memories = rawMemories
    .filter((m: any) => m && typeof m.content === 'string')
    .map((m: any, idx: number) => ({
      id: typeof m.id === 'string' && m.id.trim() ? m.id.trim() : uuidv4(),
      content: String(m.content),
      timestamp: typeof m.timestamp === 'number' && !isNaN(m.timestamp) ? m.timestamp : Date.now() + idx,
    }));

  return {
    id,
    name,
    systemPrompt,
    selectedModelId,
    memories,
  };
}

export const StorageService = {
  /**
   * Loads and normalizes conversations from localStorage.
   * Defends against malformed JSON, missing properties, and partial corruption.
   * Never throws or returns null/undefined.
   */
  getConversations(): Conversation[] {
    const rawData = localStorage.getItem(STORAGE_KEYS.CONVERSATIONS);
    if (!rawData) {
      return [];
    }

    let parsed: any = null;
    try {
      parsed = JSON.parse(rawData);
    } catch (parseError) {
      console.error('StorageService: Malformed conversations JSON in localStorage:', parseError);
      // Preserve corrupted raw string in an emergency backup key so data is not permanently lost
      try {
        const backupKey = `${STORAGE_KEYS.BACKUP_PREFIX}${Date.now()}`;
        localStorage.setItem(backupKey, rawData);
        console.warn(`StorageService: Corrupted raw conversations preserved under "${backupKey}"`);
      } catch {
        // Ignore backup save failures
      }
      return [];
    }

    if (!Array.isArray(parsed)) {
      console.warn('StorageService: Expected array of conversations, got:', typeof parsed);
      return [];
    }

    const validConversations: Conversation[] = [];
    const seenIds = new Set<string>();

    for (let i = 0; i < parsed.length; i++) {
      const normalized = normalizeConversation(parsed[i], i);
      if (normalized) {
        // Guard against duplicate IDs
        if (seenIds.has(normalized.id)) {
          normalized.id = uuidv4();
        }
        seenIds.add(normalized.id);
        validConversations.push(normalized);
      }
    }

    return validConversations;
  },

  /**
   * Persists conversations to localStorage with QuotaExceededError protection.
   */
  saveConversations(conversations: Conversation[]): { success: boolean; error?: string } {
    if (!Array.isArray(conversations)) {
      return { success: false, error: 'INVALID_DATA' };
    }

    try {
      localStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify(conversations));
      return { success: true };
    } catch (err: any) {
      console.error('StorageService: Failed to save conversations to localStorage:', err);
      const isQuota =
        err?.name === 'QuotaExceededError' ||
        err?.code === 22 ||
        err?.code === 1014 ||
        err?.number === -2147024882;

      if (isQuota) {
        window.dispatchEvent(new CustomEvent('void_storage_quota_exceeded'));
        return { success: false, error: 'QUOTA_EXCEEDED' };
      }
      return { success: false, error: err instanceof Error ? err.message : 'STORAGE_ERROR' };
    }
  },

  /**
   * Retrieves active conversation ID, validating that it is a non-empty string.
   */
  getActiveConversationId(): string | null {
    try {
      const id = localStorage.getItem(STORAGE_KEYS.ACTIVE_CONVO);
      return typeof id === 'string' && id.trim().length > 0 ? id.trim() : null;
    } catch {
      return null;
    }
  },

  saveActiveConversationId(id: string | null) {
    try {
      if (id && typeof id === 'string' && id.trim()) {
        localStorage.setItem(STORAGE_KEYS.ACTIVE_CONVO, id.trim());
      } else {
        localStorage.removeItem(STORAGE_KEYS.ACTIVE_CONVO);
      }
    } catch (err) {
      console.warn('StorageService: Failed to save active conversation ID:', err);
    }
  },

  /**
   * Loads personas with guaranteed default persona fallback.
   */
  getPersonas(): Persona[] {
    const rawData = localStorage.getItem(STORAGE_KEYS.PERSONAS);
    const defaultPersona: Persona = {
      id: 'default',
      name: 'Default',
      systemPrompt: 'You are a helpful, clear, practical AI assistant.',
      memories: [],
    };

    if (!rawData) {
      const initial = [defaultPersona];
      this.savePersonas(initial);
      return initial;
    }

    const parsed = safeJsonParse<any[]>(rawData, []);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [defaultPersona];
    }

    const normalizedPersonas: Persona[] = parsed
      .map(p => normalizePersona(p))
      .filter((p): p is Persona => p !== null);

    // Guarantee default persona is present
    if (!normalizedPersonas.some(p => p.id === 'default')) {
      normalizedPersonas.unshift(defaultPersona);
    }

    return normalizedPersonas;
  },

  savePersonas(personas: Persona[]) {
    try {
      if (Array.isArray(personas)) {
        localStorage.setItem(STORAGE_KEYS.PERSONAS, JSON.stringify(personas));
      }
    } catch (err) {
      console.error('StorageService: Failed to save personas:', err);
    }
  },

  /**
   * Loads application settings with safe defaults for all fields.
   */
  getSettings(): AppSettings {
    const defaults: AppSettings = {
      theme: 'dark',
      selectedModelId: 'google/gemini-3.8-flash',
      activePersonaId: 'default',
      ollamaHost: 'http://localhost:11434',
      autoScroll: true,
    };

    const rawData = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (!rawData) return defaults;

    const parsed = safeJsonParse<any>(rawData, null);
    if (!parsed || typeof parsed !== 'object') return defaults;

    return {
      theme: parsed.theme === 'light' ? 'light' : 'dark',
      selectedModelId: typeof parsed.selectedModelId === 'string' && parsed.selectedModelId.trim()
        ? parsed.selectedModelId.trim()
        : defaults.selectedModelId,
      activePersonaId: typeof parsed.activePersonaId === 'string' && parsed.activePersonaId.trim()
        ? parsed.activePersonaId.trim()
        : defaults.activePersonaId,
      ollamaHost: typeof parsed.ollamaHost === 'string' && parsed.ollamaHost.trim()
        ? parsed.ollamaHost.trim()
        : defaults.ollamaHost,
      autoScroll: parsed.autoScroll !== false,
    };
  },

  saveSettings(settings: AppSettings) {
    try {
      localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    } catch (err) {
      console.error('StorageService: Failed to save settings:', err);
    }
  },

  createConversation(title: string, personaId: string, modelId: string): Conversation {
    const cleanTitle = (title && typeof title === 'string' && title.trim()) ? title.trim() : 'New Conversation';
    const cleanPersonaId = (personaId && typeof personaId === 'string') ? personaId : 'default';
    const cleanModelId = (modelId && typeof modelId === 'string') ? modelId : 'google/gemini-3.8-flash';

    const newConvo: Conversation = {
      id: uuidv4(),
      title: cleanTitle,
      messages: [],
      lastUpdated: Date.now(),
      personaId: cleanPersonaId,
      modelId: cleanModelId,
      isPinned: false,
    };

    const conversations = this.getConversations();
    this.saveConversations([newConvo, ...conversations]);
    this.saveActiveConversationId(newConvo.id);
    return newConvo;
  },

  togglePinConversation(id: string): Conversation[] {
    const conversations = this.getConversations();
    const updated = conversations.map(c => c.id === id ? { ...c, isPinned: !c.isPinned } : c);
    this.saveConversations(updated);
    return updated;
  },

  /**
   * Updates an existing conversation safely without regressing timestamps
   * or discarding newer state.
   */
  updateConversation(updated: Conversation): Conversation[] {
    const conversations = this.getConversations();
    const index = conversations.findIndex(c => c.id === updated.id);

    if (index !== -1) {
      const existing = conversations[index];
      const lastUpdated = Math.max(updated.lastUpdated || 0, existing.lastUpdated || 0, Date.now());
      conversations[index] = {
        ...existing,
        ...updated,
        lastUpdated,
      };
    } else {
      conversations.unshift(updated);
    }

    this.saveConversations(conversations);
    return conversations;
  },

  updateConversationTitle(id: string, title: string): Conversation[] {
    const clean = title && typeof title === 'string' && title.trim() ? title.trim() : 'Untitled';
    const conversations = this.getConversations();
    const index = conversations.findIndex(c => c.id === id);

    if (index !== -1) {
      conversations[index].title = clean;
      conversations[index].lastUpdated = Date.now();
      this.saveConversations(conversations);
    }

    return conversations;
  },

  deleteConversation(id: string): Conversation[] {
    const conversations = this.getConversations();
    const remaining = conversations.filter(c => c.id !== id);
    this.saveConversations(remaining);

    if (this.getActiveConversationId() === id) {
      this.saveActiveConversationId(remaining[0]?.id || null);
    }

    return remaining;
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

  /**
   * Robust import parsing: handles Void Chat archives, standard conversation arrays,
   * single conversation objects, and nested payloads.
   */
  parseImportData(rawJson: string): { conversations: Conversation[]; error?: string } {
    if (!rawJson || typeof rawJson !== 'string' || !rawJson.trim()) {
      return { conversations: [], error: 'The selected file is empty.' };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawJson);
    } catch (err) {
      return {
        conversations: [],
        error: `JSON Syntax Error: ${err instanceof Error ? err.message : 'Invalid JSON file syntax.'}`
      };
    }

    let rawList: any[] = [];

    if (Array.isArray(parsed)) {
      rawList = parsed;
    } else if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.conversations)) {
        rawList = parsed.conversations;
      } else if (Array.isArray(parsed.data)) {
        rawList = parsed.data;
      } else if (Array.isArray(parsed.messages)) {
        // Single conversation export
        rawList = [parsed];
      } else {
        return {
          conversations: [],
          error: 'Unrecognized JSON structure. Expected a Void Chat export or JSON containing conversations array.'
        };
      }
    }

    if (rawList.length === 0) {
      return { conversations: [], error: 'No conversations found in the selected file.' };
    }

    const validConversations: Conversation[] = [];
    for (let i = 0; i < rawList.length; i++) {
      const normalized = normalizeConversation(rawList[i], i);
      if (normalized) {
        validConversations.push(normalized);
      }
    }

    if (validConversations.length === 0) {
      return { conversations: [], error: 'None of the items in the file matched a valid conversation format.' };
    }

    return { conversations: validConversations };
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
