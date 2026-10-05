# Local Harness integration

`npm run demo` runs `server/demo.mjs` with explicit `offline-demo` status and
`allowExternalCalls:false`. Its deterministic adapter simulates chat and a bounded
draft plan, while approval, local file creation and download are actual operations.
It does not read private provider configuration, authorize external calls or start
voice capture. Configuration routes are unavailable in this mode.

`npm start` runs `server/app.mjs` in local real-runtime mode. It binds only
`127.0.0.1`, default port 8793, configurable through `COMPANION_PORT`. This entry
enables external calls to the user's configured providers. It uses the fixed
official Harness `0.1.3-alpha.1` source CLI with the `sdk` profile. See
`dsh/alpha1/README.md` and `dsh/alpha1/version-lock.json`. The public repository does
not bundle an installed runtime or usable provider credentials.

`createApp`/`createServer` default to external calls disabled. The explicit demo
flag permits its local conversation adapter but cannot be combined with external
authorization. Real mode uses `createHarnessAdapter` for chat, note tasks and
workspace conversations. A server-owned bridge binds TypeSafe with logging off
and zero retries. Its candidate result is checked independently against the
decision-core contract and permission rules; model decisions do not grant broader
execution permissions.

## Execution and file scope

Each real turn owns a short-lived Harness process and session workspace. The
legacy `/api/chat` route has no execution tools. The bounded note-task plugin
exposes `companion_write_note`, writing a fixed Markdown filename; a matching
successful tool event, actual file and SHA-256 check are required before publishing
the downloadable note.

The newer `/api/conversation` route supports listing and reading files in the
isolated application workspace. Create, replace, move and bounded XLSX operations
require a concrete plan and matching user approval. Relative-path constraints and
expected file hashes are checked by the file layer. The plan does not provide
arbitrary desktop access, deletion, script execution or messaging tools. Cancel or
amend invalidates pending work; already completed operations remain.

Jobs have UUID task/turn IDs, persistent records, event sequence numbers and
revisions. On restart, unfinished workspace conversations are marked `interrupted`
for user review/retry; they are not automatically resumed. Stopping avatar/audio
playback does not cancel a file task. Server close aborts active and queued work.
Legacy chat/note turns use a 65-second deadline; workspace-agent turns use a
10-minute deadline, with file-plan approval expiring after 5 minutes.

## Configuration and external requests

Provider keys are accepted through the write-only localhost admin form. Exact
Origin, an HttpOnly SameSite session and CSRF token protect mutations. The app reads
only its own ignored `data/private-config/providers.json`; keys are not returned,
logged, placed in argv or committed. Child processes receive only their selected
provider credential. Official DeepSeek and Jev configurations are restricted to
their official endpoints. Relay configuration uses a separate credential and one
of four allowlisted endpoints from `model-routing.mjs`; the official key is never
reused for a relay. Endpoint/model probes must match the current relay configuration
before it is eligible for chat or tool routing. There is no automatic cross-site
retry or replay after execution.

In real mode, saving DeepSeek/Jev configuration makes no provider request. Saving
relay configuration without `clear:true`, when external calls are enabled,
attempts an authenticated `GET <selected-entry>/v1/models`. The manual
`POST /api/admin/relay-discover` route performs the same discovery. Neither is a
generation test or balance check, and a returned model list proves neither tool
support nor output quality. Public users must verify their own endpoint/account;
the four choices are not preverified for them.

`POST /api/admin/relay-test` requires `confirmMeteredRequests:true` and external
authorization. It can send up to two small generation requests: short chat and a
harmless `connection_check` tool call, each with at most 64 output tokens and a
2048-byte request-body limit. Tests do not execute file operations. Their results
do not replace a real Harness streaming/task acceptance test. The legacy
`POST /api/admin/test` remains disabled.

User-submitted real chat/tasks explicitly invoke configured providers. Session
telemetry and automatic session-log uploads are disabled. Windows file permissions
inherit the project directory; encrypted storage or additional ACL hardening is
not implemented.

## Status and evidence

`GET /api/status` reports the current mode, executor, Harness version, provider
activity and distinct voice/Jev readiness. Configured readiness is separate from
a successful real call through `harnessState.connected`. Microphone capture
requires user click and browser permission. No voice clone or generated real-time
face is bundled.

Run `npm test` for the public version's offline regression suite. Historical real
browser note download, Jev routing and file-ASR-to-Harness results are recorded in
`ACCEPTANCE.md` and `dsh/alpha1/ui-acceptance.json`. Those records do not claim live
calls were rerun during public-release preparation. Actual microphone, natural
voice quality, custom live avatar and the new multimodal interfaces still require
separate acceptance.
