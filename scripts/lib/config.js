'use strict';
// Central config for the weekly research pipeline. Every "cap" here is
// deliberately set BELOW the actual free-tier limit of that service, per
// the hard requirement: this pipeline must never be able to cost money.
//
// Free-tier limits (checked against each provider's current docs — Groq in
// particular changes these with little notice, so re-verify against
// console.groq.com/docs/rate-limits and console.groq.com/docs/deprecations
// before relying on this comment if it's been a while):
//   Ticketmaster Discovery API — 5,000 requests/day, 5 requests/sec.
//   Tavily Search API          — 1,000 credits/month (1 credit per search
//                                 by default), free plan, no card required.
//   Groq (openai/gpt-oss-120b) — free tier: 30 req/min, 1,000 req/day,
//                                 8,000 tokens/min (TPM), 200,000 tokens/
//                                 day (TPD). llama-3.3-70b-versatile (the
//                                 model originally used here) was deprecated
//                                 by Groq on 2026-06-17 — gpt-oss-120b is
//                                 their recommended replacement. TPD is the
//                                 real binding constraint for this pipeline
//                                 (a full run's total token usage matters
//                                 more than any one minute's), so prompts
//                                 sent to Groq are kept deliberately short.
//   setlist.fm API             — free (non-commercial use only, per its own
//                                 terms), max. 2 requests/second and max.
//                                 1,440 requests/day, straight from the key
//                                 issued at signup. Unlike the three above,
//                                 this is a direct structured lookup (no
//                                 search+LLM step), so per-show cost is a
//                                 single request, not several.
//
// This runs once/week (≈4.33 runs/month), so the real constraint for
// Tavily is the MONTHLY budget, not the per-run one — a single run must
// never use more than monthlyCap / (runs remaining this month) worth of
// credits. usageTracker.js enforces that dynamically; the numbers below are
// just the hard ceilings.

module.exports = {
  // Home location for distance calculations — Smygehamn, Sweden.
  HOME_LAT: 55.34,
  HOME_LON: 13.36,

  // How far back "new" news items are allowed to be for a run to still
  // treat them as fresh (matches the documented news.json recency rule).
  NEWS_RECENCY_DAYS: 14,

  TICKETMASTER: {
    apiKeyEnv: 'TICKETMASTER_API_KEY',
    baseUrl: 'https://app.ticketmaster.com/discovery/v2',
    freeTierDailyLimit: 5000,
    // Hard cap, ~16x under the free tier — one call per band plus a little
    // headroom for retries, never anywhere close to the real limit.
    perRunCap: 300,
    minDelayMs: 300, // stays well under 5 req/sec
  },

  TAVILY: {
    apiKeyEnv: 'TAVILY_API_KEY',
    baseUrl: 'https://api.tavily.com',
    freeTierMonthlyLimit: 1000,
    // Stop the whole month at 900 credits even if a run's own cap would
    // allow more — this is the real backstop against ever going over.
    monthlyCap: 900,
    // Per-run cap sized so ~4-5 runs/month comfortably stays under
    // monthlyCap even without the dynamic check (900 / 4 ≈ 225; kept lower
    // for margin).
    perRunCap: 180,
    minDelayMs: 500,
  },

  GROQ: {
    apiKeyEnv: 'GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-120b',
    freeTierDailyRequestLimit: 1000,
    freeTierTpmLimit: 8000,
    freeTierTpdLimit: 200000,
    // Hard caps, all comfortably under the free tier.
    dailyCap: 800,
    perRunCap: 250,
    // Real-time pacing target — kept under the real 8,000 TPM limit so a
    // burst of large prompts never trips the provider's own rate limiter.
    safeTpm: 6000,
    // Daily token budget — the real binding constraint (200,000 TPD free
    // tier). Kept well under it so a single run, even a slow one spread
    // over hours, can never get close to the real ceiling.
    safeTpd: 150000,
    // Minimum gap between requests — under the real 30 RPM limit (2s) with
    // margin.
    minDelayMs: 2500,
  },

  SETLISTFM: {
    apiKeyEnv: 'SETLISTFM_API_KEY',
    baseUrl: 'https://api.setlist.fm/rest/1.0',
    freeTierDailyLimit: 1440,
    // Hard caps, well under the real 1,440/day, 2/sec free-tier limits —
    // even backfilling every attended-past show in one run stays nowhere
    // close to either ceiling.
    dailyCap: 1200,
    perRunCap: 200,
    minDelayMs: 600, // under the real 2 req/sec (500ms) with margin
  },

  // Spotify Web API (Client Credentials flow — app-only, resolves a track
  // link per original setlist song). Unlike the four providers above,
  // Spotify doesn't publish a fixed free-tier request cap: it throttles
  // dynamically via HTTP 429 + Retry-After instead of a documented
  // requests/day number. The caps below are a defensive safety valve (so a
  // single run can never run away indefinitely), not a real ceiling —
  // spotify.js's 429 handling is the actual enforcement mechanism.
  SPOTIFY: {
    clientIdEnv: 'SPOTIFY_CLIENT_ID',
    clientSecretEnv: 'SPOTIFY_CLIENT_SECRET',
    tokenUrl: 'https://accounts.spotify.com/api/token',
    searchUrl: 'https://api.spotify.com/v1/search',
    // Sized generously enough to resolve the full historical backfill (every
    // original song across every already-attended setlist) in a single run,
    // while still being a bounded, defensive cap rather than "unlimited".
    dailyCap: 6000,
    perRunCap: 4000,
    minDelayMs: 150,
  },

  MUSICBRAINZ: {
    baseUrl: 'https://musicbrainz.org/ws/2',
    enabled: false,
    userAgent: 'TheLiveVault/1.0 (https://github.com/mstpln/concert-tracker-mobile; personal non-commercial project)',
    perRunCap: 5,
    minDelayMs: 1100,
    timeoutMs: 10000,
    maxCandidates: 5,
    autoConfirmThreshold: 95,
    clearLeadThreshold: 10,
    noMatchRetryDays: 90,
  },

  // This is deliberately separate from MUSICBRAINZ.enabled.  The latter
  // controls the conservative identity matcher; this flag controls the
  // broader use of already-confirmed identities in the weekly pipeline.
  // Keep it off until a reviewed release decision explicitly enables it.
  STRUCTURED_RESEARCH: {
    enabled: true,
    providerIdentityResolutionEnabled: true,
    structuredReleaseMonitoringEnabled: true,
    targetedTavilyRoutingEnabled: true,
    groqFallbackEnabled: true,
    artistMetadataRefreshDays: 90,
    unresolvedIdentityRetryDays: 90,
    temporaryErrorRetryHours: 24,
    musicbrainzReleaseRefreshDays: 7,
    spotifyReleaseRefreshDays: 7,
    tavilyNoEventsDays: 14,
    tavilySupplementalTourDays: 28,
    tavilyReleaseDays: 28,
    tavilyStatusDays: 28,
    tavilyTicketDays: 28,
    groqFingerprintDays: 90,
    maxMusicbrainzReleasePages: 3,
    maxSpotifyReleasePages: 3,
  },

  // Kept separate from identity resolution; prediction processing is guarded
  // by the existing upcoming-attending, confirmed-identity and quota checks.
  PREDICTED_SETLIST: {
    enabled: true,
    refreshDays: 7,
    spotifyMatchVersion: 2,
    spotifyTemporaryRetryHours: 24,
    historyMaxSetlists: 20,
    historyWindowDays: 730,
    minimumUsefulSetlists: 3,
  },

  // Actual past-setlist context is intentionally conservative and bounded.
  // This is separate from upcoming predictions and never makes career-wide claims.
  SETLIST_INSIGHTS: {
    enabled: true,
    algorithmVersion: 2,
    comparisonSetlistLimit: 50,
    minimumUsefulPriorSetlists: 20,
    rareMaximumPerformanceRate: 0.05,
    minimumSameTourPriorSetlists: 3,
    longGapMinimumYears: 2,
    maximumInsightsPerConcert: 2,
    historyPageLimit: 10,
    historyIncompleteRetryDays: 7,
    temporaryErrorRetryHours: 24,
    quotaBlockedRetryHours: 24,
    weeklyRetryLimit: 2,
  },

  WORKER: {
    endpointEnv: 'CF_WORKER_ENDPOINT',
    tokenEnv: 'CF_WORKER_TOKEN',
  },
};
