import { exec } from 'node:child_process';

export function getLogs(lines = 100, filter = '', unit = '', priority = '') {
  return new Promise((resolve) => {
    const args = ['--no-pager', '--output=short-iso', `--lines=${Math.min(lines, 500)}`];
    if (unit) {
      const safeUnit = String(unit).replace(/[^a-zA-Z0-9._-]/g, '');
      if (safeUnit) args.push(`--unit=${safeUnit}`);
    }
    if (priority) {
      const pVal = parseInt(priority, 10);
      if (!isNaN(pVal) && pVal >= 0 && pVal <= 7) args.push(`--priority=${pVal}`);
    }
    const cmd = `journalctl ${args.map(a => `'${a}'`).join(' ')}`;
    exec(cmd, { encoding: 'utf8', timeout: 5000 }, (err, stdout) => {
      if (err || !stdout?.trim()) { resolve([]); return; }
      const entries = [];
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        const m = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^ ]*)\s+(.+?)\s+(\S+)\s+(.+)/);
        if (m) {
          const msg = m[4];
          if (filter && !msg.toLowerCase().includes(filter.toLowerCase())) continue;
          entries.push({ timestamp: m[1], host: m[2], unit: m[3], message: msg });
        } else {
          const m2 = line.match(/^(\S+\s+\d+\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+(\S+)\s+(.+)/);
          if (m2) {
            const msg = m2[4];
            if (filter && !msg.toLowerCase().includes(filter.toLowerCase())) continue;
            entries.push({ timestamp: m2[1], host: '', unit: m2[3], message: msg });
          }
        }
      }
      resolve(entries);
    });
  });
}
