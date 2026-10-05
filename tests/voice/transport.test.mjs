import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalAsrTransport } from '../../packages/voice-plugin/transport.mjs';
import { toWav } from '../../packages/voice-plugin/audio.mjs';
import { body, fixture, ids, json } from './helpers.mjs';
const audio = () => ({ ...ids(), wav: toWav(new Uint8Array(1280)) });
const options = () => ({ signal: new AbortController().signal });

test('real HTTP multipart file ASR carries waveform and correlated IDs without credentials', async t => {
  let calls = 0;
  const endpoint = await fixture(t, async (req, res) => { calls++; const bytes = await body(req); const form = await new Response(bytes, { headers: { 'Content-Type': req.headers['content-type'] } }).formData(); assert.equal(form.get('file').type, 'audio/wav'); assert.equal((await form.get('file').arrayBuffer()).byteLength, 1324); assert.equal(form.get('turnId'), 't1'); assert.equal(req.headers.authorization, undefined); assert.equal(req.headers.cookie, undefined); json(res, { text: '  fixture transcript  ' }); });
  const transport = createLocalAsrTransport({ endpoint }); assert.equal(calls, 0);
  assert.deepEqual(await transport.transcribe(audio(), options()), { text: 'fixture transcript' }); assert.equal(calls, 1);
});
test('raw WAV mode matches author bridge request protocol', async t => {
  const endpoint = await fixture(t, async (req, res) => { assert.equal(req.headers['content-type'], 'audio/wav'); assert.equal(req.headers['x-max-audio-sec'], '30'); assert.equal(req.headers['x-turn-id'], 't1'); assert.deepEqual(await body(req), audio().wav); json(res, { text: 'local bridge', language: 'en' }); });
  assert.equal((await createLocalAsrTransport({ endpoint, format: 'wav' }).transcribe(audio(), options())).text, 'local bridge');
});
test('external hosts, embedded credentials, query secrets and implicit host discovery are rejected', () => {
  for (const endpoint of ['https://api.example.com/asr', 'http://localhost/asr', 'file:///tmp/key', 'http://user:secret@127.0.0.1/asr', 'http://127.0.0.1/asr?key=secret']) assert.throws(() => createLocalAsrTransport({ endpoint }), /invalid_endpoint/);
});
test('HTTP redirect cannot forward an audio body to another destination', async t => {
  let destinationCalls = 0; const destination = await fixture(t, (_, res) => { destinationCalls++; json(res, { text: 'bad' }); });
  const endpoint = await fixture(t, (_, res) => { res.writeHead(307, { Location: destination }); res.end(); });
  await assert.rejects(createLocalAsrTransport({ endpoint }).transcribe(audio(), options())); assert.equal(destinationCalls, 0);
});
test('real HTTP timeout, malformed transcript and oversized response are bounded', async t => {
  const hanging = await fixture(t, async req => { await body(req); });
  await assert.rejects(createLocalAsrTransport({ endpoint: hanging, timeoutMs: 20 }).transcribe(audio(), options()), /timeout/);
  const malformed = await fixture(t, (_, res) => json(res, { text: 123 }));
  await assert.rejects(createLocalAsrTransport({ endpoint: malformed }).transcribe(audio(), options()), /invalid_transcript/);
  const huge = await fixture(t, (_, res) => json(res, { text: 'x'.repeat(65537) }));
  await assert.rejects(createLocalAsrTransport({ endpoint: huge }).transcribe(audio(), options()), /asr_response_too_large/);
});
