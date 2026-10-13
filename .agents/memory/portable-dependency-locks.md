---
name: Portable dependency locks
description: Preserve dependency installation compatibility outside Replit.
---

Check lockfile changes after using the Replit package installer; do not retain internal registry URLs in a repository also built by GitHub Actions.

**Why:** The installer rewrote public npm URLs to a Replit-only hostname during import setup, making the lockfile unusable by external CI.

**How to apply:** Preserve the imported public-registry lockfile when no dependency change is needed. If dependencies must change, verify every resolved URL remains reachable outside Replit before delivering.
