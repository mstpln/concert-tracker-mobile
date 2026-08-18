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

**Decision:** Complete sanitized listening history is private R2 data with IndexedDB as the device working copy. Source observations remain immutable.

**Reason:** Listening history needs durable recovery without entering GitHub, public QA or provider bulk requests.

**Consequence:** Derived identity/artwork layers remain separate from source observations; failures never invalidate a listen or alter statistics.

## 2026-08-03 — Listening artwork metadata remains separate from source events

**Decision:** Provider-specific artwork metadata is stored in its provider-owned derived layer; source listens are not rewritten as provider metadata.

**Reason:** Repeated listens should not duplicate mutable provider metadata, and provider ownership must remain explicit.

**Consequence:** Spotify metadata stays Spotify-owned. Provider-neutral evidence such as MusicBrainz/ListenBrainz/Cover Art Archive must not be written into the Spotify metadata document.

## 2026-08-10 — Historical listening identity is catalogue-first and provider-neutral

**Decision:** Reuse existing recording/provider identity and deterministic local catalogue evidence before widening to provider calls. Spotify is presentation/metadata only, not the core historical recording-identity provider.

**Reason:** Reuse reduces provider dependence while preserving durable review/retry/error/no-match ownership.

**Consequence:** Ambiguous or held identity state remains unresolved/reviewed rather than guessed. Provider calls occur only after local reusable evidence is exhausted under the applicable safety gates.

## 2026-08-12 — Listening artwork is album-oriented and cumulative

**Decision:** Safe album groups are conservative local-band/release groups. Existing reusable artwork is excluded before provider work; unresolved work is bounded and prioritizes recent/important listening. Spotify uses exact trusted track seeds, not title search.

**Reason:** Artwork should improve incrementally without turning into an unbounded private-history provider backfill.

**Consequence:** Missing release titles, ambiguous ownership, cross-group track conflicts and conflicting album identity fail closed. Source observations remain immutable.

## 2026-08-13 — Node Spotify safety uses one persisted circuit and one cross-scheduler lease

**Decision:** Scheduled Node research and trusted-local Spotify maintenance share the persisted Spotify circuit and persisted scheduler lease. UsageTracker caps/pacing remain authoritative.

**Reason:** Independent processes must not race provider quota/circuit state.

**Consequence:** Active/malformed safety state fails closed; changed safety state is persisted; provider work never bypasses UsageTracker, pacing, lease or circuit gates.

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

**Decision:** Non-playlist track links and listening artwork must consume safe reusable evidence before making new Spotify calls. Exact stored Spotify track IDs/URLs and exact ListenBrainz/MusicBrainz Spotify URL relations are reusable for non-playlist display/setlist links. Exact MusicBrainz release identity, including exact ListenBrainz CAA release identity, may provide Cover Art Archive artwork before Spotify album-artwork enrichment. Playlist matching remains a separate contract and is not changed by this reuse layer.

**Reason:** The reviewed provider-cleanup scope requires fewer unnecessary Spotify calls without weakening identity, privacy or provider ownership. Ordinary scheduled automation cannot be given raw private listening access merely to improve reuse.

**Consequence:** The shared link resolver is pure and fail-closed on conflicting evidence. Scheduled research may collect only evidence already visible in its allowed concert/band state; private listening evidence may be fed to the same resolver only by callers that already possess it. A single exact CAA release URL may satisfy a safe local album group and removes that group from unresolved Spotify artwork planning; conflicting CAA evidence remains ambiguous. CAA-derived presentation fields are local/provider-neutral and never become Spotify metadata. Trusted-local Spotify artwork operations retain aggregate diagnostics plus UsageTracker, circuit, lease, pacing, authorization and conditional-write controls.

## 2026-08-17 — v139 Next Concert ticket geometry is fixed to the approved reference

**Decision:** The Start-screen Next Concert card uses the approved 820x386 ticket silhouette with tear x=468, graphite contour and matching graphite dashed tear line, and inset frames 358x286 and 238x286. Normal countdown treatment is silver/graphite. On concert day, `Get directions` remains in the left information frame and the right stub becomes the yellow circular `Open tickets` control with a ticket icon and text.

**Reason:** v138 approximated the aligned visual rather than reproducing the approved geometry precisely.

**Consequence:** This visual decision is superseded by the explicitly approved v140 ticket geometry/color decision below. Maps URL generation and OwnedTickets remain the behavior owners.

## 2026-08-18 — v140 Next Concert ticket adopts the taller black/white stub and neon show-day ticket action

**Decision:** The Start-screen Next Concert card uses an 820x463 true-black ticket silhouette with shallow center notches, repeated fixed-size side perforations, tear x=468, a thin white outer contour, thicker white inner frames, visually all-caps artist name, compact silver countdown, normal-day concert date and dynamic user-owned `ticketQuantity` display. On concert day, the same tall geometry is retained; `Get directions` remains on the left and `Open tickets` remains on the right using `#5ED8FF` with dark text/icon.

**Reason:** The approved v140 correction replaces the shorter graphite/yellow v139 presentation while preserving established functional ownership.

**Consequence:** Normal-day ticket quantity reads only the canonical user-owned `concert.ticketQuantity` and is omitted for missing/non-positive values; it is not derived from owned ticket artifacts. Concert-day Maps URL generation and OwnedTickets PDF/URL/multiple-ticket behavior remain the authoritative paths and must not be forked by the presentation layer.
