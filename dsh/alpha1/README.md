# Harness alpha.1 local proof

Official tag `dsh-v0.1.3-alpha.1`, commit `d347e703908d0406b7a7ef80e3a0e594d86b2215`, is the locked baseline. npm has no published alpha.1 package, so the official source CLI runs via its supported `node --import tsx/esm` path with the `sdk` profile. This is not a substitute agent loop.

`D:\Companion-Agent\data\dsh-home-alpha1` is isolated from 0.2 and other projects. The upstream checkout is clean. pnpm 11.7.0 installed 1068 packages from its original frozen lockfile. The required `fs-ext@2.1.1` native extension was built with existing Visual Studio Build Tools and Python; no global installation was needed. Other dependency install scripts remain skipped.

## Validation

Run `node D:\Companion-Agent\dsh\alpha1\run-proof.mjs` for a keyless SDK handshake. Add `--live` only for an explicitly authorized small real DeepSeek file task. It uses this application's own configured credential internally and never prints it. Live execution is not part of ordinary unit tests.

Validated: source runtime launch, Cordis tool registration, SDK initialization, official DeepSeek response, actual `companion_write_note` execution, file existence/content/SHA-256, and clean shutdown. See `version-lock.json` for the exact artifact. The file contains a Chinese three-item plan, not fabricated browser output.

The plugin signals registration and the official `appReady` lifecycle before the client initializes. This avoids reporting a premature SDK response as runtime readiness while sibling imports may still fail. `fs_ext.node` was the diagnosed initial boot blocker.

The overlay selects native tools, denies other tools at execution, disables general shell/filesystem/web tools and automatic session uploads/telemetry, keeps workspace-write, and sets zero automatic provider retries. The note tool writes only one fixed filename inside a newly allocated task workspace with exclusive creation. No arbitrary paths, commands or network actions are exposed by the note plugin.

## Current integration

The 8793 UI now runs actual Jev decisions and Harness file tasks. A separate persistent official alpha.1 SDK host mounts companionVoice and an authenticated loopback bridge. Voice requests route through the same real Harness adapter; no model is called on binding or saving configuration. Existing CPU Whisper serves raw PCM16 mono 16kHz WAV at 127.0.0.1:8795/transcribe. The browser records only after explicit click and permission, and uses a local Chinese system voice only as a labelled temporary output.

The official build:lib:host completed locally. Cloud's compiled-entry loader test still failed on Windows absolute import URLs and a missing gateway build dependency. The actual source-entry hosts and real Jev/file-audio end-to-end requests passed. See ACCEPTANCE.md. No final natural voice or real-time avatar claim.
