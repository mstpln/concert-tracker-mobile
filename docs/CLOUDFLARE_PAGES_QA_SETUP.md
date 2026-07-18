# Cloudflare Pages QA setup

1. In Cloudflare, open **Workers & Pages → Create application → Pages → Connect to Git**.
2. Authorize/select only `mstpln/concert-tracker-mobile` where possible; name it `livevault-qa`.
3. Set production branch to `main`, framework preset **None**, build command `npm ci && npm run build:qa`, output directory `dist`, root repository default.
4. Add `NODE_VERSION=20` only if requested. Add no Worker URL, token or other secret.
5. Deploy and confirm the banner says **QA PREVIEW · SYNTHETIC DATA** and onboarding never appears.
6. Confirm its `pages.dev` URL and PR previews are synthetic-only; do not attach the production custom domain.

Anyone with a preview URL can open it, so it deliberately contains only fictional fixtures. Robots/headers block indexing. Cloudflare Access is intentionally not required initially because it would block automated review. GitHub Pages remains the production app.
