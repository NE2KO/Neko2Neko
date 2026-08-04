import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { Download, X, RotateCcw, Trash2, Loader, RefreshCw, Radio, ChevronRight, ChevronDown, Film, Music, User, Image, Hash, Settings, List } from 'lucide-react';
import ServiceStoppedBanner from '../../components/ServiceStoppedBanner';

const SOURCES = [
  {
    id: 'youtube', label: 'YouTube',
    activeBg: 'bg-red-500/10', border: 'border-red-500/25', textColor: 'text-red-400',
    lightGradient: 'from-red-500/10 to-red-600/5',
    placeholder: 'https://www.youtube.com/watch?v=...',
    qualities: [
      { value: 'best', label: 'Best' },
      { value: '2160p', label: '2160p' },
      { value: '1440p', label: '1440p' },
      { value: '1080p', label: '1080p' },
      { value: '720p', label: '720p' },
      { value: '480p', label: '480p' },
      { value: '360p', label: '360p' },
      { value: 'audio', label: 'Audio Only' },
    ],
    routes: { video: 'Videos/YouTube/', audio: 'Music/YouTube/' },
    Logo: ({ className }) => (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
      </svg>
    ),
  },
  {
    id: 'tiktok', label: 'TikTok',
    activeBg: 'bg-pink-500/10', border: 'border-pink-500/25', textColor: 'text-pink-400',
    lightGradient: 'from-pink-500/10 via-red-500/5 to-yellow-500/5',
    placeholder: 'https://www.tiktok.com/@user/video/...',
    qualities: [{ value: 'best', label: 'Best' }, { value: 'audio', label: 'Audio Only' }],
    routes: { video: 'Videos/TikTok/', image: 'Pictures/TikTok/' },
    Logo: ({ className }) => (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
        <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>
      </svg>
    ),
  },
  {
    id: 'instagram', label: 'Instagram',
    activeBg: 'bg-orange-500/10', border: 'border-orange-500/25', textColor: 'text-orange-400',
    lightGradient: 'from-orange-500/10 via-pink-500/5 to-purple-600/5',
    placeholder: 'https://www.instagram.com/p/...',
    qualities: [{ value: 'best', label: 'Best' }, { value: 'audio', label: 'Audio Only' }],
    routes: { video: 'Videos/Instander/', image: 'Pictures/Instander/' },
    Logo: ({ className }) => (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
      </svg>
    ),
  },
  {
    id: 'twitter', label: 'Twitter / X',
    activeBg: 'bg-blue-500/10', border: 'border-blue-500/25', textColor: 'text-blue-400',
    lightGradient: 'from-blue-500/10 to-sky-500/5',
    placeholder: 'https://x.com/user/status/...',
    qualities: [{ value: 'best', label: 'Best' }, { value: 'audio', label: 'Audio Only' }],
    routes: { video: 'Videos/Twitter/', image: 'Pictures/Twitter/' },
    Logo: ({ className }) => (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>
    ),
  },
  {
    id: 'torrent', label: 'Torrent',
    activeBg: 'bg-purple-500/10', border: 'border-purple-500/25', textColor: 'text-purple-400',
    lightGradient: 'from-purple-500/10 to-violet-500/5',
    placeholder: 'magnet:?xt=urn:btih:...',
    qualities: [{ value: 'standard', label: 'Standard' }],
    routes: { any: 'homelab/' },
    Logo: ({ className }) => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 6v6l4 2"/>
      </svg>
    ),
  },
];

const CAT_ICON_COLORS = {
  youtube: 'text-red-400 bg-red-500/10',
  tiktok: 'text-pink-400 bg-pink-500/10',
  instagram: 'text-orange-400 bg-orange-500/10',
  twitter: 'text-blue-400 bg-blue-500/10',
  torrent: 'text-purple-400 bg-purple-500/10',
};

const STATUS_COLORS = {
  downloading: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  completed: 'bg-green-500/10 text-green-400 border-green-500/20',
  failed: 'bg-red-500/10 text-red-400 border-red-500/20',
  cancelled: 'bg-neutral-500/10 text-neutral-500 border-neutral-500/20',
  queued: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
};

const BAR_COLORS = {
  downloading: 'bg-cyan-500', completed: 'bg-green-500', failed: 'bg-red-500',
  cancelled: 'bg-neutral-600', queued: 'bg-yellow-500',
};

function fmtVcodec(codec) {
  if (!codec) return 'Unknown';
  if (codec.startsWith('av01')) return 'AV1';
  if (codec.startsWith('avc1') || codec.startsWith('h264')) return 'H.264';
  if (codec.startsWith('vp9') || codec.startsWith('vp09')) return 'VP9';
  if (codec.startsWith('vp8')) return 'VP8';
  if (codec.startsWith('hev1') || codec.startsWith('hvc1') || codec.startsWith('hevc')) return 'H.265/HEVC';
  return codec;
}

function fmtAcodec(codec) {
  if (!codec || codec === 'none') return '';
  if (codec.startsWith('mp4a')) return 'AAC';
  if (codec.startsWith('opus')) return 'Opus';
  return codec;
}

export default function DownloaderPage() {
  const [tasks, setTasks] = useState([]);
  const [url, setUrl] = useState('');
  const [source, setSource] = useState('youtube');
  const [quality, setQuality] = useState('best');
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState('');
  const [cachedMsg, setCachedMsg] = useState('');
  const [detectedData, setDetectedData] = useState(null);
  const [editedTitle, setEditedTitle] = useState('');
  const [expandedRes, setExpandedRes] = useState(null);
  const [selectedFormat, setSelectedFormat] = useState(null);
  const [selectedAudioId, setSelectedAudioId] = useState(null);
  const [twitterMode, setTwitterMode] = useState('single');
  const [twitterCookiesPath, setTwitterCookiesPath] = useState(() => localStorage.getItem('twitterCookiesPath') || '/home/CATIAA/homelab-media-server/cookies.txt');
  const [twitterInfo, setTwitterInfo] = useState(null);
  const [twitterDetecting, setTwitterDetecting] = useState(false);
  const [customOutput, setCustomOutput] = useState(false);
  const [sortBy, setSortBy] = useState('created');
  const [sortAsc, setSortAsc] = useState(false);
const [bulkMode, setBulkMode] = useState(false);
const [playlistMode, setPlaylistMode] = useState(false);
const [playlistData, setPlaylistData] = useState(null);
const [playlistLoading, setPlaylistLoading] = useState(false);
const [selectedPlaylistItems, setSelectedPlaylistItems] = useState(new Set());
const [playlistError, setPlaylistError] = useState('');
const [maxConcurrent, setMaxConcurrentState] = useState(3);
const [embedCover, setEmbedCover] = useState(false);
const [playlistAudioMode, setPlaylistAudioMode] = useState(false);
  const inputRef = useRef(null);
  const textareaRef = useRef(null);

  const currentSource = SOURCES.find(s => s.id === source) || SOURCES[0];

  useEffect(() => {
    if (!detectedData) {
      setQuality(currentSource.qualities.find(q => q.value !== 'audio')?.value || currentSource.qualities[0].value);
    }
  setError(''); setDetectedData(null); setSelectedFormat(null);
  setSelectedAudioId(null); setExpandedRes(null); setEditedTitle('');
  setTwitterMode('single'); setTwitterInfo(null);
  setEmbedCover(false);
  if (source !== 'youtube') { setPlaylistMode(false); setPlaylistData(null); setSelectedPlaylistItems(new Set()); setPlaylistError(''); setPlaylistAudioMode(false); }
  }, [source]);

  useEffect(() => {
    localStorage.setItem('twitterCookiesPath', twitterCookiesPath);
  }, [twitterCookiesPath]);

  useEffect(() => {
    fetch('/api/download/config').then(r => r.json()).then(d => {
      if (d.maxConcurrent) setMaxConcurrentState(d.maxConcurrent);
    }).catch(() => {});
  }, []);

  const updateConcurrency = async (n) => {
    setMaxConcurrentState(n);
    try {
      await fetch('/api/download/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxConcurrent: n }),
      });
    } catch {}
  };

  const fetchTasks = useCallback(async () => {
    try {
      const r = await fetch('/api/download/list');
      if (r.ok) {
        const t = await r.text();
        try { setTasks(JSON.parse(t).tasks || []); } catch {}
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchTasks();

    let es;
    try {
      es = new EventSource('/api/download/stream');
      es.addEventListener('tasks', (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          setTasks(Array.isArray(msg?.tasks) ? msg.tasks : []);
        } catch {}
      });
      es.onerror = () => { try { es.close(); } catch {} es = null; };
    } catch {}

    const id = setInterval(() => { if (!es) fetchTasks(); }, 2500);

    return () => { try { es?.close?.(); } catch {} clearInterval(id); };
  }, [fetchTasks]);

  const cancelTask = async (id) => { try { await fetch(`/api/download/${id}/cancel`, { method: 'POST' }); } catch {} fetchTasks(); };
  const removeTask = async (id) => { try { await fetch(`/api/download/${id}/remove`, { method: 'POST' }); } catch {} fetchTasks(); };
  const retryTask = async (id) => {
    try {
      await fetch(`/api/download/${id}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ twitterCookiesPath: twitterCookiesPath || null }),
      });
    } catch {}
    fetchTasks();
  };

  const detectFormats = async () => {
    if (!url.trim()) return;
    setDetecting(true); setError(''); setDetectedData(null);
    setSelectedFormat(null); setSelectedAudioId(null);
    try {
      const ac = new AbortController();
      const timeoutId = setTimeout(() => ac.abort(), 25000);
      const r = await fetch('/api/download/formats', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), youtubeCookiesPath: twitterCookiesPath || null }),
        signal: ac.signal,
      });
      clearTimeout(timeoutId);
      const text = await r.text();
      let d;
      try { d = JSON.parse(text); } catch { throw new Error('Server returned invalid response'); }
      if (d.error) { setError(d.error); }
      else if (d.video || d.audio) {
        setDetectedData(d);
        const resKeys = Object.keys(d.video || {});
        if (resKeys.length > 0) {
          setExpandedRes(resKeys[0]);
          if (d.video[resKeys[0]]?.length > 0) {
            const best = d.video[resKeys[0]][0];
            setSelectedFormat(best.id);
          }
        } else if (d.audio?.length > 0) {
          setSelectedAudioId(d.audio[0].id);
        }
      }
    } catch (e) {
      if (e.name === 'AbortError') setError('Request timeout — periksa koneksi internet');
      else setError(e.message || 'Gagal mendeteksi format');
    }
    setDetecting(false);
  };

  const detectTwitter = async () => {
    const targetUrl = twitterMode === 'account'
      ? url.trim().replace(/^@/, '')
      : url.trim();
    if (!targetUrl) return;
    setTwitterDetecting(true); setError(''); setTwitterInfo(null);
    try {
      const body = {
        url: twitterMode === 'account'
          ? targetUrl.startsWith('http') ? `${targetUrl}/media` : `https://x.com/${targetUrl}/media`
          : targetUrl,
        twitterMode,
        twitterCookiesPath: twitterCookiesPath || null,
      };
      const ac = new AbortController();
      const timeoutId = setTimeout(() => ac.abort(), 75000);
      const r = await fetch('/api/download/twitter-info', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      clearTimeout(timeoutId);
      const text = await r.text();
      let d;
      try { d = JSON.parse(text); } catch { throw new Error('Server returned invalid response'); }
      if (d.valid) setTwitterInfo(d);
      else setError(d.error || 'Gagal mendeteksi');
    } catch (e) { setError(e.message); }
    setTwitterDetecting(false);
  };

  const fetchPlaylist = async () => {
    const targetUrl = url.trim();
    if (!targetUrl) return;
    setPlaylistLoading(true); setPlaylistError(''); setPlaylistData(null); setSelectedPlaylistItems(new Set());
    try {
      const ac = new AbortController();
      const timeoutId = setTimeout(() => ac.abort(), 100000);
      const r = await fetch('/api/download/playlist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl, youtubeCookiesPath: twitterCookiesPath || null }),
        signal: ac.signal,
      });
      clearTimeout(timeoutId);
      const text = await r.text();
      let d;
      try { d = JSON.parse(text); } catch { throw new Error('Server returned invalid response'); }
      if (d.error) setPlaylistError(d.error);
      else if (d.items && d.items.length > 0) {
        setPlaylistData(d);
        const all = new Set(d.items.map(it => it.url));
        setSelectedPlaylistItems(all);
      } else setPlaylistError('Playlist kosong atau tidak dapat dibaca');
    } catch (e) {
      if (e.name === 'AbortError') setPlaylistError('Request timeout — periksa koneksi internet');
      else setPlaylistError(e.message || 'Gagal memuat playlist');
    }
    setPlaylistLoading(false);
  };

  const togglePlaylistMode = () => {
    const next = !playlistMode;
    setPlaylistMode(next);
    if (!next) { setPlaylistData(null); setSelectedPlaylistItems(new Set()); setPlaylistError(''); }
  };

  const togglePlaylistItem = (itemUrl) => {
    setSelectedPlaylistItems(prev => {
      const next = new Set(prev);
      if (next.has(itemUrl)) next.delete(itemUrl);
      else next.add(itemUrl);
      return next;
    });
  };

  const toggleAllPlaylistItems = (selectAll) => {
    if (!playlistData?.items?.length) return;
    if (selectAll) setSelectedPlaylistItems(new Set(playlistData.items.map(it => it.url)));
    else setSelectedPlaylistItems(new Set());
  };

  const downloadSelectedPlaylistItems = async () => {
    if (!playlistData?.items?.length) return;
    const urls = playlistData.items.filter(it => selectedPlaylistItems.has(it.url)).map(it => it.url);
    if (urls.length === 0) return;
    setError('');
    setPlaylistData(null); setSelectedPlaylistItems(new Set()); setPlaylistMode(false);
    try {
      const body = {
        urls,
        category: 'youtube',
        quality: playlistAudioMode ? 'audio' : quality,
        audioExtract: playlistAudioMode,
        audioFormat: playlistAudioMode ? 'mp3' : undefined,
        youtubeCookiesPath: twitterCookiesPath || null,
        embedCover,
      };
      const r = await fetch('/api/download/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const d = await r.json();
      const errors = (d.results || []).filter(r => r.error);
      if (errors.length > 0) setError(`${errors.length} URL gagal: ${errors[0].error}`);
      fetchTasks();
    } catch (e) { setError('Server error: restart backend'); }
  };

  const startDownload = async () => {
    if (!url.trim()) return;
    setError('');

    const urls = bulkMode
      ? url.split('\n').map(u => u.trim()).filter(Boolean)
      : [url.trim()];

    if (urls.length === 0) return;

    const savedUrl = url;
    setUrl(''); setDetectedData(null); setSelectedFormat(null);
    setSelectedAudioId(null); setEditedTitle('');
    setTimeout(() => inputRef.current?.focus() || textareaRef.current?.focus(), 0);

    try {
      if (urls.length === 1) {
        let body;
        if (source === 'twitter' && twitterMode === 'account') {
          body = {
            url: urls[0], category: 'twitter',
            twitterMode: 'account',
            twitterAccount: urls[0].replace(/^@/, '').replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//, '').replace(/\/.*$/, ''),
            quality, twitterCookiesPath: twitterCookiesPath || null, customOutput,
          };
         } else if (detectedData) {
           const titleParam = editedTitle ? { customTitle: editedTitle } : {};
           if (selectedFormat) {
             const fmt = [...Object.values(detectedData.video || {}).flat(), ...(detectedData.audio || [])].find(f => f.id === selectedFormat);
             body = { url: urls[0], category: source, formatId: fmt?.hasAudio ? selectedFormat : `${selectedFormat}+bestaudio[ext=m4a]/bestaudio[ext=m4a]/best`, ...titleParam };
           }
           else if (selectedAudioId) body = { url: urls[0], category: source, formatId: selectedAudioId, audioExtract: true, ...titleParam };
           else body = { url: urls[0], category: source, quality, audioExtract: quality === 'audio', ...titleParam };
           if (source === 'instagram') body.twitterCookiesPath = twitterCookiesPath || null;
           if (source === 'youtube') body.youtubeCookiesPath = twitterCookiesPath || null;
         } else {
          body = { url: urls[0], category: source, quality, twitterMode: 'single', twitterAccount: '', customOutput };
          if (source === 'twitter' || source === 'instagram') body.twitterCookiesPath = twitterCookiesPath || null;
          if (source === 'youtube') { body.youtubeCookiesPath = twitterCookiesPath || null; }
        }
        body.embedCover = embedCover;
        fetch('/api/download/start', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        }).then(r => r.json()).then(d => {
          if (d.error) setError(d.error);
          else if (d.skipped) setError(d.reason || 'Sudah di-download sebelumnya (anti-double)');
          else if (d.cached) { setCachedMsg(d.message || 'Cache hit'); setTimeout(() => setCachedMsg(''), 3000); }
          fetchTasks();
        }).catch(() => { setError('Server error: restart backend'); });
       } else {
         const body = {
           urls: extractUrls(url),
           category: source,
           quality,
           audioExtract: quality === 'audio',
           twitterMode: 'single',
           twitterAccount: '',
           customOutput,
         };
        if (source === 'twitter' || source === 'instagram') body.twitterCookiesPath = twitterCookiesPath || null;
        if (source === 'youtube') { body.youtubeCookiesPath = twitterCookiesPath || null; }
        body.embedCover = embedCover;
        fetch('/api/download/bulk', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        }).then(r => r.json()).then(d => {
          const errors = (d.results || []).filter(r => r.error);
          if (errors.length > 0) setError(`${errors.length} URLs gagal: ${errors[0].error}`);
          fetchTasks();
        }).catch(() => { setError('Server error: restart backend'); });
      }
    } catch (e) { setError(e.message); }
  };

  const activeTasks = tasks.filter(t => t.status === 'downloading' || t.status === 'queued');
  const doneTasks = tasks.filter(t => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled');
  const failedTasks = tasks.filter(t => t.status === 'failed');
  const routes = currentSource.routes || {};

  function parseSize(s) {
    if (!s) return 0;
    const m = s.match(/^([\d.]+)\s*(B|KiB|MiB|GiB)$/);
    if (!m) return 0;
    const v = parseFloat(m[1]);
    const u = { B: 1, KiB: 1024, MiB: 1048576, GiB: 1073741824 }[m[2]] || 1;
    return v * u;
  }

  const SORT_OPTIONS = [
    { key: 'created', label: 'Created' },
    { key: 'completed', label: 'Completed' },
    { key: 'name', label: 'Name' },
    { key: 'size', label: 'Size' },
    { key: 'platform', label: 'Platform' },
  ];

  const clearCompleted = async () => {
    const completed = tasks.filter(t => t.status === 'completed');
    for (const t of completed) {
      try { await fetch(`/api/download/${t.id}/remove`, { method: 'POST' }); } catch {}
    }
  };

  const retryFailed = async () => {
    for (const t of failedTasks) {
      try {
        await fetch(`/api/download/${t.id}/retry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ twitterCookiesPath: twitterCookiesPath || null }),
        });
      } catch {}
    }
  };

  const sortedDone = [...doneTasks].sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'name') cmp = (a.filename || '').localeCompare(b.filename || '');
    else if (sortBy === 'size') cmp = parseSize(a.totalSize) - parseSize(b.totalSize);
    else if (sortBy === 'created') cmp = (a.createdAt || '').localeCompare(b.createdAt || '');
    else if (sortBy === 'completed') cmp = (a.completedAt || '').localeCompare(b.completedAt || '');
    else if (sortBy === 'platform') cmp = (a.category || '').localeCompare(b.category || '');
    return sortAsc ? cmp : -cmp;
  });

  const hasDetection = detectedData && (Object.keys(detectedData.video || {}).length > 0 || (detectedData.audio || []).length > 0);

  const extractUrls = (text) => {
    const re = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(youtu\.be\/[^\s]+)/gi;
    const found = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      let u = m[0].replace(/[.,);\]]+$/, '').trim();
      if (/^www\./i.test(u)) u = `https://${u}`;
      else if (/^youtu\.be\//i.test(u)) u = `https://${u}`;
      found.push(u);
    }
    const seen = new Set();
    return found.filter(u => {
      const k = u.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  const urlLines = bulkMode ? extractUrls(url).length : 0;

  return (
    <div className="h-full w-full overflow-y-auto bg-[#0b0d10]" data-debug-id="3.1" data-debug-name="DownloaderPage" data-debug-type="container">
      <div className="p-4 md:p-6 lg:p-8 space-y-5 min-h-full w-full max-w-7xl mx-auto">
        <ServiceStoppedBanner service="downloader" />

        {/* Source Selector */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {SOURCES.map(s => {
            const active = source === s.id;
            const Logo = s.Logo;
            return (
              <button key={s.id} onClick={() => setSource(s.id)}
                data-debug-id={s.id === 'youtube' ? '3.1.2' : s.id === 'tiktok' ? '3.1.3' : s.id === 'instagram' ? '3.1.4' : s.id === 'twitter' ? '3.1.5' : s.id === 'torrent' ? '3.1.6' : undefined}
                data-debug-name={s.id === 'youtube' ? 'SourceCardYouTube' : s.id === 'tiktok' ? 'SourceCardTikTok' : s.id === 'instagram' ? 'SourceCardInstagram' : s.id === 'twitter' ? 'SourceCardTwitter' : s.id === 'torrent' ? 'SourceCardTorrent' : undefined}
                data-debug-type="card"
                className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border transition-all duration-200 overflow-hidden ${
                  active
                    ? `${s.activeBg} ${s.border} shadow-lg scale-[1.02]`
                    : 'border-[#1e2530] bg-[#111418] hover:border-neutral-600 hover:bg-[#1a1f26]'
                }`}>
                <div className={`p-2.5 rounded-xl transition-all ${active ? s.activeBg + ' scale-110' : 'bg-neutral-800'}`}>
                  <Logo className={`w-5 h-5 ${active ? s.textColor : 'text-neutral-500'}`} />
                </div>
                <span className={`text-[11px] font-semibold ${active ? s.textColor : 'text-neutral-400'}`}>{s.label}</span>
                {active && source !== 'torrent' && (
                  <div className={`absolute inset-0 bg-gradient-to-b ${s.lightGradient} opacity-60 pointer-events-none`} />
                )}
              </button>
            );
          })}
        </div>

        {/* URL Input */}
        <div className="bg-[#111418] border border-[#1e2530] rounded-xl p-4 md:p-5">
          <div className="flex items-center gap-2.5 mb-3">
            <div className={`p-2 rounded-lg ${currentSource.activeBg}`}>
              <currentSource.Logo className={`w-4 h-4 ${currentSource.textColor}`} />
            </div>
            <div className="text-xs text-neutral-500 leading-relaxed flex flex-wrap gap-x-3 gap-y-0.5">
              {Object.entries(routes).map(([key, dir]) => (
                <span key={key}>
                  <span className="capitalize text-neutral-600">{key}:</span>{' '}
                  <code className="font-mono text-[10px] bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-400">{dir}</code>
                </span>
              ))}
            </div>
          </div>
          {detecting && !detectedData && (
            <div className="mb-3 rounded-xl bg-[#111418] border border-[#1e2530] overflow-hidden">
              <div className="w-full aspect-video bg-neutral-800 animate-pulse rounded-t-xl" />
              <div className="p-3 space-y-2">
                <div className="h-4 bg-neutral-800 rounded animate-pulse w-3/4" />
                <div className="h-3 bg-neutral-800 rounded animate-pulse w-1/2" />
              </div>
            </div>
          )}
          {detectedData?.title && (
            <MetadataPreview data={detectedData} onTitleChange={setEditedTitle} />
          )}

          <div className="flex flex-col gap-3">
            <div className="flex gap-2 items-end">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  {source === 'youtube' && (
                    <button onClick={() => setPlaylistMode(!playlistMode)}
                      className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-md font-medium transition-all ${
                        playlistMode
                          ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                          : 'text-neutral-600 border border-transparent hover:text-neutral-400'
                      }`}>
                      <List size={10} /> Playlist
                    </button>
                  )}
                  {(
                    <button onClick={() => setBulkMode(!bulkMode)}
                      className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-md font-medium transition-all ${
                        bulkMode
                          ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                          : 'text-neutral-600 border border-transparent hover:text-neutral-400'
                      }`}>
                      <List size={10} /> Bulk
                    </button>
                  )}
                  {bulkMode && urlLines > 0 && (
                    <span className="text-[10px] text-cyan-400/70 font-mono">{urlLines} URL{urlLines !== 1 ? 's' : ''}</span>
                  )}
                  {playlistMode && playlistData && (
                    <span className="text-[10px] text-red-400/70 font-mono">{playlistData.items.length} items</span>
                  )}
                </div>
                {bulkMode ? (
                  <textarea ref={textareaRef} value={url}
                    onChange={e => { setUrl(e.target.value); if (detectedData) setDetectedData(null); if (twitterInfo) setTwitterInfo(null); }}
                    placeholder="Paste banyak link sekaligus (boleh dari chat WA):&#10;[09.22, 13/7/2026] Ai: https://youtube.com/shorts/ABC&#10;https://instagram.com/p/DEF"
                    rows={4}
                    className="w-full bg-[#0d1117] text-neutral-300 text-sm px-3 py-2.5 rounded-lg border border-[#2a3340] focus:outline-none focus:border-cyan-500/30 placeholder:text-neutral-600 font-mono text-xs resize-none" />
                ) : source === 'twitter' && twitterMode === 'account' ? (
                  <input type="text" value={url}
                    onChange={e => setUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && startDownload()}
                    placeholder="@username"
                    className="w-full bg-[#0d1117] text-neutral-300 text-sm px-3 py-2.5 pr-8 rounded-lg border border-[#2a3340] focus:outline-none focus:border-cyan-500/30 placeholder:text-neutral-600" />
                ) : (
                  <input ref={inputRef} type="text" value={url}
                    onChange={e => { setUrl(e.target.value); if (detectedData) setDetectedData(null); if (twitterInfo) setTwitterInfo(null); }}
                    onKeyDown={e => e.key === 'Enter' && !(source === 'youtube' && !detectedData) && startDownload()}
                    placeholder={currentSource.placeholder}
                    data-debug-id="3.1.6.1"
                    data-debug-name="UrlInput"
                    data-debug-type="other"
                    className="w-full bg-[#0d1117] text-neutral-300 text-sm px-3 py-2.5 pr-8 rounded-lg border border-[#2a3340] focus:outline-none focus:border-cyan-500/30 placeholder:text-neutral-600" />
                )}
                {url && (
                  <button onClick={() => { setUrl(''); setDetectedData(null); inputRef.current?.focus(); textareaRef.current?.focus(); }}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-neutral-600 hover:text-neutral-300 rounded transition-colors">
                    <X size={14} />
                  </button>
                )}
              </div>
              {source === 'youtube' && url.trim() && !bulkMode && !playlistMode && (
                <button onClick={detectFormats} disabled={detecting}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-all duration-200 text-neutral-500 border border-[#2a3340] bg-[#0d1117] hover:border-neutral-600 hover:text-neutral-300 active:scale-[0.97] flex-shrink-0">
                  {detecting ? <Loader size={13} className="animate-spin" /> : <Radio size={13} />}
                  <span className="hidden sm:inline">Detect</span>
                </button>
              )}
              {source === 'youtube' && url.trim() && !bulkMode && playlistMode && (
                <button onClick={fetchPlaylist} disabled={playlistLoading}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-all duration-200 text-red-400 border border-red-500/20 bg-[#0d1117] hover:border-red-500/40 hover:text-red-300 active:scale-[0.97] flex-shrink-0">
                  {playlistLoading ? <Loader size={13} className="animate-spin" /> : <List size={13} />}
                  <span className="hidden sm:inline">Fetch Playlist</span>
                </button>
              )}
              {source === 'twitter' && url.trim() && !bulkMode && (
                <button onClick={detectTwitter} disabled={twitterDetecting}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-medium transition-all duration-200 text-neutral-500 border border-[#2a3340] bg-[#0d1117] hover:border-neutral-600 hover:text-neutral-300 active:scale-[0.97] flex-shrink-0">
                  {twitterDetecting ? <Loader size={13} className="animate-spin" /> : <Radio size={13} />}
                  <span className="hidden sm:inline">Detect</span>
                </button>
              )}
              <button onClick={startDownload} disabled={!url.trim() || (source === 'youtube' && !detectedData && !bulkMode && !playlistMode)}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 disabled:opacity-30 bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 active:scale-[0.97] flex-shrink-0">
                <Download size={15} />
                <span className="hidden sm:inline">{bulkMode && urlLines > 1 ? `Download ${urlLines}` : 'Download'}</span>
              </button>
            </div>

            {playlistMode && (
              <div className="mt-3 bg-[#111418] border border-[#1e2530] rounded-xl overflow-hidden">
                <div className="p-3 md:p-4 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-neutral-200 truncate">
                      {playlistData ? playlistData.title : 'Playlist Browser'}
                    </div>
                    <div className="text-[10px] text-neutral-500 mt-0.5">
                      {playlistData ? `${playlistData.items.length} items` : 'Paste URL lalu klik Fetch Playlist'}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {playlistData && (
                      <>
                        <button onClick={() => toggleAllPlaylistItems(true)} className="px-2 py-1 text-[10px] rounded border border-neutral-800 text-neutral-500 hover:text-neutral-200 hover:border-neutral-700">All</button>
                        <button onClick={() => toggleAllPlaylistItems(false)} className="px-2 py-1 text-[10px] rounded border border-neutral-800 text-neutral-500 hover:text-neutral-200 hover:border-neutral-700">None</button>
                      </>
                    )}
                    {playlistData && selectedPlaylistItems.size > 0 && (
                      <button onClick={downloadSelectedPlaylistItems} className="px-3 py-1.5 text-[11px] rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 font-medium transition-all">
                        Download Selected ({selectedPlaylistItems.size})
                      </button>
                    )}
                    <button onClick={togglePlaylistMode} className="p-1.5 text-neutral-600 hover:text-neutral-300 rounded-lg hover:bg-neutral-800/50 transition-colors" title="Close playlist">
                      <X size={14} />
                    </button>
                  </div>
                </div>

                {playlistData && (
                  <div className="px-3 md:px-4 pb-3 flex items-center gap-3 flex-wrap border-b border-[#1e2530]">
                    <div className="flex items-center gap-1">
                      <button onClick={() => setPlaylistAudioMode(false)} className={`px-2.5 py-1 text-[10px] rounded-md font-medium transition-all ${!playlistAudioMode ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' : 'text-neutral-500 border border-transparent hover:text-neutral-300'}`}>Video</button>
                      <button onClick={() => setPlaylistAudioMode(true)} className={`px-2.5 py-1 text-[10px] rounded-md font-medium transition-all ${playlistAudioMode ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-neutral-500 border border-transparent hover:text-neutral-300'}`}>Audio</button>
                    </div>
                    <label className="flex items-center gap-1.5 cursor-pointer group">
                      <input type="checkbox" checked={embedCover} onChange={e => setEmbedCover(e.target.checked)} className="w-3.5 h-3.5 rounded border-neutral-600 bg-neutral-800 text-cyan-500 focus:ring-cyan-500/30 focus:ring-offset-0 cursor-pointer" />
                      <span className="text-[10px] text-neutral-500 font-semibold uppercase tracking-wider group-hover:text-neutral-300 transition-colors">Embed Cover</span>
                    </label>
                  </div>
                )}

                {playlistError && (
                  <div className="mx-3 md:mx-4 mb-3 text-[11px] text-red-400 flex items-start gap-2 bg-red-500/5 rounded-lg px-3 py-2 border border-red-500/10">
                    <X size={12} className="flex-shrink-0 mt-0.5" />
                    <span className="leading-relaxed">{playlistError}</span>
                  </div>
                )}

                {playlistLoading && (
                  <div className="p-3 md:p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {Array.from({ length: 10 }).map((_, i) => (
                      <div key={i} className="rounded-xl overflow-hidden bg-neutral-800/30 border border-[#1e2530]">
                        <div className="w-full aspect-video bg-neutral-800 animate-pulse" />
                        <div className="p-2 space-y-2">
                          <div className="h-3 bg-neutral-800 rounded animate-pulse w-full" />
                          <div className="h-2.5 bg-neutral-800 rounded animate-pulse w-2/3" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {!playlistLoading && playlistData?.items?.length > 0 && (
                  <div className="p-3 md:p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 max-h-[60vh] overflow-y-auto">
                    {playlistData.items.slice(0, 200).map((item, idx) => {
                      const checked = selectedPlaylistItems.has(item.url);
                      const dur = fmtDuration(item.duration);
                      return (
                        <button key={item.url + idx} onClick={() => togglePlaylistItem(item.url)} className={`text-left rounded-xl overflow-hidden border transition-all duration-150 hover:border-neutral-600 ${checked ? 'bg-cyan-500/5 border-cyan-500/25' : 'bg-[#0d1117] border-[#1e2530]'}`}>
                          <div className="relative w-full aspect-video bg-neutral-900">
                            {item.thumbnail ? (
                              <img src={item.thumbnail} alt={item.title} className="w-full h-full object-cover" loading="lazy" onError={(e) => { e.target.style.display = 'none'; }} />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center"><Image size={20} className="text-neutral-700" /></div>
                            )}
                            <div className="absolute top-1.5 left-1.5 text-[9px] px-1.5 py-0.5 rounded bg-black/70 text-neutral-300 font-mono font-semibold">#{item.index || idx + 1}</div>
                            {dur && <div className="absolute bottom-1.5 right-1.5 text-[10px] px-1.5 py-0.5 rounded bg-black/80 text-white font-mono font-semibold">{dur}</div>}
                            <div className={`absolute top-1.5 right-1.5 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${checked ? 'bg-red-500 border-red-500' : 'bg-black/50 border-neutral-500'}`}>
                              {checked && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-3 h-3 text-white"><path d="M5 12l5 5L20 7" /></svg>}
                            </div>
                          </div>
                          <div className="p-2">
                            <div className={`text-[11px] leading-snug line-clamp-2 ${checked ? 'text-cyan-300' : 'text-neutral-300'}`}>{item.title}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {!playlistLoading && playlistData?.truncated && (
                  <div className="mx-3 md:mx-4 mb-3 text-[10px] text-yellow-400 bg-yellow-500/5 rounded-lg px-3 py-2 border border-yellow-500/10">
                    Playlist besar — menampilkan 200 item pertama. Pilih yang dibutuhkan, lalu download.
                  </div>
                )}
              </div>
            )}

            {/* DETECTED FORMAT PICKER (YouTube only) */}
            {source === 'youtube' && hasDetection && !playlistMode ? (
              <div className="mt-1 space-y-3" data-debug-id="3.1.6.2" data-debug-name="QualitySelector" data-debug-type="other">
                {Object.keys(detectedData.video).length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Film size={12} className="text-neutral-600" />
                      <span className="text-[10px] text-neutral-600 font-semibold uppercase tracking-wider">Video</span>
                    </div>
                    <div className="space-y-1">
                      {Object.entries(detectedData.video).map(([res, formats]) => {
                        const isOpen = expandedRes === res;
                        const isAnySelected = selectedFormat && formats.some(f => selectedFormat === f.id);
                        return (
                          <div key={res}>
                            <button
                              onClick={() => setExpandedRes(isOpen ? null : res)}
                              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors ${
                                isAnySelected ? 'bg-cyan-500/10 text-cyan-400' : 'text-neutral-400 hover:bg-neutral-800/30'
                              }`}>
                              {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                              <span className="font-semibold">{res}</span>
                              <span className="text-neutral-600">({formats.length} {formats.length === 1 ? 'fmt' : 'fmts'})</span>
                            </button>
                            {isOpen && (
                              <div className="ml-4 mt-1 space-y-1">
                                {formats.map(f => {
                                  const active = selectedFormat === f.id;
                                  return (
                                    <button key={f.id} onClick={() => { setSelectedFormat(f.id); setSelectedAudioId(null); }}
                                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-all ${
                                        active
                                          ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                                          : 'text-neutral-500 hover:bg-neutral-800/30 border border-transparent'
                                      }`}>
                                      <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                                        active ? 'border-cyan-500 bg-cyan-500/20' : 'border-neutral-600'
                                      }`}>
                                        {active && <div className="w-1.5 h-1.5 rounded-full bg-cyan-400" />}
                                      </div>
                                      <span className="font-mono text-neutral-400 w-10">{f.ext}</span>
                                      <span className="font-medium">{fmtVcodec(f.vcodec)}</span>
                                      {f.hdr && <span className="text-[9px] bg-yellow-500/10 text-yellow-500 px-1 rounded">HDR</span>}
                                      {f.fps > 30 && <span className="text-[9px] bg-blue-500/10 text-blue-400 px-1 rounded">{f.fps}fps</span>}
                                      {f.hasAudio && <span className="text-[9px] bg-purple-500/10 text-purple-400 px-1 rounded">+audio</span>}
                                      {f.best && <span className="text-[9px] bg-green-500/15 text-green-400 px-1.5 rounded font-bold border border-green-500/20">BEST</span>}
                                      <span className="ml-auto text-neutral-600 font-mono">{f.filesize || f.tbr || ''}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Music size={12} className="text-neutral-600" />
                    <span className="text-[10px] text-neutral-600 font-semibold uppercase tracking-wider">Audio</span>
                  </div>
                  {detectedData.audio?.length > 0 && (
                    <div className="space-y-1">
                      {detectedData.audio.map(f => {
                        const active = selectedAudioId === f.id;
                        return (
                          <button key={f.id} onClick={() => { setSelectedAudioId(f.id); setSelectedFormat(null); }}
                            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-all ${
                              active
                                ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                                : 'text-neutral-500 hover:bg-neutral-800/30 border border-transparent'
                            }`}>
                            <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                              active ? 'border-cyan-500 bg-cyan-500/20' : 'border-neutral-600'
                            }`}>
                              {active && <div className="w-1.5 h-1.5 rounded-full bg-cyan-400" />}
                            </div>
                            <span className="font-mono text-neutral-400 w-10">{f.ext}</span>
                            <span className="font-medium">{fmtAcodec(f.acodec)}</span>
                            {f.abitrate && <span className="text-neutral-600">{f.abitrate}</span>}
                            {f.best && <span className="text-[9px] bg-green-500/15 text-green-400 px-1.5 rounded font-bold border border-green-500/20">BEST</span>}
                            <span className="ml-auto text-neutral-600 font-mono">{f.filesize || ''}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : source === 'twitter' && (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-neutral-600 font-semibold uppercase tracking-wider mr-1">Mode</span>
                  <button onClick={() => { setTwitterMode('single'); setTwitterInfo(null); }}
                    className={`px-3.5 py-1.5 text-[11px] rounded-lg font-semibold transition-all ${
                      twitterMode === 'single'
                        ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                        : 'text-neutral-500 border border-transparent hover:text-neutral-300'
                    }`}>
                    Single Post
                  </button>
                  <button onClick={() => { setTwitterMode('account'); setTwitterInfo(null); }}
                    className={`px-3.5 py-1.5 text-[11px] rounded-lg font-semibold transition-all ${
                      twitterMode === 'account'
                        ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                        : 'text-neutral-500 border border-transparent hover:text-neutral-300'
                    }`}>
                    <span className="inline-flex items-center gap-1">
                      Account Media
                      <span className="text-[8px] bg-cyan-500/10 text-cyan-500 px-1 rounded ml-0.5">bulk</span>
                    </span>
                  </button>
                </div>

                {twitterInfo?.valid && (
                  <div className="mt-3 bg-blue-500/5 border border-blue-500/15 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-blue-500/10">
                        <User size={16} className="text-blue-400" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-blue-300">@{twitterInfo.username}</div>
                        <div className="text-[11px] text-neutral-400">{twitterInfo.displayName}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <div className="flex items-center gap-1.5">
                        <Hash size={12} className="text-neutral-500" />
                        <span className="text-neutral-300 font-mono">{twitterInfo.itemsFound}</span>
                        <span className="text-neutral-500">{twitterInfo.itemsLimited ? 'media ditemukan (sampling)' : 'media items'}</span>
                      </div>
                    </div>
                    {twitterInfo.samples?.length > 0 && (
                      <div>
                        <div className="text-[10px] text-neutral-600 font-semibold uppercase tracking-wider mb-1.5">Preview</div>
                        <div className="space-y-1">
                          {twitterInfo.samples.map((s, i) => {
                            const isImageUrl = s.url && (s.url.includes('pbs.twimg.com') || s.url.includes('twimg.com'));
                            return (
                              <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-blue-500/5 text-xs">
                                {isImageUrl ? (
                                  <img src={s.url} alt="preview" className="w-8 h-8 object-cover rounded flex-shrink-0" onError={(e) => { e.target.style.display='none'; }} />
                                ) : (
                                  <Image size={10} className="text-neutral-500 flex-shrink-0" />
                                )}
                                <span className="text-neutral-400 truncate flex-1">{s.title || 'Untitled'}</span>
                                {s.ext && <span className="text-neutral-600 font-mono text-[10px]">{s.ext}</span>}
                                {s.date && <span className="text-neutral-600 text-[10px]">{s.date}</span>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-3">
                  <span className="text-[10px] text-neutral-600 font-semibold uppercase tracking-wider mb-1.5 block">Cookies Path (optional)</span>
                  <input type="text" value={twitterCookiesPath}
                    onChange={e => setTwitterCookiesPath(e.target.value)}
                    placeholder="/path/to/cookies.txt or browser cookies dir"
                    className="w-full bg-[#0d1117] text-neutral-300 text-sm px-3 py-2 rounded-lg border border-[#2a3340] focus:outline-none focus:border-cyan-500/30 placeholder:text-neutral-600" />
                  {twitterCookiesPath ? (
                    <span className="text-[9px] text-neutral-400 mt-1 block">Saved: {twitterCookiesPath}</span>
                  ) : (
                    <span className="text-[9px] text-neutral-600 mt-1 block">Browser cookies format (Netscape) or directory. Required for age-restricted content.</span>
                  )}
                </div>

                <div className="mt-3">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input type="checkbox" checked={customOutput}
                      onChange={e => setCustomOutput(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-neutral-600 bg-neutral-800 text-cyan-500 focus:ring-cyan-500/30 focus:ring-offset-0 cursor-pointer" />
                    <span className="text-[10px] text-neutral-500 font-semibold uppercase tracking-wider group-hover:text-neutral-300 transition-colors">Simpan ke /home/CATIAA/homelab/Y/</span>
                  </label>
                  {customOutput && (
                    <p className="text-[10px] text-cyan-400/70 mt-1 ml-5 font-mono">
                      → /home/CATIAA/homelab/Y/{(() => {
                        const u = url.trim().replace(/^@/, '');
                        const a = twitterMode === 'account'
                          ? u.replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//, '').replace(/\/.*$/, '') || '<akun>'
                          : u.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([^\/?#]+)/)?.[1] || '<akun>';
                        return a;
                      })()}/
                      <span className="text-neutral-600">(video + gambar)</span>
                    </p>
                  )}
                </div>
              </>
            )}
{source === 'instagram' && (
  <div className="mt-3">
    <span className="text-[10px] text-neutral-600 font-semibold uppercase tracking-wider mb-1.5 block">Cookies Path (optional)</span>
    <input type="text" value={twitterCookiesPath}
      onChange={e => setTwitterCookiesPath(e.target.value)}
      placeholder="/home/CATIAA/homelab-media-server/cookies.txt"
      className="w-full bg-[#0d1117] text-neutral-300 text-sm px-3 py-2 rounded-lg border border-[#2a3340] focus:outline-none focus:border-cyan-500/30 placeholder:text-neutral-600" />
    {twitterCookiesPath ? (
      <span className="text-[9px] text-neutral-400 mt-1 block">Saved: {twitterCookiesPath}</span>
    ) : (
      <span className="text-[9px] text-neutral-600 mt-1 block">Diperlukan untuk konten age-restricted/private.</span>
    )}
  </div>
)}

{source !== 'torrent' && (
  <label className="flex items-center gap-2 cursor-pointer group mt-3">
    <input type="checkbox" checked={embedCover}
      onChange={e => setEmbedCover(e.target.checked)}
      className="w-3.5 h-3.5 rounded border-neutral-600 bg-neutral-800 text-cyan-500 focus:ring-cyan-500/30 focus:ring-offset-0 cursor-pointer" />
    <span className="text-[10px] text-neutral-500 font-semibold uppercase tracking-wider group-hover:text-neutral-300 transition-colors">Embed cover</span>
    {embedCover && <span className="text-[9px] text-cyan-500/70">thumbnail dari sumber akan di-embed</span>}
  </label>
)}
</div>

          {error && (
            <div className="text-[11px] text-red-400 mt-3 flex items-start gap-2 bg-red-500/5 rounded-lg px-3 py-2 border border-red-500/10">
              <X size={12} className="flex-shrink-0 mt-0.5" />
              <span className="leading-relaxed">{error}</span>
            </div>
          )}
          {cachedMsg && (
            <div className="text-[11px] text-green-400 mt-3 flex items-center gap-1 bg-green-500/5 rounded-lg px-3 py-2">
              {cachedMsg}
            </div>
          )}
        </div>

        {/* Concurrency + Stats */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Settings size={12} className="text-neutral-600" />
            <span className="text-[10px] text-neutral-600 font-semibold uppercase tracking-wider">Concurrent:</span>
            {[1, 2, 3, 5].map(n => (
              <button key={n} onClick={() => updateConcurrency(n)}
                className={`w-6 h-6 rounded text-[10px] font-bold transition-all ${
                  maxConcurrent === n
                    ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/25'
                    : 'text-neutral-600 border border-transparent hover:text-neutral-400'
                }`}>
                {n}
              </button>
            ))}
          </div>
          <div className="text-[10px] text-neutral-600 font-mono">
            {activeTasks.filter(t => t.status === 'downloading').length}/{maxConcurrent} running
            {activeTasks.filter(t => t.status === 'queued').length > 0 && ` · ${activeTasks.filter(t => t.status === 'queued').length} queued`}
          </div>
        </div>

        {/* Empty State */}
        {tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-neutral-600">
            <div className="w-14 h-14 mb-4 rounded-2xl bg-neutral-800/50 border border-[#1e2530] flex items-center justify-center">
              <Download size={22} className="text-neutral-500" />
            </div>
            <p className="text-sm text-neutral-500 mb-1">Belum ada unduhan</p>
            <p className="text-xs text-neutral-600">Pilih sumber, paste URL, tekan Detect untuk lihat opsi, lalu Download</p>
          </div>
        )}

        {/* Active Downloads */}
        {activeTasks.length > 0 && (
          <div>
            <h2 className="text-xs text-neutral-600 font-semibold uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
              Downloading ({activeTasks.length})
            </h2>
            <div className="space-y-2" data-debug-id="3.1.7" data-debug-name="DownloadQueue" data-debug-type="list">
              {activeTasks.map(t => (
                <TaskCard key={t.id} task={t} onCancel={cancelTask} onRemove={removeTask} onRetry={retryTask} />
              ))}
            </div>
          </div>
        )}

        {/* History */}
        {doneTasks.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2.5 flex-wrap">
              <h2 className="text-xs text-neutral-600 font-semibold uppercase tracking-wider flex items-center gap-1.5">
                <RotateCcw size={12} /> History ({doneTasks.length})
              </h2>
              <div className="flex items-center gap-1">
                <button
                  onClick={retryFailed}
                  disabled={failedTasks.length === 0}
                  className="px-2 py-1 text-[10px] rounded border border-neutral-800 text-neutral-500 hover:text-neutral-200 hover:border-neutral-700 disabled:opacity-40"
                  title="Retry all failed tasks"
                >
                  Retry Failed ({failedTasks.length})
                </button>
                <button
                  onClick={clearCompleted}
                  className="px-2 py-1 text-[10px] rounded border border-neutral-800 text-neutral-500 hover:text-neutral-200 hover:border-neutral-700"
                  title="Remove all completed tasks"
                >
                  Clear Completed
                </button>
              </div>
              <div className="flex items-center gap-1 ml-auto">
                {SORT_OPTIONS.map(opt => (
                  <button key={opt.key} onClick={() => {
                    if (sortBy === opt.key) setSortAsc(!sortAsc);
                    else { setSortBy(opt.key); setSortAsc(false); }
                  }}
                    className={`px-2 py-0.5 text-[9px] rounded font-medium transition-all ${
                      sortBy === opt.key
                        ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                        : 'text-neutral-600 border border-transparent hover:text-neutral-400'
                    }`}>
                    {opt.label} {sortBy === opt.key && (sortAsc ? '↑' : '↓')}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              {sortedDone.map(t => (
                <TaskCard key={t.id} task={t} onCancel={cancelTask} onRemove={removeTask} onRetry={retryTask} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const QUALITY_LABELS = {
  audio: 'Audio', best: 'Best', standard: 'Standard',
  '2160p': '4K', '1440p': '2K', '1080p': '1080p',
  '720p': '720p', '480p': '480p', '360p': '360p',
};

function fmtDuration(sec) {
  if (!sec || sec <= 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtViews(n) {
  if (n == null) return '';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B views`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M views`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K views`;
  return `${n} views`;
}

function fmtDate(d) {
  if (!d || d.length < 8) return '';
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

function MetadataPreview({ data, onTitleChange }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(data.title || '');
  const [thumbLoaded, setThumbLoaded] = useState(false);
  const [thumbError, setThumbError] = useState(false);
  const titleInputRef = useRef(null);

  useEffect(() => { setTitle(data.title || ''); setEditing(false); setThumbLoaded(false); setThumbError(false); }, [data?.title, data?.thumbnail]);

  useEffect(() => {
    if (editing && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editing]);

  const hasThumb = data.thumbnail && data.thumbnail.length > 0 && !thumbError;
  const duration = fmtDuration(data.duration);
  const uploadDate = fmtDate(data.uploadDate);
  const views = fmtViews(data.viewCount);

  return (
    <div className="mb-3 rounded-xl bg-[#111418] border border-[#1e2530] overflow-hidden">
      {/* Thumbnail — 16:9 aspect ratio, full width */}
      <div className="relative w-full aspect-video bg-neutral-900 rounded-t-xl overflow-hidden">
        {!thumbLoaded && hasThumb && (
          <div className="absolute inset-0 bg-neutral-800 animate-pulse flex items-center justify-center">
            <Loader size={20} className="text-neutral-600 animate-spin" />
          </div>
        )}
        {!hasThumb && (
          <div className="absolute inset-0 flex items-center justify-center bg-neutral-900">
            <Image size={32} className="text-neutral-700" />
            <span className="text-[10px] text-neutral-600 ml-2">No thumbnail</span>
          </div>
        )}
        {hasThumb && (
          <img
            src={data.thumbnail}
            alt="thumbnail"
            className={`w-full h-full object-cover transition-opacity duration-300 ${thumbLoaded ? 'opacity-100' : 'opacity-0'}`}
            onLoad={() => setThumbLoaded(true)}
            onError={() => setThumbError(true)}
          />
        )}
        {duration && (
          <div className="absolute bottom-2 right-2 bg-black/80 text-white text-[11px] font-mono px-1.5 py-0.5 rounded font-semibold">
            {duration}
          </div>
        )}
        <span className="absolute top-2 left-2 text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/90 text-white font-semibold uppercase tracking-wider">Preview</span>
      </div>

      {/* Metadata below thumbnail */}
      <div className="p-3 space-y-2">
        {/* Title — editable */}
        {editing ? (
          <input
            ref={titleInputRef}
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={() => { setEditing(false); onTitleChange?.(title); }}
            onKeyDown={e => { if (e.key === 'Enter') { setEditing(false); onTitleChange?.(title); } }}
            className="text-sm font-semibold text-cyan-300 bg-[#0d1117] border border-cyan-500/20 rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500/40 w-full"
          />
        ) : (
          <div
            className="text-sm font-semibold text-neutral-100 cursor-pointer hover:text-cyan-300 transition-colors leading-snug"
            onClick={() => setEditing(true)}
            title="Click to edit filename"
          >
            {title || data.title}
            <span className="text-[9px] text-neutral-600 ml-2 font-normal">(click to edit)</span>
          </div>
        )}

        {/* Channel + metadata row */}
        <div className="flex items-center gap-3 text-[11px] text-neutral-500 flex-wrap">
          {(data.channel || data.uploader) && (
            <div className="flex items-center gap-1.5">
              <User size={10} className="text-neutral-600" />
              <span className="text-neutral-400 font-medium">{data.channel || data.uploader}</span>
            </div>
          )}
          {views && <span>{views}</span>}
          {uploadDate && <span>{uploadDate}</span>}
        </div>

        {/* Description preview */}
        {data.description && (
          <div className="text-[10px] text-neutral-600 line-clamp-2 leading-relaxed">
            {data.description}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskCard({ task, onCancel, onRemove, onRetry }) {
  const isActive = task.status === 'downloading' || task.status === 'queued';
  const isFailed = task.status === 'failed';
  const src = SOURCES.find(s => s.id === task.category);
  const Logo = src?.Logo;
  const srcColor = CAT_ICON_COLORS[task.category] || 'bg-neutral-800 text-neutral-500';
  const showQuality = task.quality && task.quality !== 'best' && task.quality !== 'standard';
  const logRef = useRef(null);

  useLayoutEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [task.logs]);

  return (
    <div className="bg-[#111418] border border-[#1e2530] rounded-xl overflow-hidden hover:border-neutral-700 transition-colors" data-debug-id="3.1.7.1" data-debug-name="QueueItem" data-debug-type="card">
      <div className="p-4">
        <div className="flex items-start gap-3.5">
          <div className={`p-2.5 rounded-xl mt-0.5 flex-shrink-0 ${srcColor}`}>
            {Logo && <Logo className="w-4 h-4" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm font-semibold truncate max-w-[300px] ${
                task.status === 'downloading' ? 'text-cyan-300' :
                task.status === 'completed' ? 'text-green-300' :
                task.status === 'failed' ? 'text-red-300' :
                task.status === 'cancelled' ? 'text-neutral-500' : 'text-yellow-300'
              }`}>
                {task.filename || task.url.split('/').pop() || task.url.substring(0, 60)}
              </span>
              {task.category && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${srcColor}`}>
                  {src?.label || task.category}
                </span>
              )}
              {showQuality && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-neutral-700/50 text-neutral-400 font-mono flex-shrink-0">
                  {QUALITY_LABELS[task.quality] || task.quality}
                </span>
              )}
              {task.formatId && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-900/30 text-cyan-500 font-mono flex-shrink-0">
                  {task.formatId}
                </span>
              )}
              {task.audioExtract && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-900/30 text-amber-500 font-mono flex-shrink-0">
                  {task.audioFormat}{task.audioBitrate !== 'best' ? ` ${task.audioBitrate}` : ''}
                </span>
              )}
              <span className={`text-[10px] px-2.5 py-0.5 rounded-full uppercase font-semibold border flex-shrink-0 ${STATUS_COLORS[task.status] || 'bg-neutral-800 text-neutral-500'}`}>
                {task.status}
              </span>
              {task.retryCount > 0 && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 flex-shrink-0">
                  retry {task.retryCount}/{task.maxRetries || 3}
                </span>
              )}
              {task.lastError && isFailed && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded flex-shrink-0 border ${
                  task.lastError.toLowerCase().includes('network') || task.lastError.toLowerCase().includes('timeout')
                    ? 'bg-orange-500/10 text-orange-400 border-orange-500/20'
                    : 'bg-red-500/10 text-red-400 border-red-500/20'
                }`}>
                  {task.lastError.toLowerCase().includes('network') || task.lastError.toLowerCase().includes('timeout') ? 'Network' : 'Content'}
                </span>
              )}
            </div>
            <div className="text-[10px] text-neutral-600 truncate mt-1 font-mono">{task.url}</div>

            {task.totalSize && !isActive && (
              <div className="text-[10px] text-neutral-500 mt-0.5 font-mono">{task.totalSize}</div>
            )}

            {task.outputDir && !isActive && (
              <div className="text-[10px] text-neutral-600 mt-0.5 truncate font-mono">
                {task.outputDir}/{task.filename || ''}
              </div>
            )}

            {isActive && (
              <div className="mt-3">
                {task.logs && task.logs.length > 0 && (
                  <div className="mb-2">
                    <pre ref={logRef} className="text-[10px] text-cyan-400/70 bg-[#0d1117] rounded-lg p-2 h-20 overflow-y-auto font-mono whitespace-pre-wrap break-words">
                      {task.logs.map((log, i) => <div key={i}>{log}</div>)}
                    </pre>
                  </div>
                )}
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Loader size={10} className="text-cyan-500 animate-spin flex-shrink-0" />
                  <span className="text-[10px] text-cyan-400/70 truncate">{task.statusText}</span>
                </div>
                <div className="h-2 bg-neutral-800/80 rounded-full overflow-hidden" data-debug-id="3.1.7.2" data-debug-name="ProgressBar" data-debug-type="chart">
                  <div className={`h-full rounded-full transition-all duration-300 ease-out ${BAR_COLORS[task.status]}`}
                    style={{ width: `${task.progress || 0}%` }} />
                </div>
                <div className="flex items-center justify-between mt-1.5 text-[10px]" data-debug-id="3.1.7.3" data-debug-name="SpeedEta" data-debug-type="other">
                  <span className="text-neutral-400 font-mono tabular-nums">{task.progress.toFixed(1)}%</span>
                  <div className="flex items-center gap-3">
                    {task.speed && <span className="text-neutral-500 font-mono tabular-nums">{task.speed}</span>}
                    {task.eta && <span className="text-neutral-600 font-mono tabular-nums">ETA {task.eta}</span>}
                  </div>
                </div>
              </div>
            )}

            {isFailed && task.error && (
              <div className="text-[10px] text-red-400 mt-2 bg-red-500/5 rounded-lg px-3 py-1.5">{task.error}</div>
            )}

            {isFailed && task.retryHistory?.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {task.retryHistory.slice(-3).map((r, i) => (
                  <div key={i} className="text-[9px] text-neutral-600 font-mono flex items-center gap-1.5">
                    <span className="text-yellow-500/70">#{r.attempt}</span>
                    <span className="truncate">{r.error?.substring(0, 60)}</span>
                    <span className="text-neutral-700 flex-shrink-0">{new Date(r.timestamp).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            )}

            {(task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') && task.completedAt && (
              <div className="text-[10px] text-neutral-600 mt-1.5">
                {task.status === 'completed' ? 'Selesai' : task.status === 'failed' ? 'Gagal' : 'Dibatalkan'}{' '}
                {new Date(task.completedAt).toLocaleString()}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            {isActive && (
              <button onClick={() => onCancel(task.id)}
                className="p-2 text-neutral-600 hover:text-red-400 rounded-lg hover:bg-red-500/10 transition-colors" title="Cancel"
                data-debug-id="3.1.7.4"
                data-debug-name="CancelButton"
                data-debug-type="other">
                <X size={14} />
              </button>
            )}
            {isFailed && (
              <button onClick={() => onRetry(task.id)}
                className="p-2 text-neutral-600 hover:text-cyan-400 rounded-lg hover:bg-cyan-500/10 transition-colors" title="Retry">
                <RefreshCw size={14} />
              </button>
            )}
            <button onClick={() => onRemove(task.id)}
              className="p-2 text-neutral-600 hover:text-neutral-400 rounded-lg hover:bg-neutral-800/50 transition-colors" title="Remove">
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
