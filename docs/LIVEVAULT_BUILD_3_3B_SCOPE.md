# LiveVault Build 3.3B Scope

## Completed identity rollout

The Listening Build 3.3A identity work is complete.

- PR #75 merged as `166aa599193a269f24713356f02206b4cc5ea45d`.
- PR #76 merged as `b5dbb9d6482e8521b95ba6c7e5e931aaeaeb57e3`.
- The manually dispatched production workflow validated five targets and updated five band records.
- The updated artists were The Technicolors, Maudlin Strangers, James and the Cold Gun, The Plan, and LE SSERAFIM.
- The user confirmed in the production app that no unresolved Spotify artist identities remain and manually checked the five updated bands.
- `APP_VERSION` and `CACHE_NAME_LITERAL` remain synchronized at v95.

## Build 3.3B — Toplist

Build 3.3B is the next focused user-visible slice of issue #71.

### Included

- Rename the current **Top bands** destination to **Toplist**.
- Reuse the existing Band Detail segmented-control pattern with **Top Bands** and **Top Tracks**.
- Keep the control order consistent with Band Detail: timeframe selector, Top Bands / Top Tracks selector, then ranked results.
- Support 2 weeks, 3 months, 1 year, and All time for both tabs.
- Default a fresh visit to Top Bands and 3 months.
- Preserve the current tab and timeframe while the user remains in Toplist.
- Global Top Tracks rows show rank, neutral artwork placeholder where trusted artwork is unavailable, track title, artist name, listen count, known listening time, and movement where meaningful.
- Rank tracks by listen count, then known duration, recency, and normalized title as deterministic tie-breakers.
- Group recordings only through trusted identity. Studio, live, remix, remaster, acoustic, and rerecorded versions must never be collapsed from text alone.
- Preserve current Top Bands ranking behavior and all existing listening-period rules.
- Add synthetic desktop and mobile QA covering empty data, missing duration, long names, and conservative recording separation.

### Deferred to later focused Build 3.3 slices

- Listening Stats Top Bands / Top Tracks overview card and View all handoff.
- Trusted Spotify track and album links.
- Identity-backed track and album artwork acquisition.
- Selected-year genre-detail reconciliation.
- General Settings redesign or spacing work.

## Safety and ownership

- Use synthetic fixtures and the QA fake backend only.
- Do not access production listening history or production R2 data during development or QA.
- Do not call live providers.
- Do not modify source listening observations.
- Preserve stable band IDs, provider IDs, reviewed identity decisions, user-owned fields, and unknown future fields.
- Do not change cleaned-total activation state.
- Any user-visible build must bump `APP_VERSION` and `CACHE_NAME_LITERAL` together exactly once.

## Expected implementation surfaces

Implementation planning should inspect the current Top bands screen, listening statistics calculation helpers, navigation/deep-link state, Band Detail segmented controls, QA fixtures, and Playwright coverage before selecting exact files. The likely surfaces are `index.html`, `app.js`, listening-specific UI modules and CSS, pure listening-statistics helpers, synthetic fixtures, and desktop/mobile Playwright tests.
