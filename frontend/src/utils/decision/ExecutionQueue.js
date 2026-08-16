// ExecutionQueue — serializes, coalesces, and executes side-effect ActionRequests.
// Only this module calls seek(), setRate(), pause(), play().

import { createActionRequest, ActionType, ActionPriority } from './ActionRequest.js';
import { ExecutionReasonCode } from '../validation/ReasonCodes.js';

export class ExecutionQueue {
  constructor({
    engineId = 'mv',
    seek = () => {},
    setRate = () => {},
    pause = () => {},
    play = () => {},
    anchor = null,
    cooldownMs = 100,
    inFlightGuardMs = 1000,
  } = {}) {
    this.engineId = engineId;
    this.seek = seek;
    this.setRate = setRate;
    this.pause = pause;
    this.play = play;
    this.anchor = anchor;
    this.cooldownMs = cooldownMs;
    this.inFlightGuardMs = inFlightGuardMs;

    this._queue = [];
    this._inFlight = false;
    this._lastExecutedAt = 0;
    this._lastExecutedType = null;
    this._lastExecutedParams = null;
  }

  enqueue(request) {
    if (!request) return;
    const action = createActionRequest(request);
    // Latest-wins per type: the queue holds at most one action of each type and
    // an incoming action of the same type replaces the pending one. With the
    // decision loop enqueuing every ~30ms and process() throttled by cooldown,
    // a FIFO backlog made process() execute stale rates (from when drift was
    // near zero), leaving the applied playbackRate stuck at ~1.0 and the engine
    // effectively inert. For setRate and seeks only the newest target matters,
    // so replacing (instead of appending) keeps the applied action current.
    const existingIndex = this._queue.findIndex(item => item.type === action.type);
    if (existingIndex >= 0) {
      this._queue[existingIndex] = action;
      return { coalesced: true, reasonCode: ExecutionReasonCode.COALESCED };
    }
    this._queue.push(action);
    this._queue.sort((a, b) => b.priority - a.priority);
    return { coalesced: false };
  }

  process() {
    if (this._inFlight) {
      return { processed: false, reasonCode: ExecutionReasonCode.IN_FLIGHT_GUARD };
    }
    if (this._queue.length === 0) {
      return { processed: false, reasonCode: ExecutionReasonCode.NOOP };
    }
    const now = performance.now();
    if (now - this._lastExecutedAt < this.cooldownMs) {
      return { processed: false, reasonCode: ExecutionReasonCode.COOLDOWN_ACTIVE };
    }
    const request = this._queue.shift();
    if (!request) {
      return { processed: false, reasonCode: ExecutionReasonCode.NOOP };
    }
    this._inFlight = true;
    this._lastExecutedAt = now;
    this._lastExecutedType = request.type;
    this._lastExecutedParams = request.params;
    const result = this._execute(request);
    if (result && typeof result.then === 'function') {
      result.then(
        () => { this._inFlight = false; },
        () => { this._inFlight = false; }
      );
    } else {
      this._inFlight = false;
    }
    return { processed: true, request, reasonCode: ExecutionReasonCode.EXECUTED };
  }

  isInFlight() {
    return this._inFlight;
  }

  clear() {
    this._queue = [];
  }

  reset() {
    this._queue = [];
    this._inFlight = false;
    this._lastExecutedAt = 0;
    this._lastExecutedType = null;
    this._lastExecutedParams = null;
  }

  _execute(request) {
    let result;
    switch (request.type) {
      case ActionType.HARD_SEEK:
      case ActionType.SOFT_SEEK:
      case ActionType.SEEK:
        result = this.seek(request.params?.target);
        break;
      case ActionType.SET_RATE:
        result = this.setRate(request.params?.rate);
        break;
      case ActionType.PAUSE:
        result = this.pause();
        break;
      case ActionType.PLAY:
        result = this.play();
        break;
      case ActionType.HOLD:
      case ActionType.NOOP:
      default:
        break;
    }
    if (this.anchor && request.type === ActionType.HARD_SEEK) {
      const anchorResult = this.anchor({ play: true, target: request.params?.target });
      result = result || anchorResult;
    }
    return result;
  }

  _paramsEqual(a, b) {
    const keysA = Object.keys(a || {});
    const keysB = Object.keys(b || {});
    if (keysA.length !== keysB.length) return false;
    return keysA.every(key => a[key] === b[key]);
  }
}
