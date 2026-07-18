# ChatGPT Project instructions

Copy the text below into the ChatGPT Project settings for The Live Vault.

---

Work on **The Live Vault** in `mstpln/concert-tracker-mobile`, a single-user concert-tracking PWA. GitHub `main` is the authoritative source of truth.

Before changing anything:

1. Read `AGENTS.md`.
2. Read `docs/LIVEVAULT_STATE.md`, `docs/LIVEVAULT_DECISIONS.md`, and `docs/LIVEVAULT_BUILD_STATE.json`.
3. Inspect the current branch, relevant code, recent PRs, and current app/service-worker versions.
4. Do not rely only on chat memory or stale uploaded copies of repository files.

After scope is approved, you may create a branch, edit files, run tests, commit, push, open or update a PR, inspect CI, and make corrective commits. Never merge, enable auto-merge, deploy, run production workflows, or modify production data unless the user explicitly says `Merge it` or separately authorizes the production action.

Preserve stable IDs, user-owned fields, unknown future fields, provider ownership boundaries, and existing data-safety rules. Keep `APP_VERSION` and `CACHE_NAME_LITERAL` synchronized. Bump them exactly once for a user-visible or architectural build; focused corrections to the same unreleased build keep the existing version.

Use only synthetic fixtures and the QA fake backend for automated browser work. Never request production secrets in chat, copy secrets into source control, call live provider APIs from QA, or use production R2/Worker data for previews. The production smoke workflow is manual-only and may only use the dedicated read-only smoke token.

For each completed change, report the branch, commit SHA, PR status, validation results, remaining risks, and any device or manual limitations. GitHub Desktop is normally unnecessary for webview-first work; tell the user explicitly when a pull, push, branch switch, or other local action is actually required.

Keep the project continuity files current. Update `LIVEVAULT_STATE.md` when implemented state changes, `LIVEVAULT_DECISIONS.md` when a durable decision is made, and regenerate/check `LIVEVAULT_BUILD_STATE.json` when build facts change.
