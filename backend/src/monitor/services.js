import { execSync, execFileSync } from 'node:child_process';

export function getServices(filter = '') {
  try {
  const out = execFileSync('systemctl', ['list-units', '--type=service', '--all', '--no-legend'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
    if (!out.trim()) return [];
    const services = [];
    for (const line of out.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;
      const name = parts[0];
      if (filter && !name.toLowerCase().includes(filter.toLowerCase())) continue;
      services.push({
        name,
        load: parts[1] || '',
        active: parts[2] || '',
        sub: parts[3] || '',
        description: parts.slice(4).join(' ') || '',
      });
    }
    return services;
  } catch {
    return [];
  }
}

export function serviceAction(name, action) {
  const valid = { start: true, stop: true, restart: true, reload: true, enable: true, disable: true };
  if (!valid[action]) return { success: false, error: `Invalid action: ${action}` };
  try {
    execFileSync('systemctl', [action, name], { encoding: 'utf8', timeout: 10000 });
    return { success: true, action, service: name };
  } catch (e) {
    return { success: false, error: e.stderr || e.message };
  }
}
