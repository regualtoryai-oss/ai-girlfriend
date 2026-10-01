import { createHash } from 'node:crypto';
export { TASK_STATUSES, transitionTask, stopSpeaking } from './lifecycle.mjs';

export const ACTIONS = Object.freeze(['chat', 'task', 'status', 'cancel', 'clarify']);
export const CAPABILITIES = Object.freeze(['read_only', 'local_write', 'external_message', 'payment', 'credentials']);
export const MAX_CANDIDATES = 16;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const PUBLIC_FAILURE_CODES = new Set([
  'timeout', 'aborted', 'invalid_shape', 'invalid_value', 'invalid_id',
  'unknown_action', 'invalid_capability', 'invalid_version', 'invalid_kind',
  'invalid_candidates', 'duplicate_candidate', 'stale_decision',
  'unknown_candidate', 'invalid_scores', 'duplicate_score', 'invalid_score'
]);

export class ContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ContractError';
    this.code = code;
  }
}

function fail(code, message) { throw new ContractError(code, message); }
function object(value, keys, location) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail('invalid_shape', `${location} must be a plain object`);
  }
  const actual = Reflect.ownKeys(value);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key)) ||
      keys.some(key => !Object.hasOwn(value, key))) {
    fail('invalid_shape', `${location} must contain exactly: ${keys.join(', ')}`);
  }
  // Accept data, never getter-backed objects from a plugin or executable payload.
  if (keys.some(key => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) {
    fail('invalid_shape', `${location} must contain data properties`);
  }
}
function string(value, location, max = 4000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    fail('invalid_value', `${location} must be a nonempty string of at most ${max} characters`);
  }
  return value;
}
function id(value, location) {
  if (typeof value !== 'string' || !ID.test(value)) fail('invalid_id', `${location} is invalid`);
  return value;
}
function immutable(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
function candidate(value) {
  object(value, ['id', 'action', 'args'], 'candidate');
  id(value.id, 'candidate.id');
  if (!ACTIONS.includes(value.action)) fail('unknown_action', 'Action is not allowlisted');
  let args;
  switch (value.action) {
    case 'chat':
      object(value.args, ['message'], 'chat.args');
      args = { message: string(value.args.message, 'chat.message') };
      break;
    case 'clarify':
      object(value.args, ['question'], 'clarify.args');
      args = { question: string(value.args.question, 'clarify.question', 1000) };
      break;
    case 'status':
    case 'cancel':
      object(value.args, ['taskId'], `${value.action}.args`);
      args = { taskId: id(value.args.taskId, 'taskId') };
      break;
    case 'task':
      object(value.args, ['instruction', 'capability'], 'task.args');
      if (!CAPABILITIES.includes(value.args.capability)) fail('invalid_capability', 'Unsupported task capability');
      args = { instruction: string(value.args.instruction, 'task.instruction'), capability: value.args.capability };
  }
  return { id: value.id, action: value.action, args };
}

/** Validate and copy trusted-server candidates before exposing them to a provider. */
export function validateRequest(value) {
  object(value, ['schemaVersion', 'kind', 'requestId', 'turnId', 'candidates'], 'request');
  if (value.schemaVersion !== 1) fail('invalid_version', 'Expected schemaVersion 1');
  if (!['choice', 'score'].includes(value.kind)) fail('invalid_kind', 'Expected choice or score');
  id(value.requestId, 'requestId');
  id(value.turnId, 'turnId');
  if (!Array.isArray(value.candidates) || value.candidates.length < 1 || value.candidates.length > MAX_CANDIDATES) {
    fail('invalid_candidates', `Expected 1–${MAX_CANDIDATES} candidates`);
  }
  const candidates = Array.from(value.candidates, candidate);
  if (new Set(candidates.map(c => c.id)).size !== candidates.length) fail('duplicate_candidate', 'Candidate IDs must be unique');
  return immutable({ schemaVersion: 1, kind: value.kind, requestId: value.requestId, turnId: value.turnId, candidates });
}

/** Strict normalized contract, not the raw TypeSafe API response. */
export function validateDecision(value, input) {
  const request = validateRequest(input);
  const field = request.kind === 'choice' ? 'choiceId' : 'scores';
  object(value, ['schemaVersion', 'kind', 'requestId', 'turnId', field], 'decision');
  if (value.schemaVersion !== 1) fail('invalid_version', 'Expected schemaVersion 1');
  if (value.kind !== request.kind) fail('invalid_kind', 'Decision kind does not match request');
  if (value.requestId !== request.requestId || value.turnId !== request.turnId) {
    fail('stale_decision', 'Decision does not match this request and turn');
  }
  const ids = request.candidates.map(c => c.id);
  if (request.kind === 'choice') {
    if (!ids.includes(value.choiceId)) fail('unknown_candidate', 'Choice is outside the server candidate set');
    return immutable({ schemaVersion: 1, kind: 'choice', requestId: request.requestId, turnId: request.turnId, choiceId: value.choiceId });
  }
  if (!Array.isArray(value.scores) || value.scores.length !== ids.length) {
    fail('invalid_scores', 'Exactly one score is required for every candidate');
  }
  const seen = new Set();
  const scores = Array.from(value.scores, item => {
    object(item, ['candidateId', 'score'], 'score');
    if (!ids.includes(item.candidateId)) fail('unknown_candidate', 'Scored candidate is unknown');
    if (seen.has(item.candidateId)) fail('duplicate_score', 'Candidate is scored more than once');
    seen.add(item.candidateId);
    if (typeof item.score !== 'number' || !Number.isFinite(item.score) || item.score < 0 || item.score > 1) {
      fail('invalid_score', 'Scores must be finite numbers between 0 and 1');
    }
    return { candidateId: item.candidateId, score: item.score };
  });
  return immutable({ schemaVersion: 1, kind: 'score', requestId: request.requestId, turnId: request.turnId, scores });
}

export function selectCandidate(input, output) {
  const request = validateRequest(input);
  const decision = validateDecision(output, request);
  if (decision.kind === 'choice') return request.candidates.find(c => c.id === decision.choiceId);
  const scores = new Map(decision.scores.map(item => [item.candidateId, item.score]));
  // Equal scores preserve server candidate order, independent of response order.
  return request.candidates.reduce((best, item) => scores.get(item.id) > scores.get(best.id) ? item : best);
}

/** A binding key, not a token or proof of consent. Store only after real approval. */
export function approvalKey(input, candidateId) {
  const request = validateRequest(input);
  const selected = request.candidates.find(c => c.id === candidateId);
  if (!selected) fail('unknown_candidate', 'Cannot bind approval for an unknown candidate');
  return createHash('sha256').update(JSON.stringify([1, request.requestId, request.turnId, selected])).digest('hex');
}

function validatePolicy(value) {
  object(value, ['allowReadOnlyTasks', 'approvedActionKeys', 'ownedTaskIds'], 'policy');
  if (typeof value.allowReadOnlyTasks !== 'boolean' || !Array.isArray(value.approvedActionKeys) ||
      !Array.isArray(value.ownedTaskIds) || value.approvedActionKeys.length > 100 || value.ownedTaskIds.length > 1000) {
    fail('invalid_policy', 'Policy must come from trusted server authorization state');
  }
  const approvedActionKeys = Array.from(value.approvedActionKeys, key => {
    if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) fail('invalid_policy', 'Invalid approval binding');
    return key;
  });
  const ownedTaskIds = Array.from(value.ownedTaskIds, taskId => id(taskId, 'ownedTaskId'));
  return immutable({ allowReadOnlyTasks: value.allowReadOnlyTasks, approvedActionKeys, ownedTaskIds });
}

const DEFAULT_POLICY = immutable({ allowReadOnlyTasks: false, approvedActionKeys: [], ownedTaskIds: [] });

/** No model output, confidence value, or score can grant permission. */
export function permissionGate(input, candidateId, context = DEFAULT_POLICY) {
  const request = validateRequest(input);
  const policy = validatePolicy(context);
  const selected = request.candidates.find(c => c.id === candidateId);
  if (!selected) fail('unknown_candidate', 'Cannot authorize an unknown candidate');
  let outcome, reason;
  if (['chat', 'clarify'].includes(selected.action)) {
    outcome = 'allow'; reason = 'conversation_only';
  } else if (['status', 'cancel'].includes(selected.action)) {
    outcome = policy.ownedTaskIds.includes(selected.args.taskId) ? 'allow' : 'deny';
    reason = outcome === 'allow' ? 'owned_task' : 'task_not_owned';
  } else if (['payment', 'credentials'].includes(selected.args.capability)) {
    outcome = 'handoff'; reason = 'unsupported_sensitive_operation';
  } else if (selected.args.capability === 'read_only' && policy.allowReadOnlyTasks) {
    outcome = 'allow'; reason = 'read_only_scope';
  } else if (policy.approvedActionKeys.includes(approvalKey(request, selected.id))) {
    outcome = 'allow'; reason = 'explicit_scoped_approval';
  } else {
    outcome = 'confirm'; reason = 'approval_required';
  }
  return immutable({ outcome, reason });
}

/** Provider absence is visible; no production fake, API call, or executor exists here. */
export function decisionAvailability(adapter) {
  if (adapter === undefined || adapter === null) return immutable({ status: 'unconfigured', provider: null });
  if (typeof adapter.decide !== 'function' || typeof adapter.name !== 'string' || !adapter.name.trim() || adapter.name.length > 100) {
    fail('invalid_adapter', 'Adapter requires a name and decide(request, { signal })');
  }
  return immutable({ status: 'configured', provider: adapter.name });
}

function fallback(request, reason, status = 'fallback') {
  return immutable({
    status, reason, requestId: request.requestId, turnId: request.turnId,
    candidate: status === 'cancelled' ? null : {
      id: 'safe-clarification', action: 'clarify', args: { question: 'Decision service is unavailable. Please clarify what you would like to do; no task has been started.' }
    },
    permission: { outcome: status === 'cancelled' ? 'deny' : 'allow', reason: status === 'cancelled' ? 'decision_cancelled' : 'conversation_only' }
  });
}

/** Resolves a suggestion only. The caller must authorize again immediately before execution. */
export async function resolveDecision(input, options = {}) {
  const request = validateRequest(input);
  const { adapter, timeoutMs = 2500, signal, policy = DEFAULT_POLICY } = options;
  const trustedPolicy = validatePolicy(policy);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) fail('invalid_timeout', 'timeoutMs must be 1–30000');
  if (signal !== undefined && !(signal instanceof AbortSignal)) fail('invalid_signal', 'Expected AbortSignal');
  if (signal?.aborted) return fallback(request, 'aborted', 'cancelled');
  if (decisionAvailability(adapter).status === 'unconfigured') return fallback(request, 'provider_not_configured', 'unconfigured');

  const controller = new AbortController();
  let timer, onAbort;
  const interruption = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new ContractError('timeout', 'Decision timed out'));
      controller.abort();
    }, timeoutMs);
    onAbort = () => {
      reject(new ContractError('aborted', 'Decision cancelled'));
      controller.abort();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const raw = await Promise.race([
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new ContractError('aborted', 'Decision cancelled');
        return adapter.decide(request, { signal: controller.signal });
      }),
      interruption
    ]);
    if (signal?.aborted) return fallback(request, 'aborted', 'cancelled');
    const selected = selectCandidate(request, raw);
    return immutable({
      status: 'ready', requestId: request.requestId, turnId: request.turnId,
      candidate: selected, permission: permissionGate(request, selected.id, trustedPolicy)
    });
  } catch (error) {
    // Never expose provider error text, prompts, headers, or credentials to the UI.
    const reason = error instanceof ContractError && PUBLIC_FAILURE_CODES.has(error.code) ? error.code : 'provider_error';
    return fallback(request, reason, reason === 'aborted' ? 'cancelled' : 'fallback');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    controller.abort();
  }
}
