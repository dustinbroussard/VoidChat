import React, { useState, useEffect, useRef } from 'react';
import {
  Menu, Plus, Search, Trash2, Edit3,
  Settings, User, MessageSquare, Bookmark, Moon, Sun,
  Send, X, Copy, Check, Download,
  Server, RefreshCw, ChevronDown, Upload, FileUp, Sparkles,
  Mic, MicOff, Pin, PinOff, MoreVertical, Square, AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { v4 as uuidv4 } from 'uuid';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import {
  ChatMessage, Conversation, Persona,
  OpenRouterModel, AppSettings, PersonaMemory, BeforeInstallPromptEvent
} from './types';
import { StorageService } from './lib/storage';
import { ApiService } from './lib/api';
import { MarkdownRenderer } from './components/MarkdownRenderer';

const INSTALL_PROMPT_SESSION_KEY = 'void_chat_install_prompt_session_state';

function isRunningStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Unified Design System Button Component
const Button = ({
  className,
  children,
  variant = 'secondary',
  ...props
}: {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
  const variantStyles = {
    primary: "bg-[var(--accent-primary)] text-[var(--bg-primary)] hover:bg-[var(--accent-secondary)] shadow-sm",
    secondary: "border border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] hover:border-[var(--border-light)]",
    ghost: "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]",
    danger: "border border-[var(--danger)] bg-[var(--bg-secondary)] text-[var(--danger)] hover:bg-[var(--danger)] hover:text-[var(--bg-primary)]",
  };

  return (
    <button
      className={cn(
        "touch-target px-4 py-2 rounded-xl text-xs sm:text-sm font-medium inline-flex items-center justify-center gap-2",
        "transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]",
        "disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none cursor-pointer select-none",
        variantStyles[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
};

// Accessible Icon Button with minimum 44px hit-box on touch devices
const IconButton = ({
  icon: Icon,
  className,
  size = 18,
  ...props
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  size?: number;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    className={cn(
      "touch-target w-10 h-10 rounded-xl flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]",
      "transition-all duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] active:scale-[0.96] cursor-pointer",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]",
      "disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none",
      className
    )}
    {...props}
  >
    <Icon size={size} />
  </button>
);

export default function App() {
  // --- Core State ---
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [settings, setSettings] = useState<AppSettings>(StorageService.getSettings());
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
  const [isPersonaManagerOpen, setIsPersonaManagerOpen] = useState(false);
  const [generatingConvoIds, setGeneratingConvoIds] = useState<Set<string>>(new Set());
  const [isSummarizingMemory, setIsSummarizingMemory] = useState(false);
  const [inputMessage, setInputMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [freeModelsOnly, setFreeModelsOnly] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallBannerVisible, setIsInstallBannerVisible] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isInstallPromptPending, setIsInstallPromptPending] = useState(false);

  // --- Voice-to-Text State ---
  const [isListening, setIsListening] = useState(false);
  const speechRecognitionRef = useRef<any>(null);

  // --- Editing User Message State ---
  const [editingUserMessageId, setEditingUserMessageId] = useState<string | null>(null);
  const [editingUserMessageContent, setEditingUserMessageContent] = useState('');

  // --- Per-Conversation Abort Controllers & Streaming State ---
  const activeControllersRef = useRef<Map<string, AbortController>>(new Map());
  const isGeneratingActiveConvo = activeConversationId ? generatingConvoIds.has(activeConversationId) : false;
  const isLoading = isGeneratingActiveConvo;

  // --- Conversation Context Menu State ---
  const [activeMenuConvoId, setActiveMenuConvoId] = useState<string | null>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);

  // --- Title Editing & Export/Import State ---
  const [editingConvoId, setEditingConvoId] = useState<string | null>(null);
  const [editingTitleText, setEditingTitleText] = useState('');
  const [exportFeedbackMessage, setExportFeedbackMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [settingsTab, setSettingsTab] = useState<'settings' | 'personas'>('settings');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<{
    fileName: string;
    conversations: Conversation[];
    totalMessages: number;
  } | null>(null);
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const isInitializedRef = useRef(false);

  // --- Ollama Connection State ---
  const [isOllamaConnected, setIsOllamaConnected] = useState(false);
  const [isOllamaModalOpen, setIsOllamaModalOpen] = useState(false);
  const [isTestingOllama, setIsTestingOllama] = useState(false);
  const [ollamaHostInput, setOllamaHostInput] = useState(settings.ollamaHost || 'http://localhost:11434');
  const [ollamaStatusMessage, setOllamaStatusMessage] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const userScrolledUpRef = useRef<boolean>(false);
  const prevActiveConvoIdRef = useRef<string | null>(null);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState<boolean>(false);

  // Auto-resize textarea height
  const adjustTextareaHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = 190;
    const nextHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${Math.max(40, nextHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [inputMessage]);

  // Click-outside listener for conversation menu
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (activeMenuConvoId && menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setActiveMenuConvoId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeMenuConvoId]);

  const refreshModelsAndOllama = async (host?: string) => {
    const targetHost = host || settings.ollamaHost || 'http://localhost:11434';
    try {
      const connected = await ApiService.checkOllama(targetHost);
      setIsOllamaConnected(connected);
      const fetchedModels = await ApiService.fetchModels(targetHost);
      setModels(fetchedModels);
    } catch (err) {
      console.error("Failed to load models / check Ollama:", err);
    }
  };

  // --- Initialization ---
  useEffect(() => {
    const init = async () => {
      const rawStored = localStorage.getItem('void_chat_conversations');
      const hasCorruptedRaw = Boolean(rawStored && rawStored.trim().length > 0);

      const storedConvos = StorageService.getConversations();
      const storedPersonas = StorageService.getPersonas();
      const currentSettings = StorageService.getSettings();
      const savedActiveId = StorageService.getActiveConversationId();

      setPersonas(storedPersonas);
      setSettings(currentSettings);
      setOllamaHostInput(currentSettings.ollamaHost || 'http://localhost:11434');

      if (storedConvos.length === 0) {
        if (hasCorruptedRaw) {
          showToast('Notice: Corrupted conversation data was detected; an emergency backup was preserved.');
          const recoveredConvo: Conversation = {
            id: uuidv4(),
            title: 'New Conversation',
            messages: [],
            lastUpdated: Date.now(),
            personaId: currentSettings.activePersonaId,
            modelId: currentSettings.selectedModelId,
            isPinned: false,
          };
          setConversations([recoveredConvo]);
          setActiveConversationId(recoveredConvo.id);
        } else {
          const welcomeConvo: Conversation = {
            id: uuidv4(),
            title: 'Welcome to Void Chat',
            messages: [
              {
                id: uuidv4(),
                role: 'assistant',
                content: `# Welcome to Void Chat

A refined, minimalist AI interface designed for comfortable reading, distraction-free thinking, and direct connectivity to **local Ollama instances** or cloud models.

---

### Capabilities & Controls

- **Document-Style Message View**: Clean typographic hierarchy, syntax-highlighted code blocks with one-click copy, and responsive tables.
- **Message Editing**: Click the pen icon on any user prompt to edit it and branch clean responses.
- **Response Regeneration**: Click the refresh icon on any assistant response to re-generate in place.
- **Voice Dictation**: Click the microphone icon in the composer to dictate prompts directly.
- **Request Cancellation**: Click Stop anytime while an answer is generating.
- **Pinned Chats**: Pin your favorite conversations to the top of your sidebar via the three-dot menu.

\`\`\`typescript
export async function streamChat(prompt: string, modelId: string): Promise<string> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, modelId }),
  });
  return response.text();
}
\`\`\`

| Feature | Support | Mode |
| :--- | :--- | :--- |
| **Local Ollama** | Offline | 100% On-device |
| **Cloud Models** | OpenRouter / Gemini | Encrypted TLS |
| **Voice-to-Text** | Web Speech API | Client-side |

Type your query in the composer below or click the microphone to dictate.`,
                timestamp: Date.now(),
              }
            ],
            lastUpdated: Date.now(),
            personaId: currentSettings.activePersonaId,
            modelId: currentSettings.selectedModelId,
            isPinned: true,
          };

          setConversations([welcomeConvo]);
          setActiveConversationId(welcomeConvo.id);
        }
      } else {
        setConversations(storedConvos);
        const found = storedConvos.find(c => c.id === savedActiveId);
        setActiveConversationId(found ? found.id : (storedConvos[0]?.id || null));
      }

      isInitializedRef.current = true;
      await refreshModelsAndOllama(currentSettings.ollamaHost);
    };
    init();
  }, []);

  // Auto-save conversations
  useEffect(() => {
    if (!isInitializedRef.current) return;
    StorageService.saveConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    if (!isInitializedRef.current || !activeConversationId) return;
    StorageService.saveActiveConversationId(activeConversationId);
  }, [activeConversationId]);

  // Ensure active conversation ID is always valid when conversations exist
  useEffect(() => {
    if (!isInitializedRef.current || conversations.length === 0) return;
    if (!activeConversationId || !conversations.some(c => c.id === activeConversationId)) {
      setActiveConversationId(conversations[0].id);
    }
  }, [conversations, activeConversationId]);

  // Storage Quota Event Listener
  useEffect(() => {
    const handleQuotaExceeded = () => {
      showToast('Browser storage quota full! Please export and delete older conversations.');
    };
    window.addEventListener('void_storage_quota_exceeded', handleQuotaExceeded);
    return () => window.removeEventListener('void_storage_quota_exceeded', handleQuotaExceeded);
  }, []);

  // Periodic Ollama polling
  useEffect(() => {
    const interval = setInterval(() => {
      const targetHost = settings.ollamaHost || 'http://localhost:11434';
      ApiService.checkOllama(targetHost)
        .then(connected => {
          setIsOllamaConnected(prev => {
            if (prev !== connected) {
              refreshModelsAndOllama(targetHost);
            }
            return connected;
          });
        })
        .catch(() => setIsOllamaConnected(false));
    }, 25000);

    return () => clearInterval(interval);
  }, [settings.ollamaHost]);

  const handleChatScroll = () => {
    if (!chatContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
    const scrolledUp = distanceFromBottom > 80;
    userScrolledUpRef.current = scrolledUp;
    setIsUserScrolledUp(scrolledUp);
  };

  const scrollToBottom = (smooth = true) => {
    userScrolledUpRef.current = false;
    setIsUserScrolledUp(false);
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
    }
  };

  const toggleAutoScroll = () => {
    setSettings(prev => {
      const next: AppSettings = {
        ...prev,
        autoScroll: prev.autoScroll === false ? true : false,
      };
      StorageService.saveSettings(next);
      showToast(next.autoScroll ? 'Auto-scroll enabled' : 'Auto-scroll paused');
      return next;
    });
  };

  useEffect(() => {
    const isNewConversation = prevActiveConvoIdRef.current !== activeConversationId;
    prevActiveConvoIdRef.current = activeConversationId;

    if (isNewConversation) {
      userScrolledUpRef.current = false;
      setIsUserScrolledUp(false);
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'auto' });
      }, 30);
      return;
    }

    if (settings.autoScroll === false) return;
    if (userScrolledUpRef.current) return;

    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversations, activeConversationId, settings.autoScroll]);

  // Synchronize design system theme attribute & dark class
  useEffect(() => {
    const themeClass = settings.theme === 'dark' ? 'dark' : 'light';
    const themeAttr = settings.theme === 'dark' ? 'default-dark' : 'default-light';
    document.documentElement.setAttribute('data-theme', themeAttr);
    document.body.setAttribute('data-theme', themeAttr);
    document.body.className = themeClass;
    StorageService.saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    setIsInstalled(isRunningStandalone());
  }, []);

  useEffect(() => {
    const sessionChoice = sessionStorage.getItem(INSTALL_PROMPT_SESSION_KEY);
    const isStandaloneMediaQuery = window.matchMedia('(display-mode: standalone)');

    const handleStandaloneChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setIsInstalled(true);
        setIsInstallBannerVisible(false);
        setDeferredInstallPrompt(null);
      }
    };

    const handleBeforeInstallPrompt = (event: Event) => {
      const installEvent = event as BeforeInstallPromptEvent;
      installEvent.preventDefault();

      if (isRunningStandalone()) {
        setIsInstalled(true);
        setIsInstallBannerVisible(false);
        return;
      }

      setDeferredInstallPrompt(installEvent);
      setIsInstallBannerVisible(sessionChoice == null);
    };

    const handleAppInstalled = () => {
      sessionStorage.setItem(INSTALL_PROMPT_SESSION_KEY, 'accepted');
      setIsInstalled(true);
      setDeferredInstallPrompt(null);
      setIsInstallBannerVisible(false);
      setIsInstallPromptPending(false);
    };

    isStandaloneMediaQuery.addEventListener('change', handleStandaloneChange);
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    if (sessionChoice != null || isRunningStandalone()) {
      setIsInstallBannerVisible(false);
    }

    return () => {
      isStandaloneMediaQuery.removeEventListener('change', handleStandaloneChange);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // --- Voice-to-Text Dictation ---
  const handleToggleVoiceInput = () => {
    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      showToast('Speech recognition is not supported in this browser');
      return;
    }

    if (isListening) {
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.stop();
      }
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRecognitionClass();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || 'en-US';

      recognition.onstart = () => {
        setIsListening(true);
        showToast('Listening... Speak to dictate prompt');
      };

      recognition.onresult = (event: any) => {
        let currentTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          currentTranscript += event.results[i][0].transcript;
        }

        if (currentTranscript) {
          setInputMessage(prev => {
            const next = prev ? `${prev.trim()} ${currentTranscript}` : currentTranscript;
            setTimeout(adjustTextareaHeight, 10);
            return next;
          });
        }
      };

      recognition.onerror = (event: any) => {
        console.warn('Speech recognition error:', event.error);
        setIsListening(false);
        if (event.error === 'not-allowed') {
          showToast('Microphone access was denied. Please allow microphone permissions.');
        } else if (event.error !== 'no-speech') {
          showToast(`Voice input: ${event.error}`);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      speechRecognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error('Failed to start speech recognition:', err);
      setIsListening(false);
      showToast('Could not start microphone');
    }
  };

  useEffect(() => {
    return () => {
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.stop();
      }
    };
  }, []);

  // --- Stop Generation (Per-Conversation or Active) ---
  const handleStopGeneration = (convoId?: string) => {
    const targetId = convoId || activeConversationId;
    if (targetId && activeControllersRef.current.has(targetId)) {
      const controller = activeControllersRef.current.get(targetId);
      controller?.abort();
      activeControllersRef.current.delete(targetId);
    }
    setGeneratingConvoIds(prev => {
      const next = new Set(prev);
      if (targetId) next.delete(targetId);
      return next;
    });
    showToast('Generation stopped');
  };

  // --- Central Execution Engine with True SSE Incremental Streaming ---
  const executeGeneration = async (
    targetConvoId: string,
    messagesContext: ChatMessage[]
  ) => {
    if (activeControllersRef.current.has(targetConvoId)) {
      showToast('A generation is already in progress for this conversation');
      return;
    }

    const controller = new AbortController();
    activeControllersRef.current.set(targetConvoId, controller);
    setGeneratingConvoIds(prev => new Set(prev).add(targetConvoId));

    userScrolledUpRef.current = false;
    setIsUserScrolledUp(false);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 40);

    const targetConvo = conversations.find(c => c.id === targetConvoId);
    const modelToUse = targetConvo?.modelId || settings.selectedModelId;
    const personaIdToUse = targetConvo?.personaId || settings.activePersonaId;
    const personaToUse = personas.find(p => p.id === personaIdToUse) || personas[0];

    // Cap persona memories to top 5 to prevent prompt bloat and uncontrolled token growth
    const boundedMemories = personaToUse?.memories ? personaToUse.memories.slice(0, 5) : [];
    const memorySection = boundedMemories.length > 0
      ? `\n\nRelevant saved memories for this persona:\n${boundedMemories.map(m => `- ${m.content}`).join('\n')}`
      : '';
    const systemMessageContent = `System prompt:\n${personaToUse?.systemPrompt || ''}${memorySection}`;

    const systemMessage: ChatMessage = {
      id: 'system',
      role: 'system',
      content: systemMessageContent,
      timestamp: Date.now(),
    };

    const cleanMessages = messagesContext.filter(m => m.role !== 'system' && !m.isError);
    const assistantMessageId = uuidv4();
    const initialAssistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };

    // Insert initial empty assistant message bubble into target conversation
    setConversations(prev => prev.map(c => {
      if (c.id !== targetConvoId) return c;
      return {
        ...c,
        messages: [...cleanMessages, initialAssistantMessage],
        lastUpdated: Date.now(),
      };
    }));

    let streamedContent = '';

    try {
      const streamResult = await ApiService.chatCompletionStream(
        modelToUse,
        [systemMessage, ...cleanMessages],
        0.7,
        settings.ollamaHost,
        controller.signal,
        (_delta, accumulated) => {
          streamedContent = accumulated;
          setConversations(prev => prev.map(c => {
            if (c.id !== targetConvoId) return c;
            return {
              ...c,
              messages: c.messages.map(m => m.id === assistantMessageId ? { ...m, content: accumulated } : m),
              lastUpdated: Date.now(),
            };
          }));

          // Stream auto-scrolling that respects user manual scroll-up
          if (!userScrolledUpRef.current && targetConvoId === activeConversationId) {
            chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          }
        }
      );

      let finalContent = streamResult.content;
      if (streamResult.aborted) {
        finalContent = finalContent ? `${finalContent}\n\n*[Generation stopped by user]*` : '*[Generation stopped by user]*';
      }

      setConversations(prev => prev.map(c => {
        if (c.id !== targetConvoId) return c;
        const updatedMessages = c.messages.map(m => m.id === assistantMessageId ? { ...m, content: finalContent } : m);
        const nextConvo = {
          ...c,
          messages: updatedMessages,
          lastUpdated: Date.now(),
        };

        if (
          (nextConvo.messages.length >= 2 && (nextConvo.title === 'Welcome to Void Chat' || nextConvo.title === 'New Conversation')) ||
          !nextConvo.title
        ) {
          const firstUser = nextConvo.messages.find(m => m.role === 'user');
          if (firstUser) {
            nextConvo.title = firstUser.content.slice(0, 32) + (firstUser.content.length > 32 ? '...' : '');
          }
        }

        return nextConvo;
      }));
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) {
        const finalContent = streamedContent ? `${streamedContent}\n\n*[Generation stopped by user]*` : '*[Generation stopped by user]*';
        setConversations(prev => prev.map(c => {
          if (c.id !== targetConvoId) return c;
          return {
            ...c,
            messages: c.messages.map(m => m.id === assistantMessageId ? { ...m, content: finalContent } : m),
            lastUpdated: Date.now(),
          };
        }));
        return;
      }

      console.error('Generation error:', err);
      const errorMessage: ChatMessage = {
        id: uuidv4(),
        role: 'system',
        content: `Error: ${err?.message || 'Unknown error occurred'}`,
        timestamp: Date.now(),
        isError: true,
      };

      setConversations(prev => prev.map(c => {
        if (c.id !== targetConvoId) return c;
        const baseMessages = streamedContent
          ? c.messages.map(m => m.id === assistantMessageId ? { ...m, content: streamedContent } : m)
          : c.messages.filter(m => m.id !== assistantMessageId);
        return {
          ...c,
          messages: [...baseMessages, errorMessage],
          lastUpdated: Date.now(),
        };
      }));
    } finally {
      activeControllersRef.current.delete(targetConvoId);
      setGeneratingConvoIds(prev => {
        const next = new Set(prev);
        next.delete(targetConvoId);
        return next;
      });
    }
  };

  // --- Handlers ---
  const handleNewChat = (title = 'New Conversation') => {
    const newConvo = StorageService.createConversation(title, settings.activePersonaId, settings.selectedModelId);
    setConversations([newConvo, ...conversations]);
    setActiveConversationId(newConvo.id);
    setIsSidebarOpen(false);
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 50);
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputMessage.trim() || !activeConversation || isLoading) return;

    if (isListening && speechRecognitionRef.current) {
      speechRecognitionRef.current.stop();
      setIsListening(false);
    }

    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: inputMessage.trim(),
      timestamp: Date.now(),
    };

    const nextMessages = [...activeConversation.messages, userMessage];

    const updatedConvo = {
      ...activeConversation,
      messages: nextMessages,
      lastUpdated: Date.now(),
    };

    setConversations(prev => prev.map(c => c.id === activeConversation.id ? updatedConvo : c));
    setInputMessage('');
    if (textareaRef.current) {
      textareaRef.current.style.height = '40px';
    }

    await executeGeneration(activeConversation.id, nextMessages);
  };

  // --- Edit User Message ---
  const handleStartEditUserMessage = (msg: ChatMessage) => {
    setEditingUserMessageId(msg.id);
    setEditingUserMessageContent(msg.content);
  };

  const handleCancelEditUserMessage = () => {
    setEditingUserMessageId(null);
    setEditingUserMessageContent('');
  };

  const handleSaveAndResubmitUserMessage = async (msgId: string) => {
    if (!activeConversation || !editingUserMessageContent.trim()) return;

    const messageIndex = activeConversation.messages.findIndex(m => m.id === msgId);
    if (messageIndex === -1) return;

    const historyBefore = activeConversation.messages.slice(0, messageIndex);
    const updatedUserMsg: ChatMessage = {
      id: msgId,
      role: 'user',
      content: editingUserMessageContent.trim(),
      timestamp: Date.now(),
    };

    const nextMessages = [...historyBefore, updatedUserMsg];

    const updatedConvo = {
      ...activeConversation,
      messages: nextMessages,
      lastUpdated: Date.now(),
    };

    setConversations(prev => prev.map(c => c.id === activeConversation.id ? updatedConvo : c));
    setEditingUserMessageId(null);
    setEditingUserMessageContent('');

    showToast('Resubmitting updated prompt...');
    await executeGeneration(activeConversation.id, nextMessages);
  };

  // --- Regenerate Assistant Response ---
  const handleRegenerateResponse = async (assistantMsgId: string) => {
    if (!activeConversation || isLoading) return;

    const msgIndex = activeConversation.messages.findIndex(m => m.id === assistantMsgId);
    if (msgIndex === -1) return;

    const contextBefore = activeConversation.messages.slice(0, msgIndex);
    if (contextBefore.length === 0) return;

    const updatedConvo = {
      ...activeConversation,
      messages: contextBefore,
      lastUpdated: Date.now(),
    };

    setConversations(prev => prev.map(c => c.id === activeConversation.id ? updatedConvo : c));

    showToast('Regenerating response...');
    await executeGeneration(activeConversation.id, contextBefore);
  };

  // --- Retry from Error Message ---
  const handleRetryFromError = async (errorMsgId: string) => {
    if (!activeConversation || isLoading) return;

    const cleanMessages = activeConversation.messages.filter(m => m.id !== errorMsgId);

    const updatedConvo = {
      ...activeConversation,
      messages: cleanMessages,
      lastUpdated: Date.now(),
    };

    setConversations(prev => prev.map(c => c.id === activeConversation.id ? updatedConvo : c));

    showToast('Retrying generation...');
    await executeGeneration(activeConversation.id, cleanMessages);
  };

  // --- Pin / Unpin Conversation ---
  const handleTogglePin = (convoId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setConversations(prev => {
      const next = prev.map(c => c.id === convoId ? { ...c, isPinned: !c.isPinned } : c);
      const target = next.find(c => c.id === convoId);
      showToast(target?.isPinned ? 'Conversation pinned' : 'Conversation unpinned');
      return next;
    });
    setActiveMenuConvoId(null);
  };

  const handleStartRename = (convo: Conversation, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingConvoId(convo.id);
    setEditingTitleText(convo.title || 'Untitled');
    setActiveMenuConvoId(null);
  };

  const handleSaveTitle = (id: string) => {
    const trimmed = editingTitleText.trim() || 'Untitled';
    setConversations(prev => prev.map(c => c.id === id ? { ...c, title: trimmed, lastUpdated: Date.now() } : c));
    setEditingConvoId(null);
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleExportAllChats = () => {
    StorageService.exportChatHistory(conversations);
    setExportFeedbackMessage(`Exported ${conversations.length} conversation(s) to JSON`);
    showToast(`Exported ${conversations.length} conversation(s)`);
    setTimeout(() => setExportFeedbackMessage(null), 4000);
  };

  const handleExportSingleChat = (convoId: string) => {
    const target = conversations.find(c => c.id === convoId);
    if (!target) return;
    StorageService.exportChatHistory(conversations, convoId);
    setExportFeedbackMessage(`Exported "${target.title}" to JSON`);
    showToast(`Exported "${target.title}"`);
    setTimeout(() => setExportFeedbackMessage(null), 4000);
    setActiveMenuConvoId(null);
  };

  const processJsonFile = (file: File) => {
    if (!file.name.endsWith('.json') && file.type && !file.type.includes('json')) {
      showToast('Please select a valid .json file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (!content) {
        showToast('The selected file is empty');
        return;
      }

      const { conversations: parsedConvos, error } = StorageService.parseImportData(content);
      if (error || parsedConvos.length === 0) {
        showToast(error || 'Failed to parse conversations from JSON');
        return;
      }

      const totalMessages = parsedConvos.reduce((acc, c) => acc + (c.messages?.length || 0), 0);
      setPendingImport({
        fileName: file.name,
        conversations: parsedConvos,
        totalMessages,
      });
      setImportMode('merge');
      setIsImportModalOpen(true);
    };

    reader.onerror = () => {
      showToast('Error reading the selected file');
    };

    reader.readAsText(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processJsonFile(file);
    }
    e.target.value = '';
  };

  const handleConfirmImport = () => {
    if (!pendingImport) return;

    const nextConversations = StorageService.importConversations(pendingImport.conversations, importMode);
    setConversations(nextConversations);
    if (nextConversations.length > 0) {
      setActiveConversationId(nextConversations[0].id);
    }

    showToast(`Imported ${pendingImport.conversations.length} conversation(s)`);
    setIsImportModalOpen(false);
    setPendingImport(null);
    setIsSidebarOpen(false);
  };

  const handleSummarizeMemory = async () => {
    if (!activeConversation || activeConversation.messages.length < 2 || isLoading || isSummarizingMemory) return;

    setIsSummarizingMemory(true);
    try {
      const summary = await ApiService.summarizeMemory(settings.selectedModelId, activeConversation.messages, settings.ollamaHost);
      const newMemory: PersonaMemory = {
        id: uuidv4(),
        content: summary,
        timestamp: Date.now(),
      };

      const updatedPersonas = personas.map(p =>
        p.id === settings.activePersonaId
          ? { ...p, memories: [newMemory, ...p.memories] }
          : p
      );
      setPersonas(updatedPersonas);
      StorageService.savePersonas(updatedPersonas);
      showToast('Memory summarized for active persona');
    } catch (err) {
      console.error(err);
      showToast('Failed to summarize memory');
    } finally {
      setIsSummarizingMemory(false);
    }
  };

  const handleTestOllamaConnection = async () => {
    setIsTestingOllama(true);
    setOllamaStatusMessage(null);
    const host = ollamaHostInput.trim() || 'http://localhost:11434';

    const nextSettings: AppSettings = { ...settings, ollamaHost: host };
    setSettings(nextSettings);
    StorageService.saveSettings(nextSettings);

    try {
      const connected = await ApiService.checkOllama(host);
      setIsOllamaConnected(connected);

      const refreshedModels = await ApiService.fetchModels(host);
      setModels(refreshedModels);

      const localModels = refreshedModels.filter(m => m.id.startsWith('ollama/'));
      if (connected) {
        setOllamaStatusMessage(`Connected! Found ${localModels.length} local model(s).`);
      } else {
        setOllamaStatusMessage('Could not connect. Ensure `ollama serve` is running.');
      }
    } catch (err) {
      console.error(err);
      setIsOllamaConnected(false);
      setOllamaStatusMessage('Connection attempt failed.');
    } finally {
      setIsTestingOllama(false);
    }
  };

  const deleteConversation = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setActiveMenuConvoId(null);
    if (confirm('Delete this conversation? This action cannot be undone.')) {
      StorageService.deleteConversation(id);
      const newConvos = conversations.filter(c => c.id !== id);
      setConversations(newConvos);
      if (activeConversationId === id) {
        setActiveConversationId(newConvos[0]?.id || null);
      }
      showToast('Conversation deleted');
    }
  };

  const handlePersonaSelect = (personaId: string) => {
    const selectedPersona = personas.find(p => p.id === personaId);
    const chosenModel = selectedPersona?.selectedModelId || settings.selectedModelId;
    setSettings(prev => {
      const nextSettings = { ...prev, activePersonaId: personaId, selectedModelId: chosenModel };
      StorageService.saveSettings(nextSettings);
      return nextSettings;
    });
    if (activeConversationId) {
      setConversations(prev => prev.map(c => c.id === activeConversationId ? {
        ...c,
        personaId,
        modelId: chosenModel,
        lastUpdated: Date.now()
      } : c));
    }
  };

  const handleModelSelect = (modelId: string) => {
    setSettings(prev => {
      const nextSettings = { ...prev, selectedModelId: modelId };
      StorageService.saveSettings(nextSettings);
      return nextSettings;
    });
    if (activeConversationId) {
      setConversations(prev => prev.map(c => c.id === activeConversationId ? {
        ...c,
        modelId,
        lastUpdated: Date.now()
      } : c));
    }
  };

  const handleSelectConversation = (convoId: string) => {
    setActiveConversationId(convoId);
    setIsSidebarOpen(false);
    const target = conversations.find(c => c.id === convoId);
    if (target) {
      setSettings(prev => {
        const next = {
          ...prev,
          selectedModelId: target.modelId || prev.selectedModelId,
          activePersonaId: target.personaId || prev.activePersonaId,
        };
        StorageService.saveSettings(next);
        return next;
      });
    }
  };

  const handleUpdatePersonaModel = (personaId: string, modelId: string) => {
    const next = personas.map(p => p.id === personaId ? { ...p, selectedModelId: modelId } : p);
    setPersonas(next);
    StorageService.savePersonas(next);

    if (settings.activePersonaId === personaId) {
      setSettings(prev => ({ ...prev, selectedModelId: modelId }));
    }
  };

  const toggleTheme = () => {
    setSettings(prev => ({ ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' }));
  };

  const dismissInstallBanner = () => {
    sessionStorage.setItem(INSTALL_PROMPT_SESSION_KEY, 'declined');
    setIsInstallBannerVisible(false);
  };

  const handleInstallApp = async () => {
    if (!deferredInstallPrompt) return;
    setIsInstallPromptPending(true);

    try {
      await deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;

      sessionStorage.setItem(
        INSTALL_PROMPT_SESSION_KEY,
        choice.outcome === 'accepted' ? 'accepted' : 'declined',
      );

      setIsInstallBannerVisible(false);
      setDeferredInstallPrompt(null);

      if (choice.outcome === 'accepted') {
        setIsInstalled(true);
      }
    } catch (error) {
      console.error('Install prompt failed:', error);
    } finally {
      setIsInstallPromptPending(false);
    }
  };

  const handleCopyMessage = async (messageId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);
      window.setTimeout(() => {
        setCopiedMessageId(current => current === messageId ? null : current);
      }, 2000);
    } catch (err) {
      console.error('Failed to copy message:', err);
    }
  };

  // --- Derived State for Conversations & Search ---
  const activeConversation = conversations.find(c => c.id === activeConversationId);
  const activePersona = personas.find(p => p.id === (activeConversation?.personaId || settings.activePersonaId)) || personas[0];

  const searchFilteredConversations = conversations.filter(c => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const titleMatch = c.title.toLowerCase().includes(query);
    const messageMatch = c.messages.some(m => m.content.toLowerCase().includes(query));
    return titleMatch || messageMatch;
  });

  const pinnedConversations = searchFilteredConversations.filter(c => Boolean(c.isPinned));
  const recentConversations = searchFilteredConversations.filter(c => !c.isPinned);

  const availableModels = models.filter(m => {
    const matchesSearch = m.name.toLowerCase().includes(modelSearch.toLowerCase()) || m.id.toLowerCase().includes(modelSearch.toLowerCase());
    const isFree = parseFloat(m.pricing?.prompt || '1') === 0 && parseFloat(m.pricing?.completion || '1') === 0;
    return matchesSearch && (freeModelsOnly ? isFree : true);
  });

  // --- Helper to render each conversation list item ---
  const renderConversationItem = (convo: Conversation) => {
    const isActive = activeConversationId === convo.id;
    const modelName = models.find(m => m.id === convo.modelId)?.name?.split('/')[1] || 'AI';
    const isMenuOpen = activeMenuConvoId === convo.id;

    const lastMeaningfulMsg = convo.messages[convo.messages.length - 1];
    let previewText = 'Empty transmission';
    if (lastMeaningfulMsg) {
      const clean = lastMeaningfulMsg.content.replace(/[#*`_~]/g, '').trim();
      previewText = lastMeaningfulMsg.role === 'user' ? `You: ${clean}` : clean;
    }

    let searchSnippet: string | null = null;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchedMsg = convo.messages.find(m => m.content.toLowerCase().includes(q));
      if (matchedMsg) {
        const idx = matchedMsg.content.toLowerCase().indexOf(q);
        const start = Math.max(0, idx - 20);
        const end = Math.min(matchedMsg.content.length, idx + q.length + 30);
        searchSnippet = `...${matchedMsg.content.slice(start, end).replace(/\n/g, ' ')}...`;
      }
    }

    const isConvoGenerating = generatingConvoIds.has(convo.id);

    return (
      <div
        key={convo.id}
        onClick={() => handleSelectConversation(convo.id)}
        className={cn(
          "group relative p-2.5 rounded-xl cursor-pointer transition-all duration-200 border select-none",
          isActive
            ? "bg-[var(--bg-hover)] border-[var(--border)] text-[var(--text-primary)] elevation-low font-medium"
            : "border-transparent hover:bg-[var(--bg-tertiary)] hover:border-[var(--border-light)] text-[var(--text-secondary)]"
        )}
      >
        {editingConvoId === convo.id ? (
          <div className="flex items-center gap-2 py-0.5" onClick={(e) => e.stopPropagation()}>
            <input
              type="text"
              value={editingTitleText}
              autoFocus
              onChange={(e) => setEditingTitleText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveTitle(convo.id);
                if (e.key === 'Escape') setEditingConvoId(null);
              }}
              className="flex-1 text-xs px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)] font-medium"
            />
            <button
              type="button"
              onClick={() => handleSaveTitle(convo.id)}
              title="Save title"
              className="p-1 hover:text-[var(--success)] text-[var(--text-muted)] transition-colors cursor-pointer"
            >
              <Check size={14} />
            </button>
            <button
              type="button"
              onClick={() => setEditingConvoId(null)}
              title="Cancel"
              className="p-1 hover:text-[var(--danger)] text-[var(--text-muted)] transition-colors cursor-pointer"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1">
                {convo.isPinned && (
                  <Pin size={11} className="text-[var(--accent-primary)] shrink-0 rotate-45" />
                )}
                {isConvoGenerating && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)] animate-pulse shrink-0" title="Generating response..." />
                )}
                <p className={cn(
                  "text-xs truncate leading-snug tracking-tight",
                  isActive ? "font-semibold text-[var(--text-primary)]" : "font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]"
                )}>
                  {convo.title || 'Untitled'}
                </p>
              </div>

              {searchSnippet ? (
                <p className="text-[11px] text-[var(--text-primary)] font-mono truncate leading-tight">
                  {searchSnippet}
                </p>
              ) : (
                <p className="text-[11px] text-[var(--text-muted)] truncate leading-tight">
                  {previewText}
                </p>
              )}

              <p className="text-[10px] text-[var(--text-muted)] font-mono tracking-tight mt-1.5 truncate">
                {new Date(convo.lastUpdated).toLocaleDateString([], { month: 'short', day: 'numeric' })} · {modelName}
              </p>
            </div>

            {/* Context menu button */}
            <div className="relative shrink-0 pt-0.5" ref={isMenuOpen ? menuContainerRef : null}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveMenuConvoId(prev => prev === convo.id ? null : convo.id);
                }}
                className={cn(
                  "p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer",
                  isMenuOpen ? "text-[var(--text-primary)] bg-[var(--bg-hover)]" : "opacity-0 group-hover:opacity-100"
                )}
                title="Conversation options"
                aria-label="Conversation options"
              >
                <MoreVertical size={13} />
              </button>

              {/* Context Menu Popover */}
              {isMenuOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-0 top-7 w-40 py-1.5 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] elevation-modal z-30 flex flex-col text-xs text-[var(--text-primary)] backdrop-blur-md"
                >
                  <button
                    type="button"
                    onClick={(e) => handleTogglePin(convo.id, e)}
                    className="px-3.5 py-2 flex items-center gap-2 hover:bg-[var(--bg-hover)] text-left cursor-pointer transition-colors"
                  >
                    {convo.isPinned ? <PinOff size={13} className="text-[var(--accent-primary)]" /> : <Pin size={13} />}
                    <span>{convo.isPinned ? 'Unpin chat' : 'Pin to top'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => handleStartRename(convo, e)}
                    className="px-3.5 py-2 flex items-center gap-2 hover:bg-[var(--bg-hover)] text-left cursor-pointer transition-colors"
                  >
                    <Edit3 size={13} />
                    <span>Rename</span>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleExportSingleChat(convo.id); }}
                    className="px-3.5 py-2 flex items-center gap-2 hover:bg-[var(--bg-hover)] text-left cursor-pointer transition-colors"
                  >
                    <Download size={13} />
                    <span>Export JSON</span>
                  </button>

                  <div className="my-1 border-t border-[var(--border-light)]" />

                  <button
                    type="button"
                    onClick={(e) => deleteConversation(convo.id, e)}
                    className="px-3.5 py-2 flex items-center gap-2 text-[var(--danger)] hover:bg-[var(--danger)]/10 text-left cursor-pointer transition-colors"
                  >
                    <Trash2 size={13} />
                    <span>Delete chat</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderSidebar = () => (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 w-[280px] z-50 border-r border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col",
        "transition-transform duration-250 ease-[cubic-bezier(0.4,0,0.2,1)] md:translate-x-0 md:static md:z-auto",
        isSidebarOpen ? "translate-x-0 elevation-modal" : "-translate-x-full"
      )}
    >
      {/* Brand Header */}
      <div className="p-4 pb-3 flex items-center justify-between border-b border-[var(--border-light)]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border)] flex items-center justify-center text-[var(--accent-primary)]">
            <Sparkles size={14} />
          </div>
          <div>
            <h1 className="text-xs font-semibold tracking-wider uppercase text-[var(--text-primary)]">
              Void Chat
            </h1>
          </div>
        </div>
        <IconButton icon={X} onClick={() => setIsSidebarOpen(false)} className="md:hidden" size={16} />
      </div>

      {/* Action Buttons: New Chat & Import */}
      <div className="p-3 pb-2 flex items-center gap-2">
        <button
          onClick={() => handleNewChat()}
          className="flex-1 py-2.5 px-3.5 rounded-xl text-xs font-medium text-left transition-all duration-200 flex items-center justify-between cursor-pointer border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-light)] text-[var(--text-primary)] elevation-low active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:outline-none"
        >
          <span className="font-semibold">New Chat</span>
          <Plus size={15} className="text-[var(--text-muted)]" />
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          title="Import chat history (JSON)"
          aria-label="Import chat history JSON"
          className="touch-target p-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all cursor-pointer elevation-low active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:outline-none"
        >
          <Upload size={15} />
        </button>
      </div>

      {/* Search Conversations */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl pl-9 pr-8 py-2 text-xs border border-[var(--border)] bg-[var(--bg-card)] placeholder:text-[var(--text-muted)] text-[var(--text-primary)] outline-none transition-all duration-200 focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)]"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-1 space-y-3">
        {searchFilteredConversations.length === 0 ? (
          <div className="py-12 px-4 text-center text-xs text-[var(--text-muted)]">
            {searchQuery ? (
              <div className="flex flex-col items-center gap-2">
                <Search size={18} className="opacity-40" />
                <span>No matching conversations</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <MessageSquare size={18} className="opacity-40" />
                <span>No conversations yet</span>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Pinned Section */}
            {pinnedConversations.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 px-2 text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-semibold">
                  <Pin size={10} className="text-[var(--accent-primary)]" />
                  <span>Pinned ({pinnedConversations.length})</span>
                </div>
                <div className="space-y-1">
                  {pinnedConversations.map(convo => renderConversationItem(convo))}
                </div>
              </div>
            )}

            {/* Recent Section */}
            <div className="space-y-1">
              {pinnedConversations.length > 0 && (
                <div className="px-2 text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-semibold pt-1">
                  Recent
                </div>
              )}
              <div className="space-y-1">
                {recentConversations.map(convo => renderConversationItem(convo))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Sidebar Footer */}
      <div className="p-3 border-t border-[var(--border)] flex items-center justify-between text-xs bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-2">
          <span className={cn(
            "w-2 h-2 rounded-full",
            isOllamaConnected ? "bg-[var(--success)]" : "bg-[var(--text-muted)]"
          )} />
          <span className="text-[11px] font-mono uppercase text-[var(--text-muted)] tracking-wider">
            {isOllamaConnected ? 'Ollama Live' : 'Cloud Ready'}
          </span>
        </div>

        <button
          onClick={() => {
            setSettingsTab('settings');
            setIsPersonaManagerOpen(true);
          }}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors flex items-center gap-1.5 cursor-pointer font-medium text-xs px-2.5 py-1.5 rounded-lg hover:bg-[var(--bg-hover)] focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]"
        >
          <Settings size={14} />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );

  const renderModelSelector = () => (
    <AnimatePresence>
      {isModelSelectorOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsModelSelectorOpen(false)}
            className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[60]"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="fixed inset-x-4 top-[10%] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[560px] max-h-[78vh] z-[70] border border-[var(--border)] bg-[var(--bg-card)] rounded-2xl flex flex-col p-6 overflow-hidden elevation-modal text-[var(--text-primary)]"
          >
            <div className="flex items-center justify-between pb-3.5 border-b border-[var(--border-light)]">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
                  Select Intelligence Model
                </h2>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Choose from local Ollama or high-speed cloud LLMs
                </p>
              </div>
              <IconButton icon={X} onClick={() => setIsModelSelectorOpen(false)} size={16} />
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 my-3.5">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  type="text"
                  placeholder="Filter models by name or id..."
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  className="w-full rounded-xl pl-9 pr-3 py-2 text-xs border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)] transition-all"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer px-2 py-1 text-xs select-none">
                <input
                  type="checkbox"
                  checked={freeModelsOnly}
                  onChange={e => setFreeModelsOnly(e.target.checked)}
                  className="rounded accent-[var(--accent-primary)] cursor-pointer"
                />
                <span className="text-xs text-[var(--text-secondary)] font-medium">Free only</span>
              </label>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin space-y-2 pr-1 pb-2">
              {availableModels.length === 0 ? (
                <div className="p-10 text-center text-[var(--text-muted)] text-xs italic">
                  No models match the filter
                </div>
              ) : (
                availableModels.map(model => {
                  const isSelected = settings.selectedModelId === model.id;
                  const isOllama = model.id.startsWith('ollama/');
                  const isFree = parseFloat(model.pricing?.prompt || '1') === 0 && parseFloat(model.pricing?.completion || '1') === 0;

                  return (
                    <div
                      key={model.id}
                      onClick={() => {
                        handleModelSelect(model.id);
                        setIsModelSelectorOpen(false);
                      }}
                      className={cn(
                        "p-3.5 rounded-xl border cursor-pointer transition-all duration-200 flex items-center justify-between gap-3 active:scale-[0.99]",
                        isSelected
                          ? "bg-[var(--bg-hover)] border-[var(--accent-primary)] elevation-low"
                          : "border-[var(--border-light)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] hover:border-[var(--border)]"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold truncate text-[var(--text-primary)]">{model.name}</span>
                          {isOllama && (
                            <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-[var(--info)]/10 text-[var(--info)] border border-[var(--info)]/20 uppercase font-semibold">
                              OLLAMA
                            </span>
                          )}
                          {isFree && (
                            <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-[var(--success)]/10 text-[var(--success)] border border-[var(--success)]/20 uppercase font-semibold">
                              FREE
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] font-mono text-[var(--text-muted)] truncate">{model.id}</p>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-[10px] font-mono text-[var(--text-muted)] block">
                          {model.context_length ? `${Math.round(model.context_length / 1024)}k ctx` : ''}
                        </span>
                        {isSelected && (
                          <span className="text-[11px] font-semibold text-[var(--accent-primary)]">Selected</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  const renderPersonaManager = () => (
    <AnimatePresence>
      {isPersonaManagerOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsPersonaManagerOpen(false)}
            className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[60]"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="fixed inset-x-4 top-[8%] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[640px] max-h-[84vh] z-[70] border border-[var(--border)] bg-[var(--bg-card)] rounded-2xl flex flex-col p-6 overflow-hidden elevation-modal text-[var(--text-primary)]"
          >
            {/* Header & Tabs */}
            <div className="flex items-center justify-between pb-3.5 border-b border-[var(--border-light)]">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSettingsTab('settings')}
                  className={cn(
                    "px-3.5 py-1.5 rounded-xl text-xs font-semibold tracking-wide transition-all cursor-pointer flex items-center gap-2",
                    settingsTab === 'settings'
                      ? "bg-[var(--accent-primary)] text-[var(--bg-primary)] shadow-sm"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                  )}
                >
                  <Settings size={14} />
                  <span>General & Data</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsTab('personas')}
                  className={cn(
                    "px-3.5 py-1.5 rounded-xl text-xs font-semibold tracking-wide transition-all cursor-pointer flex items-center gap-2",
                    settingsTab === 'personas'
                      ? "bg-[var(--accent-primary)] text-[var(--bg-primary)] shadow-sm"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                  )}
                >
                  <User size={14} />
                  <span>Personas ({personas.length})</span>
                </button>
              </div>
              <IconButton icon={X} onClick={() => setIsPersonaManagerOpen(false)} size={16} />
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin py-4 space-y-4 pr-1">
              {settingsTab === 'settings' ? (
                <div className="space-y-4">
                  {/* Export & Import Card */}
                  <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col gap-3 elevation-low">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] font-mono">
                          Chat Data & Archiving
                        </h3>
                        <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                          Export portable JSON backups or import existing chat archives
                        </p>
                      </div>
                      <span className="text-[11px] font-mono text-[var(--text-muted)]">
                        {conversations.length} chats · {conversations.reduce((acc, c) => acc + (c.messages?.length || 0), 0)} msgs
                      </span>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                      <Button
                        type="button"
                        variant="primary"
                        onClick={handleExportAllChats}
                        className="flex-1"
                      >
                        <Download size={14} />
                        <span>Export All Chats (JSON)</span>
                      </Button>

                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex-1"
                      >
                        <Upload size={14} />
                        <span>Import Backup (JSON)</span>
                      </Button>
                    </div>

                    {/* Drag and drop zone */}
                    <div
                      onDragOver={(e) => { e.preventDefault(); setIsDraggingFile(true); }}
                      onDragLeave={() => setIsDraggingFile(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDraggingFile(false);
                        const file = e.dataTransfer.files?.[0];
                        if (file) processJsonFile(file);
                      }}
                      onClick={() => fileInputRef.current?.click()}
                      className={cn(
                        "p-3.5 rounded-xl border border-dashed text-center cursor-pointer transition-all flex items-center justify-center gap-2",
                        isDraggingFile
                          ? "border-[var(--accent-primary)] bg-[var(--bg-hover)]"
                          : "border-[var(--border)] hover:border-[var(--border-light)] hover:bg-[var(--bg-tertiary)]"
                      )}
                    >
                      <FileUp size={15} className="text-[var(--text-muted)]" />
                      <span className="text-xs text-[var(--text-secondary)]">
                        Drop a JSON backup file here or click to browse
                      </span>
                    </div>

                    {exportFeedbackMessage && (
                      <div className="px-3.5 py-2.5 rounded-xl bg-[var(--success)]/10 border border-[var(--success)]/20 text-[var(--success)] text-xs font-mono flex items-center gap-2">
                        <Check size={14} />
                        <span>{exportFeedbackMessage}</span>
                      </div>
                    )}
                  </div>

                  {/* Ollama Local Integration */}
                  <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] flex items-center justify-between elevation-low">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Server size={15} className="text-[var(--text-muted)]" />
                        <h3 className="text-xs font-semibold text-[var(--text-primary)]">Ollama Local Integration</h3>
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)] font-mono">
                        Host: {settings.ollamaHost || 'http://localhost:11434'} · Status: <span className={isOllamaConnected ? "text-[var(--success)]" : "text-[var(--text-muted)]"}>{isOllamaConnected ? 'Connected' : 'Offline'}</span>
                      </p>
                    </div>

                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setIsPersonaManagerOpen(false);
                        setIsOllamaModalOpen(true);
                      }}
                    >
                      Configure Host
                    </Button>
                  </div>

                  {/* Auto-scroll Toggle */}
                  <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] flex items-center justify-between elevation-low">
                    <div className="space-y-0.5">
                      <h3 className="text-xs font-semibold text-[var(--text-primary)]">Auto-Scroll</h3>
                      <p className="text-[11px] text-[var(--text-muted)]">
                        Anchors chat view to latest responses; automatically pauses when reviewing earlier text
                      </p>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={settings.autoScroll !== false}
                      onClick={toggleAutoScroll}
                      className={cn(
                        "w-11 h-6 rounded-full p-0.5 transition-colors relative cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:outline-none",
                        settings.autoScroll !== false
                          ? "bg-[var(--accent-primary)]"
                          : "bg-[var(--border)]"
                      )}
                    >
                      <div
                        className={cn(
                          "w-5 h-5 rounded-full transition-transform duration-200",
                          settings.autoScroll !== false
                            ? "translate-x-5 bg-[var(--bg-primary)]"
                            : "translate-x-0 bg-[var(--text-muted)]"
                        )}
                      />
                    </button>
                  </div>

                  {/* Appearance Switch */}
                  <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] flex items-center justify-between elevation-low">
                    <div className="space-y-0.5">
                      <h3 className="text-xs font-semibold text-[var(--text-primary)]">Appearance Theme</h3>
                      <p className="text-[11px] text-[var(--text-muted)]">Pure AMOLED Black (#000000) or Clean Minimalist Light mode</p>
                    </div>

                    <Button
                      type="button"
                      variant="secondary"
                      onClick={toggleTheme}
                    >
                      {settings.theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                      <span>{settings.theme === 'dark' ? 'AMOLED Dark' : 'Minimal Light'}</span>
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {personas.map(persona => {
                    const isPersonaActive = settings.activePersonaId === persona.id;

                    return (
                      <div
                        key={persona.id}
                        className={cn(
                          "p-4 rounded-xl border flex flex-col gap-3 transition-all duration-200 elevation-low",
                          isPersonaActive
                            ? "bg-[var(--bg-hover)] border-[var(--accent-primary)]"
                            : "bg-[var(--bg-secondary)] border-[var(--border)] hover:border-[var(--border-light)]"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 flex-1">
                            <span className={cn(
                              "w-2 h-2 rounded-full",
                              isPersonaActive ? "bg-[var(--accent-primary)]" : "bg-[var(--text-muted)]"
                            )} />
                            <input
                              type="text"
                              value={persona.name}
                              onChange={(e) => {
                                const next = personas.map(p => p.id === persona.id ? { ...p, name: e.target.value } : p);
                                setPersonas(next);
                                StorageService.savePersonas(next);
                              }}
                              className="text-xs font-semibold bg-transparent border-none outline-none w-full text-[var(--text-primary)]"
                            />
                          </div>

                          <div className="flex items-center gap-2">
                            {persona.id !== 'default' && (
                              <IconButton
                                icon={Trash2}
                                size={14}
                                onClick={() => {
                                  if (confirm('Delete this persona?')) {
                                    const next = personas.filter(p => p.id !== persona.id);
                                    setPersonas(next);
                                    StorageService.savePersonas(next);
                                    if (settings.activePersonaId === persona.id) {
                                      setSettings(prev => ({ ...prev, activePersonaId: 'default' }));
                                    }
                                  }
                                }}
                                className="text-[var(--text-muted)] hover:text-[var(--danger)]"
                              />
                            )}
                            <Button
                              variant={isPersonaActive ? 'primary' : 'secondary'}
                              onClick={() => handlePersonaSelect(persona.id)}
                              className="text-[11px] font-semibold uppercase tracking-wider py-1 px-3 min-h-[34px]"
                            >
                              {isPersonaActive ? 'Active' : 'Select'}
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-2 pt-2 border-t border-[var(--border-light)]">
                          <div>
                            <label className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] block mb-1">
                              Associated Model Override
                            </label>
                            <select
                              value={persona.selectedModelId || ''}
                              onChange={(e) => handleUpdatePersonaModel(persona.id, e.target.value)}
                              className="w-full rounded-xl px-3 py-2 text-xs border border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)]"
                            >
                              <option value="">Default (Global Selection)</option>
                              {models.map(m => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] block mb-1">
                              System Instructions
                            </label>
                            <textarea
                              value={persona.systemPrompt}
                              onChange={(e) => {
                                const next = personas.map(p => p.id === persona.id ? { ...p, systemPrompt: e.target.value } : p);
                                setPersonas(next);
                                StorageService.savePersonas(next);
                              }}
                              rows={2}
                              className="w-full rounded-xl p-2.5 text-xs border border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] outline-none resize-none leading-relaxed focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)]"
                            />
                          </div>

                          {persona.memories.length > 0 && (
                            <div>
                              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] block mb-1">
                                Saved Memories ({persona.memories.length})
                              </span>
                              <div className="space-y-1.5 max-h-32 overflow-y-auto scrollbar-thin">
                                {persona.memories.map(m => (
                                  <div
                                    key={m.id}
                                    className="p-2.5 rounded-lg border border-[var(--border-light)] bg-[var(--bg-tertiary)] text-[11px] text-[var(--text-secondary)] flex items-start justify-between gap-2"
                                  >
                                    <span className="flex-1">{m.content}</span>
                                    <button
                                      onClick={() => {
                                        const next = personas.map(p => p.id === persona.id ? { ...p, memories: p.memories.filter(x => x.id !== m.id) } : p);
                                        setPersonas(next);
                                        StorageService.savePersonas(next);
                                      }}
                                      className="text-[var(--text-muted)] hover:text-[var(--danger)] p-0.5 cursor-pointer"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  <button
                    onClick={() => {
                      const newPersona: Persona = {
                        id: uuidv4(),
                        name: 'New Persona',
                        systemPrompt: 'You are a helpful, precise AI assistant.',
                        memories: [],
                      };
                      const next = [...personas, newPersona];
                      setPersonas(next);
                      StorageService.savePersonas(next);
                    }}
                    className="w-full py-3 rounded-xl border border-dashed border-[var(--border)] hover:border-[var(--accent-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer flex items-center justify-center gap-2 text-xs font-medium"
                  >
                    <Plus size={15} />
                    <span>Create Persona</span>
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  const renderOllamaModal = () => (
    <AnimatePresence>
      {isOllamaModalOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsOllamaModalOpen(false)}
            className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[70]"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="fixed inset-x-4 top-[15%] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[480px] z-[80] border border-[var(--border)] bg-[var(--bg-card)] rounded-2xl p-6 elevation-modal flex flex-col gap-4 text-[var(--text-primary)]"
          >
            <div className="flex items-center justify-between pb-2 border-b border-[var(--border-light)]">
              <div className="flex items-center gap-2">
                <Server size={16} className="text-[var(--accent-primary)]" />
                <h2 className="text-base font-semibold tracking-tight">Ollama Host Configuration</h2>
              </div>
              <IconButton icon={X} onClick={() => setIsOllamaModalOpen(false)} size={16} />
            </div>

            <div className={cn(
              "p-3.5 rounded-xl border flex items-center justify-between elevation-low",
              isOllamaConnected
                ? "border-[var(--success)]/20 bg-[var(--success)]/5 text-[var(--success)]"
                : "border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-muted)]"
            )}>
              <div className="flex items-center gap-2.5">
                <span className={cn(
                  "w-2 h-2 rounded-full",
                  isOllamaConnected ? "bg-[var(--success)]" : "bg-[var(--danger)]"
                )} />
                <span className="text-xs font-semibold">
                  {isOllamaConnected ? 'Active Connection' : 'Disconnected'}
                </span>
              </div>
              <span className="text-[10px] font-mono text-[var(--text-muted)]">
                {models.filter(m => m.id.startsWith('ollama/')).length} local models detected
              </span>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] block">
                Ollama API URL
              </label>
              <input
                type="text"
                value={ollamaHostInput}
                onChange={(e) => setOllamaHostInput(e.target.value)}
                placeholder="http://localhost:11434"
                className="w-full rounded-xl px-3.5 py-2 text-xs font-mono border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] focus:ring-1 focus:ring-[var(--accent-primary)] transition-all"
              />
            </div>

            <div className="p-3.5 rounded-xl border border-[var(--border-light)] bg-[var(--bg-secondary)] text-xs text-[var(--text-muted)] space-y-1 font-mono">
              <p className="font-semibold text-[var(--text-secondary)]">Setup Command:</p>
              <p className="text-[var(--text-accent)]">OLLAMA_ORIGINS="*" ollama serve</p>
            </div>

            {ollamaStatusMessage && (
              <p className="text-xs text-center font-mono text-[var(--accent-primary)]">
                {ollamaStatusMessage}
              </p>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[var(--border-light)]">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsOllamaModalOpen(false)}
              >
                Close
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={handleTestOllamaConnection}
                disabled={isTestingOllama}
              >
                <RefreshCw size={13} className={isTestingOllama ? "animate-spin" : ""} />
                <span>{isTestingOllama ? 'Connecting...' : 'Test Connection'}</span>
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  const renderImportModal = () => (
    <AnimatePresence>
      {isImportModalOpen && pendingImport && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              setIsImportModalOpen(false);
              setPendingImport(null);
            }}
            className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[80]"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="fixed inset-x-4 top-[15%] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[500px] z-[90] border border-[var(--border)] bg-[var(--bg-card)] rounded-2xl p-6 elevation-modal flex flex-col gap-4 text-[var(--text-primary)]"
          >
            <div className="flex items-center justify-between pb-2 border-b border-[var(--border-light)]">
              <div className="flex items-center gap-2">
                <Upload size={16} className="text-[var(--accent-primary)]" />
                <h2 className="text-base font-semibold tracking-tight">Confirm Chat Import</h2>
              </div>
              <IconButton icon={X} onClick={() => { setIsImportModalOpen(false); setPendingImport(null); }} size={16} />
            </div>

            <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col gap-2 elevation-low">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-medium truncate">{pendingImport.fileName}</span>
                <span className="text-[10px] font-mono text-[var(--success)] font-semibold">Validated</span>
              </div>
              <div className="text-[11px] text-[var(--text-muted)] font-mono">
                {pendingImport.conversations.length} conversation(s) · {pendingImport.totalMessages} message(s)
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setImportMode('merge')}
                className={cn(
                  "p-3.5 rounded-xl border text-left flex flex-col gap-1 cursor-pointer transition-all duration-200 active:scale-[0.98]",
                  importMode === 'merge'
                    ? "border-[var(--accent-primary)] bg-[var(--bg-hover)] text-[var(--text-primary)] elevation-low"
                    : "border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                )}
              >
                <span className="text-xs font-semibold">Merge</span>
                <span className="text-[10px] text-[var(--text-muted)]">Add alongside existing chats</span>
              </button>
              <button
                type="button"
                onClick={() => setImportMode('replace')}
                className={cn(
                  "p-3.5 rounded-xl border text-left flex flex-col gap-1 cursor-pointer transition-all duration-200 active:scale-[0.98]",
                  importMode === 'replace'
                    ? "border-[var(--danger)] bg-[var(--danger)]/10 text-[var(--danger)] elevation-low"
                    : "border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                )}
              >
                <span className="text-xs font-semibold">Replace</span>
                <span className="text-[10px] text-[var(--text-muted)]">Overwrite all existing chats</span>
              </button>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[var(--border-light)]">
              <Button
                type="button"
                variant="ghost"
                onClick={() => { setIsImportModalOpen(false); setPendingImport(null); }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant={importMode === 'replace' ? 'danger' : 'primary'}
                onClick={handleConfirmImport}
              >
                <Check size={14} />
                <span>Confirm {importMode === 'merge' ? 'Merge' : 'Replace'}</span>
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  const activeModelId = activeConversation?.modelId || settings.selectedModelId;
  const selectedModel = models.find(m => m.id === activeModelId);
  const isSelectedModelFree = parseFloat(selectedModel?.pricing?.prompt || '1') === 0;

  return (
    <div className="flex h-screen overflow-hidden font-sans bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Mobile Sidebar Backdrop */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/75 z-40 md:hidden backdrop-blur-sm"
          />
        )}
      </AnimatePresence>

      {renderSidebar()}

      {/* Main Chat Viewport */}
      <main className="flex-1 flex flex-col h-full bg-[var(--bg-primary)] relative z-0 overflow-hidden">
        {/* Minimal Accessible Application Header */}
        <header className="h-14 sm:h-16 border-b border-[var(--border)] flex items-center justify-between px-4 sm:px-6 shrink-0 z-20 sticky top-0 bg-[var(--bg-primary)]/90 backdrop-blur-md transition-colors duration-200">
          {/* Left: Mobile Toggle & Model / Persona Triggers */}
          <div className="flex items-center gap-2 sm:gap-3">
            <IconButton
              icon={Menu}
              onClick={() => setIsSidebarOpen(true)}
              className="md:hidden"
              size={18}
              aria-label="Open sidebar"
            />

            {/* Model Selector Trigger */}
            <button
              type="button"
              onClick={() => setIsModelSelectorOpen(true)}
              className="px-3 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-primary)] flex items-center gap-2 cursor-pointer transition-all duration-200 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:outline-none"
            >
              <span className="truncate max-w-[130px] sm:max-w-[220px]">
                {selectedModel?.name || 'Select Model'}
              </span>
              {isSelectedModelFree && (
                <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-[var(--success)]/10 text-[var(--success)] border border-[var(--success)]/20 font-semibold">
                  FREE
                </span>
              )}
              <ChevronDown size={14} className="text-[var(--text-muted)] shrink-0" />
            </button>

            {/* Persona Switcher Trigger */}
            <button
              type="button"
              onClick={() => {
                setSettingsTab('personas');
                setIsPersonaManagerOpen(true);
              }}
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl border border-transparent hover:border-[var(--border-light)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-all cursor-pointer"
            >
              <User size={14} className="text-[var(--text-muted)]" />
              <span className="truncate max-w-[120px]">{activePersona?.name || 'Default'}</span>
            </button>
          </div>

          {/* Right: Ollama Indicator & Actions */}
          <div className="flex items-center gap-1 sm:gap-2">
            {/* Ollama Status Button */}
            <button
              type="button"
              onClick={() => setIsOllamaModalOpen(true)}
              title={`Ollama: ${isOllamaConnected ? 'Connected' : 'Offline'} (Click to configure)`}
              className={cn(
                "px-3 py-1.5 rounded-full border text-[11px] font-mono flex items-center gap-2 transition-all cursor-pointer active:scale-[0.97] focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]",
                isOllamaConnected
                  ? "border-[var(--success)]/30 bg-[var(--success)]/10 text-[var(--success)] hover:bg-[var(--success)]/15"
                  : "border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              )}
            >
              <span className={cn(
                "w-1.5 h-1.5 rounded-full shrink-0",
                isOllamaConnected ? "bg-[var(--success)]" : "bg-[var(--text-muted)]"
              )} />
              <span className="hidden sm:inline uppercase tracking-wider text-[10px] font-semibold">
                {isOllamaConnected ? 'Ollama' : 'Offline'}
              </span>
            </button>

            {/* Memory Summarizer */}
            <IconButton
              icon={Bookmark}
              size={16}
              onClick={handleSummarizeMemory}
              title="Summarize conversation memory"
              aria-label="Summarize memory"
            />

            {/* Theme Toggle */}
            <IconButton
              icon={settings.theme === 'dark' ? Sun : Moon}
              size={16}
              onClick={toggleTheme}
              title="Toggle theme"
              aria-label="Toggle theme"
            />
          </div>
        </header>

        {/* Optional Standalone PWA Banner */}
        {deferredInstallPrompt && isInstallBannerVisible && !isInstalled && (
          <div className="max-w-3xl mx-auto px-4 pt-3.5 w-full">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3 flex items-center justify-between gap-3 text-xs elevation-low">
              <span className="text-[var(--text-secondary)]">
                Install Void Chat for standalone desktop & mobile use
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={dismissInstallBanner}
                  className="px-3 py-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  Dismiss
                </button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleInstallApp}
                  disabled={isInstallPromptPending}
                  className="text-xs py-1 px-3 min-h-[34px]"
                >
                  Install
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Chat Stream & Document Area */}
        <div
          ref={chatContainerRef}
          onScroll={handleChatScroll}
          className="flex-1 overflow-y-auto px-4 sm:px-6 md:px-8 py-6 scrollbar-thin"
        >
          {activeConversation && (
            <div className="max-w-3xl mx-auto">
              {/* Conversation Sub-header */}
              <div className="flex items-center justify-between pb-3.5 mb-6 border-b border-[var(--border-light)] text-xs transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  {editingConvoId === activeConversation.id ? (
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={editingTitleText}
                        autoFocus
                        onChange={(e) => setEditingTitleText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveTitle(activeConversation.id);
                          if (e.key === 'Escape') setEditingConvoId(null);
                        }}
                        className="text-xs px-2.5 py-1 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] font-medium"
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveTitle(activeConversation.id)}
                        title="Save title"
                        className="p-1 text-[var(--success)] cursor-pointer"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingConvoId(null)}
                        title="Cancel"
                        className="p-1 text-[var(--danger)] cursor-pointer"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <div
                      className="flex items-center gap-2 min-w-0 cursor-pointer group"
                      onClick={() => handleStartRename(activeConversation)}
                      title="Click to rename"
                    >
                      {activeConversation.isPinned && (
                        <Pin size={12} className="text-[var(--accent-primary)] shrink-0 rotate-45" />
                      )}
                      <h1 className="text-xs sm:text-sm font-semibold truncate tracking-tight text-[var(--text-primary)]">
                        {activeConversation.title || 'Untitled'}
                      </h1>
                      <Edit3 size={12} className="text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    </div>
                  )}
                </div>

                {/* Sub-header controls */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => handleTogglePin(activeConversation.id, e)}
                    title={activeConversation.isPinned ? "Unpin chat" : "Pin chat to top"}
                    className={cn(
                      "p-1.5 rounded-lg transition-colors cursor-pointer",
                      activeConversation.isPinned
                        ? "text-[var(--accent-primary)] bg-[var(--bg-hover)]"
                        : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    )}
                  >
                    <Pin size={13} />
                  </button>

                  <button
                    type="button"
                    onClick={toggleAutoScroll}
                    title="Toggle auto-scroll anchor"
                    className={cn(
                      "px-2.5 py-1 rounded-lg text-[10px] font-mono border transition-all cursor-pointer",
                      settings.autoScroll !== false
                        ? "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                        : "border-[var(--warning)]/30 text-[var(--warning)] bg-[var(--warning)]/10"
                    )}
                  >
                    {settings.autoScroll !== false ? 'Auto-scroll ON' : 'Paused'}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleExportSingleChat(activeConversation.id)}
                    title="Export conversation as JSON"
                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                  >
                    <Download size={13} />
                  </button>
                </div>
              </div>

              {/* Message List */}
              {activeConversation.messages.length === 0 ? (
                <div className="py-24 flex flex-col items-center justify-center text-center text-[var(--text-muted)]">
                  <div className="w-12 h-12 rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] flex items-center justify-center mb-3.5 elevation-low">
                    <MessageSquare size={20} strokeWidth={1.5} className="text-[var(--text-muted)]" />
                  </div>
                  <p className="text-xs font-semibold tracking-wider uppercase text-[var(--text-secondary)] font-mono">
                    Transmission Ready
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mt-1.5 max-w-sm leading-relaxed">
                    Type a prompt below or dictate with voice to interact with {selectedModel?.name || 'the model'}.
                  </p>
                </div>
              ) : (
                <div className="space-y-8 pb-16">
                  {activeConversation.messages.map((message) => {
                    const isUser = message.role === 'user';
                    const isSystem = message.role === 'system';
                    const isEditingThisUserMsg = editingUserMessageId === message.id;

                    if (isUser) {
                      return (
                        <div key={message.id} className="flex flex-col items-end group">
                          {isEditingThisUserMsg ? (
                            <div className="w-full max-w-xl p-4 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] elevation-card flex flex-col gap-3">
                              <div className="flex items-center gap-1.5 text-xs text-[var(--warning)] font-medium">
                                <AlertCircle size={14} />
                                <span>Editing this message will remove subsequent responses and re-generate.</span>
                              </div>

                              <textarea
                                value={editingUserMessageContent}
                                onChange={(e) => setEditingUserMessageContent(e.target.value)}
                                rows={3}
                                className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-3 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-primary)] resize-none leading-relaxed"
                              />

                              <div className="flex items-center justify-end gap-2.5">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={handleCancelEditUserMessage}
                                  className="text-xs py-1.5 px-3 min-h-[36px]"
                                >
                                  Cancel
                                </Button>
                                <Button
                                  type="button"
                                  variant="primary"
                                  onClick={() => handleSaveAndResubmitUserMessage(message.id)}
                                  className="text-xs py-1.5 px-4 min-h-[36px]"
                                >
                                  Save & Submit
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="rounded-2xl rounded-tr-md px-4 py-3 max-w-[88%] md:max-w-[78%] border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] elevation-low transition-all duration-200">
                                <MarkdownRenderer content={message.content} isUser />
                              </div>

                              <div className="flex items-center gap-2 mt-1.5 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <span className="text-[10px] font-mono text-[var(--text-muted)]">
                                  {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleStartEditUserMessage(message)}
                                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1"
                                  title="Edit message & regenerate"
                                >
                                  <Edit3 size={12} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleCopyMessage(message.id, message.content)}
                                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1"
                                  title="Copy prompt"
                                >
                                  {copiedMessageId === message.id ? <Check size={12} className="text-[var(--success)]" /> : <Copy size={12} />}
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    }

                    if (isSystem) {
                      return (
                        <div key={message.id} className="p-4 rounded-xl border border-[var(--danger)]/30 bg-[var(--bg-secondary)] text-xs text-[var(--danger)] flex items-start justify-between gap-3 elevation-low">
                          <div className="flex items-center gap-2.5">
                            <AlertCircle size={16} className="shrink-0 text-[var(--danger)]" />
                            <span className="leading-relaxed">{message.content}</span>
                          </div>
                          {message.isError && (
                            <button
                              type="button"
                              onClick={() => handleRetryFromError(message.id)}
                              className="px-3 py-1.5 rounded-xl border border-[var(--danger)] bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--danger)] font-mono text-xs shrink-0 flex items-center gap-1.5 transition-all cursor-pointer"
                              title="Retry generation"
                            >
                              <RefreshCw size={12} />
                              <span>Retry</span>
                            </button>
                          )}
                        </div>
                      );
                    }

                    // Assistant response: Document-like presentation
                    return (
                      <div key={message.id} className="flex flex-col gap-2.5 group pt-1">
                        {/* Meta header */}
                        <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-semibold">
                              Void Assistant
                            </span>
                            <span className="text-[10px] font-mono text-[var(--text-muted)]/70">
                              {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>

                          <div className="flex items-center gap-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => handleRegenerateResponse(message.id)}
                              disabled={isLoading}
                              className="inline-flex items-center gap-1.5 text-xs font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer transition-colors disabled:opacity-30 p-1"
                              title="Regenerate this response"
                            >
                              <RefreshCw size={12} />
                              <span>Regenerate</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleCopyMessage(message.id, message.content)}
                              className="inline-flex items-center gap-1.5 text-xs font-mono text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer transition-colors p-1"
                              title="Copy full response"
                            >
                              {copiedMessageId === message.id ? (
                                <>
                                  <Check size={12} className="text-[var(--success)]" />
                                  <span className="text-[var(--success)]">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy size={12} />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Document Content */}
                        <div className="text-[15px] leading-[1.75] text-[var(--text-secondary)]">
                          <MarkdownRenderer content={message.content} />
                        </div>
                      </div>
                    );
                  })}

                  {isLoading && (
                    <div className="flex flex-col gap-2.5 pt-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--text-muted)] font-semibold flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)] animate-pulse" />
                          {activeConversation?.messages[activeConversation.messages.length - 1]?.content
                            ? 'Void Assistant is streaming...'
                            : 'Void Assistant is thinking...'}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleStopGeneration()}
                          className="px-3 py-1.5 rounded-xl text-xs font-mono border border-[var(--danger)]/40 bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)] text-[var(--danger)] flex items-center gap-1.5 transition-all cursor-pointer"
                        >
                          <Square size={11} fill="currentColor" />
                          <span>Stop</span>
                        </button>
                      </div>
                      {!activeConversation?.messages[activeConversation.messages.length - 1]?.content && (
                        <div className="flex items-center gap-2 py-1.5">
                          <div className="w-2 h-2 bg-[var(--accent-primary)] rounded-full animate-pulse" />
                          <div className="w-2 h-2 bg-[var(--accent-primary)]/70 rounded-full animate-pulse delay-100" />
                          <div className="w-2 h-2 bg-[var(--accent-primary)]/40 rounded-full animate-pulse delay-200" />
                        </div>
                      )}
                    </div>
                  )}

                  <div ref={chatEndRef} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Message Composer (Natural Writing & Dictation Interface) */}
        <div className="px-4 sm:px-6 md:px-8 pt-2 pb-5 shrink-0 sticky bottom-0 z-20 bg-[var(--bg-primary)]/90 backdrop-blur-md border-t border-[var(--border-light)] transition-colors duration-200">
          {/* Jump to latest messages button */}
          <AnimatePresence>
            {isUserScrolledUp && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                className="absolute -top-11 left-1/2 -translate-x-1/2 pointer-events-auto"
              >
                <button
                  type="button"
                  onClick={() => scrollToBottom(true)}
                  className="px-4 py-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-xs font-medium text-[var(--text-primary)] flex items-center gap-2 elevation-float cursor-pointer transition-all duration-200 backdrop-blur-md active:scale-[0.97]"
                >
                  <ChevronDown size={14} className="text-[var(--accent-primary)]" />
                  <span>Latest messages</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="max-w-3xl mx-auto flex flex-col gap-2">
            {/* Ambient Composer Container */}
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] focus-within:border-[var(--accent-primary)] focus-within:ring-1 focus-within:ring-[var(--accent-primary)] transition-all duration-200 flex items-end gap-2.5 p-2 sm:p-2.5 elevation-card">
              {/* Voice-to-Text Microphone Button */}
              <button
                type="button"
                onClick={handleToggleVoiceInput}
                title={isListening ? "Listening... click to stop" : "Dictate with voice (Speech-to-Text)"}
                className={cn(
                  "w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center shrink-0 transition-all duration-200 cursor-pointer mb-0.5",
                  isListening
                    ? "bg-[var(--danger)]/15 text-[var(--danger)] border border-[var(--danger)]/40 animate-pulse shadow-sm"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                )}
              >
                {isListening ? <MicOff size={16} /> : <Mic size={16} />}
              </button>

              <textarea
                ref={textareaRef}
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder={isListening ? "Listening... speak now" : "Ask Void Chat a question or dictate a prompt..."}
                rows={1}
                className="flex-1 bg-transparent border-none focus:outline-none px-2 py-1.5 text-sm resize-none min-h-[40px] max-h-48 leading-relaxed scrollbar-thin text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
              />

              {/* Stop Button when generating, or Send Button */}
              {isLoading ? (
                <button
                  type="button"
                  onClick={() => handleStopGeneration()}
                  aria-label="Stop generation"
                  title="Stop generating response"
                  className="px-3 py-2 rounded-xl bg-[var(--danger)]/15 border border-[var(--danger)]/30 text-[var(--danger)] hover:bg-[var(--danger)]/25 text-xs font-mono flex items-center gap-1.5 shrink-0 transition-all cursor-pointer mb-0.5"
                >
                  <Square size={13} fill="currentColor" />
                  <span className="hidden sm:inline">Stop</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSendMessage()}
                  disabled={!inputMessage.trim() || isLoading}
                  aria-label="Send message"
                  className={cn(
                    "w-10 h-10 min-w-[40px] min-h-[40px] rounded-xl flex items-center justify-center shrink-0 transition-all duration-200 cursor-pointer mb-0.5",
                    inputMessage.trim()
                      ? "bg-[var(--accent-primary)] text-[var(--bg-primary)] hover:bg-[var(--accent-secondary)] active:scale-[0.96] shadow-sm"
                      : "text-[var(--text-muted)] opacity-35 cursor-not-allowed"
                  )}
                >
                  <Send size={15} />
                </button>
              )}
            </div>

            <div className="flex items-center justify-between px-2 text-[10px] text-[var(--text-muted)] font-mono">
              <span className="truncate">
                {isListening ? 'Microphone active · Dictating...' : `Active: ${selectedModel?.name?.split('/')[1] || selectedModel?.name || 'AI'}`}
              </span>
              <span className="hidden sm:inline">
                Enter to send · Shift + Enter for new line
              </span>
            </div>
          </div>
        </div>
      </main>

      {renderModelSelector()}
      {renderPersonaManager()}
      {renderOllamaModal()}
      {renderImportModal()}

      {/* Hidden file input for JSON import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={handleFileInputChange}
        className="hidden"
      />

      {/* Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-6 right-6 z-[100] px-4 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] text-xs font-medium text-[var(--text-primary)] flex items-center gap-2.5 elevation-modal backdrop-blur-md"
          >
            <Check size={14} className="text-[var(--success)] shrink-0" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
