import { ContractError } from './index.mjs';

export const TASK_STATUSES = Object.freeze(['queued', 'awaiting_confirmation', 'running', 'cancelling', 'completed', 'failed', 'cancelled']);
const NEXT = Object.freeze({
  queued: Object.freeze({ require_confirmation: 'awaiting_confirmation', start: 'running', cancel: 'cancelled', fail: 'failed' }),
  awaiting_confirmation: Object.freeze({ approve: 'queued', cancel: 'cancelled', fail: 'failed' }),
  running: Object.freeze({ cancel: 'cancelling', complete: 'completed', fail: 'failed' }),
  cancelling: Object.freeze({ cancelled: 'cancelled', complete: 'completed', fail: 'failed' }),
  completed: Object.freeze({}), failed: Object.freeze({}), cancelled: Object.freeze({})
});

/** State-only reducer; executor acknowledgement is required to finish cancellation. */
export function transitionTask(status, event) {
  if (!TASK_STATUSES.includes(status) || typeof event !== 'string') {
    throw new ContractError('invalid_transition', 'Unknown task status or event');
  }
  if (event === 'stop_speaking') return status;
  if (event === 'cancel' && ['cancelling', 'cancelled', 'completed', 'failed'].includes(status)) return status;
  if (!Object.hasOwn(NEXT[status], event)) throw new ContractError('invalid_transition', `Cannot ${event} a ${status} task`);
  return NEXT[status][event];
}

/** Audio interruption is deliberately separate from background job cancellation. */
export function stopSpeaking() {
  return Object.freeze({ type: 'audio.stop', cancelsTask: false });
}
