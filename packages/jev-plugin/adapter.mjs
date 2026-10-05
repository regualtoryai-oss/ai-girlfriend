import { choice, score, VERSION } from '@typesafe-ai/sdk';
import { ContractError, validateRequest, validateDecision } from '@ai-girlfriend/decision-core';

export const TYPESAFE_SDK_VERSION = VERSION;
export const SCORE_RUBRIC = Object.freeze(['Does not match the user intent', 'Strongly matches the user intent']);

function jsonState(value, depth = 0) {
  if (depth > 8) throw new ContractError('invalid_state', 'Decision state is too deeply nested');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.length <= 128) return Array.from(value, child => jsonState(child, depth + 1));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const keys = Reflect.ownKeys(value);
    if (keys.length <= 128 && keys.every(key => typeof key === 'string' && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) {
      return Object.fromEntries(keys.map(key => [key, jsonState(value[key], depth + 1)]));
    }
  }
  throw new ContractError('invalid_state', 'Decision state must contain plain JSON data');
}

/** Build one real System One choice or score request; no key, client construction, or network here. */
export function buildSystemOneRequest(input, options = {}) {
  const request = validateRequest(input);
  const context = jsonState(options.state ?? null);
  if (Buffer.byteLength(JSON.stringify(context)) > 16000) throw new ContractError('invalid_state', 'Decision state exceeds 16000 bytes');
  if (options.model !== undefined && (typeof options.model !== 'string' || !options.model.trim() || options.model.length > 100)) {
    throw new ContractError('invalid_model', 'Expected a nonempty model identifier');
  }
  const candidates = request.candidates.map((candidate, index) => ({ alias: `c_${index}`, ...candidate }));
  const questions = request.kind === 'choice'
    ? { decision: choice('Choose the candidate that best matches the user intent. Selection is not permission to execute.', Object.fromEntries(candidates.map(({ alias, ...candidate }) => [alias, candidate]))) }
    : Object.fromEntries(candidates.map(candidate => [candidate.alias, score(`Rate how well candidate ${candidate.alias} matches the user intent. This score does not grant permission.`, SCORE_RUBRIC)]));
  return {
    state: { requestId: request.requestId, turnId: request.turnId, context, candidates },
    questions,
    ...(options.model === undefined ? {} : { model: options.model })
  };
}

/** Normalize the pinned SDK's answer types to the strict application contract. */
export function normalizeSystemOneResult(raw, input) {
  const request = validateRequest(input);
  const answers = raw?.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new ContractError('invalid_shape', 'Provider answers are missing');
  const expected = request.kind === 'choice' ? ['decision'] : request.candidates.map((_, index) => `c_${index}`);
  const keys = Reflect.ownKeys(answers);
  if (keys.length !== expected.length || keys.some(key => !expected.includes(key))) throw new ContractError('invalid_shape', 'Provider answer keys do not match this request');
  const base = { schemaVersion: 1, kind: request.kind, requestId: request.requestId, turnId: request.turnId };
  if (request.kind === 'choice') {
    if (answers.decision?.type !== 'choice') throw new ContractError('invalid_kind', 'Expected a typed choice answer');
    const index = request.candidates.findIndex((_, index) => answers.decision.choice === `c_${index}`);
    if (index < 0) throw new ContractError('unknown_candidate', 'Provider chose an unknown candidate');
    return validateDecision({ ...base, choiceId: request.candidates[index].id }, request);
  }
  const scores = request.candidates.map((candidate, index) => {
    const answer = answers[`c_${index}`];
    if (answer?.type !== 'score') throw new ContractError('invalid_kind', 'Expected a typed score answer');
    // The pinned SDK uses an expected rubric index. Two rubric levels mean the valid scale is exactly 0..1.
    return { candidateId: candidate.id, score: answer.score };
  });
  return validateDecision({ ...base, scores }, request);
}

/** Inject a server-owned TypeSafeClient or compatible systemOne client. Never reads environment credentials. */
export function createTypeSafeDecisionAdapter(client, options = {}) {
  if (!client || typeof client.systemOne !== 'function') throw new ContractError('invalid_adapter', 'A server-owned systemOne client is required');
  const captured = { state: jsonState(options.state ?? null), model: options.model };
  return Object.freeze({
    name: 'typesafe-system-one',
    async decide(request, { signal }) {
      const payload = buildSystemOneRequest(request, captured);
      const raw = await client.systemOne(payload, { signal, retry: { maxRetries: 0 } });
      return normalizeSystemOneResult(raw, request);
    }
  });
}
