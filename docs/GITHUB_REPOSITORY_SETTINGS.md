# GitHub repository settings

In repository **Settings → General**, optionally enable automatic deletion of merged head branches and allow auto-merge; only enable auto-merge after explicit user approval. In **Settings → Rules → Rulesets**, use an optional `main` ruleset requiring pull requests, blocking force pushes and branch deletion, and requiring available PR QA checks. These controls vary by GitHub plan; no Enterprise feature is required.

In **Settings → Secrets and variables → Actions**, retain `CF_WORKER_ENDPOINT`, add `CF_WORKER_READ_TOKEN` for sanitized smoke only, and optionally set `PRODUCTION_APP_URL` as a variable. Never add provider secrets to QA workflows. Enable GitHub’s available secret scanning/push protection where offered.
