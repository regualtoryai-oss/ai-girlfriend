import { Service } from '@deepseek-ai/cordis';
import { bounded, fromWav, identity, MAX_DURATION_MS, MAX_FRAME_BYTES, pcmBytes, requireThat, toWav, VoiceError } from './audio.mjs';
import { createLocalAsrTransport } from './transport.mjs';
export const name = 'companion-voice';
export const SERVICE_NAME = 'companionVoice';
const same = (a, b) => a.requestId === b.requestId && a.turnId === b.turnId;
const result = (t, status) => Object.freeze({ ...t.ids, status });

export class CompanionVoiceService extends Service {
  #sessions = new Map(); #listeners = new Set(); #asr = null; #router = null; #output = null; #disposed = false; #duration;
  constructor(ctx, config = {}) {
    requireThat(config && typeof config === 'object' && !Array.isArray(config) && Object.keys(config).every(k => ['asrEndpoint', 'asrFormat', 'asrTimeoutMs', 'maxDurationMs'].includes(k)), 'invalid_config');
    const duration = config.maxDurationMs ?? MAX_DURATION_MS;
    requireThat(Number.isInteger(duration) && duration >= 20 && duration <= MAX_DURATION_MS, 'invalid_config');
    const asr = config.asrEndpoint ? createLocalAsrTransport({ endpoint: config.asrEndpoint, timeoutMs: config.asrTimeoutMs, format: config.asrFormat }) : null;
    super(ctx, SERVICE_NAME); this.#asr = asr; this.#duration = duration;
    for (const method of ['status', 'subscribe', 'bindRouter', 'bindOutput', 'beginTurn', 'pushFrame', 'endTurn', 'submitWav', 'cancelInput', 'enqueueSpeech', 'stopSpeaking', 'closeSession', 'dispose']) this[method] = this[method].bind(this);
    ctx.effect(() => () => this.dispose(), 'companion-voice.cleanup');
  }
  status() {
    return Object.freeze({ service: SERVICE_NAME, status: this.#disposed ? 'disposed' : this.#asr ? 'configured' : 'unconfigured', asr: this.#asr ? 'local-http' : 'unconfigured', router: this.#router ? 'bound' : 'unconfigured', output: this.#output?.kind ?? 'unconfigured', sessions: this.#sessions.size });
  }
  subscribe(listener) { requireThat(typeof listener === 'function' && !this.#disposed, 'invalid_listener'); this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  #emit(type, t, extra = {}) {
    const channel = type.startsWith('output.') ? 'output' : 'input';
    const state = type === 'input.started' ? 'listening' : type === 'output.started' ? 'speaking'
      : type === 'transcript' || (type === 'input.ended' && extra.reason === 'submitted') ? 'transcribing'
      : ['failed', 'timeout', 'unconfigured', 'router_unconfigured'].includes(extra.status) ? 'error'
      : type === 'output.stopped' || type === 'input.ended' || extra.status === 'aborted' ? 'stopped' : 'idle';
    const event = Object.freeze({ type, channel, state, ...t.ids, ...extra });
    for (const listener of this.#listeners) { try { listener(event); } catch {} }
  }
  bindRouter(router) {
    requireThat(typeof router === 'function' && !this.#disposed, 'invalid_router'); this.#router = router;
    return () => { if (this.#router === router) this.#router = null; };
  }
  bindOutput(output) {
    requireThat(output && ['browser-synthesis', 'local-tts'].includes(output.kind) && typeof output.speak === 'function' && typeof output.stop === 'function' && !this.#disposed, 'invalid_output');
    for (const s of this.#sessions.values()) this.#stop(s);
    this.#output = output;
    return () => { if (this.#output === output) { for (const s of this.#sessions.values()) this.#stop(s); this.#output = null; } };
  }
  #turn(input) { const ids = identity(input), s = this.#sessions.get(ids.sessionId), t = s?.turns.get(ids.turnId); requireThat(t && same(ids, t.ids), 'stale_turn'); return { s, t }; }
  #release(t, status) {
    clearTimeout(t.timer); for (const frame of t.frames) frame.fill(0); t.frames = []; t.controller.abort();
    if (t.phase === 'capturing') this.#emit('input.ended', t, { reason: status });
    t.phase = status;
  }
  beginTurn(input) {
    const ids = identity(input), mode = input.mode ?? 'interrupt';
    requireThat(!this.#disposed, 'service_disposed'); requireThat(['interrupt', 'queue'].includes(mode), 'invalid_mode');
    let s = this.#sessions.get(ids.sessionId);
    if (!s) { requireThat(this.#sessions.size < 32, 'session_limit'); s = { turns: new Map(), input: null, queue: [], playing: null, draining: false }; this.#sessions.set(ids.sessionId, s); }
    requireThat(!s.turns.has(ids.turnId) && ![...s.turns.values()].some(t => t.ids.requestId === ids.requestId), 'duplicate_turn');
    requireThat(mode !== 'queue' || !s.input || !['capturing', 'transcribing'].includes(s.input.phase), 'input_busy');
    if (mode === 'interrupt') { for (const t of s.turns.values()) { this.#release(t, 'superseded'); t.muted = true; } this.#stop(s); }
    // Bounded recent-ID ledger; caller must use never-reused IDs beyond this window.
    if (s.turns.size >= 64) {
      const old = [...s.turns.values()].find(t => !['capturing', 'transcribing', 'routing'].includes(t.phase) && s.playing?.t !== t && !s.queue.some(j => j.t === t));
      requireThat(old, 'turn_limit'); s.turns.delete(old.ids.turnId);
    }
    const t = { ids, mode, phase: 'capturing', frames: [], bytes: 0, sequence: 0, controller: new AbortController(), muted: false, utterances: new Set() };
    s.turns.set(ids.turnId, t); s.input = t;
    t.timer = setTimeout(() => this.#release(t, 'expired'), this.#duration); t.timer.unref?.();
    this.#emit('input.started', t); return result(t, 'capturing');
  }
  pushFrame(input) {
    const { s, t } = this.#turn(input); requireThat(t === s.input && t.phase === 'capturing', 'stale_turn');
    try {
      requireThat(input.sequence === t.sequence, 'invalid_sequence'); const frame = pcmBytes(input.pcm16, MAX_FRAME_BYTES);
      requireThat(frame.length >= 320, 'invalid_audio'); // At least 10ms bounds frame-object overhead.
      requireThat(t.bytes + frame.length <= this.#duration * 32, 'audio_limit'); t.frames.push(frame); t.bytes += frame.length; t.sequence++;
      return { ...result(t, 'capturing'), durationMs: t.bytes / 32, nextSequence: t.sequence };
    } catch (error) { this.#release(t, 'invalid_audio'); throw error; }
  }
  async submitWav(input) {
    const pcm = fromWav(input.wav, this.#duration); this.beginTurn(input);
    const { t } = this.#turn(input); t.frames = [pcm]; t.bytes = pcm.length; return this.endTurn(input);
  }
  async endTurn(input) {
    const { s, t } = this.#turn(input); requireThat(t === s.input && t.phase === 'capturing', 'stale_turn');
    clearTimeout(t.timer); t.phase = 'transcribing'; this.#emit('input.ended', t, { reason: 'submitted' });
    const pcm = Buffer.concat(t.frames, t.bytes); for (const frame of t.frames) frame.fill(0); t.frames = [];
    let state;
    try {
      if (!pcm.length) state = 'no_speech';
      else if (!this.#asr) state = 'unconfigured';
      else if (!this.#router) state = 'router_unconfigured';
      else {
        const router = this.#router, transcript = await this.#asr.transcribe({ ...t.ids, wav: toWav(pcm) }, { signal: t.controller.signal });
        if (t.controller.signal.aborted) return result(t, 'aborted');
        if (!transcript.text) state = 'no_speech';
        else {
          t.phase = 'routing'; this.#emit('transcript', t, { characters: transcript.text.length });
          // The router must enqueue its task independently; this signal only suppresses stale reply delivery.
          await bounded(signal => router(Object.freeze({ ...t.ids, text: transcript.text, source: 'voice', mode: t.mode }), { signal }), t.controller.signal, 60000);
          state = 'routed';
        }
      }
    } catch (error) { state = t.controller.signal.aborted ? 'aborted' : error instanceof VoiceError && error.code === 'timeout' ? 'timeout' : 'failed'; }
    finally { pcm.fill(0); }
    if (!t.controller.signal.aborted) { t.phase = state; this.#emit('input.result', t, { status: state }); }
    return result(t, state);
  }
  cancelInput(input) { const { t } = this.#turn(input); this.#release(t, 'cancelled'); return result(t, 'cancelled'); }
  enqueueSpeech(input) {
    const { s, t } = this.#turn(input);
    requireThat(typeof input.utteranceId === 'string' && /^[A-Za-z0-9._:-]{1,96}$/.test(input.utteranceId) && typeof input.text === 'string' && input.text.trim().length > 0 && input.text.length <= 4000, 'invalid_speech');
    if (t.muted || this.#disposed) return Promise.resolve(result(t, 'aborted'));
    if (!this.#output) return Promise.resolve(result(t, 'output_unconfigured'));
    requireThat(s.queue.length + Number(Boolean(s.playing)) < 8 && t.utterances.size < 64, 'queue_limit');
    requireThat(!t.utterances.has(input.utteranceId), 'duplicate_utterance'); t.utterances.add(input.utteranceId);
    return new Promise(resolve => { s.queue.push({ t, text: input.text, utteranceId: input.utteranceId, resolve }); this.#drain(s); });
  }
  async #drain(s) {
    if (s.draining) return; s.draining = true;
    try { while (s.queue.length && !this.#disposed) {
      const job = s.queue.shift(), controller = new AbortController(), output = this.#output; s.playing = { ...job, controller, output };
      let state = 'spoken'; this.#emit('output.started', job.t, { utteranceId: job.utteranceId });
      try { await bounded(signal => output.speak({ ...job.t.ids, utteranceId: job.utteranceId, text: job.text, signal }), controller.signal, 60000); }
      catch (error) { state = controller.signal.aborted ? 'aborted' : error instanceof VoiceError && error.code === 'timeout' ? 'timeout' : 'failed'; }
      if (state !== 'spoken') this.#stopAdapter(output, job.t);
      s.playing = null; this.#emit('output.result', job.t, { utteranceId: job.utteranceId, status: state }); job.resolve(result(job.t, state));
    } } finally { s.draining = false; }
  }
  #stopAdapter(output, t) { try { Promise.resolve(output?.stop(t.ids)).catch(() => {}); } catch {} }
  #stop(s, target) {
    if (s.playing && (!target || s.playing.t === target)) { s.playing.controller.abort(); this.#stopAdapter(s.playing.output, s.playing.t); }
    const keep = []; for (const job of s.queue) { if (!target || job.t === target) job.resolve(result(job.t, 'aborted')); else keep.push(job); } s.queue = keep;
  }
  stopSpeaking(input) { const { s, t } = this.#turn(input); t.muted = true; this.#stop(s, t); this.#emit('output.stopped', t); return result(t, 'stopped'); }
  closeSession(sessionId) {
    const s = this.#sessions.get(sessionId); if (!s) return;
    for (const t of s.turns.values()) this.#release(t, 'closed'); this.#stop(s); this.#sessions.delete(sessionId);
  }
  dispose() { if (this.#disposed) return; this.#disposed = true; for (const id of this.#sessions.keys()) this.closeSession(id); this.#listeners.clear(); this.#router = null; this.#output = null; }
}
export function apply(ctx, config) { new CompanionVoiceService(ctx, config); }
