# Companion Agent

Avatar-first local preview. Node.js 24+, no install required: `node server/app.mjs` or `Start-Demo.cmd`. Open http://127.0.0.1:8793 . Only localhost is bound.

Current executor is **bounded-local-file**, a deterministic Markdown writer using the user's supplied title and notes. It is not an LLM or DeepSeek Harness execution. Chat, Jev, ASR and TTS are not connected. Voice controls never request microphone permission. Stop playback and cancel task are separate controls.

Local assets are intentionally ignored: copy the approved original portrait to `public/assets/portrait.png` and optional cached preview to `public/assets/idle.mp4`. See `public/assets/manifest.json`. No reference-video media or noncommercial model outputs are published. Missing assets produce a clear unavailable state, not substitute identity.

Fresh official Harness source is isolated in ignored `vendor/deepseek-harness`. Revision is recorded in `licenses/SOURCES.json`; no existing user profiles or credentials are loaded. No pharma-project integration.

Local branch owns UI, server fallback and launchers. Cloud branch owns `packages/decision-core`, `contracts`, `tests/contracts`, and designated architecture/development/license documentation. No model weights, environments, user history, credentials or vendor checkouts belong in Git.
