// ActionRequest — immutable request produced by Decision Engine.
// Execution Queue is the only component that may execute these.

export function createActionRequest({ type, priority = 0, params = {}, timestamp = performance.now(), engineId = 'mv' }) {
  return Object.freeze({
    type: String(type),
    priority: Number(priority),
    params: Object.freeze(params || {}),
    timestamp: Number(timestamp),
    engineId: String(engineId),
  });
}

export const ActionType = {
  SEEK: 'seek',
  HARD_SEEK: 'hardSeek',
  SOFT_SEEK: 'softSeek',
  SET_RATE: 'setRate',
  PAUSE: 'pause',
  PLAY: 'play',
  HOLD: 'hold',
  NOOP: 'noop',
};

export const ActionPriority = {
  HARD_SEEK: 5,
  SOFT_SEEK: 4,
  SEEK: 4,
  SET_RATE: 3,
  PLAY: 2,
  HOLD: 1,
  NOOP: 0,
};
