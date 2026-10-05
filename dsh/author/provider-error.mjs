/** Provider failures exposed to sessions contain fixed diagnostics, never response bodies. */
const codes = new Set([
  'ABORTED', 'AUTH', 'MISSING_CREDENTIAL', 'INVALID_CREDENTIAL',
  'INVALID_REQUEST', 'INVALID_RESPONSE', 'MALFORMED_RESPONSE',
  'CONTEXT_WINDOW_EXCEEDED', 'QUOTA', 'QUOTA_EXCEEDED', 'RATE_LIMIT', 'SERVER',
  'TRANSPORT', 'TIMEOUT', 'EMPTY_RESPONSE', 'STREAM_CLOSED', 'UNKNOWN',
  'NO_ADAPTER', 'UNKNOWN_MODEL', 'UNSUPPORTED_CONTENT', 'UNSUPPORTED_OPTION',
  'UNSUPPORTED_REASONING_EFFORT', 'INVALID_PREPARED_CALL', 'INVALID_REPLAY_STATE',
  'INVALID_MODEL_INFO', 'INVALID_MODEL_CONTEXT', 'INVALID_MODEL_MAX_TOKENS',
  'INVALID_MODEL_REASONING', 'REQUEST_EXTENSION', 'PI_AI_ERROR',
]);

function own(value, key) {
  if (!value || typeof value !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

/**
 * Detach safe LlmFailure fields from a thrown error or terminal failure.
 * @param value - Provider failure or thrown Error; messages and causes are discarded.
 * @param aborted - Whether the owning stream was cancelled.
 * @returns A serializable failure with fixed text and safe numeric diagnostics.
 */
export function providerFailure(value, aborted = false) {
  const facts = own(value, 'failure') ?? value;
  const originalCode = own(facts, 'code');
  const code = codes.has(originalCode) || /^HTTP_[1-5]\d\d$/.test(typeof originalCode === 'string' ? originalCode : '')
    ? originalCode : aborted || own(value, 'name') === 'AbortError' ? 'ABORTED' : 'UNKNOWN';
  const status = own(facts, 'status');
  const delay = own(facts, 'providerRetryAfterMs');
  return {
    code,
    message: aborted || code === 'ABORTED' ? 'Provider request cancelled' : `Provider request failed (${code})`,
    ...(Number.isInteger(status) && status >= 100 && status <= 599 ? {status} : {}),
    ...(Number.isFinite(delay) && delay > 0 ? {providerRetryAfterMs: delay} : {}),
  };
}

/**
 * Preserve every normal StreamChunk; project only error/aborted finish failures.
 * @param chunk - One chunk from the existing DSH stream waterfall.
 * @returns The original normal chunk or one failure-only terminal projection.
 */
export function providerChunk(chunk) {
  if (chunk.type !== 'finish' || !['error', 'aborted'].includes(chunk.reason.kind)) return chunk;
  return {type: 'finish', reason: {kind: chunk.reason.kind, failure: providerFailure(chunk.reason.failure, chunk.reason.kind === 'aborted')}};
}
