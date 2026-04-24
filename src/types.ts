export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  lastUpdated: number;
  personaId: string;
  modelId: string;
}

export interface Persona {
  id: string;
  name: string;
  systemPrompt: string;
  selectedModelId?: string;
  memories: PersonaMemory[];
}

export interface PersonaMemory {
  id: string;
  content: string;
  timestamp: number;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  pricing: {
    prompt: string;
    completion: string;
  };
  context_length: number;
}

export interface AppSettings {
  theme: 'dark' | 'light';
  selectedModelId: string;
  activePersonaId: string;
}

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
}
