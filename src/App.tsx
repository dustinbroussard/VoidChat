import React, { useState, useEffect, useRef } from 'react';
import {
  Menu, Plus, Search, Trash2, Edit3,
  Settings, User, MessageSquare, Bookmark, Moon, Sun,
  Send, X, Copy, Check, Download,
  Server, RefreshCw, ChevronDown, Upload, FileUp, FileText, Sparkles,
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

// Minimal Button component
const Button = ({ className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    className={cn(
      "px-3.5 py-2 rounded-xl text-xs font-medium inline-flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer",
      className
    )}
    {...props}
  >
    {children}
  </button>
);

const IconButton = ({
  icon: Icon,
  className,
  size = 18,
  ...props
}: { icon: React.ComponentType<{ size?: number; className?: string }>; size?: number } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    className={cn(
      "w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-offwhite dark:hover:text-white light:hover:text-zinc-900 hover:bg-white/[0.06] dark:hover:bg-white/[0.06] light:hover:bg-black/[0.05] active:scale-[0.96] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
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
  const [isLoading, setIsLoading] = useState(false);
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

  // --- Active Request & Abort Controller ---
  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const activeGeneratingConvoIdRef = useRef<string | null>(null);

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
    el.style.height = `${Math.max(38, nextHeight)}px`;
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
          // A corrupted string was in storage - backup was preserved by StorageService
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
          // Clean first run welcome conversation with rich formatting
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

- **Document-Style Message View**: Clean hierarchy, syntax-highlighted code blocks with one-click copy, and responsive tables.
- **Message Editing**: Click the pen icon on any user message to edit it and branch clean responses.
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

  useEffect(() => {
    document.body.className = settings.theme;
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

  // Clean up recognition on unmount
  useEffect(() => {
    return () => {
      if (speechRecognitionRef.current) {
        speechRecognitionRef.current.stop();
      }
    };
  }, []);

  // --- Stop Active Request ---
  const handleStopGeneration = () => {
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
      activeAbortControllerRef.current = null;
    }
    activeGeneratingConvoIdRef.current = null;
    setIsLoading(false);
    showToast('Generation stopped');
  };

  // --- Central Execution Engine ---
  const executeGeneration = async (
    targetConvoId: string,
    messagesContext: ChatMessage[]
  ) => {
    if (isLoading && activeGeneratingConvoIdRef.current === targetConvoId) {
      showToast('A generation is already in progress');
      return;
    }

    const controller = new AbortController();
    activeAbortControllerRef.current = controller;
    activeGeneratingConvoIdRef.current = targetConvoId;
    setIsLoading(true);
    userScrolledUpRef.current = false;
    setIsUserScrolledUp(false);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 40);

    try {
      const systemMessageContent = `System prompt:\n${activePersona?.systemPrompt || ''}${activePersona?.memories && activePersona.memories.length > 0 ? '\n\nRelevant saved memories for this persona:\n' + activePersona.memories.map(m => `- ${m.content}`).join('\n') : ''}`;

      const systemMessage: ChatMessage = {
        id: 'system',
        role: 'system',
        content: systemMessageContent,
        timestamp: Date.now(),
      };

      // Filter out previous system messages or errors from completion context
      const cleanMessages = messagesContext.filter(m => m.role !== 'system' && !m.isError);

      const response = await ApiService.chatCompletion(
        settings.selectedModelId,
        [systemMessage, ...cleanMessages],
        0.7,
        settings.ollamaHost,
        controller.signal
      );

      const assistantMessage: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: response,
        timestamp: Date.now(),
      };

      // Target-safe update
      setConversations(prev => prev.map(c => {
        if (c.id !== targetConvoId) return c;

        const nextConvo = {
          ...c,
          messages: [...cleanMessages, assistantMessage],
          lastUpdated: Date.now(),
        };

        // Auto-title if it's the initial exchange
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
        // Generation was cancelled by the user - do not append error or incomplete response
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
        return {
          ...c,
          messages: [...messagesContext.filter(m => !m.isError), errorMessage],
          lastUpdated: Date.now(),
        };
      }));
    } finally {
      if (activeGeneratingConvoIdRef.current === targetConvoId) {
        activeAbortControllerRef.current = null;
        activeGeneratingConvoIdRef.current = null;
        setIsLoading(false);
      }
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

    // Optimistically update conversation with user message
    const updatedConvo = {
      ...activeConversation,
      messages: nextMessages,
      lastUpdated: Date.now(),
    };

    setConversations(prev => prev.map(c => c.id === activeConversation.id ? updatedConvo : c));
    setInputMessage('');
    if (textareaRef.current) {
      textareaRef.current.style.height = '38px';
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

    // Truncate messages after this point because they depended on previous answer
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

    // Slice history up to the preceding user message
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

    // Remove the error message and re-run generation with preceding context
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
      showToast(target?.isPinned ? 'Conversation pinned to top' : 'Conversation unpinned');
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
    if (!activeConversation || activeConversation.messages.length < 2 || isLoading) return;

    setIsLoading(true);
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
      setIsLoading(false);
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
        setOllamaStatusMessage(`Connected. Found ${localModels.length} local model(s).`);
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
    setSettings(prev => {
      const nextSettings = { ...prev, activePersonaId: personaId };
      if (selectedPersona?.selectedModelId) {
        nextSettings.selectedModelId = selectedPersona.selectedModelId;
      }
      return nextSettings;
    });
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
  const activePersona = personas.find(p => p.id === settings.activePersonaId) || personas[0];

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

    // Get last meaningful message preview
    const lastMeaningfulMsg = convo.messages[convo.messages.length - 1];
    let previewText = 'Empty transmission';
    if (lastMeaningfulMsg) {
      const clean = lastMeaningfulMsg.content.replace(/[#*`_~]/g, '').trim();
      previewText = lastMeaningfulMsg.role === 'user' ? `You: ${clean}` : clean;
    }

    // Matching snippet if search active
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

    return (
      <div
        key={convo.id}
        onClick={() => { setActiveConversationId(convo.id); setIsSidebarOpen(false); }}
        className={cn(
          "group relative px-2.5 py-2 rounded-xl cursor-pointer transition-colors border select-none",
          isActive
            ? (settings.theme === 'dark'
                ? "bg-white/[0.08] border-white/[0.14] text-white"
                : "bg-white border-black/[0.12] text-zinc-900 shadow-xs")
            : (settings.theme === 'dark'
                ? "border-transparent hover:bg-white/[0.03] text-text-muted hover:text-text-offwhite"
                : "border-transparent hover:bg-black/[0.03] text-zinc-600 hover:text-zinc-900")
        )}
      >
        {editingConvoId === convo.id ? (
          <div className="flex items-center gap-1.5 py-0.5" onClick={(e) => e.stopPropagation()}>
            <input
              type="text"
              value={editingTitleText}
              autoFocus
              onChange={(e) => setEditingTitleText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveTitle(convo.id);
                if (e.key === 'Escape') setEditingConvoId(null);
              }}
              className={cn(
                "flex-1 text-xs px-2 py-1 rounded border outline-none font-medium",
                settings.theme === 'dark'
                  ? "bg-black border-white/20 text-white"
                  : "bg-white border-black/20 text-zinc-900"
              )}
            />
            <button
              type="button"
              onClick={() => handleSaveTitle(convo.id)}
              title="Save title"
              className="p-1 hover:text-emerald-400 text-text-dim transition-colors"
            >
              <Check size={13} />
            </button>
            <button
              type="button"
              onClick={() => setEditingConvoId(null)}
              title="Cancel"
              className="p-1 hover:text-red-400 text-text-dim transition-colors"
            >
              <X size={13} />
            </button>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-1.5">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                {convo.isPinned && (
                  <Pin size={10} className="text-accent-blue shrink-0 rotate-45" />
                )}
                <p className={cn(
                  "text-xs truncate leading-snug",
                  isActive ? "font-semibold" : "font-medium"
                )}>
                  {convo.title || 'Untitled'}
                </p>
              </div>

              {/* Message preview or search match */}
              {searchSnippet ? (
                <p className="text-[11px] text-accent-blue/90 font-mono truncate leading-tight">
                  {searchSnippet}
                </p>
              ) : (
                <p className="text-[11px] text-text-dim truncate leading-tight">
                  {previewText}
                </p>
              )}

              {/* Metadata */}
              <p className="text-[10px] text-text-dim/80 font-mono tracking-tight mt-1 truncate">
                {new Date(convo.lastUpdated).toLocaleDateString([], { month: 'short', day: 'numeric' })} • {modelName}
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
                  "p-1 rounded-md text-text-dim hover:text-text-offwhite transition-colors cursor-pointer",
                  isMenuOpen ? "text-text-offwhite bg-white/[0.08]" : "opacity-0 group-hover:opacity-100"
                )}
                title="Conversation options"
              >
                <MoreVertical size={13} />
              </button>

              {/* Context Menu Popover */}
              {isMenuOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className={cn(
                    "absolute right-0 top-6 w-36 py-1 rounded-xl border shadow-2xl z-30 flex flex-col text-xs backdrop-blur-md",
                    settings.theme === 'dark' ? "bg-[#0f0f13] border-white/[0.12] text-text-offwhite" : "bg-white border-black/[0.1] text-zinc-900"
                  )}
                >
                  <button
                    type="button"
                    onClick={(e) => handleTogglePin(convo.id, e)}
                    className="px-3 py-1.5 flex items-center gap-2 hover:bg-white/[0.06] text-left cursor-pointer transition-colors"
                  >
                    {convo.isPinned ? <PinOff size={12} className="text-accent-blue" /> : <Pin size={12} />}
                    <span>{convo.isPinned ? 'Unpin chat' : 'Pin to top'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => handleStartRename(convo, e)}
                    className="px-3 py-1.5 flex items-center gap-2 hover:bg-white/[0.06] text-left cursor-pointer transition-colors"
                  >
                    <Edit3 size={12} />
                    <span>Rename</span>
                  </button>

                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleExportSingleChat(convo.id); }}
                    className="px-3 py-1.5 flex items-center gap-2 hover:bg-white/[0.06] text-left cursor-pointer transition-colors"
                  >
                    <Download size={12} />
                    <span>Export JSON</span>
                  </button>

                  <div className="my-1 border-t border-white/[0.06] dark:border-white/[0.06] light:border-black/[0.06]" />

                  <button
                    type="button"
                    onClick={(e) => deleteConversation(convo.id, e)}
                    className="px-3 py-1.5 flex items-center gap-2 text-red-400 hover:bg-red-500/10 text-left cursor-pointer transition-colors"
                  >
                    <Trash2 size={12} />
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
        "fixed inset-y-0 left-0 w-[275px] z-50 border-r flex flex-col transition-transform duration-200 ease-out md:translate-x-0 md:static md:z-auto",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full",
        settings.theme === 'dark'
          ? "bg-[#070709] border-white/[0.08]"
          : "bg-[#f8f8fa] border-black/[0.08]"
      )}
    >
      {/* Brand Header */}
      <div className="p-4 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded-md bg-accent-blue/20 border border-accent-blue/30 flex items-center justify-center text-accent-blue">
            <Sparkles size={11} />
          </div>
          <span className="text-[11px] font-semibold tracking-wider uppercase text-text-offwhite dark:text-zinc-200 light:text-zinc-900">
            Void Chat
          </span>
        </div>
        <IconButton icon={X} onClick={() => setIsSidebarOpen(false)} className="md:hidden" size={16} />
      </div>

      {/* Action Buttons: New Chat & Import */}
      <div className="px-3 py-2 flex items-center gap-1.5">
        <button
          onClick={() => handleNewChat()}
          className={cn(
            "flex-1 py-2 px-3 rounded-xl text-xs font-medium text-left transition-colors flex items-center justify-between cursor-pointer border",
            settings.theme === 'dark'
              ? "bg-white/[0.04] border-white/[0.08] hover:bg-white/[0.08] text-text-offwhite hover:border-white/20"
              : "bg-white border-black/[0.08] hover:bg-black/[0.04] text-zinc-900 hover:border-black/20"
          )}
        >
          <span>New Chat</span>
          <Plus size={14} className="opacity-50" />
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          title="Import chat history (JSON)"
          className={cn(
            "p-2 rounded-xl border transition-colors flex items-center justify-center cursor-pointer",
            settings.theme === 'dark'
              ? "bg-white/[0.02] border-white/[0.08] text-text-dim hover:text-text-offwhite hover:bg-white/[0.06]"
              : "bg-white border-black/[0.08] text-text-muted-light hover:text-zinc-900 hover:bg-black/[0.04]"
          )}
        >
          <Upload size={14} />
        </button>
      </div>

      {/* Search Conversations */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(
              "w-full rounded-xl pl-8 pr-3 py-1.5 text-xs outline-none transition-colors border",
              settings.theme === 'dark'
                ? "bg-white/[0.02] border-white/[0.06] placeholder-text-dim text-text-offwhite focus:border-white/20 focus:bg-white/[0.04]"
                : "bg-white border-black/[0.06] placeholder-text-muted-light text-zinc-900 focus:border-black/20"
            )}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-dim hover:text-white"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-2 py-1 space-y-3">
        {searchFilteredConversations.length === 0 ? (
          <div className="p-6 text-center text-xs text-text-dim italic">
            {searchQuery ? (
              <div className="flex flex-col items-center gap-1.5">
                <Search size={16} className="opacity-40" />
                <span>No matching conversations</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1.5">
                <MessageSquare size={16} className="opacity-40" />
                <span>No conversations yet</span>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Pinned Section */}
            {pinnedConversations.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 px-2 text-[10px] font-mono uppercase tracking-wider text-text-dim">
                  <Pin size={10} className="text-accent-blue" />
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
                <div className="px-2 text-[10px] font-mono uppercase tracking-wider text-text-dim pt-1">
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
      <div className={cn(
        "p-3 border-t flex items-center justify-between text-xs",
        settings.theme === 'dark' ? "border-white/[0.08]" : "border-black/[0.08]"
      )}>
        <div className="flex items-center gap-2">
          <span className={cn(
            "w-2 h-2 rounded-full",
            isOllamaConnected ? "bg-emerald-500" : "bg-text-dim"
          )} />
          <span className="text-[11px] font-mono uppercase text-text-dim tracking-wider">
            {isOllamaConnected ? 'Ollama Live' : 'Cloud Ready'}
          </span>
        </div>

        <button
          onClick={() => {
            setSettingsTab('settings');
            setIsPersonaManagerOpen(true);
          }}
          className="text-text-muted hover:text-text-offwhite dark:hover:text-white light:hover:text-zinc-900 transition-colors flex items-center gap-1.5 cursor-pointer font-medium text-xs px-2 py-1 rounded-md hover:bg-white/[0.04]"
        >
          <Settings size={13} />
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
            className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[60]"
          />
          <motion.div
            initial={{ opacity: 0, y: 15, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 15, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={cn(
              "fixed inset-x-4 top-[12%] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[540px] max-h-[75vh] z-[70] border rounded-2xl flex flex-col p-5 overflow-hidden shadow-2xl",
              settings.theme === 'dark' ? "bg-[#0b0b0e] border-white/[0.1] text-text-offwhite" : "bg-white border-black/[0.1] text-zinc-900"
            )}
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.06] dark:border-white/[0.06] light:border-black/[0.06]">
              <div>
                <h2 className="text-sm font-semibold tracking-tight">Select Intelligence Model</h2>
                <p className="text-[11px] text-text-dim">Choose from local Ollama or high-speed cloud LLMs</p>
              </div>
              <IconButton icon={X} onClick={() => setIsModelSelectorOpen(false)} size={16} />
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 my-3">
              <div className="relative flex-1">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" />
                <input
                  type="text"
                  placeholder="Filter models by name or id..."
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  className={cn(
                    "w-full rounded-xl pl-8 pr-3 py-2 text-xs border outline-none transition-colors",
                    settings.theme === 'dark'
                      ? "bg-white/[0.03] border-white/[0.08] text-text-offwhite focus:border-white/20"
                      : "bg-[#f4f4f6] border-black/[0.08] text-zinc-900 focus:border-black/20"
                  )}
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer px-1 py-1 text-xs select-none">
                <input
                  type="checkbox"
                  checked={freeModelsOnly}
                  onChange={e => setFreeModelsOnly(e.target.checked)}
                  className="rounded accent-accent-blue cursor-pointer"
                />
                <span className="text-[11px] text-text-muted font-medium">Free only</span>
              </label>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin space-y-1.5 pr-1 pb-2">
              {availableModels.length === 0 ? (
                <div className="p-8 text-center text-text-dim text-xs italic">No models match the filter</div>
              ) : (
                availableModels.map(model => {
                  const isSelected = settings.selectedModelId === model.id;
                  const isOllama = model.id.startsWith('ollama/');
                  const isFree = parseFloat(model.pricing?.prompt || '1') === 0 && parseFloat(model.pricing?.completion || '1') === 0;

                  return (
                    <div
                      key={model.id}
                      onClick={() => {
                        setSettings(prev => ({ ...prev, selectedModelId: model.id }));
                        setIsModelSelectorOpen(false);
                      }}
                      className={cn(
                        "p-3 rounded-xl border cursor-pointer transition-colors flex items-center justify-between gap-3",
                        isSelected
                          ? (settings.theme === 'dark'
                              ? "bg-white/[0.08] border-white/20"
                              : "bg-black/[0.05] border-black/20")
                          : (settings.theme === 'dark'
                              ? "border-white/[0.04] bg-white/[0.01] hover:bg-white/[0.04] hover:border-white/[0.08]"
                              : "border-black/[0.04] bg-black/[0.01] hover:bg-black/[0.04] hover:border-black/[0.08]")
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold truncate">{model.name}</span>
                          {isOllama && (
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase">OLLAMA</span>
                          )}
                          {isFree && (
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase">FREE</span>
                          )}
                        </div>
                        <p className="text-[10px] font-mono text-text-dim truncate">{model.id}</p>
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-[10px] font-mono text-text-dim block">
                          {model.context_length ? `${Math.round(model.context_length / 1024)}k ctx` : ''}
                        </span>
                        {isSelected && (
                          <span className="text-[10px] font-semibold text-accent-blue">Selected</span>
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
            className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[60]"
          />
          <motion.div
            initial={{ opacity: 0, y: 15, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 15, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={cn(
              "fixed inset-x-4 top-[10%] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[620px] max-h-[82vh] z-[70] border rounded-2xl flex flex-col p-5 overflow-hidden shadow-2xl",
              settings.theme === 'dark' ? "bg-[#0b0b0e] border-white/[0.1] text-text-offwhite" : "bg-white border-black/[0.1] text-zinc-900"
            )}
          >
            {/* Header & Tabs */}
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.06] dark:border-white/[0.06] light:border-black/[0.06]">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSettingsTab('settings')}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-colors flex items-center gap-1.5 cursor-pointer",
                    settingsTab === 'settings'
                      ? (settings.theme === 'dark' ? "bg-white/10 text-white" : "bg-black/10 text-zinc-900")
                      : "text-text-muted hover:text-text-offwhite"
                  )}
                >
                  <Settings size={13} />
                  <span>General & Data</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsTab('personas')}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-colors flex items-center gap-1.5 cursor-pointer",
                    settingsTab === 'personas'
                      ? (settings.theme === 'dark' ? "bg-white/10 text-white" : "bg-black/10 text-zinc-900")
                      : "text-text-muted hover:text-text-offwhite"
                  )}
                >
                  <User size={13} />
                  <span>Personas ({personas.length})</span>
                </button>
              </div>
              <IconButton icon={X} onClick={() => setIsPersonaManagerOpen(false)} size={16} />
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin py-4 space-y-4 pr-1">
              {settingsTab === 'settings' ? (
                <div className="space-y-4">
                  {/* Export & Import Card */}
                  <div className={cn(
                    "p-4 rounded-xl border flex flex-col gap-3",
                    settings.theme === 'dark' ? "bg-white/[0.02] border-white/[0.06]" : "bg-black/[0.02] border-black/[0.06]"
                  )}>
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-dim">Chat Data & Archiving</h3>
                        <p className="text-xs text-text-muted mt-0.5">Export portable JSON backups or import existing chat archives</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono text-text-dim">
                          {conversations.length} chats • {conversations.reduce((acc, c) => acc + (c.messages?.length || 0), 0)} msgs
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2 pt-1">
                      <Button
                        type="button"
                        onClick={handleExportAllChats}
                        className={cn(
                          "flex-1 border",
                          settings.theme === 'dark'
                            ? "bg-white text-black hover:bg-white/90 border-transparent"
                            : "bg-black text-white hover:bg-black/90 border-transparent"
                        )}
                      >
                        <Download size={13} />
                        <span>Export All Chats (JSON)</span>
                      </Button>

                      <Button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className={cn(
                          "flex-1 border",
                          settings.theme === 'dark'
                            ? "border-white/[0.1] bg-white/[0.04] text-text-offwhite hover:bg-white/[0.08]"
                            : "border-black/[0.1] bg-white text-zinc-900 hover:bg-black/[0.03]"
                        )}
                      >
                        <Upload size={13} />
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
                        "p-3 rounded-lg border border-dashed text-center cursor-pointer transition-colors flex items-center justify-center gap-2",
                        isDraggingFile
                          ? "border-accent-blue bg-accent-blue/10"
                          : (settings.theme === 'dark' ? "border-white/10 hover:border-white/20" : "border-black/10 hover:border-black/20")
                      )}
                    >
                      <FileUp size={14} className="text-text-dim" />
                      <span className="text-xs text-text-muted">Drop a JSON backup file here or click to browse</span>
                    </div>

                    {exportFeedbackMessage && (
                      <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono flex items-center gap-2">
                        <Check size={13} />
                        <span>{exportFeedbackMessage}</span>
                      </div>
                    )}
                  </div>

                  {/* Ollama Local Integration */}
                  <div className={cn(
                    "p-4 rounded-xl border flex items-center justify-between",
                    settings.theme === 'dark' ? "bg-white/[0.02] border-white/[0.06]" : "bg-black/[0.02] border-black/[0.06]"
                  )}>
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Server size={14} className="text-text-muted" />
                        <h3 className="text-xs font-semibold">Ollama Local Integration</h3>
                      </div>
                      <p className="text-[11px] text-text-dim font-mono">
                        Host: {settings.ollamaHost || 'http://localhost:11434'} • Status: <span className={isOllamaConnected ? "text-emerald-400" : "text-text-dim"}>{isOllamaConnected ? 'Connected' : 'Offline'}</span>
                      </p>
                    </div>

                    <Button
                      type="button"
                      onClick={() => {
                        setIsPersonaManagerOpen(false);
                        setIsOllamaModalOpen(true);
                      }}
                      className={cn(
                        "border text-xs py-1.5 px-3",
                        settings.theme === 'dark'
                          ? "border-white/[0.1] bg-white/[0.04] text-text-offwhite hover:bg-white/[0.08]"
                          : "border-black/[0.1] bg-white text-zinc-900 hover:bg-black/[0.04]"
                      )}
                    >
                      Configure Host
                    </Button>
                  </div>

                  {/* Auto-scroll Toggle */}
                  <div className={cn(
                    "p-4 rounded-xl border flex items-center justify-between",
                    settings.theme === 'dark' ? "bg-white/[0.02] border-white/[0.06]" : "bg-black/[0.02] border-black/[0.06]"
                  )}>
                    <div className="space-y-0.5">
                      <h3 className="text-xs font-semibold">Auto-Scroll</h3>
                      <p className="text-[11px] text-text-dim">Anchors chat view to latest responses; automatically pauses when reviewing earlier text</p>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={settings.autoScroll !== false}
                      onClick={toggleAutoScroll}
                      className={cn(
                        "w-10 h-5 rounded-full p-0.5 transition-colors relative cursor-pointer",
                        settings.autoScroll !== false
                          ? "bg-accent-blue"
                          : (settings.theme === 'dark' ? "bg-white/10" : "bg-black/15")
                      )}
                    >
                      <div
                        className={cn(
                          "w-4 h-4 bg-white rounded-full transition-transform",
                          settings.autoScroll !== false ? "translate-x-5" : "translate-x-0"
                        )}
                      />
                    </button>
                  </div>

                  {/* Appearance Switch */}
                  <div className={cn(
                    "p-4 rounded-xl border flex items-center justify-between",
                    settings.theme === 'dark' ? "bg-white/[0.02] border-white/[0.06]" : "bg-black/[0.02] border-black/[0.06]"
                  )}>
                    <div className="space-y-0.5">
                      <h3 className="text-xs font-semibold">Appearance Theme</h3>
                      <p className="text-[11px] text-text-dim">Pure AMOLED Black (#000000) or Clean Minimalist Light mode</p>
                    </div>

                    <Button
                      type="button"
                      onClick={toggleTheme}
                      className={cn(
                        "border text-xs py-1.5 px-3",
                        settings.theme === 'dark'
                          ? "border-white/[0.1] bg-white/[0.04] text-text-offwhite hover:bg-white/[0.08]"
                          : "border-black/[0.1] bg-white text-zinc-900 hover:bg-black/[0.04]"
                      )}
                    >
                      {settings.theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
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
                          "p-4 rounded-xl border flex flex-col gap-3",
                          isPersonaActive
                            ? (settings.theme === 'dark' ? "bg-white/[0.04] border-white/[0.15]" : "bg-black/[0.03] border-black/[0.15]")
                            : (settings.theme === 'dark' ? "bg-white/[0.01] border-white/[0.06]" : "bg-black/[0.01] border-black/[0.06]")
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 flex-1">
                            <span className={cn(
                              "w-2 h-2 rounded-full",
                              isPersonaActive ? "bg-accent-blue" : "bg-text-dim"
                            )} />
                            <input
                              type="text"
                              value={persona.name}
                              onChange={(e) => {
                                const next = personas.map(p => p.id === persona.id ? { ...p, name: e.target.value } : p);
                                setPersonas(next);
                                StorageService.savePersonas(next);
                              }}
                              className="text-xs font-semibold bg-transparent border-none outline-none w-full"
                            />
                          </div>

                          <div className="flex items-center gap-1.5">
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
                                className="text-text-dim hover:text-red-400"
                              />
                            )}
                            <Button
                              onClick={() => handlePersonaSelect(persona.id)}
                              className={cn(
                                "text-[10px] font-semibold uppercase tracking-wider py-1 px-2.5 rounded-lg border",
                                isPersonaActive
                                  ? (settings.theme === 'dark' ? "bg-white text-black border-transparent" : "bg-black text-white border-transparent")
                                  : "border-white/10 text-text-dim hover:text-text-offwhite hover:border-white/20"
                              )}
                            >
                              {isPersonaActive ? 'Active' : 'Select'}
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-2 pt-1 border-t border-white/[0.04]">
                          <div>
                            <label className="text-[10px] font-mono uppercase tracking-wider text-text-dim block mb-1">
                              Associated Model Override
                            </label>
                            <select
                              value={persona.selectedModelId || ''}
                              onChange={(e) => handleUpdatePersonaModel(persona.id, e.target.value)}
                              className={cn(
                                "w-full rounded-lg px-2.5 py-1.5 text-xs border outline-none",
                                settings.theme === 'dark'
                                  ? "bg-white/[0.03] border-white/[0.08] text-text-offwhite focus:border-white/20"
                                  : "bg-white border-black/[0.08] text-zinc-900 focus:border-black/20"
                              )}
                            >
                              <option value="">Default (Global Selection)</option>
                              {models.map(m => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="text-[10px] font-mono uppercase tracking-wider text-text-dim block mb-1">
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
                              className={cn(
                                "w-full rounded-lg p-2.5 text-xs border outline-none resize-none leading-relaxed",
                                settings.theme === 'dark'
                                  ? "bg-white/[0.03] border-white/[0.08] text-text-offwhite focus:border-white/20"
                                  : "bg-white border-black/[0.08] text-zinc-900 focus:border-black/20"
                              )}
                            />
                          </div>

                          {persona.memories.length > 0 && (
                            <div>
                              <span className="text-[10px] font-mono uppercase tracking-wider text-text-dim block mb-1">
                                Saved Memories ({persona.memories.length})
                              </span>
                              <div className="space-y-1.5 max-h-32 overflow-y-auto scrollbar-thin">
                                {persona.memories.map(m => (
                                  <div
                                    key={m.id}
                                    className="p-2 rounded border border-white/[0.04] text-[11px] text-text-muted flex items-start justify-between gap-2"
                                  >
                                    <span className="flex-1">{m.content}</span>
                                    <button
                                      onClick={() => {
                                        const next = personas.map(p => p.id === persona.id ? { ...p, memories: p.memories.filter(x => x.id !== m.id) } : p);
                                        setPersonas(next);
                                        StorageService.savePersonas(next);
                                      }}
                                      className="text-text-dim hover:text-red-400 p-0.5"
                                    >
                                      <Trash2 size={11} />
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

                  <Button
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
                    className={cn(
                      "w-full py-2.5 rounded-xl border border-dashed transition-colors",
                      settings.theme === 'dark' ? "border-white/15 text-text-muted hover:text-white" : "border-black/15 text-zinc-600 hover:text-black"
                    )}
                  >
                    <Plus size={14} />
                    <span>Create Persona</span>
                  </Button>
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
            className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[70]"
          />
          <motion.div
            initial={{ opacity: 0, y: 15, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 15, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={cn(
              "fixed inset-x-4 top-[15%] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[460px] z-[80] border rounded-2xl p-5 shadow-2xl flex flex-col gap-4",
              settings.theme === 'dark' ? "bg-[#0b0b0e] border-white/[0.1] text-text-offwhite" : "bg-white border-black/[0.1] text-zinc-900"
            )}
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/[0.06] dark:border-white/[0.06] light:border-black/[0.06]">
              <div className="flex items-center gap-2">
                <Server size={16} className="text-accent-blue" />
                <h2 className="text-sm font-semibold tracking-tight">Ollama Host Configuration</h2>
              </div>
              <IconButton icon={X} onClick={() => setIsOllamaModalOpen(false)} size={16} />
            </div>

            <div className={cn(
              "p-3 rounded-xl border flex items-center justify-between",
              isOllamaConnected
                ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-400"
                : "border-white/[0.06] bg-white/[0.02] text-text-muted"
            )}>
              <div className="flex items-center gap-2.5">
                <span className={cn(
                  "w-2 h-2 rounded-full",
                  isOllamaConnected ? "bg-emerald-500" : "bg-red-400"
                )} />
                <span className="text-xs font-semibold">
                  {isOllamaConnected ? 'Active Connection' : 'Disconnected'}
                </span>
              </div>
              <span className="text-[10px] font-mono text-text-dim">
                {models.filter(m => m.id.startsWith('ollama/')).length} local models detected
              </span>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-mono uppercase tracking-wider text-text-dim block">
                Ollama API URL
              </label>
              <input
                type="text"
                value={ollamaHostInput}
                onChange={(e) => setOllamaHostInput(e.target.value)}
                placeholder="http://localhost:11434"
                className={cn(
                  "w-full rounded-lg px-3 py-2 text-xs font-mono border outline-none",
                  settings.theme === 'dark'
                    ? "bg-white/[0.03] border-white/[0.08] text-text-offwhite focus:border-white/20"
                    : "bg-[#f4f4f6] border-black/[0.08] text-zinc-900 focus:border-black/20"
                )}
              />
            </div>

            <div className="p-3 rounded-lg border border-white/[0.04] bg-white/[0.01] text-[11px] text-text-dim space-y-1 font-mono">
              <p className="font-semibold text-text-muted">Setup Command:</p>
              <p className="text-text-assistant">OLLAMA_ORIGINS="*" ollama serve</p>
            </div>

            {ollamaStatusMessage && (
              <p className="text-[11px] text-center font-mono text-accent-blue">
                {ollamaStatusMessage}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.06]">
              <Button
                type="button"
                onClick={() => setIsOllamaModalOpen(false)}
                className="text-text-muted hover:text-white"
              >
                Close
              </Button>
              <Button
                type="button"
                onClick={handleTestOllamaConnection}
                disabled={isTestingOllama}
                className={cn(
                  "text-white",
                  isTestingOllama ? "bg-accent-blue/50" : "bg-accent-blue hover:bg-accent-blue/90"
                )}
              >
                <RefreshCw size={12} className={isTestingOllama ? "animate-spin" : ""} />
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
            className="fixed inset-0 bg-black/60 backdrop-blur-xs z-[80]"
          />
          <motion.div
            initial={{ opacity: 0, y: 15, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 15, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={cn(
              "fixed inset-x-4 top-[15%] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[480px] z-[90] border rounded-2xl p-5 shadow-2xl flex flex-col gap-4",
              settings.theme === 'dark' ? "bg-[#0b0b0e] border-white/[0.1] text-text-offwhite" : "bg-white border-black/[0.1] text-zinc-900"
            )}
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/[0.06] dark:border-white/[0.06] light:border-black/[0.06]">
              <div className="flex items-center gap-2">
                <Upload size={16} className="text-accent-blue" />
                <h2 className="text-sm font-semibold tracking-tight">Confirm Chat Import</h2>
              </div>
              <IconButton icon={X} onClick={() => { setIsImportModalOpen(false); setPendingImport(null); }} size={16} />
            </div>

            <div className={cn(
              "p-3 rounded-xl border flex flex-col gap-2",
              settings.theme === 'dark' ? "bg-white/[0.02] border-white/[0.06]" : "bg-black/[0.02] border-black/[0.06]"
            )}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono truncate">{pendingImport.fileName}</span>
                <span className="text-[10px] font-mono text-emerald-400">Validated</span>
              </div>
              <div className="text-[11px] text-text-dim font-mono">
                {pendingImport.conversations.length} conversation(s) • {pendingImport.totalMessages} message(s)
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setImportMode('merge')}
                className={cn(
                  "p-3 rounded-xl border text-left flex flex-col gap-0.5 cursor-pointer transition-colors",
                  importMode === 'merge'
                    ? "border-accent-blue bg-accent-blue/10 text-white"
                    : "border-white/[0.06] text-text-muted hover:text-white"
                )}
              >
                <span className="text-xs font-semibold">Merge</span>
                <span className="text-[10px] opacity-70">Add alongside existing chats</span>
              </button>
              <button
                type="button"
                onClick={() => setImportMode('replace')}
                className={cn(
                  "p-3 rounded-xl border text-left flex flex-col gap-0.5 cursor-pointer transition-colors",
                  importMode === 'replace'
                    ? "border-red-500 bg-red-500/10 text-red-300"
                    : "border-white/[0.06] text-text-muted hover:text-white"
                )}
              >
                <span className="text-xs font-semibold">Replace</span>
                <span className="text-[10px] opacity-70">Overwrite all existing chats</span>
              </button>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.06]">
              <Button
                type="button"
                onClick={() => { setIsImportModalOpen(false); setPendingImport(null); }}
                className="text-text-muted hover:text-white"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleConfirmImport}
                className={cn(
                  importMode === 'replace'
                    ? "bg-red-600 hover:bg-red-500 text-white"
                    : "bg-white text-black hover:bg-white/90"
                )}
              >
                <Check size={13} />
                <span>Confirm {importMode === 'merge' ? 'Merge' : 'Replace'}</span>
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  const selectedModel = models.find(m => m.id === settings.selectedModelId);
  const isSelectedModelFree = parseFloat(selectedModel?.pricing?.prompt || '1') === 0;

  return (
    <div className="flex h-screen overflow-hidden font-sans bg-background-amoled text-text-offwhite dark:bg-background-amoled dark:text-text-offwhite light:bg-background-light light:text-text-light">
      {/* Mobile Sidebar Backdrop */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-xs"
          />
        )}
      </AnimatePresence>

      {renderSidebar()}

      {/* Main Chat Viewport */}
      <main className="flex-1 flex flex-col h-full bg-inherit relative z-0 overflow-hidden">
        {/* Minimal Application Header */}
        <header className={cn(
          "h-14 border-b flex items-center justify-between px-4 sm:px-6 shrink-0 z-20 sticky top-0 backdrop-blur-md transition-colors",
          settings.theme === 'dark' ? "border-white/[0.08] bg-[#000000]/85" : "border-black/[0.08] bg-[#ffffff]/85"
        )}>
          {/* Left: Mobile Toggle & Model / Persona Triggers */}
          <div className="flex items-center gap-3">
            <IconButton icon={Menu} onClick={() => setIsSidebarOpen(true)} className="md:hidden" size={17} />

            {/* Model Selector Trigger */}
            <button
              type="button"
              onClick={() => setIsModelSelectorOpen(true)}
              className={cn(
                "px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-2 cursor-pointer transition-colors",
                settings.theme === 'dark'
                  ? "border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] text-text-offwhite hover:border-white/20"
                  : "border-black/[0.08] bg-black/[0.03] hover:bg-black/[0.06] text-zinc-900 hover:border-black/20"
              )}
            >
              <span className="truncate max-w-[140px] sm:max-w-[220px]">
                {selectedModel?.name || 'Select Model'}
              </span>
              {isSelectedModelFree && (
                <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  FREE
                </span>
              )}
              <ChevronDown size={13} className="text-text-dim shrink-0" />
            </button>

            {/* Persona Switcher Trigger */}
            <button
              type="button"
              onClick={() => {
                setSettingsTab('personas');
                setIsPersonaManagerOpen(true);
              }}
              className="hidden sm:flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-text-muted hover:text-text-offwhite hover:bg-white/[0.04] transition-colors cursor-pointer"
            >
              <User size={13} className="text-text-dim" />
              <span className="truncate max-w-[120px]">{activePersona?.name || 'Default'}</span>
            </button>
          </div>

          {/* Right: Ollama Indicator & Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Ollama Status Button */}
            <button
              type="button"
              onClick={() => setIsOllamaModalOpen(true)}
              title={`Ollama: ${isOllamaConnected ? 'Connected' : 'Offline'} (Click to configure)`}
              className={cn(
                "px-2.5 py-1 rounded-full border text-[11px] font-mono flex items-center gap-2 transition-colors cursor-pointer",
                isOllamaConnected
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/15"
                  : (settings.theme === 'dark' ? "border-white/[0.08] text-text-dim hover:text-text-muted" : "border-black/[0.08] text-text-muted-light hover:text-zinc-700")
              )}
            >
              <span className={cn(
                "w-1.5 h-1.5 rounded-full shrink-0",
                isOllamaConnected ? "bg-emerald-400" : "bg-text-dim"
              )} />
              <span className="hidden sm:inline uppercase tracking-wider text-[10px]">
                {isOllamaConnected ? 'Ollama' : 'Offline'}
              </span>
            </button>

            {/* Memory Summarizer */}
            <IconButton
              icon={Bookmark}
              size={16}
              onClick={handleSummarizeMemory}
              title="Summarize conversation memory"
            />

            {/* Theme Toggle */}
            <IconButton
              icon={settings.theme === 'dark' ? Sun : Moon}
              size={16}
              onClick={toggleTheme}
              title="Toggle theme"
            />
          </div>
        </header>

        {/* Optional Standalone PWA Banner */}
        {deferredInstallPrompt && isInstallBannerVisible && !isInstalled && (
          <div className="max-w-3xl mx-auto px-4 pt-3 w-full">
            <div className={cn(
              "rounded-xl border px-4 py-3 flex items-center justify-between gap-3 text-xs",
              settings.theme === 'dark' ? "border-white/[0.08] bg-[#0c0c0e]" : "border-black/[0.08] bg-white"
            )}>
              <span className="text-text-muted">Install Void Chat for standalone desktop & mobile use</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={dismissInstallBanner}
                  className="px-2.5 py-1 text-text-dim hover:text-white"
                >
                  Dismiss
                </button>
                <Button
                  type="button"
                  onClick={handleInstallApp}
                  disabled={isInstallPromptPending}
                  className="bg-white text-black hover:bg-white/90 text-[11px] py-1 px-3"
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
          className="flex-1 overflow-y-auto px-4 sm:px-6 md:px-8 py-5 scrollbar-thin"
        >
          {activeConversation && (
            <div className="max-w-3xl mx-auto">
              {/* Conversation Sub-header */}
              <div className={cn(
                "flex items-center justify-between pb-3 mb-6 border-b text-xs transition-colors",
                settings.theme === 'dark' ? "border-white/[0.06]" : "border-black/[0.06]"
              )}>
                <div className="flex items-center gap-2 min-w-0">
                  {editingConvoId === activeConversation.id ? (
                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={editingTitleText}
                        autoFocus
                        onChange={(e) => setEditingTitleText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveTitle(activeConversation.id);
                          if (e.key === 'Escape') setEditingConvoId(null);
                        }}
                        className={cn(
                          "text-xs px-2 py-0.5 rounded border outline-none font-medium",
                          settings.theme === 'dark'
                            ? "bg-black border-white/20 text-white"
                            : "bg-white border-black/20 text-zinc-900"
                        )}
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveTitle(activeConversation.id)}
                        title="Save title"
                        className="p-1 text-emerald-400"
                      >
                        <Check size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingConvoId(null)}
                        title="Cancel"
                        className="p-1 text-red-400"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <div
                      className="flex items-center gap-1.5 min-w-0 cursor-pointer group"
                      onClick={() => handleStartRename(activeConversation)}
                      title="Click to rename"
                    >
                      {activeConversation.isPinned && (
                        <Pin size={11} className="text-accent-blue shrink-0 rotate-45" />
                      )}
                      <h1 className="text-xs sm:text-sm font-semibold truncate tracking-tight text-text-offwhite dark:text-zinc-200 light:text-zinc-900">
                        {activeConversation.title || 'Untitled'}
                      </h1>
                      <Edit3 size={11} className="text-text-dim opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
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
                      "p-1 rounded-md transition-colors",
                      activeConversation.isPinned
                        ? "text-accent-blue bg-accent-blue/10"
                        : "text-text-dim hover:text-text-offwhite"
                    )}
                  >
                    <Pin size={13} />
                  </button>

                  <button
                    type="button"
                    onClick={toggleAutoScroll}
                    title="Toggle auto-scroll anchor"
                    className={cn(
                      "px-2 py-1 rounded-md text-[10px] font-mono border transition-colors cursor-pointer",
                      settings.autoScroll !== false
                        ? "border-white/[0.08] text-text-dim hover:text-text-offwhite"
                        : "border-amber-500/30 text-amber-400 bg-amber-500/5"
                    )}
                  >
                    {settings.autoScroll !== false ? 'Auto-scroll ON' : 'Paused'}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleExportSingleChat(activeConversation.id)}
                    title="Export conversation as JSON"
                    className="p-1 text-text-dim hover:text-text-offwhite transition-colors cursor-pointer"
                  >
                    <Download size={13} />
                  </button>
                </div>
              </div>

              {/* Message List */}
              {activeConversation.messages.length === 0 ? (
                <div className="py-20 flex flex-col items-center justify-center text-center text-text-dim">
                  <div className="w-10 h-10 rounded-xl border border-white/[0.08] flex items-center justify-center mb-3">
                    <MessageSquare size={18} strokeWidth={1.5} className="opacity-50" />
                  </div>
                  <p className="text-xs font-semibold tracking-wider uppercase text-text-muted">Transmission Ready</p>
                  <p className="text-xs text-text-dim mt-1 max-w-xs">
                    Type a prompt below or dictate with voice to interact with {selectedModel?.name || 'the model'}.
                  </p>
                </div>
              ) : (
                <div className="space-y-7 pb-16">
                  {activeConversation.messages.map((message) => {
                    const isUser = message.role === 'user';
                    const isSystem = message.role === 'system';
                    const isEditingThisUserMsg = editingUserMessageId === message.id;

                    if (isUser) {
                      return (
                        <div key={message.id} className="flex flex-col items-end group">
                          {isEditingThisUserMsg ? (
                            <div className={cn(
                              "w-full max-w-xl p-3 rounded-2xl border flex flex-col gap-2.5",
                              settings.theme === 'dark' ? "bg-[#111116] border-white/20" : "bg-white border-black/20 shadow-md"
                            )}>
                              <div className="flex items-center gap-1.5 text-[11px] text-amber-400/90 font-medium">
                                <AlertCircle size={13} />
                                <span>Editing this message will remove subsequent responses and re-generate.</span>
                              </div>

                              <textarea
                                value={editingUserMessageContent}
                                onChange={(e) => setEditingUserMessageContent(e.target.value)}
                                rows={3}
                                className="w-full bg-transparent border border-white/10 dark:border-white/10 light:border-black/10 rounded-xl p-2.5 text-xs outline-none focus:border-white/25 resize-none leading-relaxed"
                              />

                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  type="button"
                                  onClick={handleCancelEditUserMessage}
                                  className="py-1 px-3 text-text-muted hover:text-white"
                                >
                                  Cancel
                                </Button>
                                <Button
                                  type="button"
                                  onClick={() => handleSaveAndResubmitUserMessage(message.id)}
                                  className="py-1 px-3 bg-white text-black hover:bg-white/90 text-xs"
                                >
                                  Save & Submit
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className={cn(
                                "rounded-2xl rounded-tr-xs px-4 py-3 max-w-[85%] md:max-w-[75%] border shadow-xs transition-colors",
                                settings.theme === 'dark'
                                  ? "bg-[#111115] border-white/[0.08] text-text-offwhite"
                                  : "bg-[#f1f1f4] border-black/[0.06] text-zinc-900"
                              )}>
                                <MarkdownRenderer content={message.content} isUser />
                              </div>

                              <div className="flex items-center gap-2 mt-1 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <span className="text-[10px] font-mono text-text-dim">
                                  {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleStartEditUserMessage(message)}
                                  className="text-text-dim hover:text-text-offwhite transition-colors"
                                  title="Edit message & regenerate subsequent responses"
                                >
                                  <Edit3 size={11} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleCopyMessage(message.id, message.content)}
                                  className="text-text-dim hover:text-text-offwhite transition-colors"
                                  title="Copy prompt"
                                >
                                  {copiedMessageId === message.id ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    }

                    if (isSystem) {
                      return (
                        <div key={message.id} className="p-3 rounded-xl border border-red-500/20 bg-red-500/5 text-xs text-red-400 flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <AlertCircle size={15} className="shrink-0 text-red-400" />
                            <span className="leading-relaxed">{message.content}</span>
                          </div>
                          {message.isError && (
                            <button
                              type="button"
                              onClick={() => handleRetryFromError(message.id)}
                              className="px-2.5 py-1 rounded-lg border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-300 font-mono text-[11px] shrink-0 flex items-center gap-1 transition-colors cursor-pointer"
                              title="Retry generation"
                            >
                              <RefreshCw size={11} />
                              <span>Retry</span>
                            </button>
                          )}
                        </div>
                      );
                    }

                    // Assistant response: Document-like presentation
                    return (
                      <div key={message.id} className="flex flex-col gap-2 group pt-1">
                        {/* Meta header */}
                        <div className="flex items-center justify-between text-xs text-text-dim">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono uppercase tracking-wider text-text-dim font-semibold">
                              Void Assistant
                            </span>
                            <span className="text-[10px] font-mono text-text-dim/60">
                              {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => handleRegenerateResponse(message.id)}
                              disabled={isLoading}
                              className="inline-flex items-center gap-1 text-[11px] font-mono text-text-dim hover:text-text-offwhite cursor-pointer transition-colors disabled:opacity-30"
                              title="Regenerate this response"
                            >
                              <RefreshCw size={11} />
                              <span>Regenerate</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleCopyMessage(message.id, message.content)}
                              className="inline-flex items-center gap-1 text-[11px] font-mono text-text-dim hover:text-text-offwhite cursor-pointer transition-colors"
                              title="Copy full response"
                            >
                              {copiedMessageId === message.id ? (
                                <>
                                  <Check size={11} className="text-emerald-400" />
                                  <span className="text-emerald-400">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy size={11} />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Document Content */}
                        <div className="text-[15px] leading-[1.75] text-text-assistant dark:text-zinc-200 light:text-zinc-800">
                          <MarkdownRenderer content={message.content} />
                        </div>
                      </div>
                    );
                  })}

                  {isLoading && (
                    <div className="flex flex-col gap-2 pt-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono uppercase tracking-wider text-text-dim font-semibold">
                          Void Assistant is thinking...
                        </span>
                        <button
                          type="button"
                          onClick={handleStopGeneration}
                          className="px-2.5 py-1 rounded-md text-[10px] font-mono border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20 flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          <Square size={10} fill="currentColor" />
                          <span>Stop</span>
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5 py-1">
                        <div className="w-1.5 h-1.5 bg-accent-blue/80 rounded-full animate-pulse" />
                        <div className="w-1.5 h-1.5 bg-accent-blue/60 rounded-full animate-pulse delay-100" />
                        <div className="w-1.5 h-1.5 bg-accent-blue/40 rounded-full animate-pulse delay-200" />
                      </div>
                    </div>
                  )}

                  <div ref={chatEndRef} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Message Composer (Natural Writing & Dictation Interface) */}
        <div className={cn(
          "px-4 sm:px-6 md:px-8 pt-2 pb-4 shrink-0 sticky bottom-0 z-20 backdrop-blur-md transition-colors",
          settings.theme === 'dark' ? "bg-[#000000]/90" : "bg-[#fafafa]/90"
        )}>
          {/* Jump to latest messages button */}
          <AnimatePresence>
            {isUserScrolledUp && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                className="absolute -top-10 left-1/2 -translate-x-1/2 pointer-events-auto"
              >
                <button
                  type="button"
                  onClick={() => scrollToBottom(true)}
                  className={cn(
                    "px-3 py-1 rounded-full border text-[11px] font-medium flex items-center gap-1.5 shadow-md cursor-pointer transition-colors backdrop-blur-md",
                    settings.theme === 'dark'
                      ? "bg-[#0c0c0e]/95 border-white/[0.1] text-text-offwhite hover:border-white/25"
                      : "bg-white/95 border-black/[0.1] text-zinc-900 hover:border-black/25"
                  )}
                >
                  <ChevronDown size={13} className="text-accent-blue" />
                  <span>Latest messages</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="max-w-3xl mx-auto flex flex-col gap-1.5">
            {/* Ambient Composer Container */}
            <div className={cn(
              "rounded-2xl border transition-colors flex items-end gap-2 p-2 sm:p-2.5 shadow-sm",
              settings.theme === 'dark'
                ? "bg-[#0a0a0d] border-white/[0.08] focus-within:border-white/[0.18]"
                : "bg-white border-black/[0.08] focus-within:border-black/[0.18]"
            )}>
              {/* Voice-to-Text Microphone Button */}
              <button
                type="button"
                onClick={handleToggleVoiceInput}
                title={isListening ? "Listening... click to stop" : "Dictate with voice (Speech-to-Text)"}
                className={cn(
                  "w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-all cursor-pointer mb-0.5",
                  isListening
                    ? "bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse shadow-[0_0_12px_rgba(239,68,68,0.4)]"
                    : "text-text-dim hover:text-text-offwhite hover:bg-white/[0.05]"
                )}
              >
                {isListening ? <MicOff size={15} /> : <Mic size={15} />}
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
                className="flex-1 bg-transparent border-none focus:outline-none px-2 py-1 text-sm resize-none min-h-[38px] max-h-48 leading-relaxed scrollbar-thin text-text-offwhite dark:text-zinc-100 light:text-zinc-900 placeholder:text-text-dim"
              />

              {/* Stop Button when generating, or Send Button */}
              {isLoading ? (
                <button
                  type="button"
                  onClick={handleStopGeneration}
                  aria-label="Stop generation"
                  title="Stop generating response"
                  className="px-2.5 py-1.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 hover:bg-red-500/25 text-xs font-mono flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer mb-0.5"
                >
                  <Square size={12} fill="currentColor" />
                  <span className="hidden sm:inline">Stop</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSendMessage()}
                  disabled={!inputMessage.trim() || isLoading}
                  aria-label="Send message"
                  className={cn(
                    "w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed mb-0.5",
                    inputMessage.trim()
                      ? (settings.theme === 'dark' ? "bg-white text-black hover:bg-white/90" : "bg-black text-white hover:bg-black/90")
                      : "text-text-dim hover:text-white"
                  )}
                >
                  <Send size={14} />
                </button>
              )}
            </div>

            <div className="flex items-center justify-between px-2 text-[10px] text-text-dim/75 font-mono">
              <span className="truncate">
                {isListening ? 'Microphone active • Dictating...' : `Active: ${selectedModel?.name?.split('/')[1] || selectedModel?.name || 'AI'}`}
              </span>
              <span className="hidden sm:inline">
                Enter to send • Shift + Enter for new line
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
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className={cn(
              "fixed bottom-5 right-5 z-[100] px-3.5 py-2 rounded-xl border text-xs font-medium flex items-center gap-2 shadow-xl backdrop-blur-md",
              settings.theme === 'dark'
                ? "bg-[#0c0c0e]/95 border-white/[0.1] text-text-offwhite"
                : "bg-white/95 border-black/[0.1] text-zinc-900"
            )}
          >
            <Check size={13} className="text-emerald-400 shrink-0" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
