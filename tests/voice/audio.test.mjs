import test from 'node:test';
import assert from 'node:assert/strict';
import { fromWav, toWav, pcmBytes, bounded } from '../../packages/voice-plugin/audio.mjs';

test('PCM WAV round trip validates actual format and sample-derived duration', () => {
  const pcm = new Uint8Array(3200); pcm[10] = 42;
  const wav = toWav(pcm); assert.equal(wav.length, 3244); assert.deepEqual(fromWav(wav), Buffer.from(pcm));
  assert.throws(() => fromWav(wav, 50), /invalid_audio/);
  const stereo = Buffer.from(wav); stereo.writeUInt16LE(2, 22); assert.throws(() => fromWav(stereo), /invalid_audio/);
  assert.throws(() => fromWav(wav.subarray(1)), /invalid_audio/); assert.throws(() => toWav(new Uint8Array(3)), /invalid_audio/);
});
test('accepted frames own their memory, reject oversized input and malformed WAV length', () => {
  const bytes = new Uint8Array(1280), snapshot = pcmBytes(bytes); bytes[0] = 255; assert.equal(snapshot[0], 0);
  assert.throws(() => pcmBytes(new Uint8Array(960002)), /invalid_audio/);
  const wav = toWav(snapshot); wav.writeUInt32LE(2, 40); assert.throws(() => fromWav(wav), /invalid_audio/);
});
test('bounded adapter settles on abort and timeout even when transport ignores cancellation', async () => {
  const controller = new AbortController(); const pending = bounded(() => new Promise(() => {}), controller.signal, 1000); controller.abort();
  await assert.rejects(pending, /aborted/);
  await assert.rejects(bounded(() => new Promise(() => {}), new AbortController().signal, 5), /timeout/);
});
