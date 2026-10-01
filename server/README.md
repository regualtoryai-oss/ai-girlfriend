# Local Harness integration

Production `server/app.mjs` binds only 127.0.0.1:8793. It uses the exact official Harness alpha.1 source CLI with the `sdk` profile. See `dsh/alpha1/README.md` and `version-lock.json`. No newer Harness substitution or global tool install.

`createApp`/`createServer` still default to no external calls. Injected test adapters never become active without `allowExternalCalls:true`. Production uses `createHarnessAdapter` for both chat and file tasks. Jev is configured but is not called while its actual Cordis plugin is pending. Existing TypeSafe provider code is retained as a preparation seam, not the active decision loop.

Chat and task each own a separate short-lived official Harness process, fresh workspace and session. Cancelling a chat aborts only that process. File tasks are serialized, durable and idempotent, with UUID task/turn IDs and monotonically increasing revisions. Cancellation aborts the job process and forbids publishing late artifacts. Stopping avatar/audio playback never cancels a file task. The server close hook cancels running and queued jobs.

Chat has no registered execution tools. The task plugin exposes only `companion_write_note`, writing a fixed Markdown filename in its fresh workspace. The server publishes a download only after a matching successful Harness tool event and actual file exist, then verifies SHA-256 and atomically copies the artifact to the task download directory. The file-task input authorizes this bounded action; the model cannot grant wider permissions.

`GET /api/status` reports `executor:deepseek-harness`, `harnessVersion:0.1.3-alpha.1`, current provider activity, and unconnected voice/microphone/Jev. A configured/ready provider is distinguished from a successful actual call using harnessState.connected. No microphone request, voice clone or generated real-time face is present.

Provider keys are accepted only through the write-only localhost admin form. Exact Origin, HttpOnly SameSite session and CSRF token are required to mutate configuration. The application privately reads its own ignored `data/private-config/providers.json`; no key value is returned, logged, put in argv, saved in Harness profiles or committed. The authorized runtime receives DeepSeek's key in a private child environment and authenticates only the configured official endpoint. Windows filesystem permissions inherit the project directory; no encryption or ACL changes are claimed.

Admin saves alone make no requests. `POST /api/admin/test` remains disabled. The text submission and Harness task forms explicitly invoke the configured provider. Session telemetry and automatic session-log upload are disabled. The task timeout is 65 seconds and the provider has zero automatic retries.

Validation: 8 existing server tests and 2 Harness job lifecycle tests passed without real provider calls. Real browser submission produced a three-item Chinese Markdown via Harness, HTTP 200 download and matching SHA-256; download was clicked. See `dsh/alpha1/ui-acceptance.json` for sanitized synthetic-test evidence. Full voice, Jev routing and custom live avatar are pending.
