import { useState, useEffect, useCallback } from 'react';
import { X, Save, RotateCcw, Loader2, Settings, Brain, Globe, Image } from 'lucide-react';
import { fetchConversationSettings, updateConversationSettings, fetchAllModels } from '../utils/api';

export default function ConversationSettings({ conversationId, onClose }) {
  const [settings, setSettings] = useState({
    model: '',
    temperature: 0.7,
    max_tokens: 4096,
    system_prompt: '',
    web_search: false,
    vision: false,
  });
  const [allModels, setAllModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    (async () => {
      try {
        const [settingsRes, modelsRes] = await Promise.all([
          fetchConversationSettings(conversationId),
          fetchAllModels(),
        ]);
        if (cancelled) return;
        const s = settingsRes.settings;
        if (s) {
          setSettings({
            model: s.model || '',
            temperature: s.temperature ?? 0.7,
            max_tokens: s.max_tokens ?? 4096,
            system_prompt: s.system_prompt || '',
            web_search: !!s.web_search,
            vision: !!s.vision,
          });
        }
        setAllModels(modelsRes.models || []);
      } catch (err) {
        console.error('Failed to load settings:', err);
      } finally {
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [conversationId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateConversationSettings(conversationId, settings);
      onClose?.();
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 text-sky-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Settings className="w-4 h-4" /> Conversation Settings
        </h3>
        <button onClick={onClose} className="text-neutral-400 hover:text-white"><X className="w-4 h-4" /></button>
      </div>

      <div>
        <label className="block text-xs text-neutral-400 mb-1">Model Override</label>
        <select value={settings.model} onChange={e => setSettings(s => ({ ...s, model: e.target.value }))}
          className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white focus:border-sky-500 focus:outline-none">
          <option value="">Use global default</option>
          {allModels.map(m => (
            <option key={`${m.providerId}:${m.modelId}`} value={m.modelId}>{m.providerName} / {m.modelId}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-neutral-400 mb-1">Temperature: {settings.temperature}</label>
        <input type="range" min="0" max="2" step="0.1" value={settings.temperature}
          onChange={e => setSettings(s => ({ ...s, temperature: parseFloat(e.target.value) }))}
          className="w-full accent-sky-500" />
        <div className="flex justify-between text-xs text-neutral-600"><span>Precise</span><span>Creative</span></div>
      </div>

      <div>
        <label className="block text-xs text-neutral-400 mb-1">Max Output Tokens</label>
        <input type="number" min="256" max="128000" step="256" value={settings.max_tokens}
          onChange={e => setSettings(s => ({ ...s, max_tokens: parseInt(e.target.value) || 4096 }))}
          className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white focus:border-sky-500 focus:outline-none" />
      </div>

      <div>
        <label className="block text-xs text-neutral-400 mb-1">System Prompt</label>
        <textarea value={settings.system_prompt} onChange={e => setSettings(s => ({ ...s, system_prompt: e.target.value }))} rows={4}
          placeholder="Leave empty to use global default..."
          className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-sky-500 focus:outline-none resize-none" />
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={settings.web_search} onChange={e => setSettings(s => ({ ...s, web_search: e.target.checked }))}
            className="w-4 h-4 rounded border-neutral-600 bg-neutral-800 text-sky-500 focus:ring-sky-500 focus:ring-offset-0" />
          <Globe className="w-4 h-4 text-neutral-400" />
          <span className="text-sm text-neutral-300">Web Search</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={settings.vision} onChange={e => setSettings(s => ({ ...s, vision: e.target.checked }))}
            className="w-4 h-4 rounded border-neutral-600 bg-neutral-800 text-sky-500 focus:ring-sky-500 focus:ring-offset-0" />
          <Image className="w-4 h-4 text-neutral-400" />
          <span className="text-sm text-neutral-300">Vision</span>
        </label>
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-neutral-700/50">
        <button onClick={onClose} className="px-3 py-1.5 text-sm text-neutral-400 hover:text-white transition-colors">Cancel</button>
        <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 px-4 py-1.5 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm font-medium text-white disabled:opacity-50 transition-colors">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Settings
        </button>
      </div>
    </div>
  );
}
