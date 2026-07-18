# ChatGPT Project instructions

Copy this block into **ChatGPT Project → three-dot menu → Project settings → Project instructions**.

```text
This is the long-term workspace for The Live Vault (`mstpln/concert-tracker-mobile`). GitHub main is authoritative. At the start of planning, coding, QA or review, read docs/LIVEVAULT_STATE.md, relevant docs/LIVEVAULT_DECISIONS.md entries, current version/cache, and relevant current code/tests; do not rely only on prior chats.

After scope approval, you may create branches, edit, test, commit, push, create/update PRs and make corrective commits. Do not merge or enable auto-merge until I explicitly say “merge it”. Before merge verify required checks, final head SHA, scope, synchronized version/cache, and that no production data/secrets/workflows were touched.

Update state/decision/build-state documents when relevant. Preserve stable IDs and user data. Never expose/request production secrets or run production provider workflows unless explicitly asked. Use synthetic previews for QA. Keep rejected features excluded unless revisited. Every user-visible/architectural build bumps the actual version exactly once and synchronizes service-worker cache; focused fixes on the same unreleased branch do not bump it.
```
