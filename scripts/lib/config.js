'use strict';
// Central config for the research pipelines. Every "cap" here is deliberately
// below the provider allowance; provider clients and UsageTracker remain the
// enforcement points for pacing and persisted quota state.
module.exports = {
  HOME_LAT: 55.34,
  HOME_LON: 13.36,
  NEWS_RECENCY_DAYS: 14,
  TICKETMASTER: { apiKeyEnv: 'TICKETMASTER_API_KEY', baseUrl: 'https://app.ticketmaster.com/discovery/v2', freeTierDailyLimit: 5000, perRunCap: 650, minDelayMs: 600 },
  TAVILY: { apiKeyEnv: 'TAVILY_API_KEY', baseUrl: 'https://api.tavily.com', usageCounterEpoch: '2026-07-23-tavily-key-rotation', freeTierMonthlyLimit: 1000, monthlyCap: 900, perRunCap: 180, minDelayMs: 500 },
  GROQ: { apiKeyEnv: 'GROQ_API_KEY', baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', freeTierDailyRequestLimit: 1000, freeTierTpmLimit: 8000, freeTierTpdLimit: 200000, dailyCap: 800, perRunCap: 250, safeTpm: 6000, safeTpd: 150000, minDelayMs: 2500 },
  SETLISTFM: { apiKeyEnv: 'SETLISTFM_API_KEY', baseUrl: 'https://api.setlist.fm/rest/1.0', freeTierDailyLimit: 1440, dailyCap: 1200, perRunCap: 200, minDelayMs: 600 },
  SPOTIFY: { clientIdEnv: 'SPOTIFY_CLIENT_ID', clientSecretEnv: 'SPOTIFY_CLIENT_SECRET', tokenUrl: 'https://accounts.spotify.com/api/token', searchUrl: 'https://api.spotify.com/v1/search', dailyCap: 6000, perRunCap: 4000, minDelayMs: 150 },
  MUSICBRAINZ: { baseUrl: 'https://musicbrainz.org/ws/2', enabled: false, userAgent: 'TheLiveVault/1.0 (https://github.com/mstpln/concert-tracker-mobile; personal non-commercial project)', perRunCap: 5, minDelayMs: 2000, timeoutMs: 10000, maxCandidates: 5, autoConfirmThreshold: 95, clearLeadThreshold: 10, noMatchRetryDays: 90 },
  STRUCTURED_RESEARCH: {
    enabled: true,
    providerIdentityResolutionEnabled: true,
    // v135 retires the dedicated release-discovery product. Provider identity,
    // concert discovery, listening metadata/artwork and artist images remain.
    structuredReleaseMonitoringEnabled: false,
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
  PREDICTED_SETLIST: { enabled: true, refreshDays: 7, spotifyMatchVersion: 2, spotifyTemporaryRetryHours: 24, historyMaxSetlists: 20, historyWindowDays: 730, minimumUsefulSetlists: 3 },
  SETLIST_INSIGHTS: { enabled: true, algorithmVersion: 2, comparisonSetlistLimit: 50, minimumUsefulPriorSetlists: 20, rareMaximumPerformanceRate: 0.05, minimumSameTourPriorSetlists: 3, longGapMinimumYears: 2, maximumInsightsPerConcert: 2, historyPageLimit: 10, historyIncompleteRetryDays: 7, temporaryErrorRetryHours: 24, quotaBlockedRetryHours: 24, weeklyRetryLimit: 2 },
  WORKER: { endpointEnv: 'CF_WORKER_ENDPOINT', tokenEnv: 'CF_WORKER_TOKEN' },
};
