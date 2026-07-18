import fs from 'node:fs';
import os from 'node:os';

export function detectPlatform() {
  const info = {
    os: os.platform(),
    distro: 'unknown',
    hasSystemd: false,
    hasLmSensors: false,
    hasSmartctl: false,
    hasNvidiaSmi: false,
    hasAmdGpu: false,
    hasIntelGpu: false,
    hasDocker: false,
    hasZfs: false,
    virtualization: null,
  };

  if (info.os !== 'linux') return info;

  if (fs.existsSync('/run/systemd/system')) info.hasSystemd = true;
  if (fs.existsSync('/usr/bin/sensors')) info.hasLmSensors = true;
  if (fs.existsSync('/usr/bin/smartctl')) info.hasSmartctl = true;
  if (fs.existsSync('/usr/bin/nvidia-smi')) info.hasNvidiaSmi = true;

  try {
    const drm = fs.readdirSync('/sys/class/drm');
    for (const entry of drm) {
      const vendor = fs.readFileSync(`/sys/class/drm/${entry}/device/vendor`, 'utf8').trim();
      if (vendor === '0x1002') info.hasAmdGpu = true;
      if (vendor === '0x8086') info.hasIntelGpu = true;
    }
  } catch {}

  if (fs.existsSync('/usr/bin/docker') || fs.existsSync('/var/run/docker.sock')) info.hasDocker = true;

  try {
    const mounts = fs.readFileSync('/proc/mounts', 'utf8');
    if (mounts.includes('zfs')) info.hasZfs = true;
  } catch {}

  try {
    const cpuinfo = fs.readFileSync('/proc/cpuinfo', 'utf8');
    if (cpuinfo.includes('hypervisor')) info.virtualization = 'VM';
    else info.virtualization = 'Bare metal';
  } catch {}

  try {
    const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
    const m = osRelease.match(/^ID=(.+)$/m);
    if (m) info.distro = m[1].replace(/"/g, '');
  } catch {}

  return info;
}
