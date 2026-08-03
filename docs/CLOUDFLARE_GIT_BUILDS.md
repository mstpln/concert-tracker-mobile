# Cloudflare Git Builds for Live Vault

This repository is the source of truth for the existing Cloudflare Worker `concert-tracker-api`.

## Repository configuration

- Worker configuration: `wrangler.jsonc`
- Worker entry point: `worker.js`
- Worker name: `concert-tracker-api`
- R2 binding: `BUCKET`
- R2 bucket: `concert-tracker-data`
- Runtime secrets remain configured only in Cloudflare and are never committed.

## One-time Cloudflare connection

Connect the existing Worker only after this configuration is merged to `main`.

1. Open Cloudflare Workers & Pages.
2. Open `concert-tracker-api`.
3. Open Settings, then Builds.
4. Under Git Repository, select Connect.
5. Select GitHub and authorize access to `mstpln/concert-tracker-mobile`.
6. Use production branch `main`.
7. Use root directory `/`.
8. Leave the build command empty.
9. Use deploy command `npx wrangler@4.114.0 deploy`.
10. Disable builds for non-production branches.
11. Save the connection.
12. Configure build watch include paths to:
    - `worker.js`
    - `wrangler.jsonc`
    - `package.json`
    - `package-lock.json`
13. Leave exclude paths empty.

The first connected build should be triggered only after the reviewed configuration is on `main`. Verify that the active Worker still has the existing `BUCKET` binding and runtime secrets after deployment.

## Normal future flow

1. Worker changes are made on a feature branch and tested with synthetic fixtures.
2. A pull request is opened and PR QA must pass.
3. The user explicitly says `Merge it`.
4. Merge to `main` triggers Cloudflare only when a watched Worker deployment file changed.
5. Cloudflare deploys the reviewed `main` version to the existing Worker.
6. Confirm the app loads and the Worker build is successful.

App-only changes do not trigger the Worker when none of the watched files changed.

## Production boundaries

Automatic Worker deployment does not authorize or automate:

- R2 object uploads, replacements or deletion;
- data migrations or backfills;
- secret creation, rotation or removal;
- binding or route changes beyond reviewed repository configuration;
- production workflows or live provider calls.

Those actions remain separately approved and manually verified.

## Rollback

Use Cloudflare Worker deployment history to restore the previous Worker version if a deployment fails. Worker rollback does not roll back R2 data changes, so production data operations remain separate and controlled.
