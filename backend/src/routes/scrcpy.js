import { Router } from 'express';
import { spawn, execSync } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(execSync);
const router = Router();

// Active scrcpy processes: { [deviceId]: { proc, mode, logs } }
const processes = {};

const DEFAULT_SETTINGS = {
  videoBitrate: '2M',
  maxSize: 1024,
  fps: 30,
  audioBitrate: '128k',
  crop: '',
  windowTitle: 'scrcpy',
  turnScreenOff: true,
  stayAwake: false,
  showTouches: false,
  clipboardAutosync: true,
  powerOffOnClose: false,
  noPowerOn: false,
};

function buildArgs(device, mode, settings = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const args = [];

  if (device) args.push('--serial', device);

  if (mode === 'audio') {
    args.push('--no-video');
  } else if (mode === 'video-only') {
    args.push('--no-audio');
  }

  // Video settings (only relevant when video is enabled)
  if (mode !== 'audio') {
    args.push('--video-bit-rate', s.videoBitrate);
    args.push('--max-size', String(s.maxSize));
    args.push('--max-fps', String(s.fps));
    if (s.crop) args.push('--crop', s.crop);
  }

  // Audio settings (only relevant when audio is enabled)
  if (mode !== 'video-only') {
    args.push('--audio-codec', 'aac');
    args.push('--audio-bit-rate', s.audioBitrate);
  }

  if (s.turnScreenOff) args.push('--turn-screen-off');
  if (s.stayAwake) args.push('--stay-awake');
  if (s.showTouches) args.push('--show-touches');
  if (!s.clipboardAutosync) args.push('--no-clipboard-autosync');
  if (s.powerOffOnClose) args.push('--power-off-on-close');
  if (s.noPowerOn) args.push('--no-power-on');
  if (s.windowTitle) args.push('--window-title', s.windowTitle);

  return args;
}

router.get('/devices', async (req, res) => {
  try {
    const output = execSync('adb devices -l', { encoding: 'utf-8', timeout: 5000 });
    const lines = output.trim().split('\n').slice(1);
    const devices = lines
      .filter(l => l.trim() && l.includes('device'))
      .map(l => {
        const id = l.split(/\s+/)[0];
        const model = (l.match(/model:(\S+)/) || [])[1] || 'Unknown';
        const product = (l.match(/product:(\S+)/) || [])[1] || '';
        const entry = processes[id];
        return { id, model, product, running: !!(entry && !entry.proc.killed), mode: entry?.mode || null };
      });
    res.json({ devices });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/status', (req, res) => {
  const status = {};
  for (const [deviceId, entry] of Object.entries(processes)) {
    status[deviceId] = {
      running: !entry.proc.killed,
      pid: entry.proc.pid,
      mode: entry.mode,
      logs: entry.logs.slice(-20),
    };
  }
  res.json({ processes: status });
});

router.post('/start', async (req, res) => {
  try {
    const { device, mode, settings } = req.body;

    if (!mode || !['full', 'audio', 'video-only'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid mode. Must be: full, audio, or video-only' });
    }

    const key = device || 'default';

    // Kill existing
    if (processes[key]) {
      try { processes[key].proc.kill('SIGTERM'); } catch {}
      delete processes[key];
    }

    const args = buildArgs(device || null, mode, settings);

    console.log(`[scrcpy] starting: scrcpy ${args.join(' ')}`);

    const proc = spawn('scrcpy', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' },
    });

    const entry = { proc, mode, logs: [] };
    processes[key] = entry;

    proc.stdout?.on('data', (d) => {
      const line = d.toString().trim();
      if (line) {
        entry.logs.push(`[stdout] ${line}`);
        console.log(`[scrcpy:${key}] ${line}`);
      }
    });

    proc.stderr?.on('data', (d) => {
      const line = d.toString().trim();
      if (line) {
        entry.logs.push(`[stderr] ${line}`);
        console.error(`[scrcpy:${key}] ${line}`);
      }
    });

    proc.on('error', (err) => {
      console.error(`[scrcpy] process error (${key}):`, err.message);
      entry.logs.push(`[error] ${err.message}`);
      delete processes[key];
    });

    proc.on('exit', (code, signal) => {
      console.log(`[scrcpy] process exited (${key}): code=${code} signal=${signal}`);
      delete processes[key];
    });

    // Wait for scrcpy to either crash or stay alive
    await new Promise(resolve => setTimeout(resolve, 1500));

    if (proc.killed || proc.exitCode !== null) {
      delete processes[key];
      return res.status(500).json({
        error: `scrcpy exited with code ${proc.exitCode}`,
        logs: entry.logs,
        args,
      });
    }

    res.json({
      ok: true,
      device: key,
      mode,
      pid: proc.pid,
      args,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/stop', async (req, res) => {
  try {
    const { device } = req.body;
    const key = device || 'default';

    if (!processes[key]) {
      return res.status(404).json({ error: 'No running scrcpy for this device' });
    }

    const proc = processes[key].proc;
    proc.kill('SIGTERM');

    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      proc.on('exit', () => { clearTimeout(timer); resolve(); });
    });

    if (!proc.killed) {
      try { proc.kill('SIGKILL'); } catch {}
    }

    delete processes[key];
    res.json({ ok: true, message: 'scrcpy stopped' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/stop-all', async (req, res) => {
  const keys = Object.keys(processes);
  for (const key of keys) {
    try { processes[key].proc.kill('SIGTERM'); } catch {}
    delete processes[key];
  }
  res.json({ ok: true, stopped: keys.length });
});

router.post('/input', async (req, res) => {
  try {
    const { device, command } = req.body;
    if (!command) {
      return res.status(400).json({ error: 'command required' });
    }

    const keyMap = {
      power: 'KEYCODE_POWER',
      back: 'KEYCODE_BACK',
      home: 'KEYCODE_HOME',
      volume_up: 'KEYCODE_VOLUME_UP',
      volume_down: 'KEYCODE_VOLUME_DOWN',
      menu: 'KEYCODE_APP_SWITCH',
      enter: 'KEYCODE_ENTER',
      tab: 'KEYCODE_TAB',
      escape: 'KEYCODE_ESCAPE',
    };

    const key = keyMap[command] || command;
    const serialArg = device ? `-s ${device}` : '';

    execSync(`adb ${serialArg} shell input keyevent ${key}`, { encoding: 'utf-8', timeout: 5000 });
    res.json({ ok: true, command, key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
