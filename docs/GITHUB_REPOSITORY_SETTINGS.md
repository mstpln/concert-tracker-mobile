# GitHub repository settings

## Goal

Repository settings should protect `main`, keep pull-request QA visible and preserve the existing manual production boundaries. These recommendations do not require GitHub Enterprise.

## General repository options

In **Settings → General**:

- keep pull requests enabled;
- optionally enable automatic deletion of merged head branches;
- do not enable auto-merge for LiveVault work unless the user explicitly approves that behavior;
- keep GitHub Pages configured from `main` as it is today;
- do not change the production Pages source while reviewing the QA foundation.

## Rules for `main`

In **Settings → Rules → Rulesets**, create or update an optional ruleset targeting `main` with the protections available on the current GitHub plan:

- require changes to arrive through a pull request;
- block force pushes;
- block branch deletion;
- require the available PR QA checks before merge;
- require conversations to be resolved when review threads exist;
- allow the repository owner to merge only after explicit approval in the project workflow.

Do not select unavailable Enterprise-only controls. The exact interface and available options may differ by plan; use the closest supported equivalent rather than weakening the repository with a custom workaround.

## Actions secrets and variables

In **Settings → Secrets and variables → Actions**:

- retain the existing `CF_WORKER_ENDPOINT` secret;
- add `CF_WORKER_READ_TOKEN` only after the read-only Worker route is deployed;
- optionally add `PRODUCTION_APP_URL` as a repository variable, otherwise the smoke script uses the established GitHub Pages URL;
- keep provider secrets limited to the existing research workflows;
- never expose `API_TOKEN`, provider keys, R2 credentials or personal data to PR QA or Cloudflare Pages preview builds.

The read-only token must be different from the full `API_TOKEN`. It is intended only for `GET /qa-smoke` and must not authorize raw JSON, ticket files or writes.

## Actions permissions

Keep workflow permissions read-only unless a specific workflow has a reviewed need for additional access. The PR QA, Full PWA QA and Production smoke workflows should use `contents: read`. They must not receive write access to repository contents, deployments, issues or pull requests.

Keep the existing research and data-write workflow concurrency behavior unchanged. QA workflows must not share or cancel the production data-write concurrency group.

## Security features

Enable the repository's available secret scanning and push protection options where offered. Treat any detected credential, production JSON file, ticket PDF, archive or environment file in a pull request as a release blocker.

## Manual production smoke setup

After the Worker code is merged and manually deployed in Cloudflare:

1. Create a strong `READ_ONLY_TOKEN` Worker secret that differs from `API_TOKEN`.
2. Add the same value to GitHub as `CF_WORKER_READ_TOKEN`.
3. Confirm `CF_WORKER_ENDPOINT` points to the production Worker base URL.
4. Run **Actions → Production smoke → Run workflow** manually.
5. Verify the workflow reports only aggregate counts and schema status.

Do not run the production smoke workflow before the matching Worker route and secret are deployed. The workflow is intentionally manual and must not be attached to pull requests or scheduled runs.

## GitHub Desktop

GitHub Desktop is not needed for webview-first branch updates or PR review. Pull the repository there only before starting later work in the local Codex checkout. Do not use GitHub Desktop to merge this PR unless the user has explicitly said `Merge it`.
