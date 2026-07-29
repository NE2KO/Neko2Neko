import { useState, useEffect } from 'react';
import { fetchAiStatus, updateAiSetting } from '../utils/api.js';
import { Settings, Key, Brain, Globe, Wrench, Sparkles, Database, Sliders } from 'lucide-react';
import ProviderManager from './ProviderManager';
import MemoryManager from './MemoryManager';

const TABS = [
  { id: 'providers', label: 'Providers', icon: Key },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'general', label: 'General', icon: Settings },
  { id: 'tools', label: 'Tools', icon: Wrench },
];

function GeneralSettings() {
  const [settings, setSettings] = useState({});
  const [saving, setSaving] = useState(null);

  useEffect(() => {
    fetchAiStatus().then(d => setSettings(d)).catch(() => {});
  }, []);

  const updateSetting = async (key, value) => {
    setSaving(key);
    try {
      await updateAiSetting(key, value);
      setSettings(s => ({ ...s, [key.replace('ai.', '')]: value }));
      setTimeout(() => setSaving(null), 500);
    } catch { setSaving(null); }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-neutral-400 mb-1">Default Model</label>
        <input value={settings.defaultModel || ''} onChange={e => updateSetting('ai.defaultModel', e.target.value)}
          className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white focus:border-sky-500 focus:outline-none" placeholder="gpt-4o-mini" />
      </div>

      <div>
        <label className="block text-xs text-neutral-400 mb-1">Temperature: {settings.temperature ?? 0.7}</label>
        <input type="range" min="0" max="2" step="0.1" value={settings.temperature ?? 0.7}
          onChange={e => updateSetting('ai.temperature', parseFloat(e.target.value))}
          className="w-full accent-sky-500" />
      </div>

      <div>
        <label className="block text-xs text-neutral-400 mb-1">Max Output Tokens</label>
        <input type="number" min="256" max="128000" step="256" value={settings.maxOutputTokens ?? 4096}
          onChange={e => updateSetting('ai.maxOutputTokens', parseInt(e.target.value) || 4096)}
          className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white focus:border-sky-500 focus:outline-none" />
      </div>

      <div>
        <label className="block text-xs text-neutral-400 mb-1">Max Context Messages</label>
        <input type="number" min="5" max="200" value={settings.maxContextMessages ?? 50}
          onChange={e => updateSetting('ai.maxContextMessages', parseInt(e.target.value) || 50)}
          className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white focus:border-sky-500 focus:outline-none" />
      </div>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={settings.streaming !== false}
            onChange={e => updateSetting('ai.streaming', e.target.checked)}
            className="w-4 h-4 rounded border-neutral-600 bg-neutral-800 text-sky-500 focus:ring-sky-500 focus:ring-offset-0" />
          <span className="text-sm text-neutral-300">Enable Streaming</span>
        </label>
      </div>

      <div>
        <label className="block text-xs text-neutral-400 mb-1">Default System Prompt</label>
        <textarea value={settings.defaultSystemPrompt || ''} onChange={e => updateSetting('ai.defaultSystemPrompt', e.target.value)} rows={4}
          placeholder="Leave empty for default behavior..."
          className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white placeholder-neutral-500 focus:border-sky-500 focus:outline-none resize-none" />
      </div>

      <div className="border-t border-neutral-800 pt-4 mt-4">
        <h4 className="text-xs font-semibold text-neutral-400 mb-3">Context Management</h4>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-neutral-400 mb-1">Max Context Tokens</label>
            <input type="number" min="1000" max="128000" step="1000" value={settings.context?.maxTokens ?? 8000}
              onChange={e => updateSetting('ai.context.maxTokens', parseInt(e.target.value) || 8000)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white focus:border-sky-500 focus:outline-none" />
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={settings.context?.autoCompact !== false}
                onChange={e => updateSetting('ai.context.autoCompact', e.target.checked)}
                className="w-4 h-4 rounded border-neutral-600 bg-neutral-800 text-sky-500 focus:ring-sky-500 focus:ring-offset-0" />
              <span className="text-sm text-neutral-300">Auto-compact Context</span>
            </label>
          </div>
        </div>
      </div>

      <div className="border-t border-neutral-800 pt-4 mt-4">
        <h4 className="text-xs font-semibold text-neutral-400 mb-3">Memory System</h4>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={settings.memory?.enabled !== false}
                onChange={e => updateSetting('ai.memory.enabled', e.target.checked)}
                className="w-4 h-4 rounded border-neutral-600 bg-neutral-800 text-sky-500 focus:ring-sky-500 focus:ring-offset-0" />
              <span className="text-sm text-neutral-300">Enable Memory System</span>
            </label>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={settings.memory?.autoExtract !== false}
                onChange={e => updateSetting('ai.memory.autoExtract', e.target.checked)}
                className="w-4 h-4 rounded border-neutral-600 bg-neutral-800 text-sky-500 focus:ring-sky-500 focus:ring-offset-0" />
              <span className="text-sm text-neutral-300">Auto-extract Memories</span>
            </label>
          </div>
          <div>
            <label className="block text-xs text-neutral-400 mb-1">Extraction Frequency (every N messages)</label>
            <input type="number" min="2" max="100" value={settings.memory?.extractionFrequency ?? 10}
              onChange={e => updateSetting('ai.memory.extractionFrequency', parseInt(e.target.value) || 10)}
              className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white focus:border-sky-500 focus:outline-none" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolPermissions() {
  const [tools, setTools] = useState([]);
  const [settings, setSettings] = useState({});

  useEffect(() => {
    fetchAiStatus().then(d => {
      setTools(Array.isArray(d.tools) ? d.tools : [...(d.tools || [])]);
    }).catch(() => {});
  }, []);

  const updateSetting = async (key, value) => {
    try {
      await updateAiSetting(key, value);
      setSettings(s => ({ ...s, [key]: value }));
    } catch {}
  };

  const toolDefs = [
    { id: 'web_search', label: 'Web Search', desc: 'Search the web for information' },
    { id: 'vault_media_search', label: 'Vault Search', desc: 'Search media library' },
    { id: 'vault_media_folder', label: 'Vault Folder', desc: 'Browse media folders' },
    { id: 'vault_media_meta', label: 'Vault Metadata', desc: 'Read media metadata' },
    { id: 'vault_media_filter', label: 'Vault Filter', desc: 'Filter media files' },
    { id: 'vault_playlists', label: 'Vault Playlists', desc: 'Manage playlists' },
    { id: 'system_stats', label: 'System Stats', desc: 'View system statistics' },
  ];

  return (
    <div className="space-y-3">
      <div className="text-xs text-neutral-500 mb-2">Configure which tools the AI can use.</div>
      {toolDefs.map(t => (
        <div key={t.id} className="flex items-center justify-between p-2 bg-neutral-800/50 rounded-lg border border-neutral-700/50">
          <div>
            <div className="text-sm text-neutral-200">{t.label}</div>
            <div className="text-xs text-neutral-500">{t.desc}</div>
          </div>
          <div className={`text-xs px-2 py-0.5 rounded ${tools.includes(t.id) ? 'bg-emerald-900/50 text-emerald-400' : 'bg-neutral-700 text-neutral-500'}`}>
            {tools.includes(t.id) ? 'enabled' : 'disabled'}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function AISettings({ onBack }) {
  const [activeTab, setActiveTab] = useState('providers');

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-800">
        {onBack && (
          <button onClick={onBack} className="text-neutral-400 hover:text-white transition-colors">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
        )}
        <Sparkles size={16} className="text-violet-400" />
        <span className="text-sm font-semibold text-neutral-200">AI Settings</span>
      </div>

      <div className="flex border-b border-neutral-800">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors ${activeTab === tab.id ? 'text-sky-400 border-b-2 border-sky-400' : 'text-neutral-500 hover:text-neutral-300'}`}>
              <Icon size={12} />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'providers' && <ProviderManager />}
        {activeTab === 'memory' && <MemoryManager />}
        {activeTab === 'general' && <GeneralSettings />}
        {activeTab === 'tools' && <ToolPermissions />}
      </div>
    </div>
  );
}
