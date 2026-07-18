import os from 'node:os';

const LANE_CPU = 'cpu';
const LANE_GPU = 'gpu';

class JobQueue {
  #lanes = {
    [LANE_CPU]: { maxWorkers: 8, active: 0, queue: [] }, // BURST: Increase CPU workers for transcode
    [LANE_GPU]: { maxWorkers: 1, active: 0, queue: [] }, // GPU still 1 (hardware limit)
  };

  #pressure = {
    cpuThreshold: 0.8,
    ramThreshold: 0.8,
    burstWindow: 150,
    queueNormal: 50,
    queueMedium: 200,
  };

  #stats = { total: 0, completed: 0, failed: 0 };

  constructor(options = {}) {
    if (options.cpuWorkers) this.#lanes[LANE_CPU].maxWorkers = options.cpuWorkers;
    if (options.gpuWorkers) this.#lanes[LANE_GPU].maxWorkers = options.gpuWorkers;
    this.#startPressureMonitor();
  }

  get totalQueueLength() {
    return this.#lanes[LANE_CPU].queue.length + this.#lanes[LANE_GPU].queue.length;
  }

  get effectiveWorkers() {
    const totalQ = this.totalQueueLength;
    const load = this.#getSystemLoad();

    let cpu = this.#lanes[LANE_CPU].maxWorkers;
    let gpu = this.#lanes[LANE_GPU].maxWorkers;

    if (totalQ > this.#pressure.queueMedium) {
      cpu = Math.max(2, cpu - 2);
      gpu = 1;
    } else if (totalQ > this.#pressure.queueNormal) {
      cpu = Math.max(3, cpu - 1);
    }

    if (load.cpu > this.#pressure.cpuThreshold) {
      cpu = Math.max(1, Math.floor(cpu * 0.5));
    }

    if (load.ram > this.#pressure.ramThreshold) {
      cpu = Math.max(1, cpu - 1);
    }

    return { cpu, gpu };
  }

  #getSystemLoad() {
    const cpus = os.cpus();
    const idleTotal = cpus.reduce((sum, cpu) => sum + cpu.times.idle, 0);
    const totalAll = cpus.reduce((sum, cpu) => sum + Object.values(cpu.times).reduce((a, b) => a + b, 0), 0);
    const cpuUsage = totalAll > 0 ? 1 - idleTotal / totalAll : 0;

    const memInfo = os.freemem();
    const totalMem = os.totalmem();
    const ramUsage = totalMem > 0 ? 1 - memInfo / totalMem : 0;

    return { cpu: cpuUsage, ram: ramUsage };
  }

  #startPressureMonitor() {
    setInterval(() => {
      const load = this.#getSystemLoad();
      if (load.cpu > this.#pressure.cpuThreshold) {
        console.log(`[jobqueue] HIGH CPU: ${(load.cpu * 100).toFixed(0)}% — throttling`);
      }
      if (load.ram > this.#pressure.ramThreshold) {
        console.log(`[jobqueue] HIGH RAM: ${(load.ram * 100).toFixed(0)}% — throttling`);
      }
    }, 5000);
  }

  submit(lane, jobFn, priority = 'medium') {
    if (!this.#lanes[lane]) {
      throw new Error(`Unknown lane: ${lane}`);
    }

    const { active, queue, maxWorkers } = this.#lanes[lane];

    if (active < maxWorkers) {
      return this.#execute(lane, jobFn);
    }

    return new Promise((resolve, reject) => {
      queue.push({
        priority,
        jobFn,
        resolve,
        reject,
        timestamp: Date.now(),
      });
      this.#sortQueue(lane);
      this.#stats.total++;
    });
  }

  #sortQueue(lane) {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    this.#lanes[lane].queue.sort((a, b) => {
      const pDiff = (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1);
      return pDiff !== 0 ? pDiff : a.timestamp - b.timestamp;
    });
  }

  async #execute(lane, jobFn) {
    this.#lanes[lane].active++;
    try {
      const result = await jobFn();
      this.#stats.completed++;
      return result;
    } catch (err) {
      this.#stats.failed++;
      throw err;
    } finally {
      this.#lanes[lane].active--;
      this.#drain(lane);
    }
  }

  #drain(lane) {
    const { active, queue } = this.#lanes[lane];
    const effective = this.effectiveWorkers;
    const max = lane === LANE_CPU ? effective.cpu : effective.gpu;

    while (active < max && queue.length > 0) {
      const job = queue.shift();
      this.#execute(lane, job.jobFn).then(job.resolve).catch(job.reject);
    }
  }

  getStats() {
    return {
      ...this.#stats,
      queue: this.totalQueueLength,
      active: {
        cpu: this.#lanes[LANE_CPU].active,
        gpu: this.#lanes[LANE_GPU].active,
      },
      queueByLane: {
        cpu: this.#lanes[LANE_CPU].queue.length,
        gpu: this.#lanes[LANE_GPU].queue.length,
      },
      limits: this.effectiveWorkers,
    };
  }
}

const jobQueue = new JobQueue();

export { jobQueue, JobQueue, LANE_CPU, LANE_GPU };
