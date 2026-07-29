import { create } from 'zustand';

const genLocalId = () => {
  try { return crypto.randomUUID(); } catch { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); }); }
};

export function useAiLocalId() {
  if (typeof window === 'undefined' || !window.sessionStorage.getItem('ai_local_id')) {
    window?.sessionStorage?.setItem('ai_local_id', genLocalId());
  }
  return window?.sessionStorage?.getItem('ai_local_id') || '';
}

const useAiStore = create((set, get) => ({
  conversations: [],
  selectedConversationId: null,
  messages: {},
  status: 'idle', // idle | streaming | error
  sidebarOpen: true,
  sidebarSearchQuery: '',
  collapsed: {},

  providerStatus: {},
  modelPreferences: {},
  favoriteModels: [],
  allModels: [],
  conversationSettings: {},
  memories: [],
  contextInfo: null,

  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  setSidebarSearchQuery: (q) => set({ sidebarSearchQuery: q }),
  setCollapsed: (id, v) => set(s => ({ collapsed: { ...s.collapsed, [id]: v } })),

  setSelectedConversation: (id) => set({ selectedConversationId: id }),
  setMessages: (conversationId, msgs) => set(s => ({ messages: { ...s.messages, [conversationId]: msgs } })),
  appendMessage: (conversationId, msg) => set(s => ({
    messages: { ...s.messages, [conversationId]: [...(s.messages[conversationId] || []), msg] }
  })),
  updateLastAssistantMessage: (conversationId, updater) => set(s => {
    const msgs = [...(s.messages[conversationId] || [])];
    const last = msgs[msgs.length - 1];
    if (last && last.role === 'assistant') {
      msgs[msgs.length - 1] = updater(last);
      return { messages: { ...s.messages, [conversationId]: msgs } };
    }
    return s;
  }),

  setConversations: (items) => set({ conversations: items }),
  upsertConversation: (c) => set(s => ({
    conversations: s.conversations.find(x => x.id === c.id) ? s.conversations.map(x => x.id === c.id ? c : x) : [c, ...s.conversations]
  })),
  removeConversation: (id) => set(s => ({
    conversations: s.conversations.filter(x => x.id !== id),
    messages: Object.fromEntries(Object.entries(s.messages).filter(([k]) => String(k) !== String(id)))
  })),

  setStatus: (v) => set({ status: v }),

  setProviderStatus: (id, status) => set(s => ({
    providerStatus: { ...s.providerStatus, [id]: status }
  })),
  setAllProviderStatus: (statuses) => set({ providerStatus: statuses }),

  setModelPreference: (providerId, modelId, pref) => set(s => ({
    modelPreferences: { ...s.modelPreferences, [`${providerId}:${modelId}`]: pref }
  })),
  setAllModelPreferences: (prefs) => {
    const map = {};
    for (const p of prefs) map[`${p.provider_id}:${p.model_id}`] = p;
    set({ modelPreferences: map });
  },
  setFavoriteModels: (models) => set({ favoriteModels: models }),
  setAllModels: (models) => set({ allModels: models }),

  setConversationSettings: (convId, settings) => set(s => ({
    conversationSettings: { ...s.conversationSettings, [convId]: settings }
  })),

  setMemories: (memories) => set({ memories }),
  setContextInfo: (info) => set({ contextInfo: info }),
}));

export default useAiStore;
