# LiveVault Decisions

This continuity file was compacted on 2026-08-17. Earlier durable decisions remain recoverable in Git history. The decisions below are the active architectural and safety constraints that must be preserved by future work.

## 2026-07-18 — GitHub main is authoritative

**Decision:** Treat merged `main`, not chat memory or a stale local copy, as product source of truth.

**Reason:** Conversations and local checkouts can be stale.

**Consequence:** Read `AGENTS.md`, current state/decisions/build-state, relevant code, recent PRs and current versions before changing the app.

## 2026-07-18 — Synthetic QA and explicit release authorization

**Decision:** Automated QA uses fictional data and the fake backend. A merge requires the explicit phrase `Merge it`; production workflows/data/provider execution require separate authorization when applicable.

**Reason:** Review and testing must not expose or mutate personal production state.

**Consequence:** Branch/PR creation, a version bump, green CI or mergeability never authorizes merge, deployment, provider calls or production-data writes.

## 2026-07-18 — Stable identity and user ownership are preserved

**Decision:** Stable record IDs, user-owned fields, user-reviewed decisions and unknown future fields survive enrichment and reconciliation.

**Reason:** Research and automation must never replace the user's concert/listening history or reviewed decisions.

**Consequence:** Use additive/provider-owned state and latest-record conditional merges. Ambiguity fails closed.

## 2026-08-02 — Existing JSON writes use optimistic concurrency

**Decision:** Writes to existing production JSON documents are conditional on the corresponding latest ETag, with only the existing bounded reread/reconciliation behavior.

**Reason:** Browser and automation can edit the same full documents.

**Consequence:** Stale automation must not overwrite newer user/provider decisions or concurrent additions.

## 2026-08-02 — Browser, automation, maintenance and smoke credentials have separate roles

**Decision:** Preserve least-privilege credential boundaries. Ordinary automation may access only its allowed JSON/derived routes; private listening archives/manifests are not ordinary automation inputs. Production smoke remains read-only and sanitized.

**Reason:** Private listening history and ticket/user data must not be exposed merely to improve provider automation.

**Consequence:** A feature that needs raw private listening history must remain in an already-authorized private/browser/trusted-local context unless a new explicit security design is approved.

## 2026-08-03 — Private R2 is the durable listening-history source of truth

**Decision:** Raw listening history stays private in R2; browser/trusted-local flows may derive presentation state without moving raw archives into ordinary automation.

**Reason:** Listening history is private user data.

**Consequence:** Preserve immutable source observations and provider ownership boundaries.

## 2026-08-13 — Scheduled listening artwork remains trusted-local

**Decision:** Automatic Spotify listening-artwork maintenance stays on the trusted local host rather than moving private listening reads into GitHub Actions.

**Reason:** Album-artwork planning requires private listening history.

**Consequence:** Installing/running the scheduler, reading production listening data, calling Spotify and writing production metadata/usage remain separately authorized production actions.

## 2026-08-15 — Listening aliases are local attribution only

**Decision:** Optional `listeningAliases` extend local band-name attribution only when one stable BANDMARKR band uniquely owns the normalized name. Explicit known stable band IDs remain authoritative.

**Reason:** Historical display names can differ without proving provider identity.

**Consequence:** Aliases do not create/replace Spotify or MusicBrainz IDs, rewrite source observations or weaken ambiguity rules.

## 2026-08-16 — Missing artist images use privacy-safe exact identity

**Decision:** The structured research image-maintenance lane may use the validated aggregate `listening/band-activity.json` for priority but may not read raw listening history. Trusted Spotify identity goes to exact artist lookup; search thumbnails are not trusted artwork.

**Reason:** Artist-image maintenance needs useful ordering without widening private-listening access.

**Consequence:** Manual `photoUrl` is never overwritten; duplicate/mismatched identity fails closed; existing provider-safety contracts remain authoritative.

## 2026-08-17 — v135 retires active release alerts and scheduled release discovery

**Decision:** Releases is no longer an active user-facing feed/alert surface. Alerts is concert-only. Scheduled structured preload disables release monitoring and lifecycle release-alert planning. Existing stored release/provider data is preserved for compatibility.

**Reason:** The unwanted release product path must stop consuming provider budget without destructive migration.

**Consequence:** Reintroducing a release feed, release alerts or scheduled release discovery requires a new explicit decision/build. Spotify remains available only for separately justified non-release features.

## 2026-08-17 — v136 reuses provider-neutral evidence before Spotify-specific work

**Decision:** Non-playlist track links and listening artwork must consume safe reusable evidence before making new Spotify calls. Exact stored Spotify track IDs/URLs and exact ListenBrainz/MusicBrainz Spotify URL relations are reusable for non-playlist display/setlist links. Exact MusicBrainz release identity may provide Cover Art Archive artwork before Spotify album-artwork enrichment. Playlist matching remains a separate contract.

**Reason:** Provider cleanup requires fewer unnecessary Spotify calls without weakening identity, privacy or provider ownership.

**Consequence:** Shared resolution remains pure and fail-closed; ordinary scheduled automation does not gain raw private listening access.

## 2026-08-17 — v139 Next Concert ticket geometry is fixed to the approved reference

**Decision:** The Start-screen Next Concert card uses the approved 820x386 ticket silhouette with tear x=468, graphite contour and matching graphite dashed tear line, and inset frames 358x286 and 238x286. Normal countdown treatment is silver/graphite. On concert day, `Get directions` remains in the left information frame and the right stub becomes the yellow circular `Open tickets` control with a ticket icon and text.

**Reason:** v138 approximated the aligned visual rather than reproducing the approved geometry precisely.

**Consequence:** Future changes must preserve this geometry and the normal/show-day division unless a new visual decision is explicitly approved. Maps URL generation and OwnedTickets remain the behavior owners; this presentation layer must not fork those data paths.
