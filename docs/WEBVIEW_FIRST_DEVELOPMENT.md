# Webview-first development

1. Discuss and approve scope in ChatGPT.
2. ChatGPT reads current GitHub state and creates a branch.
3. It implements, tests, commits and opens/updates a PR.
4. PR QA and the synthetic Cloudflare Pages preview run.
5. ChatGPT reviews checks/artifacts and corrects issues.
6. You inspect the preview and say **merge it** when satisfied.
7. ChatGPT verifies final SHA/checks and merges; GitHub can delete the branch.

ChatGPT can handle normal repository work, PR text and QA evidence. You still confirm real-device installation, file-picker/PDF opening, permissions and phone-specific Chrome behaviour. Codex Desktop remains useful for local experiments; pull first before using it. A fresh Project chat remains safe because the state/decision documents and Git history hold the context; tell ChatGPT to read them when a chat reaches its limit.
