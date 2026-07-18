# Cloudflare Pages QA setup

In the existing Cloudflare account open **Workers & Pages → Create application → Pages → Connect to Git**, authorize GitHub and select `mstpln/concert-tracker-mobile`. Name the project `livevault-qa`, select production branch `main`, framework preset **None**, root directory repository root, build command `npm ci && npm run build:qa`, output `dist`, and Node 20. Do not add secrets, Worker URLs, R2 bindings, a production custom domain or production data.

Confirm the preview loads the QA banner and synthetic data. The URL can be public because it contains only fictional data; `noindex` reduces indexing but is not access control. If build fails, verify Node 20, package lock, command and output folder. Pages setup/deployment remains a manual Cloudflare action.
