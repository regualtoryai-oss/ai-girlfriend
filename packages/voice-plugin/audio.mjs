export const SAMPLE_RATE = 16000;
export const MAX_DURATION_MS = 30000;
export const MAX_FRAME_BYTES = 6400; // 200ms of mono 16-bit audio.
export class VoiceError extends Error {
  constructor(code) { super(code); this.name = 'VoiceError'; this.code = code; }
}
export function requireThat(condition, code) { if (!condition) throw new VoiceError(code); }
export function identity(input) {
  requireThat(input && typeof input === 'object', 'invalid_identity');
  const ids = {};
  for (const key of ['sessionId', 'requestId', 'turnId']) {
    requireThat(typeof input[key] === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(input[key]), 'invalid_identity');
    ids[key] = input[key];
  }
  return Object.freeze(ids);
}
export function pcmBytes(value, maximum = MAX_DURATION_MS * 32) {
  requireThat(value instanceof Uint8Array && value.byteLength > 0 && value.byteLength % 2 === 0 && value.byteLength <= maximum, 'invalid_audio');
  return Buffer.from(value); // Own the bytes: callers cannot mutate an accepted frame.
}
export function toWav(value) {
  const pcm = pcmBytes(value), wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24); wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
  return wav;
}
/** Accept canonical uncompressed mono PCM16 16kHz WAV only; no trusted duration metadata. */
export function fromWav(value, maxDurationMs = MAX_DURATION_MS) {
  requireThat(value instanceof Uint8Array && value.byteLength >= 46 && value.byteLength <= maxDurationMs * 32 + 44, 'invalid_audio');
  const wav = Buffer.from(value);
  requireThat(wav.toString('ascii', 0, 4) === 'RIFF' && wav.readUInt32LE(4) === wav.length - 8 && wav.toString('ascii', 8, 16) === 'WAVEfmt ' && wav.readUInt32LE(16) === 16 && wav.readUInt16LE(20) === 1 && wav.readUInt16LE(22) === 1 && wav.readUInt32LE(24) === SAMPLE_RATE && wav.readUInt32LE(28) === SAMPLE_RATE * 2 && wav.readUInt16LE(32) === 2 && wav.readUInt16LE(34) === 16 && wav.toString('ascii', 36, 40) === 'data' && wav.readUInt32LE(40) === wav.length - 44, 'invalid_audio');
  return pcmBytes(wav.subarray(44), maxDurationMs * 32);
}
/** Settles even if an injected output/router ignores cancellation; observes late rejection. */
export async function bounded(work, signal, timeoutMs) {
  const controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  let timedOut = false, rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = () => reject(new VoiceError(timedOut ? 'timeout' : 'aborted')); });
  combined.addEventListener('abort', rejectAbort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    if (combined.aborted) throw new VoiceError('aborted');
    return await Promise.race([Promise.resolve().then(() => { if (combined.aborted) throw new VoiceError('aborted'); return work(combined); }), aborted]);
  } finally { clearTimeout(timer); combined.removeEventListener('abort', rejectAbort); controller.abort(); }
}
