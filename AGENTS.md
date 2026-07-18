# The Live Vault - Codex Project Instructions

These instructions apply to all Codex work in this repository.

The Live Vault is a personal, single-user Progressive Web App for tracking followed bands, upcoming concerts, attended concerts, setlists, playlists, photos, ratings, notes, ticket costs, alerts, news, venues, and concert statistics.

The application is hosted as a static site on GitHub Pages. The browser app reads and writes JSON data through a Cloudflare Worker backed by an R2 bucket. A GitHub Actions research pipeline uses external providers such as Ticketmaster, Tavily, Groq, setlist.fm, Spotify, and OpenStreetMap.

Follow every rule below unless the user explicitly overrides it for the current task.

---

## 1. Read this file first

Before planning or implementing any task:

1. Read this entire `AGENTS.md`.
2. Inspect the relevant existing implementation.
3. Confirm the requested scope from the user's task.
4. Identify the files likely to change.
5. Preserve all unrelated behavior and design.
6. Ask before expanding the task beyond its stated scope.

Do not assume that a requested redesign, cleanup, refactor, migration, or architecture change is allowed unless it is explicitly requested.

---

## 2. Branch and repository safety

- Never make feature or bug-fix changes directly on `main`.
- Never push directly to `main`.
- Create a separate branch for each implementation.
- Use a descriptive branch name such as:
  - `feature/musicbrainz-identity`
  - `feature/concert-weather`
  - `feature/expected-setlist`
  - `fix/settings-usage-numbers`
- Keep one feature or tightly related change per branch.
- Never merge a branch or pull request without explicit user approval.
- Never deploy without explicit user approval.
- Never delete branches, tags, releases, or repository history without explicit approval.
- Never force-push unless the user explicitly requests it and the risks have been explained.
- Do not combine unrelated cleanup with a requested feature.
- Do not rename files, functions, fields, screens, or routes merely for stylistic preference.
- Do not introduce broad formatting-only diffs unless specifically requested.

When working in a Codex environment that creates an isolated branch automatically, still report the branch name and confirm that `main` was not modified.

---

## 3. Production safety

Treat the following as production systems and production data:

- GitHub Pages deployment
- Cloudflare Worker configuration
- Cloudflare Worker secrets
- Cloudflare R2 bucket
- GitHub Actions secrets
- Production GitHub Actions workflows
- `bands.json`
- `concerts.json`
- `news.json`
- `apiUsage.json`
- Any future production JSON data files

Rules:

- Never write to production Cloudflare R2 data without explicit approval.
- Never migrate, delete, overwrite, or backfill production data without explicit approval.
- Never run the production research workflow unless explicitly requested.
- Never trigger a workflow that can write to production data unless explicitly requested.
- Never modify production Cloudflare Worker bindings, routes, secrets, or environment variables without explicit approval.
- Never modify GitHub Actions secrets.
- Never reveal, print, log, screenshot, commit, or echo credentials.
- Never include API keys, bearer tokens, client secrets, OAuth tokens, Worker tokens, or private URLs in code, diffs, screenshots, logs, issue text, or pull-request descriptions.
- Use fixtures, mocks, local files, or synthetic test data during development.
- If a production test is genuinely necessary, stop and ask for approval first.

---

## 4. Scope control

For every task:

- Make the smallest complete change that satisfies the request.
- Preserve behavior outside the requested feature.
- Do not redesign unrelated screens.
- Do not add extra features, icons, labels, settings, animations, or navigation.
- Do not change copy outside the requested area.
- Do not change API limits, safety caps, provider behavior, data retention, or validation rules unless explicitly requested.
- Do not silently change stored-data schemas.
- Do not add new runtime dependencies without explicit approval.
- Prefer existing project patterns and utilities over introducing a new framework or architecture.
- If a request appears to require a wider architectural change, explain the need and ask before implementing it.

---

## 5. Current application architecture

Preserve the existing architecture unless a task explicitly requires a change.

### Front end

The browser/PWA app is primarily composed of:

- `index.html` - app shell and screen containers
- `app.js` - UI rendering, interaction logic, navigation, and app-side behavior
- `app.css` - visual design and responsive layout
- `icons.js` - local inline SVG icon set
- `dataLib.js` - shared data helpers and business logic
- `remoteStore.js` - Cloudflare Worker storage transport and local-storage shim
- `manifest.json` - PWA metadata
- `service-worker.js` - app-shell caching and PWA service worker
- `version.js` - app version label

### Backend and storage

- `worker.js` - Cloudflare Worker API
- Cloudflare R2 - production JSON storage
- The Worker only serves explicitly allowed files.
- Adding a new production JSON file requires an intentional Worker allowlist change and explicit user approval.

### Research pipeline

The automated research pipeline includes:

- `research.js` - orchestration
- `config.js` - provider settings, limits, caps, and pacing
- `usageTracker.js` - provider usage enforcement and persisted counters
- `ticketmaster.js`
- `tavily.js`
- `groq.js`
- `setlistfm.js`
- `spotify.js`
- `geocode.js`
- `workerClient.js`
- `util.js`

Some repositories may place these files under folders such as `scripts/` or `scripts/lib/`. Follow the actual repository structure rather than assuming the flattened upload structure.

---

## 6. Data integrity rules

The user's data is the most important part of the application.

Never overwrite or remove user-entered fields unless the user explicitly requests it.

Protected user-controlled fields include, but are not limited to:

- attendance status
- ratings
- notes
- ticket price
- ticket quantity
- free-ticket status
- playlist links
- photo links
- manually added concerts
- favorites
- muted status
- custom band information
- any user-reviewed identity decision

When adding generated or researched fields:

- Add fields defensively so older records without them still work.
- Preserve backward compatibility where practical.
- Use clear names that distinguish generated data, predicted data, verified data, and user-entered data.
- Never present predicted information as confirmed.
- Never present a weak source as verified.
- Store timestamps and source references where useful.
- Avoid destructive migrations.
- Prefer additive schema changes.
- Before any schema migration, provide:
  1. old shape
  2. new shape
  3. migration logic
  4. rollback plan
  5. data-loss analysis
- Do not run migrations against production without explicit approval.

---

## 7. Research pipeline safety

The research pipeline must remain conservative, deterministic where possible, and safe against quota overuse.

- All applicable provider calls must continue through `UsageTracker`.
- Respect configured per-run, daily, monthly, token, and pacing limits.
- Do not weaken caps to make a test pass.
- Do not bypass provider pacing.
- Do not repeatedly fetch the same data when caching or reuse is possible.
- Preserve the mandatory full-date policy for discovered concerts.
- Never infer or invent a year for a concert date.
- Preserve protection against tribute acts, cover acts, parody acts, and similarly named artists.
- Preserve artist, venue, date, and source validation.
- Use deterministic checks for validation and conflict detection whenever possible.
- Use AI only where it adds value and never as the sole authority for high-confidence claims.
- A failed provider call should fail safely and should not create guessed data.
- Count attempted calls when the provider quota would count them.
- Keep generated data clearly labelled.
- Log enough context for debugging without logging secrets or personal tokens.
- New providers must have:
  - documented purpose
  - timeout handling
  - retry behavior
  - error handling
  - quota handling
  - caching strategy
  - data-source attribution
  - test coverage where practical

---

## 8. MusicBrainz and artist identity rules

For MusicBrainz identity work:

- Use the MusicBrainz Artist ID (`MBID`) as a stable external artist identifier.
- Do not auto-assign an ambiguous artist match.
- Use conservative automatic matching.
- Prefer false negatives over incorrect identity assignments.
- Store enough metadata to review a match, such as:
  - MBID
  - matched artist name
  - area or country
  - artist type
  - disambiguation text
  - confidence
  - status
  - matched date
  - reviewed date
- Provide a manual review path for uncertain matches.
- A user-confirmed match must not be silently replaced by automation.
- A rejected candidate should not repeatedly return without a reason.
- Backfills must preserve all unrelated band fields.
- Test artists with identical names, punctuation differences, diacritics, tribute acts, solo artists and bands, renamed acts, inactive acts, and missing results.

---

## 9. setlist.fm rules

- Treat setlist.fm data as crowd-sourced and potentially incomplete.
- A missing setlist is not an error.
- Preserve recheck intervals so missing setlists are not requested every run.
- Do not claim career-wide rarity unless the comparison truly supports it.
- Rarity language must state the comparison window, for example: `Played at 2 of the previous 50 recorded shows`.
- Expected setlists must always be labelled as expected, predicted, or suggested.
- Do not present an expected setlist as the real setlist.
- Reuse cached artist setlist history between expected-setlist and rarity features where practical.
- Respect configured setlist.fm pacing and call caps.
- Keep covers clearly marked.
- Do not attach Spotify links to covers unless the original artist is reliably identified and the feature explicitly requires it.

---

## 10. Spotify rules

The project currently has app-only Spotify logic for track lookup.

For playlist creation or personal-account access:

- Never ask the user for a Spotify username or password.
- Use Spotify's official OAuth authorization flow.
- For a browser/PWA client, prefer Authorization Code with PKCE.
- Request the minimum scopes required.
- Keep playlist creation separate from ordinary app-only track lookup.
- Never commit client secrets or OAuth tokens.
- Handle token expiry, refresh, denial, disconnect, and revoked access.
- Preserve expected-setlist order when building a playlist.
- Exclude covers when that is the approved rule.
- Avoid live, remix, acoustic, demo, karaoke, tribute, and unrelated versions unless intentionally selected.
- If confident matching fails, skip the song and clearly report the number skipped.
- Do not imply Spotify provides public exact stream counts when it does not.
- Store playlist URLs without overwriting an existing user-supplied playlist link unless the user confirms replacement.

---

## 11. Weather rules

For concert weather:

- Only show forecasts within a useful forecast window.
- Treat weather as a forecast, never a certainty.
- Use venue-local dates and times where possible.
- Prefer hourly conditions near concert time when available.
- Use concise daily summaries when the event is further away.
- Cache results to avoid unnecessary calls.
- Preserve the last successful forecast for temporary offline use where practical.
- Do not show stale forecasts as current.
- Distinguish indoor and outdoor relevance in the UI.
- Keep weather icons local to the app.
- Do not introduce a paid provider or login without explicit approval.

---

## 12. Verification and conflict rules

For concert freshness, verification, cancellations, postponements, and source disagreements:

- Store source observations before resolving conflicts.
- Do not silently overwrite a concert when trusted sources disagree.
- Preserve the original record until a conflict is reviewed or a clear trusted rule resolves it.
- Track source, source type, observed value, observation time, verification time, confidence, and resolution.
- Treat `verified` as a strong claim and use it only when justified.
- Distinguish recently checked, supported by one source, supported by multiple sources, conflicting, stale, cancelled, and postponed.
- Preserve user-entered concert information.
- Provide source links in review interfaces.
- Do not create noisy repeated conflicts for issues the user has already resolved.
- Keep a resolution history where practical.

---

## 13. UI and visual design rules

The user expects tightly controlled visual changes.

- Preserve unrelated UI exactly.
- Change only the screen, card, component, or element requested.
- Do not add logos, icons, decorative symbols, chevrons, badges, labels, or explanatory text unless explicitly requested.
- Do not make static cards clickable unless explicitly requested.
- Keep the top blue `THE LIVE VAULT` banner text-only unless explicitly instructed otherwise.
- Never add a logo or icon to the top banner by assumption.
- Preserve the current bottom navigation unless explicitly requested.
- Preserve the current blue, black, grey, and white visual language unless explicitly requested.
- Keep essential icons and assets local.
- Do not use external CDNs for core UI assets.
- Prefer inline SVGs in `icons.js` when consistent with the existing implementation.
- Maintain responsive layouts at approximately 375 px and 480 px widths.
- Verify dark mode.
- Verify light mode where supported.
- Prevent text and numeric values from overflowing at narrow widths.
- Use accessible labels for buttons and interactive icons.
- Preserve keyboard and touch usability.
- Do not copy accidental elements from mockups.
- When a mockup and written instructions differ, follow the written instructions.
- When several visual variants are produced, number every version clearly so the user can reference it.

---

## 14. Accessibility rules

For visible UI changes:

- Preserve or improve semantic HTML.
- Add appropriate `aria-label` values to icon-only controls.
- Maintain sufficient contrast.
- Ensure text remains readable at narrow widths.
- Do not rely only on color to communicate state.
- Keep tap targets usable on mobile.
- Avoid focus traps.
- Preserve browser back behavior and in-app navigation.
- Respect reduced-motion preferences when adding animation.
- Do not add autoplaying sound, video, or motion.

---

## 15. Testing requirements

Run the tests relevant to the change.

At minimum, test:

- normal expected data
- missing optional fields
- older stored records without new fields
- empty states
- API failure
- malformed provider response
- rate-limit or quota exhaustion
- duplicate data
- ambiguous identity matches where relevant
- narrow mobile width
- dark mode
- light mode where supported

For data or pipeline changes:

- Use fixtures or mocks.
- Do not use production R2.
- Verify idempotency where applicable.
- Verify that rerunning does not create duplicates.
- Verify that user-entered fields remain unchanged.
- Verify that failures do not write partial or guessed records.
- Verify quota counters and pacing remain correct.

For UI changes:

- Provide screenshots where the environment supports them.
- Compare screenshots against the approved design reference.
- Test approximately 375 px and 480 px widths.
- Check long names, long numbers, and missing values.
- Confirm unrelated screens are unchanged.

If the repository has no existing test framework, do not introduce a large framework without approval. Add focused lightweight tests or a documented manual test plan.

---

## 16. Version and service-worker cache rules

The PWA uses both:

- `APP_VERSION` in `version.js`
- `CACHE_NAME_LITERAL` in `service-worker.js`

Rules:

- Do not bump the version during ordinary development unless a test build or release requires it.
- When preparing a release, update both values to exactly the same version.
- Never update only one of them.
- Confirm that they match before completing a release task.
- A version bump is not permission to deploy.
- Never deploy without explicit approval.
- Preserve the service worker's policy of caching the app shell but not Cloudflare Worker data.
- Do not add production data files to the service-worker cache.

---

## 17. Cloudflare Worker rules

- Preserve authentication requirements.
- Preserve CORS behavior unless a task explicitly requires a reviewed change.
- Preserve JSON validation on writes.
- Keep the explicit allowed-file list.
- Adding a new data file requires:
  1. user approval
  2. Worker allowlist change
  3. storage design explanation
  4. backward compatibility analysis
  5. test coverage
  6. rollout plan
- Do not expose a general unrestricted file API.
- Do not log bearer tokens.
- Do not weaken authorization for convenience.
- Do not add destructive endpoints without explicit approval.

---

## 18. Secrets and security rules

- Never hardcode real secrets.
- Never expose masked secrets more fully than they already appear.
- Never replace a masked value with a real credential.
- Never store personal login details.
- Never request the user's password for Spotify, GitHub, Cloudflare, or any provider.
- Use official OAuth or secret-management flows.
- Keep development credentials separate from production credentials.
- Do not include secrets in client-side JavaScript when they must remain private.
- Do not add analytics, trackers, advertising, or third-party telemetry without explicit approval.
- Do not send the user's concert history or personal data to a new provider without explicit approval and a clear explanation.

---

## 19. Documentation rules

When adding or changing a feature:

- Update relevant comments and documentation.
- Keep documentation consistent with actual behavior.
- Do not claim a feature is live before it is deployed.
- Do not claim a provider is authoritative when it is not.
- Document new fields, files, setup requirements, secrets, scopes, and manual steps.
- Document limitations and fallback behavior.
- Avoid stale comments that describe previous logic.
- Prefer concise comments explaining why a non-obvious rule exists.

---

## 20. Planning tasks

When the user asks for planning only:

- Do not edit files.
- Do not create commits.
- Do not create branches unless explicitly requested.
- Do not create a pull request.
- Do not run production workflows.
- Do not write to Cloudflare or R2.
- Do not change stored data.
- Return:
  1. proposed architecture
  2. files expected to change
  3. data-shape proposal
  4. API and quota impact
  5. UI impact
  6. test plan
  7. rollout plan
  8. risks and open questions

---

## 21. Implementation tasks

When implementing an approved feature:

1. Read `AGENTS.md`.
2. Create or use the requested feature branch.
3. Inspect the current implementation before editing.
4. State the intended scope.
5. Make focused changes only.
6. Add or update tests.
7. Use local or mocked test data.
8. Do not touch production systems.
9. Do not merge.
10. Do not deploy.

---

## 22. Required completion report

At the end of every implementation task, provide:

1. Branch name
2. List of every changed file
3. Summary of what changed
4. Complete diff or a clear link to the diff
5. Tests run
6. Test results
7. Manual testing completed
8. Screenshots for visible UI changes where possible
9. Data-schema changes
10. Backward compatibility notes
11. API usage or quota impact
12. New setup, secrets, scopes, or login requirements
13. Remaining risks or limitations
14. Confirmation that production data was not modified
15. Confirmation that Cloudflare production configuration was not modified
16. Confirmation that the production research workflow was not run
17. Confirmation that nothing was merged
18. Confirmation that nothing was deployed

If a requested item cannot be produced, explain why.

---

## 23. Pull requests

When preparing a pull request:

- Use a clear title.
- Describe the feature and scope.
- List changed files.
- Include tests and results.
- Include screenshots for UI changes.
- Explain schema changes.
- Explain manual setup.
- Note API and quota impact.
- Note limitations.
- Confirm no production data was modified.
- Do not merge the pull request.
- Do not enable automatic merge.

---

## 24. Default decision rule

When uncertain, choose the option that is:

1. safer for production data
2. easier to review
3. easier to roll back
4. smaller in scope
5. more compatible with existing records
6. more conservative about external claims
7. less likely to consume API quota unnecessarily

Stop and ask before taking an irreversible, production-affecting, security-sensitive, or scope-expanding action.

---

## 25. Canonical project continuity

GitHub `main` is authoritative. Chat conversations are work sessions, not the project record. Before work, also read `docs/LIVEVAULT_STATE.md`, relevant `docs/LIVEVAULT_DECISIONS.md`, and the generated `docs/LIVEVAULT_BUILD_STATE.json`.

- Update the state document when durable product, architecture, design, workflow, backlog, or limitation facts change.
- Record durable choices in the decision log, not implementation trivia.
- Regenerate build state whenever its source facts change; it must contain no timestamp, username, local path, commit SHA, or secret.
- User-visible or architectural work bumps `APP_VERSION` and `CACHE_NAME_LITERAL` together exactly once. Focused corrections on the same unreleased branch do not bump again.

## 26. Webview-first development and QA

The standard flow is scope approval → branch → local/synthetic checks → commit → push → PR → QA review → explicit merge authorization.

- Create commits and PRs only within approved scope. Never merge, enable auto-merge, or deploy unless the user explicitly says `Merge it`.
- QA previews contain fictional synthetic data only. They may never read or write production browser storage, Worker/R2 data, tickets, secrets, or provider APIs.
- QA service-worker caches use an isolated namespace and never contain Worker/R2 data.
- Automated browser tests must fail on unexpected external requests and unexpected page/console errors, while retaining successful screenshots as artifacts.
- The read-only production smoke endpoint is sanitized. `READ_ONLY_TOKEN` authorizes only `GET /qa-smoke`; it must not expose raw records, ticket files, identifiers, names, URLs, tokens, R2 keys, or stacks.
- Manual smoke may fetch only public shell files plus the sanitized endpoint, and must print only safe aggregate results.
