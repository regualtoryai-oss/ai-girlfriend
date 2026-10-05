import test from 'node:test';
import assert from 'node:assert/strict';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { buildSystemOneRequest, normalizeSystemOneResult, createTypeSafeDecisionAdapter, TYPESAFE_SDK_VERSION } from '../adapter.mjs';
const request = (kind = 'choice') => ({ schemaVersion: 1, kind, requestId: 'req-1', turnId: 'turn-1', candidates: [
  { id: 'chat.option', action: 'chat', args: { message: 'Synthetic conversation' } },
  { id: 'task:option', action: 'task', args: { instruction: 'Synthetic task', capability: 'local_write' } }
] });
const response = choice => ({ model: 'test-only', usage: { input_tokens: 0, output_tokens: 0 }, answers: { decision: { type: 'choice', choice, confidence: 1, probabilities: { c_0: 0, c_1: 1 } } } });

test('official SDK is exactly pinned and builds a typed choice with safe aliases', () => {
  assert.equal(TYPESAFE_SDK_VERSION, '0.6.0');
  const payload = buildSystemOneRequest(request(), { state: { text: 'Test context' } });
  assert.equal(payload.questions.decision.type, 'choice');
  assert.deepEqual(Object.keys(payload.questions.decision.criteria), ['c_0', 'c_1']);
  assert.equal(payload.state.context.text, 'Test context');
  assert.equal(payload.model, undefined);
});
test('typed choice maps back to the exact server candidate and correlation IDs', () => {
  assert.deepEqual(normalizeSystemOneResult(response('c_1'), request()), { schemaVersion: 1, kind: 'choice', requestId: 'req-1', turnId: 'turn-1', choiceId: 'task:option' });
});
test('score uses the official two-level rubric and strict normalized 0..1 scores', () => {
  const payload = buildSystemOneRequest(request('score'));
  assert.equal(payload.questions.c_0.type, 'score'); assert.equal(payload.questions.c_0.criteria.length, 2);
  const result = normalizeSystemOneResult({ answers: { c_0: { type: 'score', score: 0.25 }, c_1: { type: 'score', score: 0.9 } } }, request('score'));
  assert.deepEqual(result.scores, [{ candidateId: 'chat.option', score: 0.25 }, { candidateId: 'task:option', score: 0.9 }]);
});
test('rejects invented choice, unexpected question keys, wrong answer types, and nonfinite or out-of-range scores', () => {
  for (const raw of [response('shell'), { answers: {} }, { answers: { ...response('c_0').answers, approved: true } }, { answers: { decision: { type: 'noul', choice: 'c_0' } } }]) assert.throws(() => normalizeSystemOneResult(raw, request()));
  for (const score of [NaN, Infinity, -1, 1.01, '1']) assert.throws(() => normalizeSystemOneResult({ answers: { c_0: { type: 'score', score }, c_1: { type: 'score', score: 1 } } }, request('score')));
});
test('copies bounded JSON context and rejects functions, accessors, cycles, and oversized state', () => {
  const state = { text: 'test' }; const payload = buildSystemOneRequest(request(), { state }); state.text = 'changed';
  assert.equal(payload.state.context.text, 'test');
  const cyclic = {}; cyclic.self = cyclic;
  for (const state of [cyclic, { method() {} }, { get secret() { throw Error('Must not run'); } }, 'x'.repeat(16001)]) assert.throws(() => buildSystemOneRequest(request(), { state }));
});
test('injected test client receives one real-shaped SDK request, cancellation signal and retries disabled', async () => {
  let calls = 0; const controller = new AbortController();
  const adapter = createTypeSafeDecisionAdapter({ async systemOne(payload, options) { calls++; assert.equal(payload.questions.decision.type, 'choice'); assert.equal(options.signal, controller.signal); assert.equal(options.retry.maxRetries, 0); return response('c_0'); } });
  assert.equal((await adapter.decide(request(), { signal: controller.signal })).choiceId, 'chat.option'); assert.equal(calls, 1);
});

test('the pinned real TypeSafe SDK serializes our request through an explicitly mocked test transport', async () => {
  let sent, calls = 0;
  const client = new TypeSafeClient({ apiKey: 'test-only-not-a-real-key', baseURL: 'https://provider.invalid', defaultModel: 'test-only-model', logLevel: 'off', fetch: async (url, init) => {
    calls++; assert.equal(url, 'https://provider.invalid/v1/systemone'); sent = JSON.parse(init.body);
    return new Response(JSON.stringify(response('c_1')), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } });
  const state = { text: 'Original context' };
  const adapter = createTypeSafeDecisionAdapter(client, { state }); state.text = 'Mutated after binding';
  const result = await adapter.decide(request(), { signal: new AbortController().signal });
  assert.equal(result.choiceId, 'task:option'); assert.equal(sent.model, 'test-only-model');
  assert.equal(sent.state.context.text, 'Original context'); assert.equal(calls, 1);
});
