# Security Build 3 rollout

Security Build 3 separates the browser credential from the GitHub Actions automation credential while retaining `API_TOKEN` temporarily for a safe staged rollout.

## Credential roles

- `BROWSER_TOKEN`: may read and write the four allowed JSON documents and use private ticket PDF routes.
- `AUTOMATION_TOKEN`: may read and write the four allowed JSON documents, but receives HTTP 403 for every ticket PDF route.
- `READ_ONLY_TOKEN`: may access only the sanitized `GET /qa-smoke` endpoint.
- `API_TOKEN`: legacy compatibility during rollout. It retains the old browser-equivalent access until it is removed.

All token values must be different long random secrets. Never commit or paste them into repository files, logs, issues, pull requests, or chat.

## Safe rollout order

1. Merge v76 and manually deploy the matching `worker.js` in Cloudflare.
2. In the Worker settings, add secret `BROWSER_TOKEN` with a new random value.
3. Add secret `AUTOMATION_TOKEN` with a different new random value.
4. In The Live Vault, use Settings → Data → Connection → Disconnect, then reconnect using the existing Worker URL and the new `BROWSER_TOKEN` value.
5. In GitHub repository Settings → Secrets and variables → Actions, replace the value of `CF_WORKER_TOKEN` with the new `AUTOMATION_TOKEN` value.
6. Verify the app loads and can save normally. Verify the next scheduled research run, or a separately authorized manual run, completes normally.
7. Only after both roles are verified, remove the legacy `API_TOKEN` secret from Cloudflare.

Do not remove `API_TOKEN` before the app and GitHub Actions have both been moved to their new tokens. No R2 data migration is required.

## Device privacy controls

- **Disconnect** removes only the saved Worker URL and token from the current browser. Local settings, listening history, Spotify authorization, and cached ticket PDFs remain.
- **Erase this device** removes the saved connection, settings, Spotify authorization, imported listening history, cached ticket PDFs, and Live Vault app-shell caches from the current browser. It never deletes remote JSON data or permanent ticket PDFs in R2.
