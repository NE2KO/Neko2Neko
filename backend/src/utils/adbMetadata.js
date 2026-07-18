import { spawn } from 'node:child_process';

// Escape a path for the device shell (wrap in single quotes)
function shellQuote(s) {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

// Execute adb with separate args (safe for simple commands without paths)
export function adbExec(deviceId, args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('adb', ['-s', deviceId, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `adb exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

// Execute a shell command on the device via adb shell
// The command string is passed as a SINGLE argument to adb shell,
// so the device shell receives it intact (no arg splitting).
export function adbShell(deviceId, shellCmd, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('adb', ['-s', deviceId, 'shell', shellCmd], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `adb exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

export function formatTouchTimestamp(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hour = pad(d.getHours());
  const min = pad(d.getMinutes());
  const sec = pad(d.getSeconds());
  return `${year}${month}${day}${hour}${min}.${sec}`;
}

export async function adbStat(deviceId, remotePath) {
  const quoted = shellQuote(remotePath);

  // Try stat first (GNU stat format)
  try {
    const output = await adbShell(deviceId, `stat ${quoted}`, 8000);
    const sizeMatch = output.match(/Size:\s+(\d+)/i);
    if (sizeMatch) {
      const size = parseInt(sizeMatch[1], 10);
      const mtimeMatch = output.match(/Modify:\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)/i);
      let mtime = 0;
      if (mtimeMatch) {
        const date = new Date(mtimeMatch[1].replace(/\.\d+$/, ''));
        mtime = Math.floor(date.getTime() / 1000);
      }
      return { exists: true, size, mtime };
    }
  } catch (e) {
    // stat failed, try ls fallback
  }

  // Fallback to ls -l (universal on Android)
  try {
    const lsOutput = await adbShell(deviceId, `ls -l ${quoted}`, 5000);
    const lsMatch = lsOutput.match(/^\S+\s+(\d+)\s+\S+\s+\S+\s+/);
    if (lsMatch) {
      const size = parseInt(lsMatch[1], 10);
      return { exists: true, size, mtime: 0 };
    }
  } catch (e) {
    // ls also failed — file doesn't exist
  }

  return null;
}

export async function ensureRemoteDir(deviceId, remoteDir) {
  await adbShell(deviceId, `mkdir -p ${shellQuote(remoteDir)}`, 10000);
}

export async function applyMtime(deviceId, remotePath, mtime) {
  const ts = formatTouchTimestamp(mtime);
  await adbShell(deviceId, `touch -t ${ts} ${shellQuote(remotePath)}`, 10000);
}

export async function applyPermissions(deviceId, remotePath, mode = '644') {
  await adbShell(deviceId, `chmod ${mode} ${shellQuote(remotePath)}`, 10000);
}

export async function applyMetadata(deviceId, remotePath, mtime, mode = '644') {
  try {
    await applyMtime(deviceId, remotePath, mtime);
  } catch (e) {
    console.warn(`[adb:metadata] touch failed for ${remotePath}: ${e.message}`);
    // Don't throw - metadata is best-effort
  }
  try {
    await applyPermissions(deviceId, remotePath, mode);
  } catch (e) {
    console.warn(`[adb:metadata] chmod failed for ${remotePath}: ${e.message}`);
    // Don't throw - metadata is best-effort
  }
}

export async function verifyFile(deviceId, remotePath, expectedSize, expectedMtime = null) {
  const stat = await adbStat(deviceId, remotePath);
  if (!stat) return { ok: false, reason: 'file_missing' };
  if (stat.size !== expectedSize) {
    return {
      ok: false,
      reason: 'size_mismatch',
      actual: stat.size,
      expected: expectedSize,
    };
  }
  if (expectedMtime != null && stat.mtime !== expectedMtime) {
    // mtime may differ by 1s on some devices — allow small tolerance
    const diff = Math.abs(stat.mtime - expectedMtime);
    if (diff > 2) {
      return {
        ok: false,
        reason: 'mtime_mismatch',
        actual: stat.mtime,
        expected: expectedMtime,
      };
    }
  }
  return { ok: true, stat };
}

// Remove a remote file (cleanup partial transfers before retry)
export async function removeRemoteFile(deviceId, remotePath) {
  try {
    await adbShell(deviceId, `rm -f ${shellQuote(remotePath)}`);
    return true;
  } catch {
    return false;
  }
}

export const ERROR_TYPES = {
  ADB_FAIL: 'adb_fail',
  FILE_MISSING: 'file_missing',
  METADATA_FAIL: 'metadata_fail',
  SIZE_MISMATCH: 'size_mismatch',
  MTIME_MISMATCH: 'mtime_mismatch',
  TIMEOUT: 'timeout',
};
