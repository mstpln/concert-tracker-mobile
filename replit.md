# Running Bandmarkr on Replit

This import retains its existing static JavaScript PWA and Cloudflare Worker/R2 architecture.

## Preview

- Runtime: Node.js 22, matching `package.json`.
- Click Run to start the **Start application** workflow, or run `npm run dev`.
- The workflow uses the repository's existing synthetic QA build and serves it on `0.0.0.0:5000`.
- Frontend edits to the existing HTML, CSS, JavaScript, QA fixtures, or icons rebuild the preview automatically and reload the browser. No new frontend framework, duplicate implementation, or extra runtime dependency is used.
- The preview serves from generated `dist`; live development disables only this preview origin's service worker and removes only QA-namespaced caches so stale shell files cannot hide edits. The normal standalone QA build and its isolated service worker remain available with `npm run build:qa`.
- The visible QA banner identifies fictional data. The fake backend and isolated browser storage do not access production Worker/R2 or provider APIs.
- Use the banner's state selector to view populated, empty, delayed-loading, and synthetic load-error startup states. Reset restores the current fixture scenario.
- External API connections and external links are blocked; the preview does not perform OAuth, access production APIs, or use real credentials. External-backed operations can therefore show their safe unavailable/error state rather than live provider results.
- Listening-history and vault frontend modules stay loaded. Their IndexedDB database names are remapped into QA-only databases, automatic Cloudflare restores are disabled in synthetic mode, and the fake backend only accepts its explicit synthetic routes.
- No secrets are required for this preview. SESSION_SECRET is not used by this static app.
- Restart Run after source changes to rebuild `dist`. Build output is excluded from Git.

## Real data

The original `index.html` connects to Cloudflare with a Worker URL and access token. The Replit preview intentionally uses the existing QA build instead; do not put real credentials into it. Connecting a real-data environment is separate work requiring explicit approval and a review of Cloudflare CORS and production-write risks. See `SETUP.md` and `docs/WEBVIEW_FIRST_DEVELOPMENT.md`.

## Checks

- `npm test`: existing unit tests.
- `npm run qa:syntax`: JavaScript syntax checks.
- `npm run build:qa`: regenerate the synthetic preview.
- `node --test test/qa-build.test.js test/qa-fixtures.test.js test/qa-preview-setup.test.js`: focused preview checks.

No production deployment, research workflow, Worker configuration, data schema, or frontend design changes are part of this setup.
