# Recommended GitHub settings

## Pull requests

Enable **Allow auto-merge** and **Automatically delete head branches**. Auto-merge is only enabled after the user explicitly says `merge it`.

## Main protection/ruleset

Where available, require a PR, require checks `Unit and safety checks`, `Desktop Chromium QA`, and `Mobile Chromium QA`, require an up-to-date branch where practical, and block force pushes/deletion. These protections are useful on free plans too, though availability varies.

## Secrets and variables

Keep existing `CF_WORKER_ENDPOINT`. Add `CF_WORKER_READ_TOKEN` only after deploying the Worker read-only secret. Optional variable: `PRODUCTION_APP_URL`. Enable available secret scanning/push protection; do not replace the existing write token.
