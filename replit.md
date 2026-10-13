# Running Bandmarkr on Replit

This import retains its existing static JavaScript PWA and Cloudflare Worker/R2 architecture.

## Preview

- Runtime: Node.js 22, matching `package.json`.
- Click Run to start the **Start application** workflow, or run `npm run dev`.
- The command builds the repository's existing synthetic QA app in `dist`, then serves it on `0.0.0.0:5000`.
- The visible QA banner identifies fictional data. The fake backend and isolated browser storage do not access production Worker/R2 or provider APIs.
- No secrets are required for this preview. SESSION_SECRET is not used by this static app.
- Restart Run after source changes to rebuild `dist`. Build output is excluded from Git.

## Real data

The original `index.html` connects to Cloudflare with a Worker URL and access token. The Replit preview intentionally uses the existing QA build instead; do not put real credentials into it. Connecting a real-data environment is separate work requiring explicit approval and a review of Cloudflare CORS and production-write risks. See `SETUP.md` and `docs/WEBVIEW_FIRST_DEVELOPMENT.md`.

## Checks

- `npm test`: existing unit tests.
- `npm run qa:syntax`: JavaScript syntax checks.
- `npm run build:qa`: regenerate the synthetic preview.
- `node --test test/qa-build.test.js test/qa-fixtures.test.js`: focused preview checks.

No production deployment, research workflow, Worker configuration, data schema, or frontend design changes are part of this setup.
