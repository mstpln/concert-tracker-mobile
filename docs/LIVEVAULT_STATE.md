# LiveVault Current State

This continuity file was compacted again on 2026-08-26. Earlier detailed state remains recoverable in Git history. GitHub `main` is authoritative; durable contracts live in `LIVEVAULT_DECISIONS.md`.

## Repository and current build

LiveVault/BANDMARKR is `mstpln/concert-tracker-mobile`, a single-user plain HTML/CSS/JavaScript PWA. Production is a GitHub Pages static app backed by the authenticated Cloudflare Worker and private R2 storage.

The current merged application baseline is **v166** at merge commit `f98bcf7456c818dc03f9cbe5c040141e73b6a537`, which merged PR #182. `APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at `v166` on `main`.

The active unmerged application build is **v167** in PR #183, `Merge Next Concert into the upcoming card (v167)`, on branch `feature/merged-next-concert-v167`. The branch bumps `APP_VERSION` and `CACHE_NAME_LITERAL` together to `v167` exactly once. v167 is presentation-only and does not authorize merge, deployment, production providers, production workflows, production smoke or production-data changes.

## Current production data baselines

The 2026-08-24 reviewed Ticketmaster cleanup replaced the prior concert snapshot with **3,262 concert records**. It removed 334 unsafe/redundant legacy Ticketmaster records while preserving all 76 attending stable IDs and meaningful user-owned fields. Ticket spend remained 31,337 before/after. The user-authorized uploaded `concerts.json` was verified byte-for-byte at the time of that maintenance action.

The 2026-08-24 Ticketmaster identity enrichment left **370 bands**, of which **334 / 370** have unique trusted Ticketmaster attraction IDs and 36 remain unresolved. Manual confirmations remain authoritative and provider-owned/unknown fields are preserved.

The reviewed venue cleanup reduced `venues.json` from 1,208 to **530** records, with duplicate IDs/placeholders/unsafe official URLs removed conservatively. The user confirmed that cleaned top-level `venues.json` was uploaded to production. Distinct same-address venues such as AFAS Dome and Lotto Arena Antwerpen remain separate by design.

These production baselines are historical maintenance facts only. v167 does not read, rewrite, migrate or backfill production data.

## Current venue/navigation implementation

Venue facts remain reusable `venues.json` records with stable venue identity, address, capacity, official URL, description and internal research provenance. Concert records keep user-owned concert state; venue research does not copy venue facts into or rewrite concert records.

v164 established canonical physical venue identity for the Venues directory, Venue Detail and venue-specific statistics. Placeholder venues do not become directory entities; ambiguous recovery fails closed; same-address complexes are not merged merely because they share an address.

v166 preserved those v164 semantics while removing repeated full-dataset scans from Dates/Venues navigation. Ordinary Dates does not build the canonical venue directory. Venue metadata lookup is indexed, canonical grouping is cached for unchanged in-memory data, Venue Detail reuses the cached group, and directory/detail render output is cached with appropriate invalidation. Synthetic production-scale Chromium coverage uses roughly the current collection scale.

## v167 merged Next Concert Start design

v167 removes the separate standalone Next Concert ticket from Start and promotes the first existing upcoming concert card into the **Next Concert** card. The promoted card keeps the existing band-profile chevron and all established upcoming-card content and interactions, including listening, Ticket, Playlist, Weather forecast, Predicted setlist, Checklist and delete behavior.

The Start hierarchy becomes:

1. Existing Listening stats and Concert stats cards.
2. `NEXT CONCERT` separator.
3. The promoted first upcoming card.
4. `UPCOMING CONCERTS` separator when later upcoming concerts exist.
5. The remaining upcoming concert cards.
6. Existing Past concerts and add-concert areas unchanged.

On normal days, the promoted card uses one compact app-blue strip with bold `N DAYS LEFT`, a lighter live hours/minutes/seconds countdown and lighter distance. The old inline distance/countdown copy is removed from that card so those values are not repeated.

On the concert date, the top strip becomes the established turquoise/neon `#5ed8ff` and reads `CONCERT DAY`. Directly below the venue information, `Open tickets` is the turquoise primary CTA and `Get directions` is the ghost secondary CTA. Existing OwnedTickets URL/PDF/multiple-ticket behavior and the existing Maps URL builder remain authoritative; v167 only moves/re-presents those established controls.

On the promoted card in both states, `Max Capacity` uses the same muted grey as the venue-address line so both read as one venue-information group rather than capacity appearing more important.

v167 adds no stored fields, schema migration, provider calls, quota changes, Worker/R2 changes or production-data writes.

## Safety and operational constraints

Automated browser work uses only synthetic fixtures and the QA fake backend. QA must not use production R2/Worker data, live provider APIs or production credentials. Production smoke remains manual-only and read-only with the dedicated smoke path/token.

Stable IDs, user-owned fields, user-reviewed provider decisions, unknown future fields and provider ownership boundaries remain protected. `APP_VERSION` and `CACHE_NAME_LITERAL` must stay synchronized.

No merge, auto-merge, deployment, production research workflow, provider execution, production smoke or production-data mutation is authorized by this build. Merge still requires the user's explicit `Merge it` instruction.

## Next operational steps

Continue PR #183 through the exact-head fix -> validate -> review cycle. Required release validation is unit/safety plus desktop Chromium and mobile Chromium synthetic QA, with focused v167 coverage for the normal countdown state, concert-day state, preserved preparation content/band navigation, separator ordering, 375px/480px responsive layout, capacity/address visual hierarchy and existing ticket/directions behavior.

If validation exposes regressions, correct them on the same unreleased v167 branch without another version bump. Stop only when the exact final head is clean and merge-ready. Do not merge or perform any production action without separate explicit authorization.