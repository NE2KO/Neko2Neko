import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, isAbsolute, normalize, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { Router } from 'express';
import { createLogger } from '../utils/logger.js';

const log = createLogger('git');
const __dirname = dirname(fileURLToPath(import.meta.url));

// Walk up from the module location (and cwd) to find the repo root (.git).
// server.js runs from backend/, but the git repo is the project root, so we
// can't just trust process.cwd().
function findRepoRoot(start) {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const REPO_ROOT = findRepoRoot(__dirname) || findRepoRoot(process.cwd()) || process.cwd();
log.info({ msg: 'Git route initialized', repo: REPO_ROOT });

const router = Router();

// === LOW-LEVEL GIT RUNNER ===
function runGit(args, opts = {}) {
  const r = spawnSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: opts.timeout || 60000,
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
  });
  return {
    ok: r.status === 0,
    code: r.status,
    stdout: (r.stdout || '').toString(),
    stderr: (r.stderr || '').toString(),
    error: r.error ? r.error.message : null,
  };
}

// Resolve a user-supplied path to a repo-relative path, rejecting anything
// that escapes the repo (path traversal protection).
function safeRelPath(p) {
  if (!p || typeof p !== 'string') return null;
  const abs = isAbsolute(p) ? normalize(p) : resolve(REPO_ROOT, normalize(p));
  const rel = relative(REPO_ROOT, abs);
  if (!rel || rel.startsWith('..' + sep) || rel === '..' || rel.startsWith('..' + '/')) return null;
  // also reject leading ".." without separator edge cases
  if (rel.split(sep)[0] === '..') return null;
  return rel.split(sep).join('/');
}

// Validate a ref/branch/tag name.
function safeRefName(name) {
  return typeof name === 'string' && /^[\w./-]+$/.test(name) ? name : null;
}

function parseStatus(raw) {
  const lines = raw.split('\n');
  let branch = null, upstream = null, ahead = 0, behind = 0;
  const files = [];
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('## ')) {
      const rest = line.slice(3);
      const m = rest.match(/^(.+?)(?:\.\.\.(.+?))?(?:\s*\[(.*)\])?$/);
      if (m) {
        branch = m[1];
        upstream = m[2] || null;
        if (m[3]) {
          const a = m[3].match(/ahead (\d+)/);
          const b = m[3].match(/behind (\d+)/);
          ahead = a ? +a[1] : 0;
          behind = b ? +b[1] : 0;
        }
      }
      continue;
    }
    const x = line[0];
    const y = line[1];
    const path = line.slice(3).trim();
    if (!path) continue;
    files.push({
      path,
      staged: x !== ' ' && x !== '?',
      unstaged: y !== ' ' && y !== '?',
      untracked: x === '?' && y === '?',
      x,
      y,
    });
  }
  return { branch, upstream, ahead, behind, files };
}

// === STATUS ===
router.get('/status', (req, res) => {
  try {
    const r = runGit(['status', '-b', '--porcelain=v1'], { timeout: 20000 });
    if (!r.ok) return res.status(500).json({ error: r.stderr || r.error });
    res.json({ ok: true, ...parseStatus(r.stdout) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === DIFF (working tree or staged) for one file ===
router.get('/diff', (req, res) => {
  const file = safeRelPath(req.query.file);
  if (!file) return res.status(400).json({ error: 'invalid file path' });
  try {
    const args = ['diff'];
    if (req.query.staged === '1' || req.query.staged === 'true') args.push('--cached');
    args.push('--', file);
    const r = runGit(args, { timeout: 30000 });
    res.json({ ok: r.ok, diff: r.stdout, error: r.stderr || r.error });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === DIFF for a specific commit (History tab) ===
router.get('/diff-commit', (req, res) => {
  const hash = req.query.hash;
  if (!hash || !/^[0-9a-f]{4,40}$/i.test(hash)) return res.status(400).json({ error: 'invalid commit hash' });
  try {
    const r = runGit(['show', hash, '--format=', '--no-patch', '--stat'], { timeout: 30000 });
    const stat = runGit(['show', hash, '--format=%H%x1f%an <%ae>%x1f%ad%x1f%s', '--date=short'], { timeout: 30000 });
    const diff = runGit(['show', hash, '--format=', '--no-color'], { timeout: 30000 });
    let meta = null;
    if (stat.ok) {
      const parts = stat.stdout.split('\x1f');
      if (parts.length >= 4) {
        meta = { hash: parts[0], author: parts[1], date: parts[2], message: parts[3] };
      }
    }
    res.json({ ok: r.ok, stat: r.stdout, diff: diff.stdout, meta, error: r.stderr || r.error });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === UNPUSHED (remote/repo vs local) ===
router.get('/unpushed', (req, res) => {
  try {
    // Resolve the comparison base: upstream tracking branch, else origin/<head>.
    let base = null;
    const up = runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { timeout: 10000 });
    if (up.ok && up.stdout.trim()) base = up.stdout.trim();
    if (!base) {
      const rb = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 10000 });
      const head = rb.ok ? rb.stdout.trim() : 'master';
      const check = runGit(['rev-parse', '--verify', `origin/${head}`], { timeout: 10000 });
      if (check.ok) base = `origin/${head}`;
    }
    if (!base) {
      return res.json({ ok: true, hasBase: false, commits: [], diff: '', message: 'Tidak ada remote/upstream untuk dibandingkan.' });
    }
    const log = runGit(['log', '--oneline', `${base}..HEAD`, '--format=%H%x1f%an%x1f%ad%x1f%s', '--date=short'], { timeout: 20000 });
    const commits = log.ok ? log.stdout.split('\n').filter(Boolean).map((l) => {
      const [hash, author, date, message] = l.split('\x1f');
      return { hash, author, date, message };
    }) : [];
    const diff = runGit(['diff', base], { timeout: 60000 });
    res.json({ ok: true, hasBase: true, base, commits, diff: diff.stdout, error: diff.stderr || diff.error });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === LOG ===
router.get('/log', (req, res) => {
  try {
    const n = Math.min(parseInt(req.query.n) || 30, 200);
    const r = runGit(['log', `--max-count=${n}`, '--format=%H%x1f%an%x1f%ad%x1f%s', '--date=short'], { timeout: 20000 });
    const commits = r.stdout.split('\n').filter(Boolean).map((l) => {
      const [hash, author, date, message] = l.split('\x1f');
      return { hash, author, date, message };
    });
    res.json({ ok: r.ok, commits, error: r.stderr || r.error });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === BRANCHES ===
router.get('/branches', (req, res) => {
  try {
    const r = runGit(['branch', '-a', '--format=%(refname:short)'], { timeout: 20000 });
    const list = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean).map((b) => ({
      name: b.replace(/^remotes\//, ''),
      remote: b.startsWith('remotes/'),
    }));
    // de-dupe local vs remote with same name
    const seen = new Set();
    const branches = list.filter((b) => {
      const key = b.name;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const cur = runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 20000 });
    const current = cur.stdout.trim();
    branches.forEach((b) => { if (b.name === current) b.current = true; });
    res.json({ ok: r.ok, branches, current, error: r.stderr || r.error });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === TAGS ===
router.get('/tags', (req, res) => {
  try {
    const r = runGit(['tag', '--list'], { timeout: 20000 });
    res.json({ ok: r.ok, tags: r.stdout.split('\n').map((s) => s.trim()).filter(Boolean), error: r.stderr || r.error });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === STASH LIST ===
router.get('/stash-list', (req, res) => {
  try {
    const r = runGit(['stash', 'list'], { timeout: 20000 });
    const stashes = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    res.json({ ok: r.ok, stashes, error: r.stderr || r.error });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === REPO FILE BROWSER ===
const MAX_FILE = 1 * 1024 * 1024; // 1 MiB editable cap

router.get('/tree', (req, res) => {
  const sub = safeRelPath(req.query.path || '') || '';
  const dir = sub ? join(REPO_ROOT, sub) : REPO_ROOT;
  try {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return res.status(400).json({ error: 'invalid directory' });
    const entries = readdirSync(dir, { withFileTypes: true });
    const items = entries
      .filter((e) => e.name !== '.git' && !e.name.startsWith('.git'))
      .map((e) => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
        path: sub ? `${sub}/${e.name}` : e.name,
        size: e.isFile() ? statSync(join(dir, e.name)).size : 0,
      }))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    res.json({ ok: true, path: sub, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/file', (req, res) => {
  const rel = safeRelPath(req.query.path);
  if (!rel) return res.status(400).json({ error: 'invalid path' });
  const abs = join(REPO_ROOT, rel);
  try {
    if (!existsSync(abs) || !statSync(abs).isFile()) return res.status(400).json({ error: 'not a file' });
    const st = statSync(abs);
    if (st.size > MAX_FILE) return res.status(413).json({ error: 'file terlalu besar (>1MB)' });
    const buf = readFileSync(abs);
    if (buf.includes(0)) return res.status(415).json({ error: 'file binary tidak bisa diedit' });
    res.json({ ok: true, path: rel, content: buf.toString('utf8'), size: st.size });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/file', (req, res) => {
  const rel = safeRelPath(req.body?.path);
  if (!rel) return res.status(400).json({ error: 'invalid path' });
  const content = typeof req.body?.content === 'string' ? req.body.content : '';
  if (content.length > MAX_FILE) return res.status(413).json({ error: 'konten terlalu besar' });
  const abs = join(REPO_ROOT, rel);
  try {
    const d = dirname(abs);
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
    writeFileSync(abs, content, 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === .gitignore ===
router.get('/gitignore', (req, res) => {
  try {
    const p = join(REPO_ROOT, '.gitignore');
    const content = existsSync(p) ? readFileSync(p, 'utf8') : '';
    res.json({ ok: true, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/gitignore', (req, res) => {
  try {
    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    writeFileSync(join(REPO_ROOT, '.gitignore'), content, 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === STAGE / UNSTAGE a single file ===
router.post('/stage', (req, res) => {
  const file = safeRelPath(req.body?.file);
  if (!file) return res.status(400).json({ error: 'invalid file path' });
  try {
    const args = req.body?.unstage ? ['reset', 'HEAD', '--', file] : ['add', '--', file];
    const r = runGit(args, { timeout: 30000 });
    res.json({ ok: r.ok, output: r.stdout, error: r.stderr || r.error });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === COMMIT ===
router.post('/commit', (req, res) => {
  const { message, files } = req.body || {};
  if (!message || !message.trim()) return res.status(400).json({ error: 'commit message required' });
  try {
    let r;
    if (Array.isArray(files) && files.length) {
      const valid = files.map(safeRelPath).filter(Boolean);
      if (!valid.length) return res.status(400).json({ error: 'no valid files to stage' });
      r = runGit(['add', '--', ...valid], { timeout: 30000 });
      if (!r.ok) return res.status(500).json({ error: r.stderr || r.error });
    } else {
      r = runGit(['add', '-A'], { timeout: 30000 });
      if (!r.ok) return res.status(500).json({ error: r.stderr || r.error });
    }
    const c = runGit(['commit', '-m', message], { timeout: 30000 });
    if (!c.ok) {
      const nothing = /nothing to commit/i.test(c.stderr);
      return res.status(nothing ? 400 : 500).json({ error: c.stderr || c.error, nothingToCommit: nothing });
    }
    res.json({ ok: true, output: c.stdout });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === PUSH ===
router.post('/push', (req, res) => {
  try {
    const r = runGit(['push'], { timeout: 120000 });
    res.json({ ok: r.ok, output: r.stdout, error: r.stderr || r.error });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === PULL ===
router.post('/pull', (req, res) => {
  try {
    const r = runGit(['pull'], { timeout: 120000 });
    res.json({ ok: r.ok, output: r.stdout, error: r.stderr || r.error });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === CHECKOUT (switch / create branch) ===
router.post('/checkout', (req, res) => {
  const branch = safeRefName(req.body?.branch);
  if (!branch) return res.status(400).json({ error: 'invalid branch name' });
  try {
    const args = req.body?.create ? ['checkout', '-b', branch] : ['checkout', branch];
    const r = runGit(args, { timeout: 60000 });
    res.json({ ok: r.ok, output: r.stdout, error: r.stderr || r.error });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === MERGE ===
router.post('/merge', (req, res) => {
  const branch = safeRefName(req.body?.branch);
  if (!branch) return res.status(400).json({ error: 'invalid branch name' });
  try {
    const r = runGit(['merge', branch], { timeout: 60000 });
    const conflictRes = runGit(['diff', '--name-only', '--diff-filter=U'], { timeout: 20000 });
    const conflicts = conflictRes.ok ? conflictRes.stdout.split('\n').map((s) => s.trim()).filter(Boolean) : [];
    res.json({ ok: r.ok, output: r.stdout, error: r.stderr || r.error, conflicts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === STASH (create / pop) ===
router.post('/stash', (req, res) => {
  try {
    const r = req.body?.pop ? runGit(['stash', 'pop'], { timeout: 60000 }) : runGit(['stash'], { timeout: 60000 });
    res.json({ ok: r.ok, output: r.stdout, error: r.stderr || r.error });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === TAG (create annotated) ===
router.post('/tag', (req, res) => {
  const name = safeRefName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'invalid tag name' });
  try {
    const r = runGit(['tag', '-a', name, '-m', req.body?.message || name], { timeout: 30000 });
    res.json({ ok: r.ok, output: r.stdout, error: r.stderr || r.error });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
