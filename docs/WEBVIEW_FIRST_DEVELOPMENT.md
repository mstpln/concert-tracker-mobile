# Webview-first development

For normal work, start a ChatGPT Project chat with the requested outcome and scope. ChatGPT can inspect GitHub, create a branch, edit, test, commit, push and open a PR after scope approval. A push writes the branch to GitHub; it is not a merge or deployment. The PR is reviewed with synthetic QA artifacts, then the user explicitly says `Merge it` when ready.

GitHub Desktop is normally unnecessary for webview-first work. Pull it only before starting later work in a local Codex checkout, or when terminal authentication requires its **Push origin** action. Cloudflare Pages QA previews show the generated app with fictional data, never personal concert data. Review screenshots, reports and manual preview behaviour before merging.

Chat sessions can end without losing continuity: code, PRs, `AGENTS.md`, `LIVEVAULT_STATE.md`, decisions and build state are the durable record. A new chat should read those files, inspect main and recent PRs, then continue. Device checks remain useful for PWA installation, real file picking/PDF opening, phone permissions/storage and actual mobile Chrome behaviour.
