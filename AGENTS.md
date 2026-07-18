# The Live Vault agent instructions

Repository: `mstpln/concert-tracker-mobile`. GitHub `main` is authoritative. Before planning, coding, QA, or review, read `docs/LIVEVAULT_STATE.md`, relevant entries in `docs/LIVEVAULT_DECISIONS.md`, inspect current `main`, `version.js`, `service-worker.js`, relevant code/tests, and merged PR history when needed. Do not rely only on chat memory.

Update the state document whenever product behaviour, architecture, design rules, workflow, or backlog changes. Add only durable constraints to the decision log. Regenerate `docs/LIVEVAULT_BUILD_STATE.json` whenever relevant source facts change.

User-visible or architectural builds increment the actual version exactly once; `APP_VERSION` and `CACHE_NAME_LITERAL` always match. A focused correction on the same unreleased branch keeps the version unchanged.

Preserve stable concert IDs, user-owned data, and unknown future fields. Provider data may only update its explicit owned allowlist. Never run production research/backfills/providers during implementation or QA, and never modify production JSON, R2, ticket files, or secrets. Use synthetic QA data only.

Create branches and PRs. Do not merge, enable auto-merge, or deploy unless the user explicitly says `Merge it`. Do not expose secrets in code, logs, screenshots, artifacts, or PR text. Keep documentation factual and current.
