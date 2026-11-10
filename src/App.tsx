import React, { useState, useEffect, useRef } from 'react';
import {
  Menu, Plus, Search, MoreVertical, Trash2, Edit3,
  Settings, User, MessageSquare, Bookmark, Moon, Sun,
  Send, ChevronLeft, Filter, Loader2, X, Archive, Copy, Check, Download,
  Server, RefreshCw, ChevronDown, ArrowDownCircle, Upload, FileUp, FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { v4 as uuidv4 } from 'uuid';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import {
  ChatMessage, Conversation, Persona,
  OpenRouterModel, AppSettings, PersonaMemory, BeforeInstallPromptEvent
} from './types';
import { StorageService } from './lib/storage';
import { ApiService } from './lib/api';

const INSTALL_PROMPT_SESSION_KEY = 'void_chat_install_prompt_session_state';
const INSTALL_PROMPT_POLICY = {
  dismissalScope: 'session',
};

function isRunningStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Components ---

const Button = ({ className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    className={cn(
      "touch-target rounded-xl transition-all hover:opacity-80 active:scale-[0.97] disabled:opacity-50 inline-flex items-center justify-center gap-2",
      className
    )}
    {...props}
  >
    {children}
  </button>
);

const IconButton = ({ icon: Icon, className, size = 20, ...props }: { icon: any, size?: number } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    className={cn(
      "touch-target rounded-full hover:bg-white/5 active:bg-white/10 transition-all flex items-center justify-center hover:scale-110 active:scale-95",
      className
    )}
    {...props}
  >
    <Icon size={size} />
  </button>
);

export default function App() {
  // --- State ---
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
  const userScrolledUpRef = useRef<boolean>(false);
  const prevActiveConvoIdRef = useRef<string | null>(null);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState<boolean>(false);

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
      const storedConvos = StorageService.getConversations();
      const storedPersonas = StorageService.getPersonas();
      const currentSettings = StorageService.getSettings();
      const savedActiveId = StorageService.getActiveConversationId();

      setConversations(storedConvos);
      setPersonas(storedPersonas);
      setSettings(currentSettings);
      setOllamaHostInput(currentSettings.ollamaHost || 'http://localhost:11434');

      if (storedConvos.length === 0) {
        // First run welcome conversation
        handleNewChat('Welcome to Void Chat');
      } else {
        const found = storedConvos.find(c => c.id === savedActiveId);
        setActiveConversationId(found ? found.id : storedConvos[0].id);
      }

      isInitializedRef.current = true;
      await refreshModelsAndOllama(currentSettings.ollamaHost);
    };
    init();
  }, []);

  // Auto-save conversations to localStorage whenever they change
  useEffect(() => {
    if (!isInitializedRef.current) return;
    StorageService.saveConversations(conversations);
  }, [conversations]);

  // Persist active conversation id across page refreshes
  useEffect(() => {
    if (!isInitializedRef.current || !activeConversationId) return;
    StorageService.saveActiveConversationId(activeConversationId);
  }, [activeConversationId]);

  // Periodic Ollama health polling
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
    // Calculate distance from bottom of scrollable container
    const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
    // User is reviewing earlier messages if scrolled up more than 80px from the bottom
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
      showToast(next.autoScroll ? 'Auto-scroll enabled' : 'Auto-scroll disabled');
      return next;
    });
  };

  useEffect(() => {
    const isNewConversation = prevActiveConvoIdRef.current !== activeConversationId;
    prevActiveConvoIdRef.current = activeConversationId;

    if (isNewConversation) {
      // Switched to a different conversation: reset review state and jump to bottom
      userScrolledUpRef.current = false;
      setIsUserScrolledUp(false);
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'auto' });
      }, 30);
      return;
    }

    // If auto-scroll is disabled in settings, do not auto-scroll
    if (settings.autoScroll === false) return;

    // If user is reviewing previous parts of the conversation (scrolled up), DO NOT auto-scroll
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

  // --- Derived State ---
  const activeConversation = conversations.find(c => c.id === activeConversationId);
  const activePersona = personas.find(p => p.id === settings.activePersonaId) || personas[0];
  const filteredConversations = conversations.filter(c =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.messages.some(m => m.content.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const availableModels = models.filter(m => {
    const matchesSearch = m.name.toLowerCase().includes(modelSearch.toLowerCase()) || m.id.toLowerCase().includes(modelSearch.toLowerCase());
    const isFree = parseFloat(m.pricing.prompt) === 0 && parseFloat(m.pricing.completion) === 0;
    return matchesSearch && (freeModelsOnly ? isFree : true);
  });

  // --- Handlers ---
  const handleNewChat = (title = 'New Conversation') => {
    const newConvo = StorageService.createConversation(title, settings.activePersonaId, settings.selectedModelId);
    setConversations([newConvo, ...conversations]);
    setActiveConversationId(newConvo.id);
    setIsSidebarOpen(false);
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputMessage.trim() || !activeConversation || isLoading) return;

    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: inputMessage,
      timestamp: Date.now(),
    };

    const updatedConvo = {
      ...activeConversation,
      messages: [...activeConversation.messages, userMessage],
      lastUpdated: Date.now(),
    };

    setConversations(prev => prev.map(c => c.id === activeConversation.id ? updatedConvo : c));
    StorageService.updateConversation(updatedConvo);
    setInputMessage('');
    setIsLoading(true);
    userScrolledUpRef.current = false;
    setIsUserScrolledUp(false);
    setTimeout(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 40);

    try {
      // Prepare messages with system prompt and memories
      const systemMessageContent = `System prompt:\n${activePersona?.systemPrompt || ''}${activePersona?.memories && activePersona.memories.length > 0 ? '\n\nRelevant saved memories for this persona:\n' + activePersona.memories.map(m => `- ${m.content}`).join('\n') : ''}`;

      const systemMessage: ChatMessage = {
        id: 'system',
        role: 'system',
        content: systemMessageContent,
        timestamp: Date.now(),
      };

      const response = await ApiService.chatCompletion(
        settings.selectedModelId,
        [systemMessage, ...updatedConvo.messages],
        0.7,
        settings.ollamaHost
      );

      const assistantMessage: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: response,
        timestamp: Date.now(),
      };

      const finalConvo = {
        ...updatedConvo,
        messages: [...updatedConvo.messages, assistantMessage],
        lastUpdated: Date.now(),
      };

      // Auto-title if it's the first real exchange
      if (
        (finalConvo.messages.length >= 2 && (finalConvo.title === 'Welcome to Void Chat' || finalConvo.title === 'New Conversation')) ||
        !finalConvo.title
      ) {
        finalConvo.title = userMessage.content.slice(0, 30) + (userMessage.content.length > 30 ? '...' : '');
      }

      setConversations(prev => prev.map(c => c.id === activeConversation.id ? finalConvo : c));
      StorageService.updateConversation(finalConvo);
    } catch (err) {
      console.error(err);
      const errorMessage: ChatMessage = {
        id: uuidv4(),
        role: 'system',
        content: `Error: ${err instanceof Error ? err.message : 'Unknown error occurred'}`,
        timestamp: Date.now(),
      };
      const errorConvo = {
        ...updatedConvo,
        messages: [...updatedConvo.messages, errorMessage],
        lastUpdated: Date.now(),
      };
      setConversations(prev => prev.map(c => c.id === activeConversation.id ? errorConvo : c));
      StorageService.updateConversation(errorConvo);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartRename = (convo: Conversation, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingConvoId(convo.id);
    setEditingTitleText(convo.title || 'Untitled');
  };

  const handleSaveTitle = (id: string) => {
    const trimmed = editingTitleText.trim() || 'Untitled';
    setConversations(prev => prev.map(c => c.id === id ? { ...c, title: trimmed, lastUpdated: Date.now() } : c));
    StorageService.updateConversationTitle(id, trimmed);
    setEditingConvoId(null);
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleExportAllChats = () => {
    StorageService.exportChatHistory(conversations);
    setExportFeedbackMessage(`Exported ${conversations.length} conversation(s) to JSON`);
    showToast(`Exported ${conversations.length} conversation(s) to JSON`);
    setTimeout(() => setExportFeedbackMessage(null), 4000);
  };

  const handleExportSingleChat = (convoId: string) => {
    const target = conversations.find(c => c.id === convoId);
    if (!target) return;
    StorageService.exportChatHistory(conversations, convoId);
    setExportFeedbackMessage(`Exported "${target.title}" to JSON`);
    showToast(`Exported "${target.title}" to JSON`);
    setTimeout(() => setExportFeedbackMessage(null), 4000);
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

    showToast(`Successfully imported ${pendingImport.conversations.length} conversation(s)`);
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
      showToast('Memory saved for current persona.');
    } catch (err) {
      console.error(err);
      showToast('Failed to summarize memory.');
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
        setOllamaStatusMessage(`Connected! Found ${localModels.length} local model(s).`);
      } else {
        setOllamaStatusMessage('Could not connect to Ollama. Make sure Ollama is running (`ollama serve`).');
      }
    } catch (err) {
      console.error(err);
      setIsOllamaConnected(false);
      setOllamaStatusMessage('Connection attempt failed.');
    } finally {
      setIsTestingOllama(false);
    }
  };

  const deleteConversation = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this conversation?')) {
      StorageService.deleteConversation(id);
      const newConvos = conversations.filter(c => c.id !== id);
      setConversations(newConvos);
      if (activeConversationId === id) {
        setActiveConversationId(newConvos[0]?.id || null);
      }
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

    // If updating the active persona, also update current settings
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

  // --- Render Helpers ---

  const renderSidebar = () => (
    <motion.aside
      initial={false}
      animate={{ x: isSidebarOpen ? 0 : -260 }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className={cn(
        "fixed inset-y-0 left-0 w-[260px] z-50 border-r flex flex-col transition-colors",
        settings.theme === 'dark' ? "bg-background-amoled border-border-dark" : "bg-background-light border-border-light"
      )}
    >
      <div className="p-6 flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[10px] tracking-[0.2em] font-bold uppercase text-text-muted">Void Chat</h1>
            <span className="text-[9px] uppercase tracking-wider text-text-dim">v1.0.0-alpha</span>
          </div>
          <IconButton icon={X} onClick={() => setIsSidebarOpen(false)} className="md:hidden" />
        </div>
      </div>

      <div className="px-4 mb-4 flex gap-2">
        <button
          onClick={() => handleNewChat()}
          className={cn(
            "flex-1 py-3 px-4 border rounded-xl text-[13px] font-medium text-left transition-all flex items-center justify-between cursor-pointer",
            settings.theme === 'dark' ? "border-border-dark hover:bg-panel-dark text-text-offwhite hover:border-border-focus" : "border-border-light hover:bg-panel-light text-text-light hover:border-gray-300"
          )}
        >
          <span>New Chat</span>
          <Plus size={14} className="opacity-40" />
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          title="Import chat history (JSON)"
          className={cn(
            "p-3 border rounded-xl transition-all flex items-center justify-center cursor-pointer",
            settings.theme === 'dark' ? "border-border-dark hover:bg-panel-dark text-text-dim hover:text-text-offwhite hover:border-border-focus" : "border-border-light hover:bg-panel-light text-text-muted-light hover:text-text-light"
          )}
        >
          <Upload size={14} />
        </button>
      </div>

      <div className="px-4 mb-4">
        <div className="relative">
          <input
            type="text"
            placeholder="Search messages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(
              "w-full border rounded-xl px-4 py-2.5 text-[13px] outline-none transition-all",
              settings.theme === 'dark' ? "bg-panel-dark border-border-dark placeholder-text-dim focus:border-border-focus" : "bg-panel-light border-border-light placeholder-text-muted-light focus:border-gray-500"
            )}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide px-2 space-y-1">
        {filteredConversations.map(convo => (
          <div
            key={convo.id}
            onClick={() => { setActiveConversationId(convo.id); setIsSidebarOpen(false); }}
            className={cn(
              "group relative p-4 rounded-xl border cursor-pointer transition-all active:scale-[0.98]",
              activeConversationId === convo.id
                ? (settings.theme === 'dark' ? "bg-panel-dark border-border-focus" : "bg-panel-light border-gray-400")
                : (settings.theme === 'dark' ? "border-transparent hover:bg-panel-darker" : "border-transparent hover:bg-panel-light")
            )}
          >
            {editingConvoId === convo.id ? (
              <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
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
                    "flex-1 text-[12px] px-2 py-1 rounded-lg border outline-none min-w-0 font-medium",
                    settings.theme === 'dark'
                      ? "bg-black border-border-focus text-text-offwhite"
                      : "bg-white border-border-light text-text-light"
                  )}
                />
                <button
                  type="button"
                  onClick={() => handleSaveTitle(convo.id)}
                  title="Save title"
                  className="p-1 hover:text-green-400 text-text-dim hover:scale-110 transition-transform"
                >
                  <Check size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => setEditingConvoId(null)}
                  title="Cancel"
                  className="p-1 hover:text-red-400 text-text-dim hover:scale-110 transition-transform"
                >
                  <X size={13} />
                </button>
              </div>
            ) : (
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0 pr-2">
                  <p className={cn(
                    "text-[13px] truncate",
                    activeConversationId === convo.id ? "font-medium" : (settings.theme === 'dark' ? "text-text-muted" : "text-text-muted-light")
                  )}>
                    {convo.title || 'Untitled'}
                  </p>
                  <p className="text-[10px] uppercase tracking-tighter text-text-dim mt-1">
                    {new Date(convo.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {models.find(m => m.id === convo.modelId)?.name?.split('/')[1] || 'AI'}
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    type="button"
                    onClick={(e) => handleStartRename(convo, e)}
                    title="Rename conversation"
                    className="p-1 hover:text-text-offwhite text-text-dim hover:scale-110 transition-all"
                  >
                    <Edit3 size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => deleteConversation(convo.id, e)}
                    title="Delete conversation"
                    className="p-1 hover:text-red-500 text-text-dim hover:scale-110 transition-all"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className={cn(
        "p-4 border-t flex items-center justify-between text-[11px] text-text-dim",
        settings.theme === 'dark' ? "border-border-dark" : "border-border-light"
      )}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-900"></div>
          <span className="uppercase tracking-widest">Connected</span>
        </div>
        <button
          onClick={() => {
            setSettingsTab('settings');
            setIsPersonaManagerOpen(true);
          }}
          className="hover:text-text-offwhite transition-colors flex items-center gap-1.5 cursor-pointer font-medium"
        >
          <Settings size={13} />
          <span>Settings</span>
        </button>
      </div>
    </motion.aside>
  );

  const renderModelSelector = () => (
    <AnimatePresence>
      {isModelSelectorOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setIsModelSelectorOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
          />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className={cn(
              "fixed inset-x-0 bottom-0 max-h-[80vh] z-[70] border-t rounded-t-[2rem] flex flex-col p-6 overflow-hidden",
              settings.theme === 'dark' ? "bg-background-amoled border-border-dark" : "bg-white border-border-light"
            )}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold tracking-tight">Select Model</h2>
              <IconButton icon={X} onClick={() => setIsModelSelectorOpen(false)} />
            </div>

            <div className="flex flex-col gap-4 mb-6">
              <div className="relative">
                <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 opacity-30" />
                <input
                  type="text"
                  placeholder="Filter models..."
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  className={cn(
                    "w-full bg-transparent border rounded-xl pl-11 pr-4 py-3 text-sm focus:outline-none focus:ring-1",
                    settings.theme === 'dark' ? "border-border-dark focus:ring-white/10" : "border-border-light focus:ring-black/10"
                  )}
                />
              </div>

              <label className="flex items-center gap-3 cursor-pointer group px-1">
                <div className={cn(
                  "w-11 h-6 rounded-full p-1 transition-all relative",
                  freeModelsOnly ? "bg-accent-blue" : (settings.theme === 'dark' ? "bg-white/10" : "bg-black/10")
                )}>
                  <motion.div
                    animate={{ x: freeModelsOnly ? 20 : 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    className="w-4 h-4 bg-white rounded-full shadow-lg"
                  />
                  <input
                    type="checkbox"
                    className="hidden"
                    checked={freeModelsOnly}
                    onChange={e => setFreeModelsOnly(e.target.checked)}
                  />
                </div>
                <span className="text-xs font-medium opacity-60">Show free models only</span>
              </label>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-hide space-y-2 pb-12">
              {availableModels.length === 0 ? (
                <div className="p-8 text-center opacity-40 text-sm italic">No models found</div>
              ) : (
                availableModels.map(model => (
                  <div
                    key={model.id}
                    onClick={() => {
                      setSettings(prev => ({ ...prev, selectedModelId: model.id }));
                      setIsModelSelectorOpen(false);
                    }}
                    className={cn(
                      "p-5 rounded-2xl border cursor-pointer transition-all hover:border-border-focus active:scale-[0.98]",
                      settings.selectedModelId === model.id
                        ? (settings.theme === 'dark' ? "bg-white/5 border-white/20" : "bg-black/5 border-black/20")
                        : (settings.theme === 'dark' ? "border-border-dark hover:bg-white/[0.02]" : "border-border-light hover:bg-black/[0.02]")
                    )}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-sm font-bold">{model.name}</span>
                      <div className="flex items-center gap-1.5">
                        {model.id.startsWith('ollama/') && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400">OLLAMA</span>
                        )}
                        {parseFloat(model.pricing.prompt) === 0 && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">FREE</span>
                        )}
                      </div>
                    </div>
                    <p className="text-[10px] font-mono opacity-40 truncate">{model.id}</p>
                    <div className="flex gap-4 mt-2">
                      <span className="text-[10px] opacity-60">Context: {Math.floor(model.context_length / 1024)}k</span>
                    </div>
                  </div>
                ))
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
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setIsPersonaManagerOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
          />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className={cn(
              "fixed inset-x-0 bottom-0 h-[90vh] z-[70] border-t rounded-t-[2rem] flex flex-col p-6 overflow-hidden",
              settings.theme === 'dark' ? "bg-background-amoled border-border-dark" : "bg-white border-border-light"
            )}
          >
            {/* Modal Header & Navigation Tabs */}
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-border-dark/40">
              <div className="flex items-center gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => setSettingsTab('settings')}
                  className={cn(
                    "px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer",
                    settingsTab === 'settings'
                      ? (settings.theme === 'dark' ? "bg-white text-black shadow-md" : "bg-black text-white shadow-md")
                      : (settings.theme === 'dark' ? "text-text-muted hover:text-white" : "text-text-muted-light hover:text-black")
                  )}
                >
                  <Settings size={14} />
                  <span>Settings & Data</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsTab('personas')}
                  className={cn(
                    "px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer",
                    settingsTab === 'personas'
                      ? (settings.theme === 'dark' ? "bg-white text-black shadow-md" : "bg-black text-white shadow-md")
                      : (settings.theme === 'dark' ? "text-text-muted hover:text-white" : "text-text-muted-light hover:text-black")
                  )}
                >
                  <User size={14} />
                  <span>Personas ({personas.length})</span>
                </button>
              </div>
              <IconButton icon={X} onClick={() => setIsPersonaManagerOpen(false)} />
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-hide pb-20">
              {settingsTab === 'settings' ? (
                <div className="space-y-6 max-w-2xl mx-auto">
                  {/* Chat History & Data Export Card */}
                  <div className={cn(
                    "p-6 rounded-3xl border flex flex-col gap-5 shadow-sm",
                    settings.theme === 'dark' ? "border-border-dark bg-white/[0.03]" : "border-border-light bg-black/[0.02]"
                  )}>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Download size={16} className="text-accent-blue" />
                        <h3 className="font-bold text-sm tracking-tight">Chat History (Export & Import)</h3>
                      </div>
                      <p className="text-xs text-text-dim leading-relaxed">
                        Export your full chat history as a portable JSON backup, or import previous conversations with full message history and titles preserved.
                      </p>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div className={cn(
                        "p-3 rounded-2xl border flex flex-col gap-1",
                        settings.theme === 'dark' ? "border-border-dark bg-panel-dark" : "border-border-light bg-panel-light"
                      )}>
                        <span className="text-[10px] uppercase font-bold tracking-wider text-text-dim">Conversations</span>
                        <span className="text-lg font-mono font-bold text-text-offwhite">{conversations.length}</span>
                      </div>
                      <div className={cn(
                        "p-3 rounded-2xl border flex flex-col gap-1",
                        settings.theme === 'dark' ? "border-border-dark bg-panel-dark" : "border-border-light bg-panel-light"
                      )}>
                        <span className="text-[10px] uppercase font-bold tracking-wider text-text-dim">Total Messages</span>
                        <span className="text-lg font-mono font-bold text-text-offwhite">
                          {conversations.reduce((acc, c) => acc + (c.messages?.length || 0), 0)}
                        </span>
                      </div>
                      <div className={cn(
                        "p-3 rounded-2xl border flex flex-col gap-1 col-span-2 sm:col-span-1",
                        settings.theme === 'dark' ? "border-border-dark bg-panel-dark" : "border-border-light bg-panel-light"
                      )}>
                        <span className="text-[10px] uppercase font-bold tracking-wider text-text-dim">Auto-Save</span>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse" />
                          <span className="text-xs font-mono text-emerald-400">Active</span>
                        </div>
                      </div>
                    </div>

                    {/* Export and Import Actions */}
                    <div className="flex flex-col sm:flex-row gap-3 pt-2">
                      <Button
                        type="button"
                        onClick={handleExportAllChats}
                        className={cn(
                          "flex-1 py-3 px-4 rounded-2xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2",
                          settings.theme === 'dark'
                            ? "bg-white text-black hover:bg-white/90 shadow-lg shadow-white/5"
                            : "bg-black text-white hover:bg-black/90 shadow-lg shadow-black/5"
                        )}
                      >
                        <Download size={14} />
                        <span>Export (JSON)</span>
                      </Button>

                      <Button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className={cn(
                          "flex-1 py-3 px-4 rounded-2xl text-xs font-bold uppercase tracking-wider border transition-all flex items-center justify-center gap-2",
                          settings.theme === 'dark'
                            ? "border-border-dark bg-panel-dark text-text-offwhite hover:border-border-focus hover:bg-white/5"
                            : "border-border-light bg-panel-light text-text-light hover:border-gray-400 hover:bg-black/5"
                        )}
                      >
                        <Upload size={14} />
                        <span>Import (JSON)</span>
                      </Button>
                    </div>

                    {/* Drag and Drop Zone */}
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
                        "p-4 rounded-2xl border border-dashed transition-all cursor-pointer text-center flex flex-col items-center justify-center gap-1",
                        isDraggingFile
                          ? "border-accent-blue bg-accent-blue/10"
                          : (settings.theme === 'dark' ? "border-white/10 hover:border-white/20 bg-white/[0.01]" : "border-black/10 hover:border-black/20 bg-black/[0.01]")
                      )}
                    >
                      <FileUp size={16} className="text-text-dim opacity-70 mb-0.5" />
                      <p className="text-xs font-medium text-text-muted">
                        Drop a <span className="font-mono text-accent-blue">.json</span> file here or click to browse
                      </p>
                      <p className="text-[10px] text-text-dim">
                        Supports Void Chat exports and standard conversation JSON archives
                      </p>
                    </div>

                    {activeConversation && (
                      <div className="flex justify-end pt-1">
                        <Button
                          type="button"
                          onClick={() => handleExportSingleChat(activeConversation.id)}
                          className={cn(
                            "py-2 px-3 rounded-xl text-[11px] font-semibold border transition-all flex items-center justify-center gap-1.5",
                            settings.theme === 'dark'
                              ? "border-border-dark bg-panel-dark text-text-muted hover:text-text-offwhite hover:border-border-focus"
                              : "border-border-light bg-panel-light text-text-muted-light hover:text-text-light"
                          )}
                          title={`Export current conversation: "${activeConversation.title}"`}
                        >
                          <Download size={13} />
                          <span>Export Active Chat Only</span>
                        </Button>
                      </div>
                    )}

                    {exportFeedbackMessage && (
                      <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono flex items-center gap-2">
                        <Check size={14} />
                        <span>{exportFeedbackMessage}</span>
                      </div>
                    )}
                  </div>

                  {/* Auto-Save & Storage Information */}
                  <div className={cn(
                    "p-6 rounded-3xl border flex flex-col gap-4 shadow-sm",
                    settings.theme === 'dark' ? "border-border-dark bg-white/[0.03]" : "border-border-light bg-black/[0.02]"
                  )}>
                    <div className="space-y-1">
                      <h3 className="font-bold text-sm tracking-tight">Auto-Save & Persistence Details</h3>
                      <p className="text-xs text-text-dim leading-relaxed">
                        Every title rename, sent message, and response is automatically committed to your browser's persistent localStorage. Refreshing or closing the tab will preserve your conversations and current active chat.
                      </p>
                    </div>

                    <div className="flex items-center justify-between text-xs font-mono pt-2 border-t border-white/5 text-text-dim">
                      <span>Persistence Store:</span>
                      <span className="text-text-offwhite">void_chat_conversations</span>
                    </div>
                  </div>

                  {/* Ollama & Local Model Shortcut */}
                  <div className={cn(
                    "p-6 rounded-3xl border flex items-center justify-between shadow-sm",
                    settings.theme === 'dark' ? "border-border-dark bg-white/[0.03]" : "border-border-light bg-black/[0.02]"
                  )}>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Server size={15} />
                        <h3 className="font-bold text-sm tracking-tight">Ollama Local Models</h3>
                      </div>
                      <p className="text-xs text-text-dim">
                        Status: <span className={isOllamaConnected ? "text-emerald-400 font-mono" : "text-red-400 font-mono"}>
                          {isOllamaConnected ? "Connected" : "Disconnected"}
                        </span> • Host: <span className="font-mono">{settings.ollamaHost || 'http://localhost:11434'}</span>
                      </p>
                    </div>

                    <Button
                      type="button"
                      onClick={() => {
                        setIsPersonaManagerOpen(false);
                        setIsOllamaModalOpen(true);
                      }}
                      className={cn(
                        "py-2 px-3.5 text-xs font-semibold rounded-xl border",
                        settings.theme === 'dark'
                          ? "border-border-dark bg-panel-dark text-text-offwhite hover:border-border-focus"
                          : "border-border-light bg-panel-light text-text-light hover:border-gray-400"
                      )}
                    >
                      Configure
                    </Button>
                  </div>

                  {/* Auto-scroll Toggle */}
                  <div className={cn(
                    "p-6 rounded-3xl border flex items-center justify-between shadow-sm",
                    settings.theme === 'dark' ? "border-border-dark bg-white/[0.03]" : "border-border-light bg-black/[0.02]"
                  )}>
                    <div className="space-y-1 pr-4">
                      <div className="flex items-center gap-2">
                        <ArrowDownCircle size={15} className={settings.autoScroll !== false ? "text-accent-blue" : "text-text-dim"} />
                        <h3 className="font-bold text-sm tracking-tight">Auto-scroll</h3>
                      </div>
                      <p className="text-xs text-text-dim leading-relaxed">
                        Anchors chat to newest messages. Automatically pauses when you scroll up to review previous parts of the conversation.
                      </p>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[11px] font-mono text-text-dim uppercase tracking-wider hidden sm:inline">
                        {settings.autoScroll !== false ? 'Enabled' : 'Disabled'}
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={settings.autoScroll !== false}
                        aria-label="Toggle auto-scroll"
                        onClick={toggleAutoScroll}
                        className={cn(
                          "w-12 h-6 rounded-full p-0.5 transition-colors relative cursor-pointer",
                          settings.autoScroll !== false
                            ? "bg-accent-blue"
                            : (settings.theme === 'dark' ? "bg-white/10" : "bg-black/15")
                        )}
                      >
                        <motion.div
                          animate={{ x: settings.autoScroll !== false ? 24 : 0 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                          className="w-5 h-5 bg-white rounded-full shadow-md"
                        />
                      </button>
                    </div>
                  </div>

                  {/* Theme Selector */}
                  <div className={cn(
                    "p-6 rounded-3xl border flex items-center justify-between shadow-sm",
                    settings.theme === 'dark' ? "border-border-dark bg-white/[0.03]" : "border-border-light bg-black/[0.02]"
                  )}>
                    <div className="space-y-1">
                      <h3 className="font-bold text-sm tracking-tight">Appearance</h3>
                      <p className="text-xs text-text-dim">Switch between Pure AMOLED Black and Minimalist Light mode</p>
                    </div>

                    <Button
                      type="button"
                      onClick={toggleTheme}
                      className={cn(
                        "py-2 px-3.5 text-xs font-semibold rounded-xl border flex items-center gap-2",
                        settings.theme === 'dark'
                          ? "border-border-dark bg-panel-dark text-text-offwhite hover:border-border-focus"
                          : "border-border-light bg-panel-light text-text-light hover:border-gray-400"
                      )}
                    >
                      {settings.theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                      <span>{settings.theme === 'dark' ? 'AMOLED Dark' : 'Minimal Light'}</span>
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {personas.map(persona => (
                    <div
                      key={persona.id}
                      className={cn(
                        "p-6 rounded-3xl border flex flex-col gap-6 shadow-sm",
                        settings.theme === 'dark' ? "border-border-dark bg-white/[0.03]" : "border-border-light bg-black/[0.02]"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4 flex-1">
                          <div className={cn(
                            "w-3 h-3 rounded-full shrink-0",
                            settings.activePersonaId === persona.id ? "bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.6)]" : "bg-gray-500/20"
                          )} />
                          <input
                            type="text"
                            value={persona.name}
                            onChange={(e) => {
                              const next = personas.map(p => p.id === persona.id ? { ...p, name: e.target.value } : p);
                              setPersonas(next);
                              StorageService.savePersonas(next);
                            }}
                            className="font-bold text-base tracking-tight bg-transparent border-none focus:outline-none w-full"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          {persona.id !== 'default' && (
                            <IconButton
                              icon={Trash2} size={16}
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
                              className="text-text-dim hover:text-red-500"
                            />
                          )}
                          <Button
                            onClick={() => handlePersonaSelect(persona.id)}
                            className={cn(
                              "text-[11px] font-bold uppercase tracking-widest px-4 py-2 min-h-0 rounded-full",
                              settings.activePersonaId === persona.id
                                ? (settings.theme === 'dark' ? "bg-white/10 text-white" : "bg-black/10 text-black")
                                : (settings.theme === 'dark' ? "text-white/40 hover:text-white" : "text-black/40 hover:text-black")
                            )}
                          >
                            {settings.activePersonaId === persona.id ? 'Active' : 'Select'}
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div className="flex flex-col gap-2">
                          <label className="text-[10px] font-bold uppercase opacity-30 block">Associated Model</label>
                          <select
                            value={persona.selectedModelId || ''}
                            onChange={(e) => handleUpdatePersonaModel(persona.id, e.target.value)}
                            className={cn(
                              "w-full bg-transparent border rounded-xl px-3 py-2 text-xs focus:outline-none focus:ring-1 transition-all",
                              settings.theme === 'dark' ? "border-border-dark focus:ring-white/10" : "border-border-light focus:ring-black/10"
                            )}
                          >
                            <option value="">Default (Global Selection)</option>
                            {models.map(m => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="text-[10px] font-bold uppercase opacity-30 block mb-2">System Instructions</label>
                          <textarea
                            value={persona.systemPrompt}
                            onChange={(e) => {
                              const next = personas.map(p => p.id === persona.id ? { ...p, systemPrompt: e.target.value } : p);
                              setPersonas(next);
                              StorageService.savePersonas(next);
                            }}
                            rows={3}
                            className={cn(
                              "w-full bg-transparent border rounded-xl p-3 text-sm focus:outline-none focus:ring-1 transition-all resize-none",
                              settings.theme === 'dark' ? "border-border-dark focus:ring-white/10" : "border-border-light focus:ring-black/10"
                            )}
                          />
                        </div>

                        {persona.memories.length > 0 && (
                          <div>
                            <label className="text-[10px] font-bold uppercase opacity-30 block mb-2">Memories ({persona.memories.length})</label>
                            <div className="space-y-2 max-h-40 overflow-y-auto scrollbar-hide">
                              {persona.memories.map(memory => (
                                <div key={memory.id} className={cn(
                                  "p-3 rounded-lg text-xs leading-relaxed border relative group",
                                  settings.theme === 'dark' ? "border-border-dark bg-white/5" : "border-border-light bg-black/5"
                                )}>
                                  {memory.content}
                                  <button
                                    onClick={() => {
                                      const next = personas.map(p => p.id === persona.id ? { ...p, memories: p.memories.filter(m => m.id !== memory.id) } : p);
                                      setPersonas(next);
                                      StorageService.savePersonas(next);
                                    }}
                                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:text-red-500"
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
                  ))}

                  <Button
                    onClick={() => {
                      const newPersona: Persona = {
                        id: uuidv4(),
                        name: 'New Persona',
                        systemPrompt: 'You are a helpful assistant.',
                        memories: [],
                      };
                      const next = [...personas, newPersona];
                      setPersonas(next);
                      StorageService.savePersonas(next);
                    }}
                    className="w-full border border-dashed border-white/20 mt-6 py-4 rounded-2xl opacity-50 hover:opacity-100 transition-opacity"
                  >
                    <Plus size={18} />
                    <span>Create New Persona</span>
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  const renderInstallBanner = () => {
    if (!deferredInstallPrompt || !isInstallBannerVisible || isInstalled) {
      return null;
    }

    return (
      <div className="max-w-3xl mx-auto px-6 pt-4 md:px-8 md:pt-6">
        <div className={cn(
          "rounded-2xl border px-5 py-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between shadow-lg",
          settings.theme === 'dark'
            ? "border-border-dark bg-panel-darker/95"
            : "border-border-light bg-white/95"
        )}>
          <div className="flex items-start gap-4">
            <div className={cn(
              "mt-0.5 rounded-xl p-2",
              settings.theme === 'dark' ? "bg-white/5 text-text-offwhite" : "bg-black/5 text-text-light"
            )}>
              <Download size={18} />
            </div>
            <div className="space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-text-dim">
                Install Void Chat
              </p>
              <p className={cn(
                "text-sm leading-relaxed",
                settings.theme === 'dark' ? "text-text-assistant" : "text-text-muted-light"
              )}>
                Install the app for a standalone experience, quicker relaunches, and cached offline access.
              </p>
              <p className="text-[10px] uppercase tracking-wider text-text-dim">
                Prompt policy: {INSTALL_PROMPT_POLICY.dismissalScope}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              onClick={dismissInstallBanner}
              className={cn(
                "px-4 py-2 min-h-0 text-xs font-semibold uppercase tracking-wider",
                settings.theme === 'dark'
                  ? "text-text-muted hover:text-text-offwhite"
                  : "text-text-muted-light hover:text-text-light"
              )}
            >
              Not Now
            </Button>
            <Button
              type="button"
              onClick={handleInstallApp}
              disabled={isInstallPromptPending}
              className={cn(
                "px-4 py-2 min-h-0 rounded-full text-xs font-semibold uppercase tracking-wider",
                settings.theme === 'dark'
                  ? "bg-white text-black hover:bg-white/90"
                  : "bg-black text-white hover:bg-black/90"
              )}
            >
              {isInstallPromptPending ? 'Opening...' : 'Install App'}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const renderOllamaModal = () => (
    <AnimatePresence>
      {isOllamaModalOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsOllamaModalOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70]"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 220 }}
            className={cn(
              "fixed inset-x-4 top-[15%] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[480px] z-[80] border rounded-3xl p-6 shadow-2xl flex flex-col gap-5",
              settings.theme === 'dark' ? "bg-panel-darker border-border-dark text-text-offwhite" : "bg-white border-border-light text-text-light"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "p-2 rounded-xl",
                  settings.theme === 'dark' ? "bg-white/5" : "bg-black/5"
                )}>
                  <Server size={18} />
                </div>
                <div>
                  <h2 className="text-base font-bold tracking-tight">Ollama Connection</h2>
                  <p className="text-[11px] text-text-dim">Connect to local models on your machine</p>
                </div>
              </div>
              <IconButton icon={X} onClick={() => setIsOllamaModalOpen(false)} />
            </div>

            {/* Connection Status Card */}
            <div className={cn(
              "p-4 rounded-2xl border flex items-center justify-between transition-colors",
              isOllamaConnected
                ? (settings.theme === 'dark' ? "border-emerald-500/30 bg-emerald-500/5" : "border-emerald-200 bg-emerald-50/60")
                : (settings.theme === 'dark' ? "border-border-dark bg-panel-dark" : "border-border-light bg-panel-light")
            )}>
              <div className="flex items-center gap-3">
                <span className={cn(
                  "w-2.5 h-2.5 rounded-full shrink-0 transition-all",
                  isOllamaConnected
                    ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.9)]"
                    : "bg-red-500/80"
                )} />
                <div>
                  <p className="text-xs font-semibold">
                    {isOllamaConnected ? "Connected & Active" : "Disconnected"}
                  </p>
                  <p className="text-[10px] text-text-dim font-mono">
                    {models.filter(m => m.id.startsWith('ollama/')).length} local model(s) detected
                  </p>
                </div>
              </div>

              <span className={cn(
                "text-[10px] font-mono px-2 py-0.5 rounded-full uppercase tracking-wider",
                isOllamaConnected
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-white/10 text-text-dim"
              )}>
                {isOllamaConnected ? "Online" : "Offline"}
              </span>
            </div>

            {/* Host URL input */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-widest text-text-dim block">
                Ollama API Host
              </label>
              <input
                type="text"
                value={ollamaHostInput}
                onChange={(e) => setOllamaHostInput(e.target.value)}
                placeholder="http://localhost:11434"
                className={cn(
                  "w-full border rounded-xl px-4 py-2.5 text-xs font-mono outline-none transition-all",
                  settings.theme === 'dark'
                    ? "bg-panel-dark border-border-dark focus:border-border-focus text-text-offwhite"
                    : "bg-panel-light border-border-light focus:border-gray-400 text-text-light"
                )}
              />
              <p className="text-[10px] text-text-dim">
                Default: <span className="font-mono">http://localhost:11434</span>
              </p>
            </div>

            {/* Helper tips */}
            <div className={cn(
              "p-3 rounded-xl text-[11px] leading-relaxed border space-y-1 font-mono text-text-dim",
              settings.theme === 'dark' ? "bg-white/[0.02] border-border-dark" : "bg-black/[0.02] border-border-light"
            )}>
              <p className="font-semibold text-text-muted">Quick setup guide:</p>
              <p>1. Start Ollama: <span className="text-text-assistant">ollama serve</span></p>
              <p>2. Allow browser origin: <span className="text-text-assistant">OLLAMA_ORIGINS="*" ollama serve</span></p>
              <p>3. Pull a model: <span className="text-text-assistant">ollama run llama3</span></p>
            </div>

            {ollamaStatusMessage && (
              <p className="text-[11px] text-center font-mono opacity-80 text-accent-blue">
                {ollamaStatusMessage}
              </p>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-1">
              <Button
                type="button"
                onClick={() => setIsOllamaModalOpen(false)}
                className={cn(
                  "px-4 py-2 text-xs font-medium rounded-xl",
                  settings.theme === 'dark' ? "text-text-muted hover:text-white" : "text-text-muted-light hover:text-black"
                )}
              >
                Close
              </Button>
              <Button
                type="button"
                onClick={handleTestOllamaConnection}
                disabled={isTestingOllama}
                className={cn(
                  "px-4 py-2 text-xs font-semibold rounded-xl text-white transition-all flex items-center gap-2",
                  isTestingOllama ? "bg-accent-blue/50" : "bg-accent-blue hover:bg-accent-blue/90"
                )}
              >
                {isTestingOllama ? (
                  <>
                    <Loader2 size={13} className="animate-spin" />
                    <span>Connecting...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw size={13} />
                    <span>Test & Refresh</span>
                  </>
                )}
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
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[80]"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 220 }}
            className={cn(
              "fixed inset-x-4 top-[15%] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[500px] z-[90] border rounded-3xl p-6 shadow-2xl flex flex-col gap-5",
              settings.theme === 'dark'
                ? "bg-panel-darker border-border-dark text-text-offwhite shadow-black"
                : "bg-white border-border-light text-text-light shadow-2xl"
            )}
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/5">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "p-2 rounded-xl",
                  settings.theme === 'dark' ? "bg-white/5 text-accent-blue" : "bg-black/5 text-accent-blue"
                )}>
                  <Upload size={18} />
                </div>
                <div>
                  <h2 className="text-base font-bold tracking-tight">Import Chat History</h2>
                  <p className="text-[11px] text-text-dim">Review and confirm chat data import</p>
                </div>
              </div>
              <IconButton
                icon={X}
                onClick={() => {
                  setIsImportModalOpen(false);
                  setPendingImport(null);
                }}
              />
            </div>

            {/* File info card */}
            <div className={cn(
              "p-4 rounded-2xl border flex flex-col gap-3",
              settings.theme === 'dark' ? "bg-panel-dark border-border-dark" : "bg-panel-light border-border-light"
            )}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  <FileText size={15} className="text-accent-blue shrink-0" />
                  <span className="text-xs font-mono font-medium truncate">{pendingImport.fileName}</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                  Ready
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/5 text-xs">
                <div>
                  <span className="text-[10px] uppercase font-bold text-text-dim block">Conversations</span>
                  <span className="font-mono font-semibold">{pendingImport.conversations.length}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-text-dim block">Messages</span>
                  <span className="font-mono font-semibold">{pendingImport.totalMessages}</span>
                </div>
              </div>

              {/* Sample Titles */}
              <div className="pt-1">
                <span className="text-[10px] uppercase font-bold text-text-dim block mb-1">Preview Conversations:</span>
                <div className="max-h-24 overflow-y-auto space-y-1 text-[11px] text-text-dim font-mono scrollbar-hide">
                  {pendingImport.conversations.slice(0, 5).map((c, i) => (
                    <div key={c.id || i} className="truncate">
                      • {c.title || 'Untitled'} ({c.messages.length} msg{c.messages.length === 1 ? '' : 's'})
                    </div>
                  ))}
                  {pendingImport.conversations.length > 5 && (
                    <div className="text-[10px] italic text-text-dim">
                      + {pendingImport.conversations.length - 5} more conversation(s)
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Import Mode Selection */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-text-dim block">
                Import Option
              </label>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setImportMode('merge')}
                  className={cn(
                    "p-3 rounded-2xl border text-left flex flex-col gap-1 transition-all cursor-pointer",
                    importMode === 'merge'
                      ? (settings.theme === 'dark' ? "border-accent-blue bg-accent-blue/10 text-white" : "border-accent-blue bg-blue-50 text-blue-900")
                      : (settings.theme === 'dark' ? "border-border-dark bg-panel-dark text-text-dim hover:text-text-muted" : "border-border-light bg-panel-light text-text-muted-light")
                  )}
                >
                  <span className="text-xs font-bold">Merge</span>
                  <span className="text-[10px] leading-tight opacity-70">
                    Add alongside current {conversations.length} conversation(s)
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setImportMode('replace')}
                  className={cn(
                    "p-3 rounded-2xl border text-left flex flex-col gap-1 transition-all cursor-pointer",
                    importMode === 'replace'
                      ? (settings.theme === 'dark' ? "border-red-500/80 bg-red-500/10 text-white" : "border-red-500 bg-red-50 text-red-900")
                      : (settings.theme === 'dark' ? "border-border-dark bg-panel-dark text-text-dim hover:text-text-muted" : "border-border-light bg-panel-light text-text-muted-light")
                  )}
                >
                  <span className="text-xs font-bold text-red-400">Replace</span>
                  <span className="text-[10px] leading-tight opacity-70">
                    Overwrite all existing conversations with imported data
                  </span>
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-white/5">
              <Button
                type="button"
                onClick={() => {
                  setIsImportModalOpen(false);
                  setPendingImport(null);
                }}
                className={cn(
                  "px-4 py-2 text-xs font-medium rounded-xl",
                  settings.theme === 'dark' ? "text-text-muted hover:text-white" : "text-text-muted-light hover:text-black"
                )}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleConfirmImport}
                className={cn(
                  "px-5 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl transition-all flex items-center gap-2",
                  importMode === 'replace'
                    ? "bg-red-600 hover:bg-red-500 text-white"
                    : (settings.theme === 'dark' ? "bg-white text-black hover:bg-white/90" : "bg-black text-white hover:bg-black/90")
                )}
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

  return (
    <div className="flex h-screen overflow-hidden font-sans">
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/40 z-40 md:hidden backdrop-blur-sm"
          />
        )}
      </AnimatePresence>

      {renderSidebar()}

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full bg-inherit relative z-0">
        {/* Header */}
        <header className={cn(
          "h-16 border-b flex items-center justify-between px-6 shrink-0 z-10 sticky top-0 backdrop-blur-md",
          settings.theme === 'dark' ? "border-border-dark bg-black/80" : "border-border-light bg-white/80"
        )}>
          <div className="flex items-center gap-6">
            <IconButton icon={Menu} onClick={() => setIsSidebarOpen(true)} className="md:hidden" />

            <div className="flex flex-col">
              <label className="text-[9px] uppercase tracking-widest text-text-dim mb-0.5">Model</label>
              <div
                onClick={() => setIsModelSelectorOpen(true)}
                className="flex items-center gap-2 cursor-pointer group"
              >
                <span className="text-[12px] font-medium truncate max-w-[150px]">
                  {models.find(m => m.id === settings.selectedModelId)?.name || 'Select Model'}
                </span>
                {models.find(m => m.id === settings.selectedModelId)?.pricing?.prompt === '0' && (
                  <span className="text-[10px] px-1 bg-panel-dark border border-border-dark text-green-500 rounded">FREE</span>
                )}
              </div>
            </div>

            <div className={cn("hidden md:block w-px h-8 self-center", settings.theme === 'dark' ? "bg-border-dark" : "bg-border-light")} />

            <div className="hidden md:flex flex-col">
              <label className="text-[9px] uppercase tracking-widest text-text-dim mb-0.5">Persona</label>
              <span
                onClick={() => {
                  setSettingsTab('personas');
                  setIsPersonaManagerOpen(true);
                }}
                className="text-[12px] font-medium cursor-pointer hover:text-text-offwhite transition-colors"
              >
                {activePersona?.name || 'Persona'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Visual Indicator: Ollama Connection */}
            <button
              type="button"
              onClick={() => setIsOllamaModalOpen(true)}
              aria-label={`Ollama connection status: ${isOllamaConnected ? 'active' : 'disconnected'}`}
              title={`Ollama: ${isOllamaConnected ? 'Active' : 'Disconnected'} (Click to configure)`}
              className={cn(
                "touch-target px-2.5 py-1.5 rounded-full border text-[11px] font-medium flex items-center gap-2 transition-all active:scale-95 cursor-pointer",
                settings.theme === 'dark'
                  ? (isOllamaConnected
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                      : "border-border-dark bg-panel-dark text-text-dim hover:text-text-muted hover:border-border-focus")
                  : (isOllamaConnected
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                      : "border-border-light bg-panel-light text-text-muted-light hover:text-text-light hover:border-gray-300")
              )}
            >
              <span
                className={cn(
                  "w-2 h-2 rounded-full shrink-0 transition-all",
                  isOllamaConnected
                    ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.9)]"
                    : "bg-red-500/80"
                )}
              />
              <span className="hidden sm:inline font-mono tracking-wider uppercase text-[10px]">
                Ollama: {isOllamaConnected ? "Active" : "Disconnected"}
              </span>
              <span className="sm:hidden font-mono text-[10px]">
                {isOllamaConnected ? "Ollama" : "Offline"}
              </span>
            </button>

            <IconButton icon={Bookmark} size={18} onClick={handleSummarizeMemory} className="text-text-muted hover:text-text-offwhite" title="Summarize conversation memory" />
            <IconButton
              icon={settings.theme === 'dark' ? Sun : Moon}
              size={18}
              onClick={toggleTheme}
              className="text-text-muted hover:text-text-offwhite"
              title="Toggle theme"
            />
          </div>
        </header>

        {renderInstallBanner()}

        {/* Chat Area */}
        <div
          ref={chatContainerRef}
          onScroll={handleChatScroll}
          className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8 scrollbar-hide"
        >
          {activeConversation && (
            <div className={cn(
              "max-w-3xl mx-auto flex items-center justify-between pb-4 border-b transition-colors",
              settings.theme === 'dark' ? "border-border-dark" : "border-border-light"
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
                        "text-xs px-2.5 py-1 rounded-lg border outline-none font-medium",
                        settings.theme === 'dark'
                          ? "bg-black border-border-focus text-text-offwhite"
                          : "bg-white border-border-light text-text-light"
                      )}
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveTitle(activeConversation.id)}
                      title="Save title"
                      className="p-1 hover:text-green-400 text-text-dim hover:scale-110 transition-transform"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingConvoId(null)}
                      title="Cancel"
                      className="p-1 hover:text-red-400 text-text-dim hover:scale-110 transition-transform"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div
                    className="flex items-center gap-2 min-w-0 group cursor-pointer"
                    onClick={() => handleStartRename(activeConversation)}
                    title="Click to rename conversation"
                  >
                    <h1 className={cn(
                      "text-sm font-semibold truncate tracking-tight transition-colors",
                      settings.theme === 'dark' ? "text-text-offwhite group-hover:text-white" : "text-text-light group-hover:text-black"
                    )}>
                      {activeConversation.title || 'Untitled'}
                    </h1>
                    <Edit3 size={12} className="opacity-40 group-hover:opacity-100 transition-opacity shrink-0 text-text-dim" />
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] font-mono text-text-dim hidden sm:inline">
                  {activeConversation.messages.length} msg{activeConversation.messages.length === 1 ? '' : 's'}
                </span>
                <button
                  type="button"
                  onClick={toggleAutoScroll}
                  title={`Auto-scroll is ${settings.autoScroll !== false ? 'Enabled' : 'Disabled'} (click to toggle)`}
                  className={cn(
                    "px-2 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer",
                    settings.autoScroll !== false
                      ? (settings.theme === 'dark' ? "border-border-dark bg-panel-dark text-text-muted hover:text-text-offwhite hover:border-border-focus" : "border-border-light bg-panel-light text-text-muted-light hover:text-text-light")
                      : (settings.theme === 'dark' ? "border-amber-500/30 bg-amber-500/5 text-amber-400/80 hover:text-amber-300" : "border-amber-400 bg-amber-50 text-amber-700")
                  )}
                >
                  <ArrowDownCircle size={12} className={settings.autoScroll !== false ? "text-accent-blue" : "text-amber-400"} />
                  <span className="hidden sm:inline font-mono text-[10px]">
                    {settings.autoScroll !== false ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExportSingleChat(activeConversation.id)}
                  title="Export this conversation as JSON"
                  className={cn(
                    "px-2.5 py-1 rounded-lg border text-[11px] font-medium flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer",
                    settings.theme === 'dark'
                      ? "border-border-dark bg-panel-dark text-text-muted hover:text-text-offwhite hover:border-border-focus"
                      : "border-border-light bg-panel-light text-text-muted-light hover:text-text-light"
                  )}
                >
                  <Download size={12} />
                  <span>Export</span>
                </button>
              </div>
            </div>
          )}
          {activeConversation?.messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-30 p-8">
              <MessageSquare size={48} strokeWidth={1} className="mb-4" />
              <p className="text-[10px] font-bold tracking-[0.2em] uppercase">Void TRANSMISSION INACTIVE</p>
              <p className="text-[10px] mt-2 font-mono uppercase tracking-widest">Select model and persona to begin.</p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-10 pb-24">
              {activeConversation?.messages.map((message) => (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  key={message.id}
                  className={cn(
                    "flex flex-col gap-3",
                    message.role === 'user' ? "items-end" : "items-start"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-[0.2em] text-text-dim">
                      {message.role === 'user' ? 'User' : (message.role === 'system' ? 'Void System' : 'Void Assistant')}
                    </span>
                    {message.role === 'assistant' && (
                      <button
                        type="button"
                        onClick={() => handleCopyMessage(message.id, message.content)}
                        aria-label="Copy assistant response"
                        title="Copy response"
                        className={cn(
                          "inline-flex items-center justify-center rounded-md p-1 transition-colors",
                          settings.theme === 'dark'
                            ? "text-text-dim hover:text-text-offwhite hover:bg-white/5"
                            : "text-text-muted-light hover:text-text-light hover:bg-black/5"
                        )}
                      >
                        {copiedMessageId === message.id ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    )}
                  </div>

                  <div className={cn(
                    "markdown-body w-full transition-all duration-300",
                    message.role === 'user'
                      ? cn(
                        "p-5 rounded-2xl border bg-opacity-50 backdrop-blur-sm",
                        settings.theme === 'dark' ? "bg-panel-dark border-border-dark text-text-offwhite shadow-sm" : "bg-panel-light border-border-light text-text-light"
                      )
                      : cn(
                        "leading-relaxed px-1",
                        message.role === 'system' ? "text-red-900 font-mono italic opacity-80" : (settings.theme === 'dark' ? "text-text-assistant" : "text-[#444444]")
                      )
                  )}>
                    {message.role === 'user' ? (
                      <div className="flex flex-col gap-3">
                        <Markdown>{message.content}</Markdown>
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => handleCopyMessage(message.id, message.content)}
                            aria-label="Copy user message"
                            title="Copy message"
                            className={cn(
                              "inline-flex items-center justify-center rounded-md p-1 transition-colors",
                              settings.theme === 'dark'
                                ? "text-text-dim hover:text-text-offwhite hover:bg-white/5"
                                : "text-text-muted-light hover:text-text-light hover:bg-black/5"
                            )}
                          >
                            {copiedMessageId === message.id ? <Check size={12} /> : <Copy size={12} />}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <Markdown>{message.content}</Markdown>
                    )}
                  </div>
                </motion.div>
              ))}
              {isLoading && (
                <div className="flex flex-col gap-3">
                  <span className="text-[10px] uppercase tracking-[0.2em] text-text-dim">Void Assistant</span>
                  <div className="flex gap-1 items-center py-2">
                    <div className="w-1.5 h-1.5 bg-text-dim rounded-full animate-pulse"></div>
                    <div className="w-1.5 h-1.5 bg-text-muted rounded-full animate-pulse delay-75"></div>
                    <div className="w-1.5 h-1.5 bg-text-dim rounded-full animate-pulse delay-150"></div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          )}
        </div>

        {/* Input area */}
        <div className={cn(
          "p-6 border-t shrink-0 sticky bottom-0 z-10 relative",
          settings.theme === 'dark' ? "border-border-dark bg-background-amoled/90 backdrop-blur-md" : "border-border-light bg-background-light/90 backdrop-blur-md"
        )}>
          {/* Floating Jump to Latest Button */}
          <AnimatePresence>
            {isUserScrolledUp && (
              <motion.div
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                className="absolute -top-12 left-1/2 -translate-x-1/2 pointer-events-auto"
              >
                <button
                  type="button"
                  onClick={() => scrollToBottom(true)}
                  className={cn(
                    "px-4 py-1.5 rounded-full border shadow-xl flex items-center gap-1.5 text-xs font-semibold backdrop-blur-md transition-all hover:scale-105 active:scale-95 cursor-pointer",
                    settings.theme === 'dark'
                      ? "bg-panel-darker/95 border-border-dark text-text-offwhite hover:border-border-focus shadow-black/80"
                      : "bg-white/95 border-border-light text-text-light hover:border-gray-400 shadow-gray-300/80"
                  )}
                  title="Scroll to latest messages"
                >
                  <ChevronDown size={14} className="text-accent-blue animate-bounce" />
                  <span className="text-[11px]">Latest messages</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="max-w-3xl mx-auto flex flex-col gap-4">
            <div className={cn(
              "relative flex items-end gap-2 border rounded-xl transition-all shadow-lg focus-within:border-border-focus focus-within:ring-2 focus-within:ring-white/5",
              settings.theme === 'dark' ? "border-border-dark bg-panel-darker" : "border-border-light bg-panel-light"
            )}>
              <textarea
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder="Enter a prompt..."
                rows={1}
                className="flex-1 bg-transparent border-none focus:outline-none px-5 py-4 text-[15px] resize-none min-h-[56px] max-h-60 scrollbar-hide"
              />
              <IconButton
                onClick={() => handleSendMessage()}
                icon={Send}
                size={20}
                disabled={!inputMessage.trim() || isLoading}
                className={cn(
                  "shrink-0 mb-2.5 mr-2.5",
                  isLoading ? "animate-pulse" : "text-text-dim hover:text-accent-blue"
                )}
              />
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

      {/* In-app Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className={cn(
              "fixed bottom-6 right-6 z-[100] px-4 py-2.5 rounded-2xl border shadow-2xl flex items-center gap-2.5 text-xs font-medium backdrop-blur-md",
              settings.theme === 'dark'
                ? "bg-panel-darker/95 border-border-dark text-text-offwhite shadow-black/80"
                : "bg-white/95 border-border-light text-text-light shadow-gray-200/80"
            )}
          >
            <Check size={14} className="text-emerald-400 shrink-0" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
