# The Live Vault — Coding-Agent Instructions

These rules apply to every repository task. The Live Vault is a personal, single-user PWA hosted on GitHub Pages. The browser app reads and writes JSON through a Cloudflare Worker backed by R2; research runs in GitHub Actions.

## Read first and preserve scope

Before planning, coding, QA, or review, read this file, `docs/LIVEVAULT_STATE.md`, relevant `docs/LIVEVAULT_DECISIONS.md`, the current `main`, `version.js`, `service-worker.js`, relevant implementation and tests. Do not rely on chat memory. Inspect before editing, make the smallest complete change, and ask before expanding scope. Preserve unrelated design, behaviour, names, fields, routes, API limits, workflows and stored data.

## Branch, GitHub and release safety

Never implement a feature or fix directly on `main`, push directly to `main`, force-push, reset, delete history, merge, enable auto-merge, deploy, or run a production workflow unless the user explicitly authorizes that exact action. Use one descriptive feature/fix branch and one coherent change per branch. Create a PR only when requested. **Only the explicit phrase `Merge it` authorizes a merge.** A GitHub Pages deployment is production; a version bump is never permission to deploy.

Use the webview-first workflow: branch → local synthetic QA → commit → push → PR QA → user review → explicit merge authorization. Never expose tokens, OAuth credentials, Worker URLs containing secrets, R2 paths, bearer headers, API keys, or private data in source, logs, screenshots, artifacts, diffs or PR text.

## Production and data safety

Treat GitHub Pages, Worker configuration/secrets, R2, Actions secrets/workflows, `bands.json`, `concerts.json`, `news.json`, `apiUsage.json`, and ticket PDFs as production. Never write, migrate, backfill, delete, overwrite, inspect raw production records, or run research/providers against production without explicit approval. Use fictional fixtures, mocks and local data only.

Never overwrite user-owned fields: attendance, ratings, notes, ticket price/quantity/free status, playlists, photos, manual concerts, favourites, mute status, custom band fields, ticket files/links, or reviewed identity choices. Add generated data defensively; preserve stable IDs and unknown future fields; retain timestamps/source/confidence where useful. Migrations require old/new shapes, logic, rollback and loss analysis before production use.

## Architecture and provider rules

Preserve the existing front-end (`index.html`, `app.js`, `app.css`, `icons.js`, `dataLib.js`, `remoteStore.js`, `service-worker.js`, `version.js`), Worker (`worker.js`), and scripts under `scripts/`. Prefer existing utilities and local inline SVGs; do not add runtime dependencies, endpoints, JSON files, Worker allowlist entries, providers, telemetry, analytics or external CDNs without approval.

All provider calls go through UsageTracker with configured caps, pacing, retry/caching, timeouts and safe failures. Never infer a concert year, weaken validation, fabricate research data, or use AI as the sole high-confidence authority. Preserve protections for tribute, cover, parody and same-name acts. Failed calls must not create guessed data or partial writes.

MusicBrainz uses stable MBIDs with conservative matching: false negatives beat false positives; manual confirmations are never replaced; rejected candidates do not return automatically. setlist.fm data is crowd-sourced: missing data is not an error, expected setlists remain labelled predicted, and rarity states its comparison window. Spotify personal features use official OAuth/PKCE with minimum scopes; never request passwords or commit tokens. Ticket handling must preserve existing PDF/link storage, offline behaviour and ownership metadata.

## UI, accessibility and versioning

Change only requested UI. Preserve the text-only blue top banner, existing bottom navigation, local icons, visual language, card dimensions and responsive behaviour unless requested. Validate 375px and 480px, dark mode and light mode where supported, long/missing content, keyboard and touch interactions. Use semantic controls and accessible labels; prevent horizontal overflow. Do not make static cards interactive by assumption.

For a user-visible or architectural build, bump `APP_VERSION` and `CACHE_NAME_LITERAL` together exactly once. A focused correction on the same unreleased branch does not bump again. Never cache Worker/R2 production data in the PWA shell.

## Canonical project continuity

`AGENTS.md` is the authoritative agent instruction file. `docs/LIVEVAULT_STATE.md` is the current durable project state; `docs/LIVEVAULT_DECISIONS.md` records only durable decisions; `docs/LIVEVAULT_BUILD_STATE.json` is generated and must be regenerated whenever relevant source facts change. Update state documentation when product behaviour, architecture, design rules, workflow or backlog changes; keep it factual and do not claim unmerged work is live.

## Synthetic QA previews and smoke checks

QA previews are generated only into ignored `dist/`, use only fictional fixtures, QA-prefixed browser storage, a synthetic in-memory backend, an isolated service-worker cache namespace, restrictive CSP and no real provider connection. They must never read/write production browser keys, IndexedDB, Worker/R2 data or ticket files. Automated QA must fail on unexpected page errors, console errors or external requests and retain successful screenshots as artifacts.

The Worker’s `/qa-smoke` endpoint is read-only and sanitized. `READ_ONLY_TOKEN` may call only `GET /qa-smoke`; it must never expose records, ticket files, IDs, names, URLs, tokens, R2 keys or stack traces. Manual production smoke may query only public shell files plus that endpoint; it never fetches raw JSON or ticket files and prints only safe aggregate results.

## Testing and completion

Run relevant unit tests, syntax checks, workflow validation, `git diff --check`, QA safety checks and browser tests. Test normal, missing, legacy, empty, error, malformed, quota, duplicate, idempotency and data-preservation cases where applicable. Use fixtures/mocks only. At completion report branch, every changed file, summary, diff, tests/results, visible UI screenshots where possible, schema/backward compatibility, API impact, setup requirements, remaining risks, and confirmation that no production data/config/workflow was touched, nothing merged and nothing deployed.
