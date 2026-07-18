import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { fork } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../../data/media.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Performance Pragmas
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('temp_store = MEMORY');
db.pragma('cache_size = -80000'); // ~80MB cache — sufficient for 112K files
db.pragma('mmap_size = 4294967296'); // 4GB — prevents kernel over-mapping
db.pragma('page_size = 32768'); // Larger page size for better sequential I/O

// Schema - Clean rebuild with deterministic sorting
db.exec(`
  CREATE TABLE IF NOT EXISTS folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    parent_id INTEGER,
    depth INTEGER DEFAULT 0,
    file_count INTEGER DEFAULT 0,
    total_size INTEGER DEFAULT 0,
    last_scanned INTEGER,
    last_updated INTEGER
  );

  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    dir_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    ext TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    mtime INTEGER NOT NULL DEFAULT 0,
    duration REAL DEFAULT 0,
    has_thumb INTEGER DEFAULT 0,
    thumb_cache_path TEXT,
    last_accessed INTEGER DEFAULT 0,
    access_count INTEGER DEFAULT 0,
    last_verified INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT 0,
    codec_info TEXT,
    is_stream_compatible INTEGER DEFAULT 0,
    youtube_id TEXT,
    video_offset REAL DEFAULT 0
  );
`);

// FTS setup is deferred — called after server.listen() to avoid blocking startup
let ftsReady = false;

export function setupFTS() {
  if (ftsReady) return Promise.resolve();
  return new Promise((resolve) => {
    const workerPath = join(__dirname, 'fts-rebuild-worker.mjs');
    const child = fork(workerPath, [DB_PATH], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], timeout: 120000 });
    let stderr = '';
    child.stderr?.on('data', d => { stderr += d; });
  child.on('message', (msg) => {
    if (msg.type === 'progress') {
      console.log(`[db] FTS rebuild: ${msg.done}/${msg.total}`);
    } else if (msg.type === 'done') {
      if (msg.ok) {
        ftsReady = true;
        console.log(`[db] FTS setup complete via worker (${msg.reason || msg.count + ' entries'})`);
      } else {
        console.error('[db] FTS worker failed:', msg.error || stderr);
        deltaSyncFTS();
      }
      resolve();
    }
  });
  child.on('error', (e) => {
    console.error('[db] FTS worker spawn error:', e.message);
    deltaSyncFTS();
    resolve();
  });
  child.on('exit', (code) => {
    if (!ftsReady) {
      console.error('[db] FTS worker exited with code', code, stderr.slice(0, 200));
      deltaSyncFTS();
      resolve();
    }
  });
  });
}

function deltaSyncFTS() {
  try {
    const ftsExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='files_fts'").get();
    if (!ftsExists) {
      db.exec(`CREATE VIRTUAL TABLE files_fts USING fts5(name, content='files', tokenize='unicode61 remove_diacritics 1')`);
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
          INSERT INTO files_fts(rowid, name) VALUES (NEW.rowid, NEW.name);
        END;
        CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
          INSERT INTO files_fts(files_fts, rowid, name) VALUES('delete', OLD.rowid, OLD.name);
        END;
        CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE ON files BEGIN
          INSERT INTO files_fts(files_fts, rowid, name) VALUES('delete', OLD.rowid, OLD.name);
          INSERT INTO files_fts(rowid, name) VALUES (NEW.rowid, NEW.name);
        END;
      `);
    }
    const total = db.prepare('SELECT COUNT(*) as cnt FROM files').get().cnt;
    if (total === 0) {
      db.exec('DELETE FROM files_fts');
      ftsReady = true;
      console.log('[db] FTS delta sync: empty DB');
      return;
    }

    // Only insert missing rowids — never wipe
    const missing = db.prepare(
      `SELECT COUNT(*) as cnt FROM files f WHERE f.rowid NOT IN (SELECT rowid FROM files_fts)`
    ).get().cnt;

    if (missing > 0) {
      db.prepare(
        `INSERT INTO files_fts(rowid, name) SELECT f.rowid, f.name FROM files f WHERE f.rowid NOT IN (SELECT rowid FROM files_fts)`
      ).run();
    }

    // Clean orphans
    const orphanCount = db.prepare(
      `SELECT COUNT(*) as cnt FROM files_fts WHERE rowid NOT IN (SELECT rowid FROM files)`
    ).get().cnt;
    if (orphanCount > 0) {
      db.prepare(`DELETE FROM files_fts WHERE rowid NOT IN (SELECT rowid FROM files)`).run();
    }

    ftsReady = true;
    console.log(`[db] FTS delta sync complete: +${missing} inserted, ${orphanCount} orphans removed`);
  } catch (e) {
    console.error('[db] FTS delta sync error:', e.message);
  }
}

// Manual FTS sync function (called after bulk file operations)
export function syncFTSIndex() {
  return new Promise((resolve) => {
    try {
      const count = db.prepare('SELECT COUNT(*) as cnt FROM files').get();
      const ftsCount = db.prepare('SELECT COUNT(*) as cnt FROM files_fts').get();
      
      if (count.cnt !== ftsCount.cnt) {
        console.log('[db] FTS out of sync, rebuilding via worker...');
        const workerPath = join(__dirname, 'fts-rebuild-worker.mjs');
        const child = fork(workerPath, [DB_PATH], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'], timeout: 120000 });
        child.on('message', (msg) => {
          if (msg.type === 'done') {
            if (msg.ok) console.log('[db] FTS sync complete via worker');
            else console.error('[db] FTS sync worker failed:', msg.error);
            resolve();
          }
        });
        child.on('error', () => { fallbackSyncFTS(); resolve(); });
        child.on('exit', () => resolve());
      } else {
        resolve();
      }
    } catch(e) {
      console.error('[db] FTS sync error:', e.message);
      resolve();
    }
  });
}

// Settings table for runtime configuration
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'string',
    category TEXT NOT NULL DEFAULT 'general',
    label TEXT NOT NULL DEFAULT '',
    description TEXT DEFAULT '',
    options TEXT,
    updated_at INTEGER NOT NULL DEFAULT 0
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS settings_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setting_key TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    type TEXT NOT NULL DEFAULT 'string',
    action TEXT NOT NULL DEFAULT 'update',
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (setting_key) REFERENCES settings(key)
  )
`);

// Send counter table for Telegram separator logic
db.exec(`
  CREATE TABLE IF NOT EXISTS send_counters (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    telegram_count INTEGER NOT NULL DEFAULT 0
  )
`);
try { db.prepare('ALTER TABLE send_counters ADD COLUMN whatsapp_count INTEGER NOT NULL DEFAULT 0').run(); } catch(e) {}
db.prepare('INSERT OR IGNORE INTO send_counters (id, telegram_count, whatsapp_count) VALUES (1, 0, 0)').run();

// Rate-limit state for outbound send scheduler
db.exec(`
  CREATE TABLE IF NOT EXISTS send_rate_limit (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    date TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    last_send_at INTEGER NOT NULL DEFAULT 0
  )
`);
db.prepare("INSERT OR IGNORE INTO send_rate_limit (id, date, count, last_send_at) VALUES (1, '', 0, 0)").run();

// Pending outbound sends awaiting rate-limit window
db.exec(`
CREATE TABLE IF NOT EXISTS send_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id TEXT NOT NULL,
    target TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    hold_until INTEGER NOT NULL DEFAULT 0,
    completed_at INTEGER
  )
`);
  db.prepare('CREATE INDEX IF NOT EXISTS idx_send_queue_status ON send_queue(status)').run();
  try { db.prepare('ALTER TABLE send_queue ADD COLUMN debug INTEGER NOT NULL DEFAULT 0').run(); } catch (e) {}
  try { db.prepare('ALTER TABLE send_queue ADD COLUMN completed_at INTEGER').run(); } catch (e) {}
  try { db.prepare('ALTER TABLE send_queue ADD COLUMN caption TEXT NOT NULL DEFAULT \'\'').run(); } catch (e) {}
  try { db.prepare('ALTER TABLE send_queue ADD COLUMN sort_order INTEGER').run(); } catch (e) {}
  try { db.prepare('ALTER TABLE send_queue ADD COLUMN scheduled_at INTEGER').run(); } catch (e) {}
  // Initialize sort_order for existing rows that have NULL
  db.prepare("UPDATE send_queue SET sort_order = id WHERE sort_order IS NULL").run();

// Queue behaviour settings (auto-send tick + debug hold mode). Survives restarts.
db.exec(`
  CREATE TABLE IF NOT EXISTS send_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    tick_enabled INTEGER NOT NULL DEFAULT 1,
    debug_mode INTEGER NOT NULL DEFAULT 0,
    share_only_target TEXT
  )
`);
db.prepare('INSERT OR IGNORE INTO send_settings (id, tick_enabled, debug_mode) VALUES (1, 1, 0)').run();
try { db.prepare('ALTER TABLE send_settings ADD COLUMN share_only_target TEXT').run(); } catch (e) {}
try { db.prepare('ALTER TABLE send_settings ADD COLUMN per_day INTEGER NOT NULL DEFAULT 3').run(); } catch (e) {}

// Telegram chats authorized to trigger downloads via the bot
db.exec(`
  CREATE TABLE IF NOT EXISTS telegram_allowed_chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL
  )
`);

// Maps a Telegram user link-message to the download tasks it spawned (survives restarts)
db.exec(`
  CREATE TABLE IF NOT EXISTS telegram_bot_tasks (
    user_msg_id INTEGER PRIMARY KEY,
    chat_id TEXT NOT NULL,
    queued_msg_id INTEGER,
    task_ids TEXT NOT NULL,
    total INTEGER NOT NULL DEFAULT 0,
    finished INTEGER NOT NULL DEFAULT 0,
    cleaned INTEGER NOT NULL DEFAULT 0
  )
`);

// Reverse map: download task id -> originating Telegram user message id
db.exec(`
  CREATE TABLE IF NOT EXISTS telegram_task_link (
    task_id INTEGER PRIMARY KEY,
    user_msg_id INTEGER NOT NULL
  )
`);

// Ephemeral Telegram messages (download result logs) that auto-delete after a TTL
db.exec(`
  CREATE TABLE IF NOT EXISTS telegram_ephemeral (
    msg_id INTEGER PRIMARY KEY,
    chat_id TEXT NOT NULL,
    delete_at INTEGER NOT NULL
  )
`);

// Processed Telegram message ids (restart-safe dedupe)
db.exec(`
  CREATE TABLE IF NOT EXISTS telegram_processed (
    msg_id INTEGER PRIMARY KEY,
    ts INTEGER NOT NULL
  )
`);

// Deferred DB init — runs after server.listen() to avoid blocking startup
export function deferredDbInit() {
  const t0 = Date.now();

  // Seed default settings if empty
  const settingCount = db.prepare('SELECT COUNT(*) as cnt FROM settings').get().cnt;
  if (settingCount === 0) {
    const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value, type, category, label, description, options, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const now = Date.now();
    const defaults = [
      ['app.compact', 'false', 'boolean', 'general', 'Compact Mode', 'Reduce spacing for dense content', null, now],
      ['app.animations', 'true', 'boolean', 'general', 'Animations', 'Enable UI animations and transitions', null, now],
      ['perf.initialLimit', '500', 'number', 'performance', 'Initial Load Limit', 'Number of files to load per page', null, now],
      ['perf.virtualization', 'true', 'boolean', 'performance', 'Virtualization', 'Use virtualized rendering for large lists', null, now],
      ['perf.thumbQuality', '10', 'number', 'performance', 'Thumbnail Quality', 'JPEG quality (1-31, lower=better)', null, now],
      ['perf.adaptiveMobile', 'true', 'boolean', 'performance', 'Adaptive Mobile Mode', 'Auto-detect mobile and optimize', null, now],
      ['monitor.refreshInterval', '1000', 'number', 'monitoring', 'Refresh Interval (ms)', 'How often monitoring stats refresh', null, now],
      ['monitor.uiSmooth', 'true', 'boolean', 'monitoring', 'Smooth Animations', 'Smooth gauge animation between updates', null, now],
      ['monitor.uiSmoothMs', '900', 'number', 'monitoring', 'Smooth Duration (ms)', 'Gauge smoothing duration in milliseconds', null, now],
      ['monitor.netTargets', '[]', 'json', 'monitoring', 'Network Targets', 'Saved iperf3 targets (JSON array of {name,host,port})', null, now],
      ['monitor.cpu', 'true', 'boolean', 'monitoring', 'CPU Metrics', 'Show CPU usage in monitoring', null, now],
      ['monitor.ram', 'true', 'boolean', 'monitoring', 'RAM Metrics', 'Show RAM usage in monitoring', null, now],
      ['monitor.gpu', 'true', 'boolean', 'monitoring', 'GPU Metrics', 'Show GPU usage in monitoring', null, now],
      ['monitor.disk', 'true', 'boolean', 'monitoring', 'Disk Metrics', 'Show Disk usage in monitoring', null, now],
      ['monitor.network', 'true', 'boolean', 'monitoring', 'Network Metrics', 'Show Network usage in monitoring', null, now],
      ['scan.mode', 'balanced', 'enum', 'scanner', 'Scan Mode', 'Scan speed vs thoroughness', JSON.stringify({enum: ['fast', 'balanced', 'full']}), now],
      ['scan.recursive', 'true', 'boolean', 'scanner', 'Recursive Scan', 'Scan subdirectories recursively', null, now],
      ['scan.incremental', 'true', 'boolean', 'scanner', 'Incremental Scan', 'Only scan changed files', null, now],
      ['scan.autoInterval', '0', 'number', 'scanner', 'Auto Rescan Interval (minutes)', '0 = disabled', null, now],
      ['scan.workers', '4', 'number', 'scanner', 'Parallel Workers', 'Number of parallel scan workers', null, now],
      ['thumb.generate', 'true', 'boolean', 'scanner', 'Thumbnail Generation', 'Generate thumbnails during scan', null, now],
      ['thumb.concurrent', '4', 'number', 'scanner', 'Concurrent Thumbnails', 'Max parallel thumbnail generations', null, now],
      ['db.cacheSize', '-200000', 'number', 'database', 'Cache Size (KB)', 'SQLite page cache size (negative = KB)', null, now],
      ['api.compression', 'disabled', 'enum', 'api', 'Compression', 'Response compression mode', JSON.stringify({enum: ['gzip', 'brotli', 'disabled']}), now],
      ['api.rateLimit', '0', 'number', 'api', 'Rate Limit (req/min)', '0 = disabled', null, now],
      ['api.cacheTTL', '86400', 'number', 'api', 'Cache TTL (seconds)', 'Browser cache duration for static assets', null, now],
      ['serve.delivery', 'direct', 'enum', 'serve', 'Delivery Mode', 'File serving strategy', JSON.stringify({enum: ['direct', 'stream', 'hybrid']}), now],
      ['serve.rangeRequests', 'true', 'boolean', 'serve', 'Range Requests', 'Allow byte-range requests for seeking', null, now],
      ['serve.cacheStrategy', 'standard', 'enum', 'serve', 'Cache Strategy', 'How to cache served files', JSON.stringify({enum: ['standard', 'aggressive', 'minimal', 'none']}), now],
      ['serve.transcode', 'false', 'boolean', 'serve', 'Transcoding', 'Transcode non-compatible formats on the fly', null, now],
      ['render.virtualization', 'true', 'boolean', 'render', 'Virtualization', 'Use virtualized rendering for large lists', null, now],
      ['render.chunkSize', '50', 'number', 'render', 'Chunk Size', 'Items per render chunk', null, now],
      ['render.overscan', '5', 'number', 'render', 'Overscan', 'Extra rows rendered outside viewport', null, now],
      ['render.lazyImages', 'true', 'boolean', 'render', 'Lazy Images', 'Lazy load images outside viewport', null, now],
      ['render.reduceAnimations', 'false', 'boolean', 'render', 'Reduce Animations', 'Disable animations on low-end devices', null, now],
      ['render.skeletonUI', 'true', 'boolean', 'render', 'Skeleton UI', 'Show loading skeletons during data fetch', null, now],
      ['render.maxGridColumns', '8', 'number', 'render', 'Max Grid Columns', 'Maximum grid columns in file browser', null, now],
      ['network.keepAlive', '65000', 'number', 'network', 'Keep-Alive (ms)', 'HTTP keep-alive timeout', null, now],
      ['network.maxBodySize', '10', 'number', 'network', 'Max Body Size (MB)', 'Maximum request body size', null, now],
      ['network.maxConnections', '100', 'number', 'network', 'Max Connections', 'Maximum concurrent connections', null, now],
      ['network.streaming', 'buffered', 'enum', 'network', 'Streaming Mode', 'Media streaming strategy', JSON.stringify({enum: ['chunked', 'buffered', 'direct']}), now],
      ['network.trackSessions', 'true', 'boolean', 'network', 'Track Sessions', 'Enable active session tracking', null, now],
      ['network.sessionTimeout', '30', 'number', 'network', 'Session Timeout (min)', 'Inactive session timeout', null, now],
      ['downloader.youtubeCookiesPath', '/home/CATIAA/homelab-media-server/cookies.txt', 'string', 'downloader', 'YouTube Cookies Path', 'Netscape cookies.txt untuk lewati verifikasi bot YouTube. Kosongkan untuk nonaktif.', null, now],
    ];
    const tx = db.transaction(() => {
      for (const row of defaults) {
        insert.run(...row);
      }
    });
    tx();
    console.log('[db] Seeded', defaults.length, 'default settings');
  }

  // Ensure all default settings exist (safe for existing DBs with partial data)
  const ensureInsert = db.prepare('INSERT OR IGNORE INTO settings (key, value, type, category, label, description, options, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const migrateTime = Date.now();
  const migrationDefaults = [
    ['monitor.refreshInterval', '1000', 'number', 'monitoring', 'Refresh Interval (ms)', 'How often monitoring stats refresh', null, migrateTime],
    ['monitor.uiSmooth', 'true', 'boolean', 'monitoring', 'Smooth Animations', 'Smooth gauge animation between updates', null, migrateTime],
    ['monitor.uiSmoothMs', '900', 'number', 'monitoring', 'Smooth Duration (ms)', 'Gauge smoothing duration in milliseconds', null, migrateTime],
    ['monitor.netTargets', '[]', 'json', 'monitoring', 'Network Targets', 'Saved iperf3 targets (JSON array of {name,host,port})', null, migrateTime],
    ['serve.delivery', 'direct', 'enum', 'serve', 'Delivery Mode', 'File serving strategy', JSON.stringify({enum: ['direct', 'stream', 'hybrid']}), migrateTime],
    ['serve.rangeRequests', 'true', 'boolean', 'serve', 'Range Requests', 'Allow byte-range requests for seeking', null, migrateTime],
    ['serve.cacheStrategy', 'standard', 'enum', 'serve', 'Cache Strategy', 'How to cache served files', JSON.stringify({enum: ['standard', 'aggressive', 'minimal', 'none']}), migrateTime],
    ['serve.transcode', 'false', 'boolean', 'serve', 'Transcoding', 'Transcode non-compatible formats on the fly', null, migrateTime],
    ['render.virtualization', 'true', 'boolean', 'render', 'Virtualization', 'Use virtualized rendering for large lists', null, migrateTime],
    ['render.chunkSize', '50', 'number', 'render', 'Chunk Size', 'Items per render chunk', null, migrateTime],
    ['render.overscan', '5', 'number', 'render', 'Overscan', 'Extra rows rendered outside viewport', null, migrateTime],
    ['render.lazyImages', 'true', 'boolean', 'render', 'Lazy Images', 'Lazy load images outside viewport', null, migrateTime],
    ['render.reduceAnimations', 'false', 'boolean', 'render', 'Reduce Animations', 'Disable animations on low-end devices', null, migrateTime],
    ['render.skeletonUI', 'true', 'boolean', 'render', 'Skeleton UI', 'Show loading skeletons during data fetch', null, migrateTime],
    ['render.maxGridColumns', '8', 'number', 'render', 'Max Grid Columns', 'Maximum grid columns in file browser', null, migrateTime],
    ['network.keepAlive', '65000', 'number', 'network', 'Keep-Alive (ms)', 'HTTP keep-alive timeout', null, migrateTime],
    ['network.maxBodySize', '10', 'number', 'network', 'Max Body Size (MB)', 'Maximum request body size', null, migrateTime],
    ['network.maxConnections', '100', 'number', 'network', 'Max Connections', 'Maximum concurrent connections', null, migrateTime],
    ['network.streaming', 'buffered', 'enum', 'network', 'Streaming Mode', 'Media streaming strategy', JSON.stringify({enum: ['chunked', 'buffered', 'direct']}), migrateTime],
    ['network.trackSessions', 'true', 'boolean', 'network', 'Track Sessions', 'Enable active session tracking', null, migrateTime],
    ['network.sessionTimeout', '30', 'number', 'network', 'Session Timeout (min)', 'Inactive session timeout', null, migrateTime],
    ['upload.enabled', 'true', 'boolean', 'upload', 'Upload Enabled', 'Allow file uploads via web UI', null, migrateTime],
    ['upload.maxSizeGB', '100', 'number', 'upload', 'Max File Size (GB)', 'Maximum single file upload size', null, migrateTime],
    ['upload.concurrent', '4', 'number', 'upload', 'Concurrent Uploads', 'Max parallel uploads', null, migrateTime],
    ['upload.autoScan', 'true', 'boolean', 'upload', 'Auto Scan', 'Auto-run incremental scan after upload', null, migrateTime],
    ['upload.autoThumbnail', 'true', 'boolean', 'upload', 'Auto Thumbnail', 'Generate thumbnail immediately after upload', null, migrateTime],
    ['upload.metadataMode', 'balanced', 'enum', 'upload', 'Metadata Mode', 'Extraction depth: fast/balanced/full', JSON.stringify({enum: ['fast', 'balanced', 'full']}), migrateTime],
    ['upload.duplicateStrategy', 'rename', 'enum', 'upload', 'Duplicate Strategy', 'How to handle duplicate files', JSON.stringify({enum: ['skip', 'overwrite', 'rename']}), migrateTime],
    ['upload.allowedTypes', '*', 'string', 'upload', 'Allowed Types', 'Comma-separated extensions or * for all', null, migrateTime],
    ['dashboard.compact', 'false', 'boolean', 'dashboard', 'Compact Mode', 'Reduce spacing for dense layout', null, migrateTime],
    ['dashboard.showCpu', 'true', 'boolean', 'dashboard', 'Show CPU Widget', 'Show CPU usage on overview', null, migrateTime],
    ['dashboard.showGpu', 'true', 'boolean', 'dashboard', 'Show GPU Widget', 'Show GPU usage on overview', null, migrateTime],
    ['dashboard.showDisk', 'true', 'boolean', 'dashboard', 'Show Disk Widget', 'Show disk usage on overview', null, migrateTime],
    ['dashboard.showNetwork', 'true', 'boolean', 'dashboard', 'Show Network Widget', 'Show network usage on overview', null, migrateTime],
    ['dashboard.showSystem', 'true', 'boolean', 'dashboard', 'Show System Widget', 'Show system info on overview', null, migrateTime],
    ['dashboard.overviewRefresh', '20', 'number', 'dashboard', 'Overview Refresh (s)', 'Overview summary data refresh interval in seconds', null, migrateTime],
    ['dashboard.topBarStats', 'true', 'boolean', 'dashboard', 'Top Bar Stats', 'Show CPU/RAM/Disk in top bar', null, migrateTime],
    ['alerts.enabled', 'true', 'boolean', 'alerts', 'Alerts Enabled', 'Enable threshold-based alerts', null, migrateTime],
    ['alerts.cpuWarn', '80', 'number', 'alerts', 'CPU Warning %', 'CPU usage warning threshold', null, migrateTime],
    ['alerts.cpuCrit', '95', 'number', 'alerts', 'CPU Critical %', 'CPU usage critical threshold', null, migrateTime],
    ['alerts.ramWarn', '80', 'number', 'alerts', 'RAM Warning %', 'RAM usage warning threshold', null, migrateTime],
    ['alerts.ramCrit', '95', 'number', 'alerts', 'RAM Critical %', 'RAM usage critical threshold', null, migrateTime],
    ['alerts.diskWarn', '85', 'number', 'alerts', 'Disk Warning %', 'Disk usage warning threshold', null, migrateTime],
    ['alerts.diskCrit', '95', 'number', 'alerts', 'Disk Critical %', 'Disk usage critical threshold', null, migrateTime],
    ['alerts.tempWarn', '75', 'number', 'alerts', 'CPU Temp Warning °C', 'CPU temperature warning threshold', null, migrateTime],
    ['alerts.tempCrit', '90', 'number', 'alerts', 'CPU Temp Critical °C', 'CPU temperature critical threshold', null, migrateTime],
    ['alerts.gpuTempWarn', '80', 'number', 'alerts', 'GPU Temp Warning °C', 'GPU temperature warning threshold', null, migrateTime],
    ['alerts.gpuTempCrit', '95', 'number', 'alerts', 'GPU Temp Critical °C', 'GPU temperature critical threshold', null, migrateTime],
    ['retention.historyDays', '7', 'number', 'retention', 'History Retention (days)', 'How many days to keep monitoring history', null, migrateTime],
    ['retention.logLines', '5000', 'number', 'retention', 'Max Log Lines', 'Maximum log lines to keep in memory', null, migrateTime],
    ['retention.alertHistory', '100', 'number', 'retention', 'Alert History Count', 'Maximum alert history entries', null, migrateTime],
    ['retention.sessionTimeout', '30', 'number', 'retention', 'Session Timeout (min)', 'Inactive session timeout before cleanup', null, migrateTime],
    ['system.autoRestart', 'false', 'boolean', 'system', 'Auto Restart', 'Auto-restart backend on crash (PM2/systemd)', null, migrateTime],
    ['system.watchdog', 'true', 'boolean', 'system', 'Watchdog', 'Monitor backend health and alert on issues', null, migrateTime],
    ['system.healthCheck', '30', 'number', 'system', 'Health Check (s)', 'Backend health check interval in seconds', null, migrateTime],
    ['system.maxMemoryMB', '0', 'number', 'system', 'Max Memory (MB)', 'Restart if memory exceeds this (0=unlimited)', null, migrateTime],
    ['whatsapp.autoRestart', 'true', 'boolean', 'whatsapp', 'Auto Restart Bot', 'Auto-restart WhatsApp bot on disconnect', null, migrateTime],
    ['whatsapp.maxRetries', '5', 'number', 'whatsapp', 'Max Retries', 'Maximum reconnect attempts before giving up', null, migrateTime],
    ['whatsapp.retryDelay', '10', 'number', 'whatsapp', 'Retry Delay (s)', 'Seconds between reconnect attempts', null, migrateTime],
    ['scanner.watchEnabled', 'true', 'boolean', 'scanner', 'File Watcher', 'Watch for file changes and auto-scan', null, migrateTime],
    ['scanner.debounceMs', '5000', 'number', 'scanner', 'Watch Debounce (ms)', 'Debounce delay for file watcher events', null, migrateTime],
    ['downloader.youtubeCookiesPath', '/home/CATIAA/homelab-media-server/cookies.txt', 'string', 'downloader', 'YouTube Cookies Path', 'Netscape cookies.txt untuk lewati verifikasi bot YouTube. Kosongkan untuk nonaktif.', null, migrateTime],
  ];
  for (const row of migrationDefaults) {
    ensureInsert.run(...row);
  }
  // Remove deprecated settings
  db.prepare("DELETE FROM settings WHERE key = 'app.title'").run();
  console.log('[db] Ensured missing default settings');

  // ─── One-time dedup: remove duplicate folder rows (pre-existing or rare race) ───
  try {
    const badIdRows = db.prepare(`
      SELECT id, path
      FROM folders
      WHERE id NOT IN (
        SELECT MIN(id) FROM folders GROUP BY path
      )
    `).all();
    if (badIdRows.length > 0) {
      console.warn(`[db] Cleaning ${badIdRows.length} duplicate folder rows...`);
      const badIds = badIdRows.map(r => r.id);
      const removeTx = db.transaction(() => {
        // load canonical path→id mapping before any rows are deleted
        const canonical = db.prepare(`
          SELECT MIN(id) as keepId, path FROM folders WHERE id NOT IN (${badIds.map(() => '?').join(',')})
          GROUP BY path
        `).all(...badIds);
        const pathToKeep = {};
        for (const row of canonical) pathToKeep[row.path] = row.keepId;
        // reassign files that point to any duplicate row
        if (badIds.length > 0) {
          const placeholders = badIds.map(() => '?').join(',');
          db.prepare(`UPDATE files SET dir_id = (SELECT id FROM folders WHERE path = (SELECT path FROM folders WHERE id = files.dir_id) ORDER BY id ASC LIMIT 1) WHERE dir_id IN (${placeholders})`).run(...badIds);
          db.prepare(`DELETE FROM folders WHERE id IN (${placeholders})`).run(...badIds);
        }
      });
      removeTx();
      console.log(`[db] Removed ${badIds.length} duplicate folder rows`);
    }
  } catch (e) {
    console.warn('[db] Dedup cleanup skipped:', e.message);
  }

  // Apply dynamic cache_size from settings
  const cacheSize = db.prepare("SELECT value FROM settings WHERE key = 'db.cacheSize'").pluck().get();
  if (cacheSize) {
    db.pragma(`cache_size = ${cacheSize}`);
  }

  // Add missing columns if they don't exist (for existing DBs)
  try { db.prepare('ALTER TABLE files ADD COLUMN thumb_cache_path TEXT').run(); } catch(e) {}
  try { db.prepare('ALTER TABLE files ADD COLUMN codec_info TEXT').run(); } catch(e) {}
  try { db.prepare('ALTER TABLE files ADD COLUMN is_stream_compatible INTEGER DEFAULT 0').run(); } catch(e) {}
  try { db.prepare('ALTER TABLE files ADD COLUMN uploader_metadata TEXT').run(); } catch(e) {}
  try { db.prepare('ALTER TABLE files ADD COLUMN checksum TEXT').run(); } catch(e) {}
  try { db.prepare('ALTER TABLE files ADD COLUMN created_at_embedded INTEGER').run(); } catch(e) {}
  try { db.prepare('ALTER TABLE files ADD COLUMN modified_at_fs INTEGER').run(); } catch(e) {}
  try { db.prepare('ALTER TABLE files ADD COLUMN uploaded_at INTEGER').run(); } catch(e) {}
  try { db.prepare('ALTER TABLE files ADD COLUMN metadata_source TEXT').run(); } catch(e) {}
  try { db.prepare('ALTER TABLE files ADD COLUMN title TEXT').run(); } catch(e) {}
  try { db.prepare('ALTER TABLE files ADD COLUMN artist TEXT').run(); } catch(e) {}
  try { db.prepare('ALTER TABLE files ADD COLUMN album TEXT').run(); } catch(e) {}
  try { db.prepare('ALTER TABLE files ADD COLUMN genre TEXT').run(); } catch(e) {}
  try { db.prepare('ALTER TABLE files ADD COLUMN lyrics TEXT').run(); } catch(e) {}
  try { db.prepare('ALTER TABLE files ADD COLUMN lyrics_synced TEXT').run(); } catch(e) {}
  try { db.prepare('ALTER TABLE files ADD COLUMN lyrics_romaji TEXT').run(); } catch(e) {}
  try { db.prepare('ALTER TABLE files ADD COLUMN cover_source TEXT').run(); } catch(e) {}
  try { db.prepare('ALTER TABLE files ADD COLUMN is_favorite INTEGER DEFAULT 0').run(); } catch(e) {}
  try { db.prepare('CREATE INDEX IF NOT EXISTS idx_files_favorite ON files(is_favorite DESC, id)').run(); } catch(e) {}
  try { db.prepare("ALTER TABLE files ADD COLUMN youtube_id TEXT").run(); } catch(e) {}
  try { db.prepare("ALTER TABLE files ADD COLUMN video_offset REAL DEFAULT 0").run(); } catch(e) {}
  try { db.prepare('ALTER TABLE folders ADD COLUMN recursive_file_count INTEGER').run(); } catch(e) {}
  try { db.prepare('ALTER TABLE folders ADD COLUMN recursive_total_size INTEGER').run(); } catch(e) {}
  try { db.prepare("UPDATE folders SET recursive_file_count = NULL WHERE recursive_file_count = 0").run(); } catch(e) {}
  try { db.prepare("UPDATE folders SET recursive_total_size = NULL WHERE recursive_total_size = 0").run(); } catch(e) {}

  // Fix .webm files misclassified as video (YouTube audio downloads)
  try { db.prepare("UPDATE files SET type = 'audio' WHERE ext = '.webm' AND type = 'video'").run(); } catch(e) {}

  // Create deterministic indexes for stable sorting with tie-breakers
  try { db.prepare('CREATE INDEX IF NOT EXISTS idx_files_cursor ON files(dir_id, created_at DESC, id DESC)').run(); } catch(e) {}
  try { db.prepare('CREATE INDEX IF NOT EXISTS idx_files_name ON files(dir_id, name COLLATE NOCASE, id)').run(); } catch(e) {}
  try { db.prepare('CREATE INDEX IF NOT EXISTS idx_files_mtime ON files(dir_id, mtime DESC, id)').run(); } catch(e) {}
  try { db.prepare('CREATE INDEX IF NOT EXISTS idx_files_size ON files(dir_id, size DESC, id)').run(); } catch(e) {}
  try { db.prepare('CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id)').run(); } catch(e) {}
  try { db.prepare('CREATE INDEX IF NOT EXISTS idx_folders_path ON folders(path)').run(); } catch(e) {}

  // Queue behaviour settings + debug hold column on send_queue.
  try { db.prepare('ALTER TABLE send_queue ADD COLUMN hold_until INTEGER NOT NULL DEFAULT 0').run(); } catch(e) {}
  try { db.prepare('CREATE TABLE IF NOT EXISTS send_settings (id INTEGER PRIMARY KEY CHECK (id = 1), tick_enabled INTEGER NOT NULL DEFAULT 1, debug_mode INTEGER NOT NULL DEFAULT 0, per_day INTEGER NOT NULL DEFAULT 3)').run(); } catch(e) {}
  try { db.prepare('INSERT OR IGNORE INTO send_settings (id, tick_enabled, debug_mode, per_day) VALUES (1, 1, 0, 3)').run(); } catch(e) {}
  try { db.prepare('ALTER TABLE send_settings ADD COLUMN per_day INTEGER NOT NULL DEFAULT 3').run(); } catch(e) {}

  console.log(`[db] Deferred init complete in ${Date.now() - t0}ms`);
}

// Playlists cache table (for XSPF and other playlist formats)
db.exec(`
  CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    creator TEXT DEFAULT '',
    annotation TEXT,
    info TEXT,
    image TEXT,
    track_count INTEGER DEFAULT 0,
    total_duration INTEGER DEFAULT 0,
    total_size INTEGER DEFAULT 0,
    available_tracks INTEGER DEFAULT 0,
    missing_tracks INTEGER DEFAULT 0,
    last_scanned INTEGER,
    last_updated INTEGER,
    created_at INTEGER NOT NULL DEFAULT 0
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS playlist_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id INTEGER NOT NULL,
    track_index INTEGER NOT NULL,
    location TEXT NOT NULL,
    resolved_path TEXT,
    title TEXT DEFAULT '',
    artist TEXT DEFAULT '',
    album TEXT DEFAULT '',
    duration INTEGER,
    artwork TEXT,
    track_num INTEGER,
    file_exists INTEGER DEFAULT 0,
    file_size INTEGER DEFAULT 0,
    file_mtime INTEGER,
    FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
  )
`);

db.exec('CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks(playlist_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_playlist_tracks_index ON playlist_tracks(playlist_id, track_index)');

// Soft-delete support for playlists (migration for existing DBs)
try { db.prepare("ALTER TABLE playlists ADD COLUMN deleted_at INTEGER").run(); } catch(e) {}
try { db.prepare("CREATE INDEX IF NOT EXISTS idx_playlists_deleted ON playlists(deleted_at)").run(); } catch(e) {}

// Uploads tracking table
db.exec(`
  CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    target_path TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    uploaded INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    checksum TEXT,
    type TEXT,
    ext TEXT,
    started_at INTEGER,
    completed_at INTEGER,
    created_at INTEGER NOT NULL
  )
`);

// ADB transfer transactions (persistence for crash recovery)
db.exec(`
  CREATE TABLE IF NOT EXISTS adb_transactions (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    device TEXT NOT NULL,
    src TEXT NOT NULL,
    dst TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    mtime INTEGER NOT NULL DEFAULT 0,
    mode TEXT NOT NULL DEFAULT '644',
    name TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    overwrite INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    error_type TEXT,
    transferred_bytes INTEGER NOT NULL DEFAULT 0,
    speed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_adb_tx_job ON adb_transactions(job_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_adb_tx_status ON adb_transactions(status)');

// ADB transfer jobs (persistence for crash recovery)
db.exec(`
  CREATE TABLE IF NOT EXISTS adb_jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    device_id TEXT NOT NULL,
    device_serial TEXT DEFAULT '',
    device_ip TEXT DEFAULT '',
    sources_json TEXT NOT NULL,
    dest TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    conflict_strategy TEXT,
    apply_all INTEGER DEFAULT 0,
    apply_all_decision TEXT,
    max_workers INTEGER DEFAULT 3,
    engine TEXT DEFAULT 'transactional',
    progress REAL DEFAULT 0,
    speed INTEGER DEFAULT 0,
    current_file TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_adb_jobs_status ON adb_jobs(status)');

// Prepared Statements
const stmts = {
  // Playlists
  getPlaylistByPath: db.prepare('SELECT * FROM playlists WHERE path = ?'),
  getPlaylistById: db.prepare('SELECT * FROM playlists WHERE id = ?'),
  getAllPlaylists: db.prepare('SELECT * FROM playlists WHERE deleted_at IS NULL ORDER BY title ASC'),
  getAllPlaylistsIncludingDeleted: db.prepare('SELECT * FROM playlists ORDER BY title ASC'),
  softDeletePlaylist: db.prepare("UPDATE playlists SET deleted_at = ? WHERE id = ?"),
  restorePlaylist: db.prepare("UPDATE playlists SET deleted_at = NULL WHERE id = ?"),
  upsertPlaylist: db.prepare(`
    INSERT INTO playlists (path, title, creator, annotation, info, image, track_count, total_duration, total_size, available_tracks, missing_tracks, last_scanned, last_updated, created_at)
    VALUES (@path, @title, @creator, @annotation, @info, @image, @track_count, @total_duration, @total_size, @available_tracks, @missing_tracks, @last_scanned, @last_updated, @created_at)
    ON CONFLICT(path) DO UPDATE SET
      title = excluded.title,
      creator = excluded.creator,
      annotation = excluded.annotation,
      info = excluded.info,
      image = excluded.image,
      track_count = excluded.track_count,
      total_duration = excluded.total_duration,
      total_size = excluded.total_size,
      available_tracks = excluded.available_tracks,
      missing_tracks = excluded.missing_tracks,
      last_scanned = excluded.last_scanned,
      last_updated = excluded.last_updated
  `),
  deletePlaylist: db.prepare('DELETE FROM playlists WHERE id = ?'),
  deletePlaylistTracks: db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ?'),
  insertPlaylistTrack: db.prepare(`
    INSERT INTO playlist_tracks (playlist_id, track_index, location, resolved_path, title, artist, album, duration, artwork, track_num, file_exists, file_size, file_mtime)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getPlaylistTracks: db.prepare('SELECT * FROM playlist_tracks WHERE playlist_id = ? ORDER BY track_index ASC'),

  // Playlist track queries
  getPlaylistIdByPath: db.prepare('SELECT id FROM playlists WHERE path = ?'),
  getMaxTrackIndex: db.prepare('SELECT MAX(track_index) as maxIdx FROM playlist_tracks WHERE playlist_id = ?'),
  getPlaylistTrackPaths: db.prepare('SELECT resolved_path FROM playlist_tracks WHERE playlist_id = ?'),
  getPlaylistTrackStats: db.prepare('SELECT COUNT(*) as cnt, COALESCE(SUM(duration),0) as dur, COALESCE(SUM(file_size),0) as sz FROM playlist_tracks WHERE playlist_id = ?'),
  updatePlaylistStats: db.prepare('UPDATE playlists SET track_count = ?, total_duration = ?, total_size = ?, available_tracks = ?, last_updated = ? WHERE id = ?'),
  getPlaylistTrack: db.prepare('SELECT * FROM playlist_tracks WHERE id = ? AND playlist_id = ?'),
  deletePlaylistTrack: db.prepare('DELETE FROM playlist_tracks WHERE id = ?'),
  getPlaylistTrackIds: db.prepare('SELECT id FROM playlist_tracks WHERE playlist_id = ? ORDER BY track_index ASC'),
  renumberPlaylistTrack: db.prepare('UPDATE playlist_tracks SET track_index = ? WHERE id = ?'),
  getPlaylistTrackCount: db.prepare('SELECT COUNT(*) as cnt FROM playlist_tracks WHERE playlist_id = ?'),
  getPlaylistTrackStatsSum: db.prepare('SELECT SUM(duration) as total_duration, SUM(file_size) as total_size FROM playlist_tracks WHERE playlist_id = ?'),
  lookupFileByDirPathAndName: db.prepare(`
    SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.duration, f.has_thumb
    FROM files f
    JOIN folders fo ON f.dir_id = fo.id
    WHERE fo.path = ? AND f.name = ?
  `),

  // Files
  upsertFile: db.prepare(`
    INSERT INTO files (id, dir_id, name, type, ext, size, mtime, duration, has_thumb, thumb_cache_path, last_accessed, access_count, last_verified, created_at, created_at_embedded, modified_at_fs, uploaded_at, metadata_source, checksum)
    VALUES (@id, @dir_id, @name, @type, @ext, @size, @mtime, @duration, @has_thumb, @thumb_cache_path, @last_accessed, @access_count, @last_verified, @created_at, @created_at_embedded, @modified_at_fs, @uploaded_at, @metadata_source, @checksum)
    ON CONFLICT(id) DO UPDATE SET
      dir_id = excluded.dir_id,
      name = excluded.name,
      type = excluded.type,
      ext = excluded.ext,
      size = excluded.size,
      mtime = excluded.mtime,
      duration = excluded.duration,
      last_verified = excluded.last_verified,
      created_at_embedded = COALESCE(excluded.created_at_embedded, files.created_at_embedded),
      modified_at_fs = COALESCE(excluded.modified_at_fs, files.modified_at_fs),
      uploaded_at = COALESCE(excluded.uploaded_at, files.uploaded_at),
      metadata_source = COALESCE(excluded.metadata_source, files.metadata_source),
      checksum = COALESCE(excluded.checksum, files.checksum)
  `),

  getFile: db.prepare('SELECT * FROM files WHERE id = ?'),
  deleteFile: db.prepare('DELETE FROM files WHERE id = ?'),
  updateThumbStatus: db.prepare('UPDATE files SET has_thumb = 1 WHERE id = ?'),
  skipThumbStatus: db.prepare('UPDATE files SET has_thumb = 2 WHERE id = ?'),
  updateThumbCachePath: db.prepare('UPDATE files SET thumb_cache_path = ? WHERE id = ?'),
  updateLastAccessed: db.prepare('UPDATE files SET last_accessed = ? WHERE id = ?'),
  updateCodecInfo: db.prepare('UPDATE files SET codec_info = ?, is_stream_compatible = ? WHERE id = ?'),
  getCodecInfo: db.prepare('SELECT codec_info, is_stream_compatible FROM files WHERE id = ?'),

  // Cursor Pagination - DETERMINISTIC with (created_at, id) composite
  // Always includes tie-breaker (id) for stable, repeatable results
  getFilesCursor: db.prepare(`
    SELECT id, name, type, ext, size, mtime, has_thumb, thumb_cache_path, dir_id, created_at, uploaded_at, is_favorite
    FROM files
    WHERE dir_id = ? AND (created_at, id) < (?, ?)
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `),
  getFilesFirstPage: db.prepare(`
    SELECT id, name, type, ext, size, mtime, has_thumb, thumb_cache_path, dir_id, created_at, uploaded_at, is_favorite
    FROM files
    WHERE dir_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `),
  getAllFilesFirstPage: db.prepare(`
    SELECT id, name, type, ext, size, mtime, has_thumb, thumb_cache_path, dir_id, created_at, uploaded_at, is_favorite
    FROM files
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `),

  getFilesCursorAsc: db.prepare(`
    SELECT id, name, type, ext, size, mtime, has_thumb, thumb_cache_path, dir_id, created_at, uploaded_at, is_favorite
    FROM files
    WHERE dir_id = ? AND (created_at > ? OR (created_at = ? AND id > ?))
    ORDER BY created_at ASC, id ASC
    LIMIT ?
  `),
  getFilesFirstPageAsc: db.prepare(`
    SELECT id, name, type, ext, size, mtime, has_thumb, thumb_cache_path, dir_id, created_at, uploaded_at, is_favorite
    FROM files
    WHERE dir_id = ?
    ORDER BY created_at ASC, id ASC
    LIMIT ?
  `),

  // Sorting queries - DETERMINISTIC with id tie-breaker
  // Name sorting (case-insensitive with COLLATE NOCASE)
  getFilesSortedByNameAsc: db.prepare(`
    SELECT id, name, type, ext, size, mtime, has_thumb, thumb_cache_path, dir_id, created_at, uploaded_at, is_favorite
    FROM files
    WHERE dir_id = ?
    ORDER BY name COLLATE NOCASE ASC, id ASC
    LIMIT ?
  `),
  getFilesSortedByNameDesc: db.prepare(`
    SELECT id, name, type, ext, size, mtime, has_thumb, thumb_cache_path, dir_id, created_at, uploaded_at, is_favorite
    FROM files
    WHERE dir_id = ?
    ORDER BY name COLLATE NOCASE DESC, id ASC
    LIMIT ?
  `),

  // Modified time sorting
  getFilesSortedByMtimeAsc: db.prepare(`
    SELECT id, name, type, ext, size, mtime, has_thumb, thumb_cache_path, dir_id, created_at, uploaded_at, is_favorite
    FROM files
    WHERE dir_id = ?
    ORDER BY mtime ASC, id ASC
    LIMIT ?
  `),
  getFilesSortedByMtimeDesc: db.prepare(`
    SELECT id, name, type, ext, size, mtime, has_thumb, thumb_cache_path, dir_id, created_at, uploaded_at, is_favorite
    FROM files
    WHERE dir_id = ?
    ORDER BY mtime DESC, id ASC
    LIMIT ?
  `),

  // Size sorting
  getFilesSortedBySizeAsc: db.prepare(`
    SELECT id, name, type, ext, size, mtime, has_thumb, thumb_cache_path, dir_id, created_at, uploaded_at, is_favorite
    FROM files
    WHERE dir_id = ?
    ORDER BY size ASC, id ASC
    LIMIT ?
  `),
  getFilesSortedBySizeDesc: db.prepare(`
    SELECT id, name, type, ext, size, mtime, has_thumb, thumb_cache_path, dir_id, created_at, uploaded_at, is_favorite
    FROM files
    WHERE dir_id = ?
    ORDER BY size DESC, id ASC
    LIMIT ?
  `),

  // Folders
  upsertFolder: db.prepare(`
    INSERT INTO folders (path, parent_id, depth, file_count, total_size, last_scanned, last_updated)
    VALUES (@path, @parent_id, @depth, @file_count, @total_size, @last_scanned, @last_updated)
    ON CONFLICT(path) DO UPDATE SET
      parent_id = excluded.parent_id,
      depth = excluded.depth,
      last_scanned = excluded.last_scanned,
      last_updated = excluded.last_updated
  `),

  getFolder: db.prepare('SELECT * FROM folders WHERE id = ?'),
  getFolderByPath: db.prepare('SELECT * FROM folders WHERE path = ?'),
  getFolderById: db.prepare('SELECT id, path, parent_id, depth FROM folders WHERE id = ?'),
  getFoldersByParent: db.prepare('SELECT id, path, COALESCE(recursive_file_count, file_count) as file_count, COALESCE(recursive_total_size, total_size) as total_size, last_updated, (SELECT COUNT(*) FROM folders sub WHERE sub.parent_id = folders.id) as subfolder_count FROM folders WHERE parent_id = ? ORDER BY path ASC'),
  getFoldersByParentDistinct: db.prepare(`
    SELECT 
      MIN(id) as id,
      path,
      COALESCE(MAX(recursive_file_count), MAX(file_count)) as file_count,
      COALESCE(MAX(recursive_total_size), MAX(total_size)) as total_size,
      MAX(last_updated) as last_updated,
      (SELECT COUNT(*) FROM folders sub WHERE sub.parent_id = folders.id) as subfolder_count
    FROM folders
    WHERE parent_id = ?
    GROUP BY path
    ORDER BY path ASC
  `),

  // File + folder path resolution
  getFileWithPath: db.prepare(`
    SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.duration, f.has_thumb, f.thumb_cache_path, f.uploaded_at, f.is_favorite,
           f.title, f.artist, f.album, f.genre, f.lyrics, f.lyrics_synced, f.cover_source, f.youtube_id, f.video_offset, f.codec_info, f.is_stream_compatible,
           d.path as dir_path
    FROM files f
    JOIN folders d ON f.dir_id = d.id
    WHERE f.id = ?
  `),
  // Cursor with deterministic ordering
  getFilesCursorWithPath: db.prepare(`
    SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
           d.path as dir_path
    FROM files f
    JOIN folders d ON f.dir_id = d.id
    WHERE f.dir_id = ? AND (f.created_at, f.id) < (?, ?)
    ORDER BY f.created_at DESC, f.id DESC
    LIMIT ?
  `),
  getFilesFirstPageWithPath: db.prepare(`
    SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
           d.path as dir_path
    FROM files f
    JOIN folders d ON f.dir_id = d.id
    WHERE f.dir_id = ?
    ORDER BY f.created_at DESC, f.id DESC
    LIMIT ?
  `),
  getFilesCursorAscWithPath: db.prepare(`
    SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
           d.path as dir_path
    FROM files f
    JOIN folders d ON f.dir_id = d.id
    WHERE f.dir_id = ? AND (f.created_at > ? OR (f.created_at = ? AND f.id > ?))
    ORDER BY f.created_at ASC, f.id ASC
    LIMIT ?
  `),
  getFilesFirstPageAscWithPath: db.prepare(`
    SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
           d.path as dir_path
    FROM files f
    JOIN folders d ON f.dir_id = d.id
    WHERE f.dir_id = ?
    ORDER BY f.created_at ASC, f.id ASC
    LIMIT ?
  `),

  // Sorting with path resolution
  getFilesSortedByNameAscWithPath: db.prepare(`
    SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
           d.path as dir_path
    FROM files f
    JOIN folders d ON f.dir_id = d.id
    WHERE f.dir_id = ?
    ORDER BY f.name COLLATE NOCASE ASC, f.id ASC
    LIMIT ?
  `),
  getFilesSortedByNameDescWithPath: db.prepare(`
    SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
           d.path as dir_path
    FROM files f
    JOIN folders d ON f.dir_id = d.id
    WHERE f.dir_id = ?
    ORDER BY f.name COLLATE NOCASE DESC, f.id ASC
    LIMIT ?
  `),
  getFilesSortedByMtimeAscWithPath: db.prepare(`
    SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
           d.path as dir_path
    FROM files f
    JOIN folders d ON f.dir_id = d.id
    WHERE f.dir_id = ?
    ORDER BY f.mtime ASC, f.id ASC
    LIMIT ?
  `),
  getFilesSortedByMtimeDescWithPath: db.prepare(`
    SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
           d.path as dir_path
    FROM files f
    JOIN folders d ON f.dir_id = d.id
    WHERE f.dir_id = ?
    ORDER BY f.mtime DESC, f.id ASC
    LIMIT ?
  `),
  getFilesSortedBySizeAscWithPath: db.prepare(`
    SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
           d.path as dir_path
    FROM files f
    JOIN folders d ON f.dir_id = d.id
    WHERE f.dir_id = ?
    ORDER BY f.size ASC, f.id ASC
    LIMIT ?
  `),
  getFilesSortedBySizeDescWithPath: db.prepare(`
    SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
           d.path as dir_path
    FROM files f
    JOIN folders d ON f.dir_id = d.id
    WHERE f.dir_id = ?
    ORDER BY f.size DESC, f.id ASC
    LIMIT ?
  `),

  // Cursor-paginated sorted queries - all use (field, id) > (?, ?) pattern
  getFilesSortedByMtimeDescCursor: db.prepare(`
    SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
           d.path as dir_path
    FROM files f
    JOIN folders d ON f.dir_id = d.id
    WHERE f.dir_id = ? AND (f.mtime < ? OR (f.mtime = ? AND f.id > ?))
    ORDER BY f.mtime DESC, f.id ASC
    LIMIT ?
  `),
  getFilesSortedByMtimeAscCursor: db.prepare(`
    SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
           d.path as dir_path
    FROM files f
    JOIN folders d ON f.dir_id = d.id
    WHERE f.dir_id = ? AND (f.mtime > ? OR (f.mtime = ? AND f.id > ?))
    ORDER BY f.mtime ASC, f.id ASC
    LIMIT ?
  `),
  getFilesSortedByNameDescCursor: db.prepare(`
    SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
           d.path as dir_path
    FROM files f
    JOIN folders d ON f.dir_id = d.id
    WHERE f.dir_id = ? AND (f.name COLLATE NOCASE < ? OR (f.name COLLATE NOCASE = ? AND f.id > ?))
    ORDER BY f.name COLLATE NOCASE DESC, f.id ASC
    LIMIT ?
  `),
  getFilesSortedByNameAscCursor: db.prepare(`
    SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
           d.path as dir_path
    FROM files f
    JOIN folders d ON f.dir_id = d.id
    WHERE f.dir_id = ? AND (f.name COLLATE NOCASE > ? OR (f.name COLLATE NOCASE = ? AND f.id > ?))
    ORDER BY f.name COLLATE NOCASE ASC, f.id ASC
    LIMIT ?
  `),
  getFilesSortedBySizeDescCursor: db.prepare(`
    SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
           d.path as dir_path
    FROM files f
    JOIN folders d ON f.dir_id = d.id
    WHERE f.dir_id = ? AND (f.size < ? OR (f.size = ? AND f.id > ?))
    ORDER BY f.size DESC, f.id ASC
    LIMIT ?
  `),
  getFilesSortedBySizeAscCursor: db.prepare(`
    SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.thumb_cache_path, f.dir_id, f.created_at, f.uploaded_at, f.is_favorite,
           d.path as dir_path
    FROM files f
    JOIN folders d ON f.dir_id = d.id
    WHERE f.dir_id = ? AND (f.size > ? OR (f.size = ? AND f.id > ?))
    ORDER BY f.size ASC, f.id ASC
    LIMIT ?
  `),

  deltaIncrementFolder: db.prepare('UPDATE folders SET file_count = file_count + 1, total_size = total_size + ?, last_updated = ? WHERE id = ?'),
  deltaDecrementFolder: db.prepare('UPDATE folders SET file_count = MAX(0, file_count - 1), total_size = MAX(0, total_size - ?), last_updated = ? WHERE id = ?'),

  // Reconciliation
  reconcileFolder: db.prepare(`
    UPDATE folders 
    SET file_count = (SELECT COUNT(*) FROM files WHERE dir_id = folders.id),
        total_size = (SELECT COALESCE(SUM(size), 0) FROM files WHERE dir_id = folders.id)
    WHERE id = ?
  `),

  // Stats
  countFilesByType: db.prepare('SELECT type, COUNT(*) as count FROM files GROUP BY type'),
  countTotalFiles: db.prepare('SELECT COUNT(*) as total FROM files'),

  // Search - FTS based (fast) - standalone FTS table
  searchFilesFTS: db.prepare(`
    SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.dir_id, f.created_at, f.uploaded_at, COALESCE(fo.path, '') as dir_path
    FROM files f
    LEFT JOIN folders fo ON f.dir_id = fo.id
    WHERE f.rowid IN (SELECT rowid FROM files_fts WHERE files_fts MATCH ?)
    LIMIT ?
  `),
  searchFilesFTSScoped: db.prepare(`
    SELECT f.id, f.name, f.type, f.ext, f.size, f.mtime, f.has_thumb, f.dir_id, f.created_at, f.uploaded_at, COALESCE(fo.path, '') as dir_path
    FROM files f
    LEFT JOIN folders fo ON f.dir_id = fo.id
    WHERE f.rowid IN (SELECT rowid FROM files_fts WHERE files_fts MATCH ?)
      AND f.dir_id = ?
    LIMIT ?
  `),
  // Folder Previews
  getPreviewFilesForFolder: db.prepare(`
    SELECT id, name, type, ext, has_thumb FROM files
    WHERE dir_id = ?
    ORDER BY 
        CASE type
            WHEN 'image' THEN 1
            WHEN 'video' THEN 2
            WHEN 'audio' THEN 3
            ELSE 4
        END,
        id ASC -- for deterministic but not necessarily newest order
    LIMIT ?
  `),
  searchFolders: db.prepare(`
    SELECT id, path, path as name, 'folder' as type, 
           COALESCE(recursive_file_count, file_count) as file_count,
           COALESCE(recursive_total_size, total_size) as total_size,
           (SELECT COUNT(*) FROM folders sub WHERE sub.parent_id = folders.id) as subfolder_count
    FROM folders 
    WHERE path LIKE ?
    ORDER BY path
    LIMIT ?
  `),
  searchFoldersScoped: db.prepare(`
    SELECT id, path, path as name, 'folder' as type, 
           COALESCE(recursive_file_count, file_count) as file_count,
           COALESCE(recursive_total_size, total_size) as total_size,
           (SELECT COUNT(*) FROM folders sub WHERE sub.parent_id = folders.id) as subfolder_count
    FROM folders 
    WHERE path LIKE ? AND (id = ? OR parent_id = ?)
    ORDER BY path
    LIMIT ?
  `),
  // Get all subfolder IDs recursively
  getSubfolderIds: db.prepare(`
    WITH RECURSIVE subs(id) AS (
      SELECT id FROM folders WHERE id = ?
      UNION ALL
      SELECT f.id FROM folders f JOIN subs s ON f.parent_id = s.id
    )
    SELECT id FROM subs
  `),
};

// Update recursive file counts for all folders
function updateAllRecursiveCounts() {
  // Use recursive CTE to compute for each folder the total files in its subtree
  const stats = db.prepare(`
    WITH RECURSIVE descendants(folder_id, descendant_id) AS (
      SELECT id, id FROM folders
      UNION ALL
      SELECT d.folder_id, f.id FROM folders f JOIN descendants d ON f.parent_id = d.descendant_id
    )
    SELECT d.folder_id as id, 
           COUNT(*) as file_count, 
           COALESCE(SUM(size), 0) as total_size
    FROM files
    JOIN descendants d ON files.dir_id = d.descendant_id
    GROUP BY d.folder_id
  `).all();

  const update = db.prepare('UPDATE folders SET recursive_file_count = ?, recursive_total_size = ? WHERE id = ?');
  const tx = db.transaction((stats) => {
    // Reset all to NULL first so COALESCE falls back to direct file_count
    db.prepare('UPDATE folders SET recursive_file_count = NULL, recursive_total_size = NULL').run();
    // Update with computed stats
    for (const row of stats) {
      update.run(row.file_count, row.total_size, row.id);
    }
  });
  tx(stats);
  console.log(`[db] Updated recursive counts for ${stats.length} folders`);
  return stats.length;
}

export default db;
export { stmts, updateAllRecursiveCounts };
