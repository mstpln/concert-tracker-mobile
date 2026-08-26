# LiveVault Current State

This continuity file was compacted on 2026-08-26. Earlier detailed state remains recoverable in Git history. GitHub `main` is authoritative.

## Repository and current build

LiveVault is `mstpln/concert-tracker-mobile`, a single-user concert-tracking PWA. Production is a GitHub Pages static app backed by an authenticated Cloudflare Worker and private R2 storage.

The current merged application baseline is **v167** at merge commit `f99ad2059f661015f4f56e67c52f324ae60153d2`, which merged PR #183. v167 removed the duplicate standalone Next Concert ticket and promoted the first existing upcoming card into the Next Concert presentation while preserving its preparation rows and user-owned data paths.

The active correction is **v168** on branch `fix/next-concert-countdown-spacing-v168`. `APP_VERSION` and `CACHE_NAME_LITERAL` are synchronized at `v168`. v168 is a focused Start/My Concerts presentation correction only: it enlarges the normal-day countdown strip/headline, restores days to the rolling countdown (`Dd HHh MMm SSs`), matches the Next-card-to-Upcoming separator gap to the established 28px stats-to-Next spacing, and makes Max Capacity use the same muted color and normal font weight as venue address on Next, remaining Upcoming and Past concert cards.

No production data, provider behavior, quota, schedule, Worker/R2 configuration, production workflow, production smoke or deployment is changed by v168.

## Current production data baseline

The reviewed 2026-08-24 Ticketmaster cleanup reduced production `concerts.json` from 3,596 to **3,262** records by removing 334 legacy wrong-artist/package records while preserving all attended IDs and meaningful user-owned state. Ticket-cost total remained **31,337**. The authorized replacement was verified byte-for-byte after upload.

Production `bands.json` contains **370** bands, with **334 / 370** carrying trusted Ticketmaster attraction IDs after the reviewed identity enrichment. Trusted IDs are unique; 36 bands remain unresolved rather than guessed.

Production `venues.json` uses the reviewed **530-record** cleaned venue baseline. Placeholder/duplicate venue records were removed conservatively; same-address distinct venues such as AFAS Dome and Lotto Arena Antwerpen remain separate.

## Current provider/data-integrity contracts

Ticketmaster automatic event admission requires a trusted `confirmed` or `manual_confirmed` attraction ID. Ticket offers are not physical-performance identity; package/VIP/premium alternatives consolidate only with strong direct evidence and retain alternate provider provenance. Lifecycle and venue ambiguity fail closed. Provider calls remain behind UsageTracker caps and pacing.

Stable IDs, user-owned fields, user-reviewed decisions and unknown future fields are preserved. Event grouping/statistics retain the event-level versus performance-level ownership model. `lineupRole` remains user-owned.

Venue facts live in reusable `venues.json` records. Venue directory/detail/statistics use conservative canonical physical-venue identity while ordinary concert-card metadata lookup remains narrower. Missing venue metadata renders nothing rather than guessed values.

Listening history remains private R2 source data with IndexedDB as the device working copy. Listening identity/artwork remain provider-neutral where possible; provider failures never invalidate listens or alter listening statistics.

## Start / My Concerts UI state

The first upcoming concert card is the **Next Concert** card. The old standalone ticket presentation does not render, so the same concert appears only once on Start.

The promoted card preserves artist image/name, band-profile chevron, date/venue/address, reusable venue metadata, Your listening, Ticket, Playlist, Weather forecast, Predicted setlist, Checklist and delete behavior.

Separators are ordered as:

1. `NEXT CONCERT`
2. promoted first upcoming card
3. `UPCOMING CONCERTS`
4. remaining upcoming cards

When there are no later upcoming concerts, the empty `UPCOMING CONCERTS` section is omitted.

### Normal day

The card uses the app-blue countdown strip. The `N DAYS LEFT` headline is the strongest/bold element and has additional height/breathing room. The live rolling countdown includes the full remaining duration as `Nd HHh MMm SSs`; distance remains lighter at the right. The retired inline `distance · days until concert` row remains hidden to avoid duplicate information.

### Concert day

The strip switches to turquoise/neon `#5ed8ff` and reads `CONCERT DAY`. `Open tickets` is the turquoise primary CTA; `Get directions` is the ghost secondary CTA. Existing OwnedTickets URL/PDF/multiple-ticket behavior and the existing Google Maps URL builder remain authoritative.

### Venue-information hierarchy on concert cards

On **Next, remaining Upcoming and Past** concert cards, `Max Capacity` is supporting venue metadata: it uses the same muted grey and normal font weight as the venue-address line immediately above it. Venue-directory cards and Venue Detail keep their own established capacity presentation.

### Section spacing

The space between the promoted Next Concert card and the `UPCOMING CONCERTS` separator matches the established **28px** outer gap between the Concert Stats area and the `NEXT CONCERT` separator.

## Venue navigation performance

v166 remains the authoritative venue-navigation performance implementation. Ordinary Dates avoids canonical venue-group work; venue metadata lookup is indexed; canonical venue directory/group results are cached for unchanged in-memory state; Venue Detail reuses the cached group; directory/detail DOM is reused; delegated handlers avoid repeated listener attachment. The v164 canonical identity/fail-closed semantics remain unchanged.

## QA and safety

Automated browser work uses synthetic fixtures and the QA fake backend only. Production providers and production R2 are never used for automated QA. Production smoke is manual-only with the dedicated read-only smoke token.

Any merge still requires the user's explicit `Merge it`. A green branch or PR does not authorize merge, deployment or production actions.
