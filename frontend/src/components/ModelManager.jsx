import { useState, useEffect, useCallback } from 'react';
import { Search, Star, Eye, EyeOff, Loader2, RefreshCw, Filter, ChevronDown } from 'lucide-react';
import { fetchAllModels, updateModelPreference, fetchProviderStatus } from '../utils/api';
import useAiStore from '../store/aiStore';

export default function ModelManager({ onSelectModel, currentModel, currentProvider }) {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('provider');
  const [filterProvider, setFilterProvider] = useState('');
  const [providerStatuses, setProviderStatuses] = useState({});

  const loadModels = useCallback(async () => {
    try {
      setLoading(true);
      const params = {};
      if (filterProvider) params.provider = filterProvider;
      if (search) params.search = search;
      params.sort = sortBy;

      const [modelsRes, statusRes] = await Promise.all([fetchAllModels(params), fetchProviderStatus()]);
      const modelList = Array.isArray(modelsRes?.models) ? modelsRes.models : Array.isArray(modelsRes) ? modelsRes : [];
      setModels(modelList);
      const statusMap = {};
      for (const p of statusRes.providers || []) statusMap[p.id] = p;
      setProviderStatuses(statusMap);
    } catch (err) {
      console.error('Failed to load models:', err);
    } finally {
      setLoading(false);
    }
  }, [filterProvider, search, sortBy]);

  useEffect(() => { loadModels(); }, [loadModels]);

  const handleToggleFavorite = async (providerId, modelId, currentFav) => {
    try {
      await updateModelPreference(providerId, modelId, { favorited: !currentFav });
      setModels(ms => ms.map(m =>
        m.providerId === providerId && m.modelId === modelId ? { ...m, favorited: !currentFav } : m
      ));
    } catch (err) {
      console.error('Failed to update preference:', err);
    }
  };

  const handleToggleHide = async (providerId, modelId, currentHidden) => {
    try {
      await updateModelPreference(providerId, modelId, { hidden: !currentHidden });
      setModels(ms => ms.filter(m => !(m.providerId === providerId && m.modelId === modelId)));
    } catch (err) {
      console.error('Failed to update preference:', err);
    }
  };

  const providers = [...new Set(models.map(m => m.providerId))];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search models..."
            className="w-full bg-neutral-800 border border-neutral-700 rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder-neutral-500 focus:border-sky-500 focus:outline-none" />
        </div>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          className="bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1.5 text-sm text-white focus:border-sky-500 focus:outline-none">
          <option value="provider">By Provider</option>
          <option value="name">By Name</option>
          <option value="lastUsed">Last Used</option>
        </select>
        <select value={filterProvider} onChange={e => setFilterProvider(e.target.value)}
          className="bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1.5 text-sm text-white focus:border-sky-500 focus:outline-none">
          <option value="">All Providers</option>
          {providers.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 text-sky-400 animate-spin" />
        </div>
      ) : models.length === 0 ? (
        <div className="text-center py-8 text-neutral-500 text-sm space-y-2">
          <p>No models available yet.</p>
          <p className="text-xs">Verify a provider first in Settings → Providers to load its model list.</p>
        </div>
      ) : (
        <div className="space-y-1 max-h-[400px] overflow-y-auto">
          {models.map(m => {
            const isActive = m.modelId === currentModel && m.providerId === currentProvider;
            return (
              <div key={`${m.providerId}:${m.modelId}`}
                className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors ${isActive ? 'bg-sky-600/20 border border-sky-500/30' : 'hover:bg-neutral-800 border border-transparent'}`}
                onClick={() => onSelectModel?.(m.providerId, m.modelId)}>
                <div className="min-w-0 flex items-center gap-2">
                  <span className="text-neutral-400 text-xs shrink-0 w-20 truncate">{m.providerName}</span>
                  <span className="text-white truncate">{m.modelId}</span>
                  {isActive && <span className="text-xs text-sky-400">Active</span>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={e => { e.stopPropagation(); handleToggleFavorite(m.providerId, m.modelId, m.favorited); }}
                    className={`p-1 rounded transition-colors ${m.favorited ? 'text-yellow-400' : 'text-neutral-600 hover:text-yellow-400'}`}>
                    <Star className="w-3.5 h-3.5" fill={m.favorited ? 'currentColor' : 'none'} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); handleToggleHide(m.providerId, m.modelId, false); }}
                    className="p-1 rounded text-neutral-600 hover:text-neutral-400 transition-colors">
                    <EyeOff className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
