import React, { useState, useEffect, useRef } from 'react';
import {
  Menu, Plus, Search, MoreVertical, Trash2, Edit3,
  Settings, User, MessageSquare, Bookmark, Moon, Sun,
  Send, ChevronLeft, Filter, Loader2, X, Archive, Copy, Check, Download
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

  const chatEndRef = useRef<HTMLDivElement>(null);

  // --- Initialization ---
  useEffect(() => {
    const init = async () => {
      const storedConvos = StorageService.getConversations();
      const storedPersonas = StorageService.getPersonas();

      setConversations(storedConvos);
      setPersonas(storedPersonas);

      if (storedConvos.length === 0) {
        // First run welcome conversation
        handleNewChat('Welcome to Void Chat');
      } else {
        setActiveConversationId(storedConvos[0].id);
      }

      try {
        const fetchedModels = await ApiService.fetchModels();
        setModels(fetchedModels);
      } catch (err) {
        console.error("Failed to load models:", err);
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [conversations, activeConversationId]);

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
    };

    setConversations(prev => prev.map(c => c.id === activeConversation.id ? updatedConvo : c));
    setInputMessage('');
    setIsLoading(true);

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
        [systemMessage, ...updatedConvo.messages]
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
      };

      // Auto-title if it's the first real message
      if (finalConvo.messages.length === 2 && finalConvo.title === 'Welcome to Void Chat' || finalConvo.title === 'New Conversation') {
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
      setConversations(prev => prev.map(c => c.id === activeConversation.id ? { ...updatedConvo, messages: [...updatedConvo.messages, errorMessage] } : c));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSummarizeMemory = async () => {
    if (!activeConversation || activeConversation.messages.length < 2 || isLoading) return;

    setIsLoading(true);
    try {
      const summary = await ApiService.summarizeMemory(settings.selectedModelId, activeConversation.messages);
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
      alert('Memory saved for current persona.');
    } catch (err) {
      console.error(err);
      alert('Failed to summarize memory.');
    } finally {
      setIsLoading(false);
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

      <div className="px-4 mb-6">
        <button
          onClick={() => handleNewChat()}
          className={cn(
            "w-full py-3 px-4 border rounded-xl text-[13px] font-medium text-left transition-all flex items-center justify-between",
            settings.theme === 'dark' ? "border-border-dark hover:bg-panel-dark text-text-offwhite hover:border-border-focus" : "border-border-light hover:bg-panel-light text-text-light hover:border-gray-300"
          )}
        >
          <span>New Conversation</span>
          <Plus size={14} className="opacity-40" />
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
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0 pr-6">
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
              <button
                onClick={(e) => deleteConversation(convo.id, e)}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:text-red-500"
              >
                <Trash2 size={12} />
              </button>
            </div>
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
        <button onClick={() => setIsPersonaManagerOpen(true)} className="hover:text-text-offwhite transition-colors">Settings</button>
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
                      {parseFloat(model.pricing.prompt) === 0 && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">FREE</span>
                      )}
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
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold">Personas</h2>
              <IconButton icon={X} onClick={() => setIsPersonaManagerOpen(false)} />
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-hide pb-20">
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
              </div>

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
                onClick={() => setIsPersonaManagerOpen(true)}
                className="text-[12px] font-medium cursor-pointer"
              >
                {activePersona?.name || 'Persona'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <IconButton icon={Bookmark} size={18} onClick={handleSummarizeMemory} className="text-text-muted hover:text-text-offwhite" />
            <IconButton
              icon={settings.theme === 'dark' ? Sun : Moon}
              size={18}
              onClick={toggleTheme}
              className="text-text-muted hover:text-text-offwhite"
            />
          </div>
        </header>

        {renderInstallBanner()}

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-10 scrollbar-hide">
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
          "p-6 border-t shrink-0 sticky bottom-0 z-10",
          settings.theme === 'dark' ? "border-border-dark bg-background-amoled/90 backdrop-blur-md" : "border-border-light bg-background-light/90 backdrop-blur-md"
        )}>
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
    </div>
  );
}
