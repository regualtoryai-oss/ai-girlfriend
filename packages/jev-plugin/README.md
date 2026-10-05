# Jev decision service for DSH

A real Cordis service plugin: `companionDecision`. It translates the application's strict choice/score contract into TypeSafe System One questions, calls an explicitly supplied server-side client, validates and normalizes the answer, and cancels work on timeout, client rotation, or plugin unload. It does not generate dialogue, speak, execute tasks, or grant permissions.

## Version target

- Harness: exact official tag `dsh-v0.1.3-alpha.1`, commit `d347e703908d0406b7a7ef80e3a0e594d86b2215`
- Cordis: `4.0.2`, the version in that tag
- TypeSafe SDK: `0.6.0`, verified from its official npm package

Alpha.1 does not support the newer `--from-default-profile` flag. A fresh DSH_HOME with profile name `sdk` is independent of other installations.

The exact Harness alpha.1 and matching Harness SDK are not published on npm. Build the official tagged source; do not replace it silently with alpha.2 or 0.2.0. Newer-runtime smoke checks do not establish voice-plugin compatibility.

## Install and register

Install this package's dependencies with `npm ci --prefix packages/jev-plugin`. Its local dependency is the sibling decision-core package. Do not publish this private package as-is with the local file reference; an eventual distribution needs a versioned decision-core package or a reviewed bundled build.

The manifest declares `dsh.bundle.patch`, and `cordis.patch.yml` inserts the `companion-jev` row. Use the selected **alpha.1** `dsh` launcher with a fresh personal DSH_HOME and the shipped sdk profile, then register this local package through the official plugin command:

```text
dsh --profile sdk --dump-default-config
dsh plugin --profile sdk add /absolute/path/to/packages/jev-plugin
```

`dsh plugin` owns the profile manifest and bundle list. Use a new absolute `DSH_HOME`, a fresh personal workspace, and a scrubbed child environment. Never import work/pharma profiles, configuration, files, or keys. No key is stored in this package or its Cordis configuration.

## Runtime integration

Consumer plugins declare `inject: ['companionDecision']`. The service is present and reports `unconfigured` before any provider client is bound. A server-owned provider integration calls `bindClient(client)` with a real `TypeSafeClient` configured from the administrator's approved private credential store. Register the returned disposer with the provider plugin's `ctx.effect` so its removal unbinds the client. The SDK must have logging disabled (`logLevel: 'off'`); its debug mode can log request bodies. Do not expose `bindClient` through a browser route or model tool.

The plugin never constructs a client implicitly, reads credential environment variables, probes a provider on load/bind/save, or falls back to another model. Binding changes status to `configured`; this is not a successful live connection test. No provider request occurs until `decide` is explicitly called with a configured client.

`decide(request, { state?, model?, signal? })` accepts the decision-core v1 request. Optional context is plain bounded JSON, at most 16,000 bytes and depth 8. The calling app remains responsible for authorization to transmit that context. The plugin includes only the supplied context and candidate set in the provider request; it never reads local files or conversation databases. Model selection is explicit when supplied, otherwise it follows the supplied client's configured default.

- Choice candidates receive stable per-request aliases; the response maps back to the original candidate ID
- Scores use the SDK's real two-description rubric. Its expected rubric index is therefore already in `[0,1]`; malformed values are rejected, not clamped
- Exactly one SDK call is made per decision, with retries disabled and a propagated AbortSignal
- The default total deadline is 2.5 seconds, configurable through the plugin's `timeoutMs` (1–30,000 ms)
- Returned results contain normalized decisions or `null`, status, and correlation IDs. They contain no approval, execution token, fallback chat prose, or raw provider errors
- The caller separately selects a candidate, runs the deterministic permission gate, verifies the active turn, and dispatches an authorized task through DSH
- Timeout/abort discards late results. Unload and client rotation abort all in-flight requests. A stale disposer cannot unbind a newer client

## Lifecycle and checks

The service is registered through Cordis `Service`; its disposer is owned by `ctx.effect`. Public methods are bound because Cordis uses tracking proxies and JavaScript private fields require the original instance. The actual provider client stays private and is absent from status/serialized decision results.

```sh
npm test --prefix packages/jev-plugin
npm run test:dsh --prefix packages/jev-plugin
```

Unit tests use mock clients only under `test/`. The DSH load test uses the actual pinned Harness launcher and actual Cordis loader in a disposable home, with no provider key or prompt. A missing exact-tag build is a blocker for that check, not grounds to silently run against the newer installation. These checks do not verify paid Jev access, voice-plugin compatibility, live speech, or a real Harness tool task.

## Verified checkpoint

On Node 24.19.0, 14 adapter/Cordis lifecycle tests pass. The exact alpha.1 source build also passes the real-host check: official profile initialization and plugin registration, service lookup through a dependent observer plugin, an unconfigured decision with no client, native SDK initialization, and clean shutdown. No prompt or provider key is supplied in that check. The source build requires its native `fs-ext` dependency to be compiled; do not skip required dependency build scripts when preparing the host.
