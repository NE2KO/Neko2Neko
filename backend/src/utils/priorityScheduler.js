const queue = [];
let running = false;

export function scheduleTask(task, priority = 'low') {
  queue.push({ task, priority, timestamp: Date.now() });
  queue.sort((a, b) => {
    const p = { critical: 0, high: 1, medium: 2, low: 3, idle: 4 };
    return (p[a.priority] || 3) - (p[b.priority] || 3);
  });
  if (!running) processQueue();
}

async function processQueue() {
  running = true;
  while (queue.length > 0) {
    const { task, priority } = queue.shift();
    try {
      if (typeof task === 'function') {
        await task();
      } else if (task.run) {
        await task.run();
      }
    } catch (err) {
      console.error('[scheduler] Task error:', err);
    }
  }
  running = false;
}

export function getQueueDepth() {
  return queue.length;
}

export function clearQueue() {
  queue.length = 0;
}
