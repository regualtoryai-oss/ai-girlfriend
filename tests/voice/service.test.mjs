import test from 'node:test';
import assert from 'node:assert/strict';
import { toWav } from '../../packages/voice-plugin/audio.mjs';
import { body, fixture, ids, json, mount, pause } from './helpers.mjs';
const wav = () => toWav(new Uint8Array(1280));
function frame(service, identity = ids()) { service.pushFrame({ ...identity, sequence: 0, pcm16: new Uint8Array(1280) }); }

test('real Cordis service exposes unconfigured states without pretending to transcribe or speak', async t => {
  const { service } = await mount(t); assert.equal(service.status().asr, 'unconfigured'); assert.equal(service.status().router, 'unconfigured');
  assert.equal((await service.submitWav({ ...ids(), wav: wav() })).status, 'unconfigured');
  assert.equal((await service.enqueueSpeech({ ...ids(), utteranceId: 'u1', text: 'hello' })).status, 'output_unconfigured');
});
test('real HTTP transcription routes once with request/turn/session IDs and explicit queue mode', async t => {
  let calls = 0; const endpoint = await fixture(t, async (req, res) => { calls++; await body(req); json(res, { text: 'Synthetic fixture task' }); });
  const { service } = await mount(t, { asrEndpoint: endpoint }); const routed = [], events = [];
  service.subscribe(event => events.push(event)); service.bindRouter(async value => routed.push(value));
  assert.equal((await service.submitWav({ ...ids(), mode: 'queue', wav: wav() })).status, 'routed');
  assert.deepEqual(routed, [{ ...ids(), mode: 'queue', source: 'voice', text: 'Synthetic fixture task' }]);
  assert.equal(events.find(e => e.type === 'input.ended').reason, 'submitted');
  assert.equal(events.find(e => e.type === 'input.started').state, 'listening');
  assert.equal(events.find(e => e.type === 'input.ended').state, 'transcribing');
  assert.equal(JSON.stringify(events).includes('Synthetic fixture task'), false); assert.equal(events.find(e => e.type === 'transcript').characters, 22);
  await assert.rejects(service.endTurn(ids()), /stale_turn/); assert.throws(() => service.beginTurn(ids()), /duplicate_turn/); assert.equal(calls, 1);
});
test('new turn aborts outdated ASR; late response cannot enter router', async t => {
  let finish, arrived; const received = new Promise(resolve => { arrived = resolve; });
  const endpoint = await fixture(t, async (req, res) => { await body(req); finish = () => json(res, { text: 'obsolete' }); arrived(); });
  const { service } = await mount(t, { asrEndpoint: endpoint }); let routed = 0; service.bindRouter(async () => routed++);
  const pending = service.submitWav({ ...ids(), wav: wav() }); await received;
  service.beginTurn(ids('t2')); finish(); assert.equal((await pending).status, 'aborted'); assert.equal(routed, 0);
  assert.throws(() => service.pushFrame({ ...ids(), sequence: 0, pcm16: new Uint8Array(2) }), /stale_turn/);
});
test('capture validates ordering, per-frame size, total samples and automatic deadline', async t => {
  const { service } = await mount(t, { maxDurationMs: 40 }); const events = []; service.subscribe(e => events.push(e));
  service.beginTurn(ids()); assert.throws(() => service.pushFrame({ ...ids(), sequence: 1, pcm16: new Uint8Array(2) }), /invalid_sequence/);
  service.beginTurn(ids('t2')); assert.throws(() => service.pushFrame({ ...ids('t2'), sequence: 0, pcm16: new Uint8Array(6402) }), /invalid_audio/);
  service.beginTurn(ids('t3')); frame(service, ids('t3')); assert.throws(() => service.pushFrame({ ...ids('t3'), sequence: 1, pcm16: new Uint8Array(320) }), /audio_limit/);
  service.beginTurn(ids('t4')); await new Promise(resolve => setTimeout(resolve, 55)); assert.throws(() => frame(service, ids('t4')), /stale_turn/);
  assert.ok(events.some(e => e.turnId === 't4' && e.type === 'input.ended' && e.reason === 'expired'));
});
test('stop-speaking aborts output and queued clips, suppresses late clips and leaves router task alone', async t => {
  const endpoint = await fixture(t, (_, res) => json(res, { text: 'synthetic task request' }));
  const { service } = await mount(t, { asrEndpoint: endpoint }); let signal, stopCalls = 0, routerSignal, finishRouter, reachedRouter;
  const routed = new Promise(resolve => { reachedRouter = resolve; });
  service.bindRouter((_, options) => { routerSignal = options.signal; reachedRouter(); return new Promise(resolve => { finishRouter = resolve; }); });
  const input = service.submitWav({ ...ids(), wav: wav() }); await routed;
  service.bindOutput({ kind: 'browser-synthesis', speak(value) { signal = value.signal; return new Promise(() => {}); }, stop() { stopCalls++; } });
  const a = service.enqueueSpeech({ ...ids(), utteranceId: 'u1', text: 'first' }); const b = service.enqueueSpeech({ ...ids(), utteranceId: 'u2', text: 'second' }); await pause();
  service.stopSpeaking(ids()); assert.equal((await a).status, 'aborted'); assert.equal((await b).status, 'aborted'); assert.equal(signal.aborted, true); assert.ok(stopCalls >= 1); assert.equal(routerSignal.aborted, false);
  assert.equal((await service.enqueueSpeech({ ...ids(), utteranceId: 'u3', text: 'late' })).status, 'aborted');
  finishRouter(); assert.equal((await input).status, 'routed');
  service.beginTurn(ids('capture')); service.stopSpeaking(ids('capture')); frame(service, ids('capture'));
});
test('FIFO output, queue mode, interruption and sessions stay independent', async t => {
  const { service } = await mount(t); const order = [], resolvers = [];
  service.bindOutput({ kind: 'local-tts', speak(value) { order.push(value.utteranceId); return new Promise(resolve => resolvers.push(resolve)); }, stop() {} });
  service.beginTurn(ids()); await service.endTurn(ids());
  const first = service.enqueueSpeech({ ...ids(), utteranceId: 'one', text: 'first' }); await pause();
  const second = service.enqueueSpeech({ ...ids(), utteranceId: 'two', text: 'second' });
  service.beginTurn({ ...ids('t2'), mode: 'queue' }); assert.deepEqual(order, ['one']); resolvers.shift()(); await first; await pause(); assert.deepEqual(order, ['one', 'two']);
  service.beginTurn(ids('other', 's2')); assert.equal(service.status().sessions, 2);
  service.beginTurn(ids('t3')); assert.equal((await second).status, 'aborted');
  frame(service, ids('other', 's2'));
});
test('bounded queue rejects overflow and duplicate utterance IDs', async t => {
  const { service } = await mount(t); service.beginTurn(ids()); service.bindOutput({ kind: 'local-tts', speak() { return new Promise(() => {}); }, stop() {} });
  const pending = []; for (let i = 0; i < 8; i++) pending.push(service.enqueueSpeech({ ...ids(), utteranceId: `u${i}`, text: 'test' }));
  assert.throws(() => service.enqueueSpeech({ ...ids(), utteranceId: 'overflow', text: 'test' }), /queue_limit/);
  service.stopSpeaking(ids()); assert.ok((await Promise.all(pending)).every(r => r.status === 'aborted'));
  service.beginTurn(ids('t2')); const one = service.enqueueSpeech({ ...ids('t2'), utteranceId: 'same', text: 'test' });
  assert.throws(() => service.enqueueSpeech({ ...ids('t2'), utteranceId: 'same', text: 'test' }), /duplicate_utterance/); service.stopSpeaking(ids('t2')); await one;
});
test('actual plugin disposal aborts output and input and releases its service', async t => {
  const { service, fiber, ctx } = await mount(t); const events = []; service.subscribe(e => events.push(e)); service.beginTurn(ids());
  let signal; service.bindOutput({ kind: 'local-tts', speak(value) { signal = value.signal; return new Promise(() => {}); }, stop() {} });
  const pending = service.enqueueSpeech({ ...ids(), utteranceId: 'u1', text: 'hello' }); await pause(); await fiber.dispose();
  assert.equal((await pending).status, 'aborted'); assert.equal(signal.aborted, true); assert.equal(service.status().sessions, 0); assert.equal(ctx.get('companionVoice'), undefined);
  assert.ok(events.some(e => e.type === 'input.ended' && e.reason === 'closed')); assert.throws(() => service.beginTurn(ids('later')), /service_disposed/);
});
test('empty recognition never routes and exceptions never leak raw provider data', async t => {
  let text = ''; const endpoint = await fixture(t, (_, res) => json(res, { text })); const { service } = await mount(t, { asrEndpoint: endpoint }); let calls = 0;
  service.bindRouter(async () => { calls++; throw Error('TEST_ONLY_SECRET_CANARY'); });
  assert.equal((await service.submitWav({ ...ids(), wav: wav() })).status, 'no_speech'); assert.equal(calls, 0); text = 'test';
  const answer = await service.submitWav({ ...ids('t2'), wav: wav() }); assert.equal(answer.status, 'failed'); assert.equal(JSON.stringify(answer).includes('CANARY'), false);
});
