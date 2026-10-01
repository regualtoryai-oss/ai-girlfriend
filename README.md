# Companion Agent

Chinese avatar-first local demo, bound only to http://127.0.0.1:8793. Start the prepared installation with `Start-Demo.cmd` or `node server/app.mjs`.

The active foundation is **official DeepSeek Harness 0.1.3-alpha.1**, pinned to tag `dsh-v0.1.3-alpha.1` / commit `d347e703908d0406b7a7ef80e3a0e594d86b2215`. Its source SDK runtime runs actual model/tool turns. The browser-to-Harness-to-Markdown download flow has passed a real local test; evidence is in `dsh/alpha1/ui-acceptance.json`. Task cancellation and avatar playback stopping are separate operations.

For a fresh Windows checkout: Node 24, Python and Visual Studio C++ Build Tools are prerequisites. Run `npm ci --ignore-scripts`, then `powershell -File Setup-Harness.ps1`. Setup downloads the exact official tag and its locked dependencies, builds required fs-ext, and runs a keyless smoke. It does not install global tools or call a model. Use the write-only localhost developer configuration page for independently approved provider credentials. No key is included in this repository.

Jev's actual Cordis plugin is pending source integration. Voice/ASR/TTS and microphone are unconnected. The original fictional portrait is static; the optional idle clip is cached offline research output, not a live avatar or lip-sync claim. No payment or public deployment is enabled.

Local assets are ignored: the approved portrait belongs at `public/assets/portrait.png`, with optional `public/assets/idle.mp4`. See the asset manifest. No reference-video media or noncommercial model weights/outputs are published.

Harness source, runtime caches, workspaces, user history and private provider configuration are ignored. The former 0.2 runtime remains separate and is not the integration baseline. See `server/README.md` and `dsh/alpha1/README.md` for controls and limitations.
