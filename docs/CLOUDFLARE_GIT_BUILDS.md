# Cloudflare Git Builds for Live Vault

This repository is the source of truth for the existing Cloudflare Worker `concert-tracker-api`.

## Repository configuration

- Worker configuration: `wrangler.jsonc`
- Worker entry point: `worker.js`
- Worker name: `concert-tracker-api`
- R2 binding: `BUCKET`
- R2 bucket: `concert-tracker-data`
- Runtime secrets remain configured only in Cloudflare and are never committed.

## Cloudflare build configuration

The production Worker is connected to `mstpln/concert-tracker-mobile` with:

- Production branch: `main`
- Root directory: `/`
- Build command: empty
- Deploy command: `npx wrangler@4.114.0 deploy`
- Build variable: `NODE_VERSION=22`
- Non-production branch builds: disabled
- Build watch include paths:
  - `worker.js`
  - `wrangler.jsonc`
  - `package.json`
  - `package-lock.json`
- Build watch exclude paths: empty

Wrangler 4.114.0 requires Node.js 22 or newer. The first build attempted with Cloudflare's Node.js 20 default and failed before deployment. After `NODE_VERSION=22` was added, the retry completed successfully.

## One-time connection record

The existing Worker was connected after the reviewed v79 configuration was merged to `main`. The first successful deployment used merge commit `8deb2f03e6b7e224ce84e9609508eb0b37016d04` and Cloudflare build `6ac9e5e3`.

After deployment, the user confirmed that:

- the app loaded normally;
- Settings showed v79;
- bands and concerts loaded;
- listening statistics remained available.

This confirms that the existing `BUCKET` binding and runtime tokens remained functional after the repository-driven deployment.

## Normal future flow

1. Worker changes are made on a feature branch and tested with synthetic fixtures.
2. A pull request is opened and PR QA must pass.
3. The user explicitly says `Merge it`.
4. Merge to `main` triggers Cloudflare only when a watched Worker deployment file changed.
5. Cloudflare deploys the reviewed `main` version to the existing Worker.
6. Confirm the Cloudflare build succeeded and perform a quick app smoke check.

App-only and documentation-only changes do not trigger the Worker when none of the watched files changed.

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
