# Companion voice plugin

Native Cordis service for **DeepSeek Harness 0.1.3-alpha.1**, exact upstream tag
`d347e703908d0406b7a7ef80e3a0e594d86b2215`, Cordis **4.0.2**. This package
implements audio framing, local HTTP ASR transport, transcript routing, speech
queue and interruption. It does not record a microphone, synthesize a voice,
install a model or execute tasks. Actual input/output adapters are required.

## Registration and readiness

Install this package's locked dependencies with `npm ci --ignore-scripts`.
With the isolated exact-version DSH home and workspace already selected:

```sh
node /path/to/exact-harness/apps/cli/lib/bin.js plugin --profile sdk add /path/to/packages/voice-plugin
```

The bundle registers `companionVoice`. In the isolated profile's patch, configure
the operator's existing local ASR endpoint; there is no default or auto-probe:

```yaml
- id: companion-voice
  config:
    asrEndpoint: http://127.0.0.1:9000/transcribe # example, not a discovered endpoint
    asrFormat: multipart
    asrTimeoutMs: 15000
```

Only literal loopback `127.0.0.1` / `[::1]` URLs are accepted. Credentials,
query strings, fragments and redirects are rejected. Multipart sends a WAV in
the `file` field plus `sessionId`, `requestId`, `turnId`; the response must be
JSON `{ "text": "recognized words" }`. Extra response fields are ignored.
`asrFormat: wav` sends `audio/wav` directly and supports the author's `/api/stt`.
It sends `X-Max-Audio-Sec: 30`, request and turn ID headers. Existing Whisper
servers with a different protocol need a local bridge or deliberate adapter.

`status()` separately reports ASR configuration, router binding and output kind.
`configured` means an endpoint is supplied, **not** that Whisper is running or
recognition quality has been tested. Unconfigured input returns `unconfigured`;
missing routing returns `router_unconfigured`; missing output returns
`output_unconfigured`. No synthetic transcript or audio is substituted.

## Server integration

The consuming Cordis plugin injects `companionVoice`, then binds a router:

```js
export const inject = ['companionVoice'];
export function apply(ctx) {
  ctx.effect(() => ctx.companionVoice.bindRouter(async (input, { signal }) => {
    // input: {sessionId, requestId, turnId, text, source:'voice', mode}
    // Feed the EXISTING companion/task router. Deduplicate by requestId.
    // mode is 'interrupt' or 'queue', chosen explicitly for chat delivery.
    // signal only cancels stale response delivery, NEVER a durable task.
    await existingRouter(input, { replySignal: signal });
  }));
}
```

The service accepts one capturing/transcribing utterance per authenticated
session, up to 32 sessions. IDs are required, conservative ASCII strings of
1–96 characters. Use fresh IDs forever; the in-memory replay ledger retains
only the last 64 turns per session. Request-ID deduplication at the durable
task router remains authoritative. The server wrapper must authenticate the
session, enforce origin/CSRF checks, rate-limit connections and bound request
bodies **before** decoding them. Supplied IDs alone do not establish ownership.

`beginTurn({...ids, mode:'interrupt'})` supersedes that session's old input,
aborts pending ASR and stale reply delivery, flushes playback and suppresses
late speech. `mode:'queue'` keeps existing playback and marks the transcript
for queued router delivery; it reports `input_busy` if another utterance is
still capturing/transcribing. It does not invent an invisible ASR backlog.

`pushFrame({...ids, sequence, pcm16})` accepts ordered copied PCM16 little-endian,
mono 16kHz bytes, 10–200ms/320–6,400 bytes per frame. Sequence starts at zero.
`endTurn(ids)` emits `input.ended` immediately, builds WAV and calls ASR once.
`submitWav({...ids, wav})` is the file shortcut; it accepts canonical 44-byte
PCM WAV headers with the same format. Compressed WebM/Opus and arbitrary WAV
layouts require an explicit conversion step. Actual sample count limits audio
to 30 seconds / 960,000 PCM bytes; a wall-clock capture deadline also expires
after 30 seconds. Smaller `maxDurationMs` can be configured. Protocol errors
release the capture. Audio is held in memory only and released after use.

Events: `input.started`, `input.ended`, `transcript`, `input.result`,
`output.started`, `output.result`, `output.stopped`. All carry the three IDs,
`channel: input|output`, and public `state: listening|transcribing|speaking|stopped|error|idle`.
The `transcript` event includes only a character count. Recognized text goes
only to the explicitly bound router; do not log it. Events contain no audio,
transcript text, endpoint or raw exception. Provider exceptions are reduced to fixed statuses. There is no
filesystem, environment-key lookup, recording store, external provider call,
or automatic telemetry in this package.

## Speech output and interruption

`bindOutput({kind, speak, stop})` supplies real output. `kind` is `local-tts` or
`browser-synthesis`; label browser synthesis as a temporary browser voice,
never as cloned/natural voice. `speak({...ids, utteranceId, text, signal})`
must resolve when playback finishes, reject/stop on abort, and check the signal
again before playing a late decoded/synthesized clip. `stop(ids)` must stop the
matching playback immediately and be idempotent. A browser bridge must carry
the IDs through events and acknowledgements; global speech cancellation across
unrelated authenticated sessions is not acceptable.

`enqueueSpeech({...ids, utteranceId, text})` provides FIFO playback, max 8 active
and queued clips per session, max 4,000 characters per clip. Duplicate utterance
IDs are rejected. A 60-second output deadline aborts stalled synthesis/playback.
`stopSpeaking(ids)` aborts that turn's TTS/playback, clears its queue and rejects
late speech; it does not abort ASR, touch the router or cancel a running task.
`cancelInput(ids)` releases capture/ASR/stale reply delivery only. Job cancellation
belongs to the existing separately authorized task lifecycle. `closeSession`
and plugin disposal abort active operations, clear buffers/queues and detach
subscribers. Client adapter stop/abort behavior remains part of acceptance.

## Microphone and VAD boundary

The frontend starts capture only from a user gesture and browser permission.
On end/cancel/deadline/disconnect it must synchronously stop every MediaStream
track, close its AudioContext/worklet, detach listeners and release buffers.
Stopping while permission is still pending must also stop a late-acquired stream.
No microphone is opened by this package or its tests.

Default integration should use explicit press-to-talk/end controls. Neural VAD
is not bundled or simulated. If the already-installed author VAD bridge is used,
keep its 16kHz stream contiguous: the author processes 512-sample windows and
confirms 384ms of sustained speech. A VAD `speech_start` can begin an interrupt
turn. RMS alone cannot reliably distinguish speech from echo, music or noise.

## Source and license notes

Behavior was reviewed against [author plugin v0.3.0, commit 480bbab](https://github.com/beiyege-01/dsh-voice-ai-girlfriend/tree/480bbabada7335735cad591eaa55f32fe54a4214):
`dsh-plugin/src/client/index.ts`, `voice/speaker.ts`, `voice/recorder.ts`, and
`bridge/voice_bridge.py`. This is an independent implementation; no author source,
demo media, voice samples or model weights are copied. The author root declares
Apache-2.0, client plugin package MIT, and demo media separately restricted.
Harness/Cordis are MIT. No OmniVoice NC weights or unresolved DUIX assets are used.

## Verification

`npm test` runs real Cordis service tests and real local HTTP fixture transport
tests. Fixture transcripts/output adapters are explicitly test-only. From the
repository, `node --test tests/voice/dsh-load.test.mjs` additionally registers and
loads the bundle through the actual built alpha.1 CLI with a temporary DSH home,
checks unconfigured behavior, initializes SDK and shuts down without a model call.
Set `DSH_SOURCE_ROOT` to the exact built source and `DSH_TEST_PATH` if pnpm is not
on PATH. A missing or wrong baseline fails the test rather than silently skips.

This verifies module behavior, not a live microphone, real speech recognition,
speaker quality, browser capture cleanup or the user's end-to-end UI wiring.
