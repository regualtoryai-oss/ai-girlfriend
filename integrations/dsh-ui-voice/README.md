# Current Xiaowan client source

This directory contains the exact source used by the local author profile, copied from its installed `packages/client/ui-voice` on 2026-10-05. It derives from beiyege-01/dsh-voice-ai-girlfriend v0.3.0, commit `480bbabada7335735cad591eaa55f32fe54a4214`, with the project's existing local UI and reliability changes.

`Setup-Harness.ps1` restores it under the exact Harness source workspace, applies `integrations/harness/xiaowan-ui.patch`, and builds the host and browser artifacts. The patch contains eight existing upstream-file changes: locale branding, presentation markers, bundle registration and the compiler reference. It does not replace the DSH agent loop.

The current client keeps the original session, native approval surface, context, file task and model owners. It uses the separately installed local Voice Bridge on port 8765 for FunASR recognition and Serena speech. Recorded action clips are muted and show state changes; they do not provide real-time lip sync.

Source backups, generated libraries, cached media, browser state and user task data are excluded. The copied upstream root license is `UPSTREAM-LICENSE`; the client package declares MIT, while the upstream repository root declares Apache-2.0. Current project changes are covered by the repository license. See the repository source notice for the third-party scope.

## Verification

After the exact Harness build, from its directory run:

```powershell
node ../../build-tools/node_modules/pnpm/bin/pnpm.cjs exec vitest run packages/client/ui-voice/tests/motion-presets.spec.tsx packages/client/ui-voice/tests/reply-lifecycle.spec.tsx
```

The motion regression checks the current six clips and the quiet continuation during the gesture cooldown. The reply lifecycle tests mount the copied production listener with local synthetic chat snapshots and mocked synthesis: historical replies do not replay, an interrupted request aborts and cannot play a late response, a new user turn can speak, and unmount releases pending synthesis. No provider request or real audio playback is made.

From the repository root, also run:

```powershell
node --test integrations/dsh-ui-voice/tests/audio-lifecycle.test.mjs dsh/author/portability.test.mjs
```

These tests import the production speaker and author modules, using local mocks to check decode cancellation, queue flushing, exact probe scope, current portrait bytes, bounded context and unchanged request limits. Test fixture corrections do not alter the copied production client source.
