import Docker from 'dockerode';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

export async function listContainers(all = true) {
  try {
    const containers = await docker.listContainers({ all, size: false });
    return containers.map(c => ({
      Id: c.Id,
      Names: c.Names,
      Image: c.Image,
      State: c.State,
      Status: c.Status,
      Created: c.Created,
      Labels: c.Labels,
    }));
  } catch (err) {
    console.error('[docker] listContainers failed:', err?.message || err);
    return [];
  }
}

export async function getContainerStats(id) {
  try {
    const container = docker.getContainer(id);
    const stream = await container.stats({ stream: false });
    const cpuDelta = stream.cpu_stats.cpu_usage.total_usage - (stream.precpu_stats?.cpu_usage?.total_usage ?? stream.cpu_stats.cpu_usage.total_usage);
    const systemDelta = stream.cpu_stats.system_cpu_usage - (stream.precpu_stats?.system_cpu_usage ?? stream.cpu_stats.system_cpu_usage);
    const onlineCpus = stream.cpu_stats.online_cpus || stream.cpu_stats.cpu_usage.percpu_usage?.length || 1;
    const cpuPercent = systemDelta > 0 && cpuDelta > 0 ? (cpuDelta / systemDelta) * onlineCpus * 100 : 0;

    const memUsage = stream.memory_stats.usage || 0;
    const memLimit = stream.memory_stats.limit || 0;
    const memPercent = memLimit > 0 ? (memUsage / memLimit) * 100 : 0;

    return {
      cpuPercent: Math.min(100 * onlineCpus, parseFloat(cpuPercent.toFixed(2))),
      memUsage,
      memLimit,
      memPercent: parseFloat(memPercent.toFixed(2)),
    };
  } catch {
    return null;
  }
}

export async function getContainerInfo(id) {
  try {
    const container = docker.getContainer(id);
    const info = await container.inspect();
    return {
      restartCount: info.RestartCount || 0,
      startedAt: info.State.StartedAt || info.Created,
      finishedAt: info.State.FinishedAt || null,
      pid: info.State.Pid ?? null,
      env: info.Config?.Env || [],
      ports: info.NetworkSettings?.Ports || {},
      mounts: (info.Mounts || []).map(m => ({
        type: m.Type,
        source: m.Source,
        destination: m.Destination,
        mode: m.Mode,
        rw: m.RW,
      })),
      networks: Object.keys(info.NetworkSettings?.Networks || {}),
      image: info.Config?.Image || '',
      cmd: info.Config?.Cmd || [],
      restartPolicy: info.HostConfig?.RestartPolicy?.Name || 'no',
    };
  } catch {
    return null;
  }
}

export async function getContainerLogs(id, tail = 100) {
  try {
    const container = docker.getContainer(id);
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      tail,
      timestamps: true,
      follow: false,
    });
    const lines = logs.split('\n').filter(l => l.trim());
    return lines.slice(-tail);
  } catch (err) {
    console.error('[docker] getContainerLogs failed:', err?.message || err);
    return [];
  }
}

export async function listImages() {
  try {
    const images = await docker.listImages({ all: false });
    return images.map(img => ({
      id: img.Id,
      tags: img.RepoTags || [],
      size: img.Size,
      created: img.Created,
      containers: img.Containers,
    }));
  } catch (err) {
    console.error('[docker] listImages failed:', err?.message || err);
    return [];
  }
}

export async function getDockerInfo() {
  try {
    const info = await docker.info();
    return {
      containers: info.Containers,
      containersRunning: info.ContainersRunning,
      containersPaused: info.ContainersPaused,
      containersStopped: info.ContainersStopped,
      images: info.Images,
      serverVersion: info.ServerVersion,
      operatingSystem: info.OperatingSystem,
      kernelVersion: info.KernelVersion,
      totalMemory: info.MemTotal,
      cpus: info.NCPU,
      dockerRootDir: info.DockerRootDir,
      storageDriver: info.Driver,
    };
  } catch {
    return null;
  }
}

export async function containerAction(id, action) {
  const valid = { start: true, stop: true, restart: true, pause: true, unpause: true, kill: true, remove: true };
  if (!valid[action]) return { success: false, error: `Invalid action: ${action}` };
  try {
    const container = docker.getContainer(id);
    switch (action) {
      case 'start':
        await container.start();
        break;
      case 'stop':
        await container.stop({ t: 10 });
        break;
      case 'restart':
        await container.restart({ t: 10 });
        break;
      case 'pause':
        await container.pause();
        break;
      case 'unpause':
        await container.unpause();
        break;
      case 'kill':
        await container.kill({ signal: 'SIGKILL' });
        break;
      case 'remove':
        await container.remove({ force: true });
        break;
      default:
        return { success: false, error: 'Unknown action' };
    }
    return { success: true, action, id };
  } catch (err) {
    return { success: false, error: err?.message || String(err) };
  }
}

export { docker as default };
