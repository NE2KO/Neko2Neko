import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import useAiStore, { useAiLocalId } from '../store/aiStore';
import {
  fetchAiConversations, createAiConversation, fetchAiConversation, updateAiConversation, deleteAiConversation,
  sendAiMessage, fetchAiStatus, fetchAiTools, exportAiConversation, searchAiConversationMessages,
  fetchAllModels, fetchProviderStatus, markModelUsed,
} from '../utils/api.js';
import { Sparkles, Trash2, Archive, Pin, Search, Plus, X, ChevronLeft, ChevronRight, MessageSquare, MoreHorizontal, Settings, Send, Square, Download, ChevronDown, Brain } from 'lucide-react';
import ModelManager from './ModelManager';
import ConversationSettings from './ConversationSettings';

function groupByDate(items) {
  const now = new Date();
  const groups = {};
  for (const item of items) {
    const d = item.updatedAt || item.createdAt;
    const date = new Date(d);
    const diff = Math.floor((now - date) / 86400000);
    const label = diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : diff < 7 ? `${diff} days ago` : date.toLocaleDateString();
    if (!groups[label]) groups[label] = [];
    groups[label].push(item);
  }
  return groups;
}

export default function AIChat({ onOpenSettings, onClose }) {
  const localId = useAiLocalId();
  const {
    conversations, selectedConversationId, messages, status, sidebarOpen, sidebarSearchQuery, collapsed,
    setSidebarOpen, setSidebarSearchQuery, setCollapsed,
    setSelectedConversation, setConversations, upsertConversation, appendMessage, updateLastAssistantMessage, removeConversation, setStatus,
  } = useAiStore();
  const [input, setInput] = useState('');
  const [convTitle, setConvTitle] = useState('');
  const [convMenu, setConvMenu] = useState(null);
  const [sidebarView, setSidebarView] = useState('chat');
  const [msgSearchQuery, setMsgSearchQuery] = useState('');
  const [msgSearchResults, setMsgSearchResults] = useState(null);
  const [showModelManager, setShowModelManager] = useState(false);
  const [showConvSettings, setShowConvSettings] = useState(false);
  const [currentModel, setCurrentModel] = useState('');
  const [currentProvider, setCurrentProvider] = useState('');
  const [providerStatuses, setProviderStatuses] = useState({});
  const messagesRef = useRef(null);
  const stopRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!localId) return;
    fetchAiConversations(localId).then((d) => { if (mountedRef.current) setConversations(d.conversations || []); }).catch(() => {});
  }, [localId, setConversations]);

  useEffect(() => {
    fetchProviderStatus().then(d => {
      const map = {};
      for (const p of d.providers || []) map[p.id] = p;
      if (mountedRef.current) setProviderStatuses(map);
    }).catch(() => {});
    fetchAiStatus().then(d => {
      if (mountedRef.current) {
        setCurrentProvider(d.activeProvider || '');
        setCurrentModel(d.defaultModel || '');
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedConversationId) return;
    fetchAiConversation(localId, selectedConversationId).then((d) => {
      if (!mountedRef.current) return;
      const msgs = (d.messages || []).map(m => ({ ...m, id: m.id || crypto.randomUUID() }));
      useAiStore.getState().setMessages(selectedConversationId, msgs);
      setConvTitle(d.conversation.title);
    }).catch(() => {});
  }, [selectedConversationId, localId]);

  const selectConversation = useCallback((c) => {
    setSelectedConversation(c.id);
    setConvTitle(c.title);
  }, [setSelectedConversation]);

  const handleSelectModel = useCallback(async (providerId, modelId) => {
    setCurrentProvider(providerId);
    setCurrentModel(modelId);
    setShowModelManager(false);
    try {
      await markModelUsed(providerId, modelId);
    } catch {}
  }, []);

  const handleNewChat = async () => {
    setSelectedConversation(null);
    const d = await createAiConversation(localId, 'New Chat');
    if (d.id) {
      upsertConversation({ ...d, title: d.title, pinned: false, archived: false, createdAt: d.createdAt, updatedAt: d.createdAt });
      setSelectedConversation(d.id);
      setConvTitle('New Chat');
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text) return;
    const cid = selectedConversationId;
    if (!cid) return;
    setInput('');
    setStatus('streaming');
    const userMsg = { role: 'user', content: text, createdAt: new Date().toISOString(), id: Date.now() };
    appendMessage(cid, userMsg);
    const assistantMsg = { role: 'assistant', content: '', createdAt: new Date().toISOString(), id: Date.now() + 1 };
    appendMessage(cid, assistantMsg);

    let aborted = false;
    stopRef.current = () => { aborted = true; };

    try {
      await sendAiMessage(
        localId, cid, text,
        (chunk) => {
          if (!mountedRef.current) return;
          if (chunk.type === 'text_delta') {
            updateLastAssistantMessage(cid, (prev) => ({ ...prev, content: (prev.content || '') + chunk.text }));
          } else if (chunk.type === 'tool_call_start') {
            updateLastAssistantMessage(cid, (prev) => {
              const exists = (prev.toolCalls || []).find(tc => tc.id === chunk.id);
              if (!exists) return { ...prev, toolCalls: [...(prev.toolCalls || []), { id: chunk.id, name: chunk.name, results: [] }] };
              return prev;
            });
          } else if (chunk.type === 'tool_call_delta') {
            updateLastAssistantMessage(cid, (prev) => {
              const idx = (prev.toolCalls || []).findIndex(tc => tc.id === chunk.id);
              if (idx >= 0) {
                const tc = [...prev.toolCalls];
                tc[idx] = { ...tc[idx], name: tc[idx].name + (chunk.name || ''), arguments: (tc[idx].arguments || '') + (chunk.arguments || '') };
                return { ...prev, toolCalls: tc };
              }
              return prev;
            });
          } else if (chunk.type === 'tool_result') {
            updateLastAssistantMessage(cid, (prev) => {
              const tc = [...(prev.toolCalls || [])];
              const idx = tc.findIndex(t => t.id === chunk.id);
              if (idx >= 0) { tc[idx] = { ...tc[idx], result: chunk.result }; }
              return { ...prev, toolCalls: tc, toolResults: [...(prev.toolResults || []), { id: chunk.id, name: chunk.name, result: chunk.result }] };
            });
          }
        },
        () => { if (mountedRef.current) setStatus('idle'); },
        (err) => {
          if (mountedRef.current) {
            updateLastAssistantMessage(cid, (prev) => ({ ...prev, content: `Error: ${err}` }));
            setStatus('error');
          }
        }
      );
      if (aborted) {
        updateLastAssistantMessage(cid, (prev) => ({ ...prev, content: (prev.content || '') + '\n[Stopped]' }));
      }
      if (mountedRef.current) {
        const msgs = useAiStore.getState().messages[selectedConversationId] || [];
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          const preview = (lastMsg.content || '').slice(0, 40);
          if (preview) updateAiConversation(localId, cid, { title: preview }).then(() => {
            setConversations(prev => prev.map(c => c.id === cid ? { ...c, title: preview } : c));
          }).catch(() => {});
        }
      }
    } catch (err) {
      if (mountedRef.current) {
        updateLastAssistantMessage(cid, (prev) => ({ ...prev, content: `Error: ${err.message || err}` }));
        setStatus('error');
      }
    } finally {
      if (mountedRef.current) setStatus('idle');
      stopRef.current = null;
    }
  };

  const handleStop = () => { stopRef.current?.(); };

const handleDelete = async (c) => {
    await deleteAiConversation(localId, c.id);
    removeConversation(c.id);
    if (selectedConversationId === c.id) { setSelectedConversation(null); setConvTitle(''); }
    setConvMenu(null);
  };

  const handleMsgSearch = async (q) => {
    if (!q.trim() || !selectedConversationId) {
      setMsgSearchResults(null);
      return;
    }
    try {
      const result = await searchAiConversationMessages(localId, selectedConversationId, q);
      setMsgSearchResults(result.messages || []);
    } catch {
      setMsgSearchResults(null);
    }
  };

  const convs = (conversations || []).filter(c => !c.archived);
  const searchLower = sidebarSearchQuery.toLowerCase();
  const filtered = searchLower ? convs.filter(c => (c.title || '').toLowerCase().includes(searchLower)) : convs;
  const groups = groupByDate(filtered);
  const allMessages = selectedConversationId ? (messages[selectedConversationId] || []) : [];
  const currentMessages = msgSearchQuery && msgSearchResults ? msgSearchResults : allMessages;

  return (
    <div className="flex-1 flex overflow-hidden bg-neutral-950 text-neutral-200">
      <div className={`${sidebarOpen ? 'w-72' : 'w-0'} flex-shrink-0 border-r border-neutral-800 flex flex-col transition-all duration-200 relative bg-neutral-900 overflow-hidden`}>
        <div className="p-2 space-y-2">
          <div className="flex items-center justify-between">
            <button onClick={handleNewChat} className="flex-1 flex items-center gap-2 px-3 py-2 text-sm bg-sky-600 hover:bg-sky-500 text-white rounded-lg transition-colors">
              <Plus size={14} /> New Chat
            </button>
            <button onClick={() => setSidebarOpen(false)} className="p-1.5 rounded hover:bg-neutral-800 text-neutral-400">
              <ChevronLeft size={16} />
            </button>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-2 top-2 text-neutral-500" />
            <input
              type="text"
              placeholder="Search conversations..."
              value={sidebarSearchQuery}
              onChange={(e) => setSidebarSearchQuery(e.target.value)}
              className="w-full pl-8 pr-2 py-1.5 text-xs rounded bg-neutral-800 border border-neutral-700 focus:border-sky-500 focus:outline-none"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 space-y-4">
          {Object.entries(groups).reverse().map(([label, items]) => (
            <div key={label}>
              <div className="text-[10px] uppercase text-neutral-500 font-semibold mb-1 px-2">{label}</div>
              <div className="space-y-0.5">
                {items.map((c) => (
                  <div key={c.id} className="group flex items-center rounded hover:bg-neutral-800 cursor-pointer"
                    onClick={() => selectConversation(c)}
                    onContextMenu={(e) => { e.preventDefault(); setConvMenu(c.id); }}>
                    <div className="flex-1 min-w-0 px-2 py-1.5">
                      <div className="text-sm truncate">{c.title || 'New Chat'}</div>
                      <div className="text-[10px] text-neutral-500 truncate">{new Date(c.updatedAt || c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                    {c.pinned && <Pin size={12} className="text-neutral-400 mr-1 flex-shrink-0" />}
                    {convMenu === c.id && (
                      <div className="absolute z-20 bg-neutral-800 border border-neutral-700 rounded shadow-lg py-1 right-2 top-8">
                        <button onClick={async () => { await updateAiConversation(localId, c.id, { pinned: !c.pinned }); setConversations(prev => prev.map(x => x.id === c.id ? { ...x, pinned: !x.pinned } : x)); setConvMenu(null); }} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-neutral-700 w-full text-left">
                          <Pin size={12} /> {c.pinned ? 'Unpin' : 'Pin'}
                        </button>
                        <button onClick={async () => { await updateAiConversation(localId, c.id, { archived: true }); setConversations(prev => prev.filter(x => x.id !== c.id)); setConvMenu(null); }} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-neutral-700 w-full text-left">
                          <Archive size={12} /> Archive
                        </button>
                        <button onClick={() => handleDelete(c)} className="flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-neutral-700 w-full text-left">
                          <Trash2 size={12} /> Delete
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {items.length === 0 && searchLower && (
                  <div className="text-xs text-neutral-600 px-2 py-2">No conversations found</div>
                )}
              </div>
            </div>
          ))}
          {filtered.length === 0 && !searchLower && (
            <div className="text-xs text-neutral-600 px-2 py-4">No conversations yet. Create a new chat to get started.</div>
          )}
        </div>
        <div className="p-2 border-t border-neutral-800">
          <button onClick={() => { setSidebarOpen(false); onOpenSettings?.(); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 rounded transition-colors">
            <Settings size={14} /> AI Settings
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            {!sidebarOpen && (
              <button onClick={() => setSidebarOpen(true)} className="p-1 rounded hover:bg-neutral-800 text-neutral-400">
                <ChevronRight size={16} />
              </button>
            )}
            <h2 className="text-sm font-medium">{convTitle || 'AI Chat'}</h2>
            {selectedConversationId && (
              <>
                <button onClick={() => setShowModelManager(!showModelManager)}
                  className="flex items-center gap-1 px-2 py-0.5 text-xs bg-neutral-800 hover:bg-neutral-700 rounded border border-neutral-700 text-neutral-300 transition-colors">
                  <span className="truncate max-w-[120px]">{currentModel || 'Default Model'}</span>
                  <ChevronDown size={10} />
                </button>
                <button onClick={() => setShowConvSettings(!showConvSettings)}
                  className="p-1 rounded hover:bg-neutral-800 text-neutral-400 transition-colors" title="Conversation Settings">
                  <Settings size={14} />
                </button>
              </>
            )}
            {selectedConversationId && currentMessages.length > 0 && (
              <div className="relative">
                <Search size={12} className="absolute left-1 top-1 text-neutral-500" />
                <input
                  type="text"
                  placeholder="Search messages..."
                  value={msgSearchQuery}
                  onChange={(e) => { setMsgSearchQuery(e.target.value); handleMsgSearch(e.target.value); }}
                  onKeyDown={(e) => { if (e.key === 'Escape') { setMsgSearchQuery(''); setMsgSearchResults(null); } }}
                  className="pl-5 pr-2 py-0.5 text-[10px] rounded bg-neutral-800 border border-neutral-700 focus:border-sky-500 focus:outline-none w-36"
                />
                {msgSearchQuery && (
                  <button onClick={() => { setMsgSearchQuery(''); setMsgSearchResults(null); }} className="absolute right-0.5 top-0.5 text-neutral-500 hover:text-neutral-300">
                    <X size={10} />
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            {selectedConversationId && (
              <button onClick={() => exportAiConversation(localId, selectedConversationId).then(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); const title = convTitle || 'chat'; a.download = `conversation-${title.replace(/[^a-z0-9_-]/gi, '_').slice(0, 40)}-${selectedConversationId}.md`; a.click(); URL.revokeObjectURL(a.href); }).catch(() => {})} className="p-1.5 rounded hover:bg-neutral-800 text-neutral-400" title="Export conversation">
                <Download size={14} />
              </button>
            )}
            {currentMessages.length > 0 && (
              <button onClick={() => { if (selectedConversationId) updateAiConversation(localId, selectedConversationId, { archived: true }).then(() => removeConversation(selectedConversationId)); }} className="p-1.5 rounded hover:bg-neutral-800 text-neutral-400" title="Archive">
                <Archive size={14} />
              </button>
            )}
          </div>
        </div>

        <div ref={messagesRef} className="flex-1 overflow-y-auto">
          {!selectedConversationId ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-neutral-500">
              <Sparkles size={32} className="text-neutral-600" />
              <p className="text-sm">Select a conversation or start a new one</p>
              <button onClick={handleNewChat} className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-sm rounded-lg transition-colors">
                Start a new chat
              </button>
            </div>
          ) : currentMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-neutral-500">
              <MessageSquare size={32} className="text-neutral-600" />
              <p className="text-sm">Type a message to start the conversation</p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto py-4 space-y-4">
              {currentMessages.map((msg, idx) => (
                <div key={msg.id || idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-lg px-4 py-2 ${msg.role === 'user' ? 'bg-sky-600 text-white' : 'bg-neutral-800 text-neutral-100'}`}>
                    {msg.role === 'assistant' && <div className="text-[10px] uppercase text-sky-400 font-semibold mb-1">Assistant</div>}
                    <div className="text-sm break-words ai-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content || ''}</ReactMarkdown></div>
                    {(msg.toolCalls || []).length > 0 && (
                      <div className="mt-2 space-y-1">
                        {(msg.toolCalls || []).map((tc, tIdx) => (
                          <div key={tIdx} className="text-xs bg-neutral-900 rounded p-2 border border-neutral-700">
                            <div className="text-sky-400 font-medium">{tc.name}</div>
                            {tc.arguments && <pre className="text-neutral-400 text-[10px] mt-1 overflow-x-auto">{tc.arguments}</pre>}
                            {tc.result !== undefined && (
                              <details className="mt-1">
                                <summary className="text-neutral-500 text-[10px] cursor-pointer">Result</summary>
                                <pre className="text-neutral-400 text-[10px] mt-1 max-h-32 overflow-auto">{typeof tc.result === 'string' ? tc.result.slice(0, 500) : JSON.stringify(tc.result).slice(0, 500)}</pre>
                              </details>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {msg.toolResults && msg.toolResults.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {msg.toolResults.map((tr, tIdx) => (
                          <div key={tIdx} className="text-xs bg-neutral-900 rounded p-2 border border-neutral-700">
                            <div className="text-emerald-400 font-medium">{tr.name}</div>
                            <pre className="text-neutral-400 text-[10px] mt-1">{typeof tr.result === 'string' ? tr.result.slice(0, 300) : JSON.stringify(tr.result).slice(0, 300)}</pre>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {status === 'streaming' && (
                <div className="flex justify-start">
                  <div className="bg-neutral-800 rounded-lg px-4 py-2">
                    <div className="flex gap-1">
                      <div className="w-1.5 h-1.5 bg-neutral-400 rounded-full animate-bounce" />
                      <div className="w-1.5 h-1.5 bg-neutral-400 rounded-full animate-bounce delay-75" />
                      <div className="w-1.5 h-1.5 bg-neutral-400 rounded-full animate-bounce delay-150" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-neutral-800">
          <div className="max-w-3xl mx-auto flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Type a message..."
              disabled={!selectedConversationId || status === 'streaming'}
              className="flex-1 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm focus:border-sky-500 focus:outline-none disabled:opacity-50 resize-none"
              rows={1}
            />
            {status === 'streaming' ? (
              <button onClick={handleStop} className="p-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors">
                <Square size={16} />
              </button>
            ) : (
              <button onClick={handleSend} disabled={!selectedConversationId || !input.trim()} className="p-2 bg-sky-600 hover:bg-sky-500 disabled:bg-neutral-700 text-white rounded-lg transition-colors">
                <Send size={16} />
              </button>
            )}
          </div>
        </div>
      </div>

      {showModelManager && (
        <div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowModelManager(false)}>
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl w-full max-w-lg max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Select Model</h3>
              <button onClick={() => setShowModelManager(false)} className="text-neutral-400 hover:text-white"><X size={16} /></button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[60vh]">
              <ModelManager onSelectModel={handleSelectModel} currentModel={currentModel} currentProvider={currentProvider} />
            </div>
          </div>
        </div>
      )}

      {showConvSettings && selectedConversationId && (
        <div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowConvSettings(false)}>
          <div className="bg-neutral-900 border border-neutral-700 rounded-xl w-full max-w-md max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-4 overflow-y-auto max-h-[70vh]">
              <ConversationSettings conversationId={selectedConversationId} onClose={() => setShowConvSettings(false)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
