import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  GitBranch, GitCommit, GitPullRequest, Upload, Download, RefreshCw, Check,
  FileText, FilePlus, FileEdit, FolderGit2, Tag, Archive, Save, Plus, X, AlertTriangle, Files, Folder, ChevronRight, GitCompare,
} from 'lucide-react';
import { useToast } from './Toast';

const BASE = import.meta.env.VITE_API_URL || '';

async function api(path, opts) {
  const res = await fetch(`${BASE}/api/git/${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const d = JSON.parse(text); if (d.error) msg = d.error; } catch {}
    throw new Error(msg);
  }
  if (!ct.includes('application/json')) {
    throw new Error('Respons bukan JSON — route /api/git mungkin belum aktif di server');
  }
  try { return JSON.parse(text); } catch (e) { throw new Error('Gagal parse JSON: ' + e.message); }
}

function statusMeta(f) {
  if (f.untracked) return { label: 'baru', color: 'text-emerald-400', Icon: FilePlus };
  if (f.x === 'A') return { label: 'ditambah', color: 'text-emerald-400', Icon: FilePlus };
  if (f.x === 'D' || f.y === 'D') return { label: 'dihapus', color: 'text-red-400', Icon: X };
  if (f.x === 'M') return { label: 'staged', color: 'text-sky-400', Icon: FileEdit };
  if (f.y === 'M') return { label: 'ubah', color: 'text-amber-400', Icon: FileEdit };
  if (f.x === 'R' || f.y === 'R') return { label: 'rename', color: 'text-violet-400', Icon: FileEdit };
  return { label: 'ubah', color: 'text-amber-400', Icon: FileEdit };
}

function DiffView({ diff }) {
  const lines = useMemo(() => (diff || '').split('\n'), [diff]);
  return (
    <pre className="text-xs leading-relaxed font-mono whitespace-pre-wrap break-words p-3 overflow-auto h-full">
      {lines.map((line, i) => {
        let cls = 'text-neutral-300';
        if (line.startsWith('+')) cls = 'text-emerald-300 bg-emerald-500/10';
        else if (line.startsWith('-')) cls = 'text-red-300 bg-red-500/10';
        else if (line.startsWith('@@')) cls = 'text-sky-400';
        else if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')) cls = 'text-neutral-500';
        return (
          <div key={i} className={cls}>
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}

export default function GitView() {
  const { showToast } = useToast();
  const [tab, setTab] = useState('changes');

  // changes
  const [status, setStatus] = useState({ branch: '', ahead: 0, behind: 0, files: [] });
  const [selected, setSelected] = useState(null);
  const [diff, setDiff] = useState('');
  const [diffStaged, setDiffStaged] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [busy, setBusy] = useState(false);

  // history
  const [commits, setCommits] = useState([]);
  const [commitDiff, setCommitDiff] = useState(null);
  const [commitMeta, setCommitMeta] = useState(null);

  // branches / tags / stash
  const [branches, setBranches] = useState([]);
  const [currentBranch, setCurrentBranch] = useState('');
  const [newBranch, setNewBranch] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');
  const [tags, setTags] = useState([]);
  const [newTag, setNewTag] = useState('');
  const [stashes, setStashes] = useState([]);

  // gitignore
  const [gitignore, setGitignore] = useState('');

  // unpushed (repo/remote vs local)
  const [unpushedCommits, setUnpushedCommits] = useState([]);
  const [unpushedDiff, setUnpushedDiff] = useState('');
  const [unpushedBase, setUnpushedBase] = useState('');
  const [unpushedMsg, setUnpushedMsg] = useState('');
  const [unpushedHasBase, setUnpushedHasBase] = useState(true);

  // files
  const [treePath, setTreePath] = useState('');
  const [treeItems, setTreeItems] = useState([]);
  const [editorPath, setEditorPath] = useState('');
  const [editorContent, setEditorContent] = useState('');
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const data = await api('status');
      setStatus({ branch: data.branch, ahead: data.ahead || 0, behind: data.behind || 0, files: data.files || [] });
      setSelected(null);
      setDiff('');
    } catch (e) {
      showToast('Gagal load status: ' + e.message, 'error');
    }
  }, [showToast]);

  const loadBranches = useCallback(async () => {
    try {
      const data = await api('branches');
      setBranches(data.branches || []);
      setCurrentBranch(data.current || '');
    } catch (e) { showToast('Gagal load branch: ' + e.message, 'error'); }
  }, [showToast]);

  const loadTags = useCallback(async () => {
    try { const data = await api('tags'); setTags(data.tags || []); } catch (e) { showToast('Gagal load tag', 'error'); }
  }, [showToast]);

  const loadStashes = useCallback(async () => {
    try { const data = await api('stash-list'); setStashes(data.stashes || []); } catch (e) { showToast('Gagal load stash', 'error'); }
  }, [showToast]);

  useEffect(() => {
    loadStatus();
    loadBranches();
  }, [loadStatus, loadBranches]);

  const loadDiff = useCallback(async (file, staged) => {
    if (!file) { setDiff(''); return; }
    try {
      const data = await api(`diff?file=${encodeURIComponent(file)}&staged=${staged ? 1 : 0}`);
      setDiff(data.diff || '');
    } catch (e) { showToast('Gagal load diff: ' + e.message, 'error'); }
  }, [showToast]);

  const onSelectFile = (file) => {
    const staged = file.staged && !file.unstaged;
    setSelected(file.path);
    setDiffStaged(staged);
    loadDiff(file.path, staged);
  };

  const toggleStage = async (file) => {
    try {
      await api('stage', { method: 'POST', body: JSON.stringify({ file: file.path, unstage: file.staged }) });
      await loadStatus();
      if (selected === file.path) loadDiff(file.path, !file.staged);
    } catch (e) { showToast('Gagal stage: ' + e.message, 'error'); }
  };

  const doCommit = async () => {
    if (!commitMsg.trim()) { showToast('Tulis pesan commit dulu', 'warning'); return; }
    const staged = status.files.filter((f) => f.staged).map((f) => f.path);
    setBusy(true);
    try {
      if (staged.length) {
        await api('commit', { method: 'POST', body: JSON.stringify({ message: commitMsg, files: staged }) });
      } else {
        await api('commit', { method: 'POST', body: JSON.stringify({ message: commitMsg }) });
      }
      showToast('Commit berhasil', 'success');
      setCommitMsg('');
      await loadStatus();
      await loadBranches();
    } catch (e) {
      showToast('Commit gagal: ' + e.message, 'error');
    } finally { setBusy(false); }
  };

  const doPush = async () => {
    setBusy(true);
    try {
      const data = await api('push', { method: 'POST' });
      showToast(data.ok ? 'Push berhasil' : 'Push gagal', data.ok ? 'success' : 'error');
      if (!data.ok && data.error) showToast(data.error.slice(0, 200), 'error');
      await loadStatus();
    } catch (e) { showToast('Push error: ' + e.message, 'error'); }
    finally { setBusy(false); }
  };

  const doPull = async () => {
    setBusy(true);
    try {
      const data = await api('pull', { method: 'POST' });
      showToast(data.ok ? 'Pull berhasil' : 'Pull gagal', data.ok ? 'success' : 'error');
      if (!data.ok && data.error) showToast(data.error.slice(0, 200), 'error');
      await loadStatus();
      await loadBranches();
    } catch (e) { showToast('Pull error: ' + e.message, 'error'); }
    finally { setBusy(false); }
  };

  const doCheckout = async (branch, create) => {
    setBusy(true);
    try {
      await api('checkout', { method: 'POST', body: JSON.stringify({ branch, create }) });
      showToast(`Pindah ke ${branch}`, 'success');
      await loadStatus();
      await loadBranches();
    } catch (e) { showToast('Checkout gagal: ' + e.message, 'error'); }
    finally { setBusy(false); }
  };

  const doMerge = async () => {
    if (!mergeTarget) return;
    setBusy(true);
    try {
      const data = await api('merge', { method: 'POST', body: JSON.stringify({ branch: mergeTarget }) });
      if (data.conflicts && data.conflicts.length) {
        showToast('Konflik: ' + data.conflicts.join(', '), 'error');
      } else {
        showToast(data.ok ? 'Merge berhasil' : 'Merge gagal', data.ok ? 'success' : 'error');
      }
      if (!data.ok && data.error) showToast(data.error.slice(0, 200), 'error');
      await loadStatus();
    } catch (e) { showToast('Merge error: ' + e.message, 'error'); }
    finally { setBusy(false); }
  };

  const doStash = async (pop) => {
    setBusy(true);
    try {
      const data = await api('stash', { method: 'POST', body: JSON.stringify({ pop }) });
      showToast(pop ? 'Stash pop' : 'Stash', data.ok ? 'success' : 'error');
      await loadStatus();
      await loadStashes();
    } catch (e) { showToast('Stash error: ' + e.message, 'error'); }
    finally { setBusy(false); }
  };

  const doTag = async () => {
    if (!newTag.trim()) return;
    try {
      await api('tag', { method: 'POST', body: JSON.stringify({ name: newTag, message: newTag }) });
      showToast('Tag ' + newTag, 'success');
      setNewTag('');
      await loadTags();
    } catch (e) { showToast('Tag gagal: ' + e.message, 'error'); }
  };

  const loadHistory = async () => {
    try {
      const data = await api('log?n=50');
      setCommits(data.commits || []);
      setCommitDiff(null);
      setCommitMeta(null);
    } catch (e) { showToast('Gagal load history', 'error'); }
  };

  const onSelectCommit = async (hash) => {
    try {
      const data = await api(`diff-commit?hash=${encodeURIComponent(hash)}`);
      setCommitDiff(data.diff || '');
      setCommitMeta(data.meta || null);
    } catch (e) { showToast('Gagal load diff commit', 'error'); }
  };

  const loadGitignore = async () => {
    try { const data = await api('gitignore'); setGitignore(data.content || ''); } catch (e) { showToast('Gagal load .gitignore', 'error'); }
  };

  const loadUnpushed = async () => {
    try {
      const data = await api('unpushed');
      setUnpushedHasBase(data.hasBase !== false);
      setUnpushedBase(data.base || '');
      setUnpushedCommits(data.commits || []);
      setUnpushedDiff(data.diff || '');
      setUnpushedMsg(data.message || '');
    } catch (e) { showToast('Gagal load perbandingan: ' + e.message, 'error'); }
  };

  const saveGitignore = async () => {
    try {
      await api('gitignore', { method: 'POST', body: JSON.stringify({ content: gitignore }) });
      showToast('.gitignore tersimpan', 'success');
    } catch (e) { showToast('Gagal simpan: ' + e.message, 'error'); }
  };

  const loadTree = useCallback(async (path) => {
    try {
      const data = await api(`tree?path=${encodeURIComponent(path || '')}`);
      setTreePath(data.path || '');
      setTreeItems(data.items || []);
    } catch (e) { showToast('Gagal buka folder: ' + e.message, 'error'); }
  }, [showToast]);

  const openFile = async (rel) => {
    setEditorLoading(true);
    setEditorPath(rel);
    try {
      const data = await api(`file?path=${encodeURIComponent(rel)}`);
      setEditorContent(data.content || '');
      setEditorDirty(false);
    } catch (e) {
      showToast('Gagal buka file: ' + e.message, 'error');
      setEditorPath('');
    } finally { setEditorLoading(false); }
  };

  const saveFile = async () => {
    if (!editorPath) return;
    try {
      await api('file', { method: 'POST', body: JSON.stringify({ path: editorPath, content: editorContent }) });
      setEditorDirty(false);
      showToast('Tersimpan: ' + editorPath, 'success');
      await loadStatus();
      await loadTree(treePath);
    } catch (e) { showToast('Gagal simpan: ' + e.message, 'error'); }
  };

  const tabs = [
    { id: 'changes', label: 'Perubahan', Icon: FileEdit },
    { id: 'history', label: 'History', Icon: GitCommit },
    { id: 'branches', label: 'Branch', Icon: GitBranch },
    { id: 'unpushed', label: 'Belum Push', Icon: GitCompare },
    { id: 'stash', label: 'Stash', Icon: Archive },
    { id: 'tags', label: 'Tag', Icon: Tag },
    { id: 'files', label: 'File', Icon: Files },
    { id: 'gitignore', label: '.gitignore', Icon: FileText },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-neutral-800 bg-neutral-900/50">
        <FolderGit2 size={18} className="text-sky-400" />
        <h1 className="text-sm font-semibold text-neutral-200">Git & GitHub</h1>
        {status.branch && (
          <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-neutral-800 text-neutral-300">
            <GitBranch size={12} /> {status.branch}
            {status.ahead > 0 && <span className="text-sky-400">↑{status.ahead}</span>}
            {status.behind > 0 && <span className="text-amber-400">↓{status.behind}</span>}
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => { loadStatus(); loadBranches(); }}
          disabled={busy}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 disabled:opacity-50"
        >
          <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Refresh
        </button>
        <button
          onClick={doPull}
          disabled={busy}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 disabled:opacity-50"
        >
          <Download size={13} /> Pull
        </button>
        <button
          onClick={doPush}
          disabled={busy || (status.ahead === 0)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-40"
        >
          <Upload size={13} /> Push
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-3 pt-2 border-b border-neutral-800 bg-neutral-900/30 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id);
              if (t.id === 'history') loadHistory();
              if (t.id === 'tags') loadTags();
              if (t.id === 'stash') loadStashes();
              if (t.id === 'gitignore') loadGitignore();
              if (t.id === 'files') loadTree('');
              if (t.id === 'unpushed') loadUnpushed();
            }}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs rounded-t-lg whitespace-nowrap ${
              tab === t.id ? 'text-sky-400 bg-neutral-800/60 font-medium' : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <t.Icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'changes' && (
          <div className="flex h-full">
            {/* file list */}
            <div className="w-72 flex-shrink-0 border-r border-neutral-800 overflow-y-auto">
              <div className="px-3 py-2 text-xs text-neutral-500 uppercase tracking-wide">
                {status.files.length} file berubah
              </div>
              {status.files.length === 0 && (
                <div className="px-3 py-6 text-sm text-neutral-500 text-center">Bersih, tidak ada perubahan.</div>
              )}
              {status.files.map((f) => {
                const m = statusMeta(f);
                const active = selected === f.path;
                return (
                  <button
                    key={f.path}
                    onClick={() => onSelectFile(f)}
                    className={`w-full text-left px-3 py-2 flex items-center gap-2 border-l-2 ${
                      active ? 'border-sky-500 bg-neutral-800/60' : 'border-transparent hover:bg-neutral-800/40'
                    }`}
                  >
                    <span onClick={(e) => { e.stopPropagation(); toggleStage(f); }}
                      className={`w-4 h-4 flex-shrink-0 rounded border flex items-center justify-center cursor-pointer ${
                        f.staged ? 'bg-sky-500 border-sky-500' : 'border-neutral-600'
                      }`}
                      title={f.staged ? 'Unstage' : 'Stage'}
                    >
                      {f.staged && <Check size={11} className="text-white" />}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs text-neutral-200 truncate">{f.path}</span>
                      <span className={`text-[10px] ${m.color}`}>{m.label}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            {/* diff + commit */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-hidden bg-neutral-950">
                {selected ? (
                  <>
                    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-neutral-800 text-xs text-neutral-400">
                      <FileText size={12} /> {selected}
                      <button
                        onClick={() => { const nf = !diffStaged; setDiffStaged(nf); loadDiff(selected, nf); }}
                        className="ml-auto px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700"
                      >
                        {diffStaged ? 'Lihat unstaged' : 'Lihat staged'}
                      </button>
                    </div>
                    <DiffView diff={diff} />
                  </>
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-neutral-600">
                    Pilih file untuk lihat diff
                  </div>
                )}
              </div>
              {/* commit bar */}
              <div className="border-t border-neutral-800 p-3 bg-neutral-900/60">
                <textarea
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  placeholder="Pesan commit…"
                  rows={2}
                  className="w-full bg-neutral-800 text-sm text-neutral-100 rounded-lg px-3 py-2 resize-none outline-none focus:ring-1 focus:ring-sky-500"
                />
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={doCommit}
                    disabled={busy || !commitMsg.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40"
                  >
                    <GitCommit size={13} /> Commit
                  </button>
                  <span className="text-xs text-neutral-500">
                    {status.files.filter((f) => f.staged).length} staged · {status.files.filter((f) => !f.staged).length} belum
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'history' && (
          <div className="flex h-full">
            <div className="w-80 flex-shrink-0 border-r border-neutral-800 overflow-y-auto">
              {commits.map((c) => (
                <button
                  key={c.hash}
                  onClick={() => onSelectCommit(c.hash)}
                  className="w-full text-left px-3 py-2 border-b border-neutral-800/50 hover:bg-neutral-800/40"
                >
                  <div className="text-xs text-neutral-200 truncate">{c.message}</div>
                  <div className="text-[10px] text-neutral-500">{c.hash.slice(0, 7)} · {c.author} · {c.date}</div>
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-hidden bg-neutral-950">
              {commitMeta && (
                <div className="px-3 py-2 border-b border-neutral-800 text-xs text-neutral-400">
                  <span className="text-neutral-200">{commitMeta.message}</span> — {commitMeta.author} · {commitMeta.date}
                </div>
              )}
              {commitDiff ? <DiffView diff={commitDiff} /> : (
                <div className="h-full flex items-center justify-center text-sm text-neutral-600">Pilih commit</div>
              )}
            </div>
          </div>
        )}

        {tab === 'unpushed' && (
          <div className="flex flex-col h-full">
            <div className="px-3 py-2 border-b border-neutral-800 text-xs text-neutral-400 flex items-center gap-2">
              <GitCompare size={13} className="text-sky-400" />
              {unpushedHasBase
                ? <>Bandingkan <span className="text-neutral-200">{unpushedBase}</span> (di repo) vs lokal — ini yang akan di-push.</>
                : <span className="text-amber-400">{unpushedMsg || 'Tidak ada base untuk dibandingkan.'}</span>}
              <button onClick={loadUnpushed}
                className="ml-auto px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700">Refresh</button>
            </div>
            <div className="flex-1 flex overflow-hidden">
              <div className="w-80 flex-shrink-0 border-r border-neutral-800 overflow-y-auto">
                <div className="px-3 py-2 text-[11px] uppercase text-neutral-500">
                  {unpushedCommits.length} commit belum ter-push
                </div>
                {unpushedCommits.map((c) => (
                  <div key={c.hash} className="px-3 py-2 border-b border-neutral-800/50">
                    <div className="text-xs text-neutral-200 truncate">{c.message}</div>
                    <div className="text-[10px] text-neutral-500">{c.hash.slice(0, 7)} · {c.author} · {c.date}</div>
                  </div>
                ))}
                {unpushedCommits.length === 0 && (
                  <div className="px-3 py-4 text-xs text-neutral-600">Tidak ada commit baru.</div>
                )}
              </div>
              <div className="flex-1 overflow-hidden bg-neutral-950">
                {unpushedDiff ? <DiffView diff={unpushedDiff} /> : (
                  <div className="h-full flex items-center justify-center text-sm text-neutral-600">
                    Tidak ada beda (termasuk perubahan yang belum di-commit)
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'branches' && (
          <div className="p-4 space-y-4 overflow-y-auto h-full">
            <div className="flex gap-2">
              <input
                value={newBranch}
                onChange={(e) => setNewBranch(e.target.value)}
                placeholder="Nama branch baru"
                className="flex-1 bg-neutral-800 text-sm text-neutral-100 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-sky-500"
              />
              <button
                onClick={() => newBranch.trim() && doCheckout(newBranch.trim(), true)}
                disabled={busy || !newBranch.trim()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-40"
              >
                <Plus size={13} /> Buat & Pindah
              </button>
            </div>
            <div>
              <div className="text-xs text-neutral-500 mb-2 uppercase">Daftar branch</div>
              <div className="space-y-1">
                {branches.map((b) => (
                  <div key={b.name + (b.remote ? '-r' : '')}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-neutral-900/60">
                    <GitBranch size={13} className={b.current ? 'text-sky-400' : 'text-neutral-500'} />
                    <span className={`text-sm ${b.current ? 'text-sky-400 font-medium' : 'text-neutral-200'}`}>{b.name}</span>
                    {b.remote && <span className="text-[10px] text-neutral-600">remote</span>}
                    {!b.remote && !b.current && (
                      <button
                        onClick={() => doCheckout(b.name, false)}
                        disabled={busy}
                        className="ml-auto text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-200 disabled:opacity-40"
                      >Pindah</button>
                    )}
                    {b.current && <span className="ml-auto text-[10px] text-sky-400">aktif</span>}
                  </div>
                ))}
              </div>
            </div>
            <div className="border-t border-neutral-800 pt-4">
              <div className="text-xs text-neutral-500 mb-2 uppercase">Merge branch ke {currentBranch || 'saat ini'}</div>
              <div className="flex gap-2">
                <select
                  value={mergeTarget}
                  onChange={(e) => setMergeTarget(e.target.value)}
                  className="flex-1 bg-neutral-800 text-sm text-neutral-100 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-sky-500"
                >
                  <option value="">Pilih branch sumber…</option>
                  {branches.filter((b) => !b.remote && b.name !== currentBranch).map((b) => (
                    <option key={b.name} value={b.name}>{b.name}</option>
                  ))}
                </select>
                <button
                  onClick={doMerge}
                  disabled={busy || !mergeTarget}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40"
                >
                  <GitMergeIcon /> Merge
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'stash' && (
          <div className="p-4 space-y-4 overflow-y-auto h-full">
            <div className="flex gap-2">
              <button
                onClick={() => doStash(false)}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-neutral-700 hover:bg-neutral-600 text-white disabled:opacity-40"
              >
                <Archive size={13} /> Stash sekarang
              </button>
              <button
                onClick={() => doStash(true)}
                disabled={busy || stashes.length === 0}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 disabled:opacity-40"
              >
                Stash pop
              </button>
            </div>
            {stashes.length === 0 && <div className="text-sm text-neutral-500">Tidak ada stash.</div>}
            {stashes.map((s) => (
              <div key={s} className="px-3 py-2 rounded-lg bg-neutral-900/60 text-xs text-neutral-300 font-mono">{s}</div>
            ))}
          </div>
        )}

        {tab === 'tags' && (
          <div className="p-4 space-y-4 overflow-y-auto h-full">
            <div className="flex gap-2">
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="Nama tag (v1.0.0)"
                className="flex-1 bg-neutral-800 text-sm text-neutral-100 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-sky-500"
              />
              <button
                onClick={doTag}
                disabled={busy || !newTag.trim()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-40"
              >
                <Plus size={13} /> Buat tag
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {tags.map((t) => (
                <span key={t} className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-neutral-800 text-xs text-neutral-200">
                  <Tag size={11} className="text-sky-400" /> {t}
                </span>
              ))}
            </div>
          </div>
        )}

        {tab === 'files' && (
          <div className="flex h-full">
            <div className="w-72 flex-shrink-0 border-r border-neutral-800 overflow-y-auto">
              <div className="px-3 py-2 flex items-center gap-1 text-xs text-neutral-400 border-b border-neutral-800">
                <button onClick={() => loadTree('')} className="hover:text-sky-400">repo</button>
                {treePath.split('/').filter(Boolean).map((seg, i, arr) => {
                  const p = arr.slice(0, i + 1).join('/');
                  return (
                    <span key={p} className="flex items-center gap-1">
                      <ChevronRight size={11} className="text-neutral-600" />
                      <button onClick={() => loadTree(p)} className="hover:text-sky-400">{seg}</button>
                    </span>
                  );
                })}
              </div>
              {treeItems.map((it) => (
                <button
                  key={it.path}
                  onClick={() => it.type === 'dir' ? loadTree(it.path) : openFile(it.path)}
                  className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-neutral-800/40"
                >
                  {it.type === 'dir'
                    ? <Folder size={13} className="text-sky-400 flex-shrink-0" />
                    : <FileText size={13} className="text-neutral-400 flex-shrink-0" />}
                  <span className="text-xs text-neutral-200 truncate flex-1">{it.name}</span>
                </button>
              ))}
              {treeItems.length === 0 && <div className="px-3 py-4 text-xs text-neutral-600">Kosong</div>}
            </div>
            <div className="flex-1 flex flex-col overflow-hidden">
              {editorPath ? (
                <>
                  <div className="flex items-center gap-2 px-3 py-1.5 border-b border-neutral-800 text-xs text-neutral-400">
                    <FileText size={12} /> <span className="truncate">{editorPath}</span>
                    {editorDirty && <span className="text-amber-400">● belum disimpan</span>}
                    <button onClick={saveFile} disabled={!editorDirty}
                      className="ml-auto flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs disabled:opacity-40">
                      <Save size={12} /> Simpan
                    </button>
                  </div>
                  {editorLoading ? (
                    <div className="flex-1 flex items-center justify-center text-sm text-neutral-600">Memuat…</div>
                  ) : (
                    <textarea
                      value={editorContent}
                      onChange={(e) => { setEditorContent(e.target.value); setEditorDirty(true); }}
                      spellCheck={false}
                      className="flex-1 w-full bg-neutral-950 text-xs font-mono text-neutral-200 p-3 outline-none resize-none leading-relaxed"
                    />
                  )}
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-sm text-neutral-600">
                  Pilih file di kiri untuk edit (termasuk yang sudah di-push)
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'gitignore' && (
          <div className="p-4 flex flex-col h-full">
            <div className="flex-1 flex flex-col">
              <textarea
                value={gitignore}
                onChange={(e) => setGitignore(e.target.value)}
                className="flex-1 w-full bg-neutral-950 text-xs font-mono text-neutral-200 rounded-lg p-3 outline-none focus:ring-1 focus:ring-sky-500 resize-none"
                placeholder="# tambahkan pola di sini"
              />
            </div>
            <div className="flex justify-end mt-2">
              <button
                onClick={saveGitignore}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                <Save size={13} /> Simpan .gitignore
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// small inline icon alias to avoid extra import churn
function GitMergeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M13 6h3a2 2 0 0 1 2 2v7" /><line x1="6" y1="9" x2="6" y2="21" />
    </svg>
  );
}
