// Worker script: reads hwmon sensors from sysfs and writes to cache file
// Runs in a separate process so D-state hangs don't block the main server
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const CACHE_FILE = '/tmp/homelab_sensors.json';

try {
  const sensors = {};
  const hwmonDir = '/sys/class/hwmon';
  let hwmons;
  try { hwmons = readdirSync(hwmonDir); } catch { process.exit(0); }

  for (const hwmon of hwmons) {
    const base = `${hwmonDir}/${hwmon}`;
    let name = '';
    try { name = readFileSync(`${base}/name`, 'utf8').trim(); } catch { continue; }
    let inputs;
    try { inputs = readdirSync(base).filter(f => f.endsWith('_input')); } catch { continue; }
    for (const input of inputs) {
      const label = input.replace('_input', '');
      const labelFile = `${base}/${label}_label`;
      let labelText = label;
      try { labelText = readFileSync(labelFile, 'utf8').trim(); } catch {}
      let raw;
      try { raw = readFileSync(`${base}/${input}`, 'utf8').trim(); } catch { continue; }
      const val = parseInt(raw);
      if (!isNaN(val)) {
        const path = `${name}.${labelText}`;
        const tempC = Math.round(val / 1000 * 100) / 100;
        let high = null, crit = null;
        try { high = Math.round(parseInt(readFileSync(`${base}/${label}_max`, 'utf8').trim()) / 1000 * 100) / 100; } catch {}
        try { crit = Math.round(parseInt(readFileSync(`${base}/${label}_crit`, 'utf8').trim()) / 1000 * 100) / 100; } catch {}
        sensors[path] = { chip: name, feature: labelText, label: labelText, value: tempC, high, crit };
      }
    }
  }
  writeFileSync(CACHE_FILE, JSON.stringify(sensors));
} catch {
  // If anything fails, just exit silently
}
