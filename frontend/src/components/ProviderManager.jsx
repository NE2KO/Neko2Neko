import { useState, useEffect, useCallback } from 'react';
import { Settings, Plus, Trash2, Check, X, Loader2, RefreshCw, Wifi, WifiOff, AlertCircle, Key, Globe, Server } from 'lucide-react';
import { fetchProviderStatus, verifyProvider, fetchProviderModels, refreshProviderModels, fetchProviderPresets, updateAiSetting, fetchAiStatus, API } from '../utils/api';
import useAiStore from '../store/aiStore';

const PROVIDER_TYPES = [
  { id: 'openai', label: 'OpenAI', color: 'text-emerald-400' },
  { id: 'anthropic', label: 'Anthropic', color: 'text-orange-400' },
  { id: 'google', label: 'Google Gemini', color: 'text-blue-400' },
  { id: 'ollama', label: 'Ollama (Local)', color: 'text-purple-400' },
  { id: 'openrouter', label: 'OpenRouter', color: 'text-pink-400' },
  { id: 'groq', label: 'Groq', color: 'text-yellow-400' },
  { id: 'deepseek', label: 'DeepSeek', color: 'text-cyan-400' },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', color: 'text-neutral-400' },
];

const STATUS_BADGES = {
  disconnected: { bg: 'bg-neutral-700', text: 'text-neutral-300', icon: WifiOff, label: 'Disconnected' },
  connecting: { bg: 'bg-yellow-900/50', text: 'text-yellow-400', icon: Loader2, label: 'Connecting...' },
  verified: { bg: 'bg-emerald-900/50', text: 'text-emerald-400', icon: Check, label: 'Verified' },
  invalid_key: { bg: 'bg-red-900/50', text: 'text-red-400', icon: Key, label: 'Invalid Key' },
  quota_exceeded: { bg: 'bg-orange-900/50', text: 'text-orange-400', icon: AlertCircle, label: 'Quota Exceeded' },
  network_error: { bg: 'bg-red-900/50', text: 'text-red-400', icon: WifiOff, label: 'Network Error' },
  error: { bg: 'bg-red-900/50', text: 'text-red-400', icon: AlertCircle, label: 'Error' },
};

const PROVIDER_PRESETS = {
  openai: { baseUrl: 'https://api.openai.com/v1', placeholder: 'sk-...' },
  anthropic: { baseUrl: 'https://api.anthropic.com', placeholder: 'sk-ant-...' },
  google: { baseUrl: 'https://generativelanguage.googleapis.com', placeholder: 'AIza...' },
  ollama: { baseUrl: 'http://localhost:11434', placeholder: '' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', placeholder: 'sk-or-...' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', placeholder: 'gsk_...' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', placeholder: 'sk-...' },
  custom: { baseUrl: '', placeholder: '' },
};

function StatusBadge({ status, latencyMs }) {
  const badge = STATUS_BADGES[status] || STATUS_BADGES.disconnected;
  const Icon = badge.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}>
      <Icon className={`w-3 h-3 ${status === 'connecting' ? 'animate-spin' : ''}`} />
      {badge.label}
      {latencyMs ? <span className="text-neutral-500 ml-1">{latencyMs}ms</span> : null}
    </span>
  );
}

export default function ProviderManager({ onBack }) {
  const [providers, setProviders] = useState([]);
  const [providerStatuses, setProviderStatuses] = useState({});
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingProvider, setEditingProvider] = useState(null);
  const [verifying, setVerifying] = useState(null);
  const [form, setForm] = useState({ id: '', name: '', type: 'openai', baseUrl: '', apiKey: '', models: '' });
  const [error, setError] = useState(null);

  const loadProviders = useCallback(async () => {
    try {
      setLoading(true);
      const [statusRes, aiRes] = await Promise.all([fetchProviderStatus(), fetchAiStatus()]);
      setProviders(aiRes.providers || []);
      const statusMap = {};
      for (const p of statusRes.providers || []) statusMap[p.id] = p;
      setProviderStatuses(statusMap);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProviders(); }, [loadProviders]);

  useEffect(() => {
    if (form.type) {
      const preset = PROVIDER_PRESETS[form.type];
      if (preset && !form.baseUrl) {
        setForm(f => ({ ...f, baseUrl: preset.baseUrl }));
      }
    }
  }, [form.type]);

  const handleVerify = async (providerId) => {
    setVerifying(providerId);
    try {
      const result = await verifyProvider(providerId);
      setProviderStatuses(s => ({
        ...s,
        [providerId]: { ...s[providerId], status: result.status, latencyMs: result.latencyMs, modelCount: result.modelCount },
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setVerifying(null);
    }
  };

  const handleRefreshModels = async (providerId) => {
    setVerifying(providerId);
    try {
      const result = await refreshProviderModels(providerId);
      const models = result.models || [];
      setProviderStatuses(s => ({
        ...s,
        [providerId]: { ...s[providerId], models, modelCount: models.length, modelsCachedAt: result.lastUpdated },
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setVerifying(null);
    }
  };

  const handleSaveProvider = async () => {
    try {
      const models = form.models ? form.models.split(',').map(m => m.trim()).filter(Boolean) : [];
      const body = { id: form.id, type: form.type, name: form.name || form.id, baseUrl: form.baseUrl, models };
      if (form.apiKey) body.apiKey = form.apiKey;

      await fetch(`${API}/api/ai/providers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      setShowAddForm(false);
      setEditingProvider(null);
      setForm({ id: '', name: '', type: 'openai', baseUrl: '', apiKey: '', models: '' });
      await loadProviders();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteProvider = async (providerId) => {
    if (!confirm(`Delete provider "${providerId}"?`)) return;
    try {
      await fetch(`${API}/api/ai/providers/${providerId}`, { method: 'DELETE' });
      await loadProviders();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleEditProvider = (provider) => {
    setEditingProvider(provider.id);
    setForm({
      id: provider.id,
      name: provider.name,
      type: provider.type,
      baseUrl: provider.baseUrl || '',
      apiKey: '',
      models: '',
    });
    setShowAddForm(true);
  };

  const startAdd = () => {
    setEditingProvider(null);
    setForm({ id: '', name: '', type: 'openai', baseUrl: PROVIDER_PRESETS.openai.baseUrl, apiKey: '', models: '' });
    setShowAddForm(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-sky-400 animate-spin" />
        <span className="ml-2 text-neutral-400">Loading providers...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {onBack && (
            <button onClick={onBack} className="text-neutral-400 hover:text-white transition-colors">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
            </button>
          )}
          <h3 className="text-lg font-semibold text-white">Providers</h3>
        </div>
        <button onClick={startAdd} className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm font-medium transition-colors">
          <Plus className="w-4 h-4" /> Add Provider
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-2 text-sm text-red-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}

      {showAddForm && (
        <div className="bg-neutral-800 border border-neutral-700 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-white">{editingProvider ? 'Edit Provider' : 'Add Provider'}</h4>
            <button onClick={() => { setShowAddForm(false); setEditingProvider(null); }} className="text-neutral-400 hover:text-white"><X className="w-4 h-4" /></button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-neutral-400 mb-1">Provider ID</label>
              <input value={form.id} onChange={e => setForm(f => ({ ...f, id: e.target.value }))} disabled={!!editingProvider}
                className="w-full bg-neutral-900 border border-neutral-600 rounded-lg px-3 py-1.5 text-sm text-white disabled:opacity-50 focus:border-sky-500 focus:outline-none" placeholder="my-openai" />
            </div>
            <div>
              <label className="block text-xs text-neutral-400 mb-1">Display Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full bg-neutral-900 border border-neutral-600 rounded-lg px-3 py-1.5 text-sm text-white focus:border-sky-500 focus:outline-none" placeholder="My OpenAI" />
            </div>
          </div>

          <div>
            <label className="block text-xs text-neutral-400 mb-1">Provider Type</label>
            <div className="flex flex-wrap gap-1.5">
              {PROVIDER_TYPES.map(t => (
                <button key={t.id} onClick={() => setForm(f => ({ ...f, type: t.id }))}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${form.type === t.id ? 'bg-sky-600 text-white' : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-neutral-400 mb-1">Base URL</label>
            <input value={form.baseUrl} onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))}
              className="w-full bg-neutral-900 border border-neutral-600 rounded-lg px-3 py-1.5 text-sm text-white focus:border-sky-500 focus:outline-none" placeholder={PROVIDER_PRESETS[form.type]?.baseUrl || ''} />
          </div>

          <div>
            <label className="block text-xs text-neutral-400 mb-1">API Key</label>
            <input type="password" value={form.apiKey} onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
              className="w-full bg-neutral-900 border border-neutral-600 rounded-lg px-3 py-1.5 text-sm text-white focus:border-sky-500 focus:outline-none" placeholder={PROVIDER_PRESETS[form.type]?.placeholder || ''} />
          </div>

          <div>
            <label className="block text-xs text-neutral-400 mb-1">Models (comma-separated, leave empty to auto-detect)</label>
            <input value={form.models} onChange={e => setForm(f => ({ ...f, models: e.target.value }))}
              className="w-full bg-neutral-900 border border-neutral-600 rounded-lg px-3 py-1.5 text-sm text-white focus:border-sky-500 focus:outline-none" placeholder="gpt-4o, gpt-4o-mini" />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => { setShowAddForm(false); setEditingProvider(null); }} className="px-3 py-1.5 text-sm text-neutral-400 hover:text-white transition-colors">Cancel</button>
            <button onClick={handleSaveProvider} className="px-4 py-1.5 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm font-medium text-white transition-colors">
              {editingProvider ? 'Update' : 'Add'} Provider
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {providers.length === 0 && !showAddForm && (
          <div className="text-center py-8 text-neutral-500">
            <Server className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No providers configured</p>
            <p className="text-xs mt-1">Add a provider to start using AI</p>
          </div>
        )}

        {providers.map(p => {
          const status = providerStatuses[p.id] || {};
          return (
            <div key={p.id} className="bg-neutral-800/50 border border-neutral-700/50 rounded-xl p-3 hover:border-neutral-600/50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white truncate">{p.name}</span>
                      <span className="text-xs text-neutral-500">{p.id}</span>
                      <StatusBadge status={status.status || 'disconnected'} latencyMs={status.latencyMs} />
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-neutral-500">
                      <span>{p.type}</span>
                      {p.baseUrl && <span className="truncate max-w-[200px]">{p.baseUrl}</span>}
                      {status.modelCount > 0 && <span>{status.modelCount} models</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => handleVerify(p.id)} disabled={verifying === p.id}
                    className="p-1.5 rounded-lg text-neutral-400 hover:text-emerald-400 hover:bg-emerald-900/30 transition-colors disabled:opacity-50"
                    title="Verify connection">
                    {verifying === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                  </button>
                  <button onClick={() => handleRefreshModels(p.id)} disabled={verifying === p.id}
                    className="p-1.5 rounded-lg text-neutral-400 hover:text-sky-400 hover:bg-sky-900/30 transition-colors disabled:opacity-50"
                    title="Refresh models">
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleEditProvider(p)}
                    className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors"
                    title="Edit provider">
                    <Settings className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDeleteProvider(p.id)}
                    className="p-1.5 rounded-lg text-neutral-400 hover:text-red-400 hover:bg-red-900/30 transition-colors"
                    title="Delete provider">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {status.errorMessage && (
                <div className="mt-2 text-xs text-red-400/80 bg-red-900/20 rounded-lg px-2 py-1">
                  {status.errorMessage}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
