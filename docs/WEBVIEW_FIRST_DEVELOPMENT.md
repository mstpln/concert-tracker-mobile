# Webview-first development

## Normal workflow

Start a ChatGPT Project conversation with the desired outcome, scope, and any visual or data constraints. ChatGPT reads the repository state, creates or reuses a feature branch, edits files, runs available checks, commits, pushes, and opens or updates a pull request after scope approval.

A branch push updates GitHub only. It does not merge, deploy, modify production data, or run production workflows. The PR remains the review boundary until the user explicitly says `Merge it`.

## Source of truth and continuity

GitHub `main` is authoritative. Before work, read:

- `AGENTS.md`
- `docs/LIVEVAULT_STATE.md`
- `docs/LIVEVAULT_DECISIONS.md`
- `docs/LIVEVAULT_BUILD_STATE.json`
- relevant code and recent PRs

Chat messages and uploaded copies may be stale. The repository documents and current branch are the durable handoff between sessions.

## QA model

Normal automated browser work uses the synthetic QA build in `dist`:

- deterministic fictional fixtures
- a fake Worker and isolated browser storage
- a visible `QA PREVIEW · SYNTHETIC DATA` banner
- desktop and mobile Chromium projects
- blocked unexpected external requests
- no production Worker, R2 data, provider APIs, tokens, or user concert history

PR QA runs unit tests, syntax/version/workflow checks, fixture validation, deterministic build-state validation, safety checks, and desktop/mobile Playwright tests. A separate manual Full PWA QA workflow checks service-worker and installability behaviour without touching production.

## GitHub Desktop

GitHub Desktop is normally unnecessary for webview-first work. Use it only when:

- starting later work from a local Codex checkout and the local repository must be pulled first
- local Git authentication requires **Push origin**
- the user intentionally wants to inspect or work with the branch locally

Do not pull, push, switch branches, merge, or publish in GitHub Desktop merely because the webview branch changed. ChatGPT should state explicitly when a local action is required.

## Manual boundaries

Automation cannot fully validate real-device behaviour. Manual confirmation remains appropriate for:

- PWA installation and update behaviour on the user's actual phone
- file picker and PDF opening behaviour
- phone storage and permissions
- real mobile Chrome rendering
- Cloudflare Pages project setup
- Cloudflare Worker secret configuration and deployment
- the manual production smoke workflow

Production actions remain separate from PR creation and require explicit user approval.
