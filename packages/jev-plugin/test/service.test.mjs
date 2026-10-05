import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import * as plugin from '../index.mjs';

const request = () => ({ schemaVersion: 1, kind: 'choice', requestId: 'request-1', turnId: 'turn-1', candidates: [{ id: 'task', action: 'task', args: { instruction: 'Synthetic write', capability: 'local_write' } }] });
const answer = { answers: { decision: { type: 'choice', choice: 'c_0' } } };
async function mount(t, config = {}) { const ctx = new Context(); const fiber = ctx.plugin(plugin, config); await fiber.await(); t.after(() => ctx.fiber.dispose()); const service = ctx.get('companionDecision'); assert.ok(service); return { ctx, fiber, service }; }

test('actual Cordis registers a visible unconfigured service and no fake decision', async t => {
  const { service } = await mount(t);
  assert.equal(service.status().status, 'unconfigured');
  const result = await service.decide(request()); assert.equal(result.status, 'unconfigured'); assert.equal(result.decision, null);
  assert.equal('permission' in result, false); assert.equal('candidate' in result, false); assert.equal(service.status().activeRequests, 0);
});
test('binding a test-only runtime client enables choice decisions without granting permission', async t => {
  const { service } = await mount(t); const unbind = service.bindClient({ async systemOne() { return answer; } });
  assert.equal(service.status().status, 'configured');
  const result = await service.decide(request()); assert.equal(result.status, 'ready'); assert.equal(result.decision.choiceId, 'task'); assert.equal('permission' in result, false);
  unbind(); assert.equal(service.status().status, 'unconfigured');
});
test('client rotation aborts in-flight work and an old disposer cannot remove the new client', async t => {
  const { service } = await mount(t); let signal;
  const old = service.bindClient({ systemOne(_, options) { signal = options.signal; return new Promise(() => {}); } });
  const pending = service.decide(request()); await Promise.resolve();
  service.bindClient({ async systemOne() { return answer; } }); old();
  assert.equal((await pending).status, 'cancelled'); assert.equal(signal.aborted, true);
  assert.equal(service.status().status, 'configured'); assert.equal((await service.decide(request())).status, 'ready');
});
test('plugin disposal aborts pending requests and removes its Cordis service', async t => {
  const { ctx, fiber, service } = await mount(t); let signal;
  service.bindClient({ systemOne(_, options) { signal = options.signal; return new Promise(() => {}); } });
  const pending = service.decide(request()); await Promise.resolve(); await fiber.dispose();
  assert.equal((await pending).status, 'cancelled'); assert.equal(signal.aborted, true); assert.equal(service.status().status, 'disposed'); assert.equal(ctx.get('companionDecision'), undefined);
});
test('timeout and provider exceptions are redacted and release active request state', async t => {
  const { service } = await mount(t, { timeoutMs: 5 });
  service.bindClient({ systemOne() { return new Promise(() => {}); } });
  assert.equal((await service.decide(request())).reason, 'timeout'); assert.equal(service.status().activeRequests, 0);
  service.bindClient({ async systemOne() { throw Error('TEST_ONLY_SECRET_CANARY'); } });
  const result = await service.decide(request()); assert.equal(result.reason, 'provider_error'); assert.equal(JSON.stringify(result).includes('SECRET_CANARY'), false); assert.equal(service.status().activeRequests, 0);
});
test('disabled service does not call a bound client', async t => {
  const { service } = await mount(t, { enabled: false }); let calls = 0;
  service.bindClient({ async systemOne() { calls++; return answer; } });
  assert.equal((await service.decide(request())).status, 'disabled'); assert.equal(calls, 0);
});
test('state validation failure leaves no active operation and caller cancellation does not become approval', async t => {
  const { service } = await mount(t); service.bindClient({ async systemOne() { throw Error('Should not call'); } });
  await assert.rejects(service.decide(request(), { state: { function() {} } })); assert.equal(service.status().activeRequests, 0);
  const controller = new AbortController(); controller.abort();
  assert.equal((await service.decide(request(), { signal: controller.signal })).status, 'cancelled');
});
