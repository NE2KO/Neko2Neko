import { useState, useEffect, useCallback } from 'react';
import { Search, Plus, Trash2, Star, Eye, EyeOff, Download, Loader2, Pin, PinOff, Edit2, Check, X } from 'lucide-react';
import { fetchMemories, createMemory, updateMemory, deleteMemory, toggleMemoryPin, toggleMemoryEnabled, exportMemories } from '../utils/api';

function ConfidenceBadge({ confidence }) {
  if (confidence >= 0.8) return <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-400">High</span>;
  if (confidence >= 0.5) return <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-900/50 text-yellow-400">Medium</span>;
  return <span className="text-xs px-1.5 py-0.5 rounded bg-neutral-700 text-neutral-400">Low</span>;
}

export default function MemoryManager({ onBack }) {
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editContent, setEditContent] = useState('');

  const loadMemories = useCallback(async () => {
    try {
      setLoading(true);
      const params = {};
      if (search) params.search = search;
      const res = await fetchMemories(params);
      setMemories(Array.isArray(res.memories) ? res.memories : Array.isArray(res) ? res : []);
    } catch (err) {
      console.error('Failed to load memories:', err);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { loadMemories(); }, [loadMemories]);

  const handleCreate = async () => {
    if (!newContent.trim()) return;
    try {
      await createMemory(newContent.trim());
      setNewContent('');
      setShowCreate(false);
      await loadMemories();
    } catch (err) {
      console.error('Failed to create memory:', err);
    }
  };

  const handleUpdate = async (id) => {
    try {
      await updateMemory(id, { content: editContent.trim() });
      setEditingId(null);
      setEditContent('');
      await loadMemories();
    } catch (err) {
      console.error('Failed to update memory:', err);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this memory?')) return;
    try {
      await deleteMemory(id);
      await loadMemories();
    } catch (err) {
      console.error('Failed to delete memory:', err);
    }
  };

  const handleTogglePin = async (id) => {
    try {
      await toggleMemoryPin(id);
      await loadMemories();
    } catch (err) {
      console.error('Failed to toggle pin:', err);
    }
  };

  const handleToggleEnabled = async (id) => {
    try {
      await toggleMemoryEnabled(id);
      await loadMemories();
    } catch (err) {
      console.error('Failed to toggle enabled:', err);
    }
  };

  const handleExport = async () => {
    try {
      const blob = await exportMemories();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ai-memories.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export:', err);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {onBack && (
            <button onClick={onBack} className="text-neutral-400 hover:text-white transition-colors">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
          )}
          <h3 className="text-lg font-semibold text-white">Memories</h3>
          <span className="text-xs text-neutral-500">{memories.length} total</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport} className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors" title="Export">
            <Download className="w-4 h-4" />
          </button>
          <button onClick={() => setShowCreate(!showCreate)} className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm font-medium transition-colors">
            <Plus className="w-4 h-4" /> New Memory
          </button>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search memories..."
          className="w-full bg-neutral-800 border border-neutral-700 rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder-neutral-500 focus:border-sky-500 focus:outline-none" />
      </div>

      {showCreate && (
        <div className="bg-neutral-800 border border-neutral-700 rounded-xl p-3 space-y-2">
          <textarea value={newContent} onChange={e => setNewContent(e.target.value)} rows={3} placeholder="Enter memory content..."
            className="w-full bg-neutral-900 border border-neutral-600 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-sky-500 focus:outline-none resize-none" />
          <div className="flex justify-end gap-2">
            <button onClick={() => { setShowCreate(false); setNewContent(''); }} className="px-3 py-1 text-sm text-neutral-400 hover:text-white">Cancel</button>
            <button onClick={handleCreate} disabled={!newContent.trim()} className="px-3 py-1 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm font-medium text-white disabled:opacity-50">Save</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 text-sky-400 animate-spin" />
        </div>
      ) : memories.length === 0 ? (
        <div className="text-center py-8 text-neutral-500 text-sm">
          No memories yet. Create one or enable auto-extraction.
        </div>
      ) : (
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {memories.map(m => (
            <div key={m.id} className={`bg-neutral-800/50 border border-neutral-700/50 rounded-xl p-3 ${!m.enabled ? 'opacity-50' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {editingId === m.id ? (
                    <div className="flex items-center gap-2">
                      <textarea value={editContent} onChange={e => setEditContent(e.target.value)} rows={2}
                        className="flex-1 bg-neutral-900 border border-neutral-600 rounded-lg px-2 py-1 text-sm text-white focus:border-sky-500 focus:outline-none resize-none" />
                      <div className="flex flex-col gap-1">
                        <button onClick={() => handleUpdate(m.id)} className="p-1 text-emerald-400 hover:text-emerald-300"><Check className="w-4 h-4" /></button>
                        <button onClick={() => { setEditingId(null); setEditContent(''); }} className="p-1 text-neutral-400 hover:text-white"><X className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-neutral-200 whitespace-pre-wrap">{m.content}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1.5 text-xs text-neutral-500">
                    <ConfidenceBadge confidence={m.confidence} />
                    {m.pinned && <span className="text-yellow-400"><Pin className="w-3 h-3 inline" /> Pinned</span>}
                    {m.conversation_id && <span>From conversation #{m.conversation_id}</span>}
                    <span>{new Date(m.updated_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button onClick={() => handleTogglePin(m.id)} className={`p-1 rounded transition-colors ${m.pinned ? 'text-yellow-400' : 'text-neutral-600 hover:text-yellow-400'}`} title={m.pinned ? 'Unpin' : 'Pin'}>
                    {m.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => handleToggleEnabled(m.id)} className={`p-1 rounded transition-colors ${m.enabled ? 'text-neutral-400 hover:text-white' : 'text-neutral-600 hover:text-emerald-400'}`} title={m.enabled ? 'Disable' : 'Enable'}>
                    {m.enabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => { setEditingId(m.id); setEditContent(m.content); }} className="p-1 rounded text-neutral-600 hover:text-sky-400 transition-colors" title="Edit">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(m.id)} className="p-1 rounded text-neutral-600 hover:text-red-400 transition-colors" title="Delete">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
