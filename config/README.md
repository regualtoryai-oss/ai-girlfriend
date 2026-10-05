# Private author configuration

`dsh/author/setup-author.mjs` copies these templates to ignored `data/private-config/` only when the private files do not exist. It never overwrites existing settings or grants a budget.

- `providers.json`: supply the operator's own relay and Jev API keys. The current relay origin remains `https://newapi1.1234bot.com`; Jev remains `https://api.typesafe.ai`. Explicit `COMPANION_RELAY_API_KEY` and `COMPANION_JEV_KEY` environment values can be used instead. Unrelated global provider credentials are not inherited by the author host.
- `usage-budget.json`: the operator must set an approved positive USD limit and explicitly enable both `authorized` and the existing `forwardTestsAuthorized` guard before model requests. A new checkout starts with both false and zero allowance. Do not copy historical expense entries.
- `verified-prices.json`: replace null price fields with independently verified rates for the actual provider/model, then mark only those quotes verified. Do not bypass the existing quote, currency, reservation, request-size or model guards.

The default model remains `deepseek-v4-flash`; the existing staged file workflow selects `deepseek-v4-pro` only through its original route and budget checks. Jev uses `jev-latest`. Setting keys alone does not approve calls, writes or media generation.

Historical probe sessions and task IDs are excluded. `COMPANION_PROBE_SESSION_ID` optionally supplies one exact authorized session; `COMPANION_PROBE_RECOVERY_TASK_ID` optionally identifies one existing recovery task. Both are empty by default, which keeps the old probe scope closed. The ordinary current task workflow does not require these fields. `COMPANION_ARTIFACT_PROXY` optionally overrides the original `http://127.0.0.1:7892` download proxy and accepts only a credential-free loopback address with an explicit port. CDN host checks and native approval remain enforced.

Never commit populated private configuration, expense ledgers, session data or logs. The templates contain no credentials, personal tasks or provider price claims.

`npm run configure` explains the local steps without changing configuration. `node scripts/configure.mjs --init` creates only missing blank templates. `Configure-Companion.ps1 -Launch` accepts hidden credentials in process memory, restores the launcher's previous environment when it finishes, and never saves keys or approves a budget. Avoid external terminal transcripts or recording during credential entry.

The read-only readiness check now runs before a new Jev decision. It requires exact boolean approval flags, a valid USD ledger, the verified Flash quote and enough remaining allowance for the original minimum first Flash reservation. Larger requests and Pro phases still pass the original per-request budget guard. Neither a status refresh nor a voice prerequisite recheck sends a task, resets the expense ledger or retries a paid request.
