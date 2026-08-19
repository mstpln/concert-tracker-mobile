'use strict';
const fs = require('node:fs');
const version = fs.readFileSync('version.js', 'utf8').match(/APP_VERSION = '([^']+)'/)?.[1];
const cache = fs.readFileSync('service-worker.js', 'utf8').match(/CACHE_NAME_LITERAL = '([^']+)'/)?.[1];
const state = {
  schemaVersion: 1,
  generatorVersion: 1,
  appVersion: version,
  serviceWorkerCacheVersion: cache,
  versionsMatch: version === cache,
  runtime: 'plain-html-css-javascript-pwa',
  expectedNodeMajor: 22,
  qaOutputDirectory: 'dist',
  playwrightProjects: ['desktop-chromium','mobile-chromium'],
  workflows: ['pr-qa.yml','full-pwa-qa.yml','production-smoke.yml'],
  shellFiles: [
    'index.html','app.css','listeningV81.css','concertCardsV86.css','bandmarkrV87.css','listeningReviewRollout.css','toplistV96.css','trustedListeningV99.css','gau2SettingsV118.css','settingsV123.css','stateFeedbackV129.css','nextConcertV138.css','nextConcertV139.css','nextConcertV140.css','alignedUiV143.css','alignedListeningBandsV144.css','icons/bandmarkr-wordmark.svg','geoFilterPreloadV143.js','app.js','alignedUiV143.js','nextConcertV138.js','nextConcertV140.js','interactionFeedbackV129.js','stateFeedbackIntegrationV129.js','providerReleaseCleanupV135.js','gau2SettingsV118.js','settingsV123.js','settingsAutomationReportingV145.js','toplistStatsV96.js','toplistV96.js','spotifyListeningMetadataV99.js','spotifyListeningAlbumArtworkV113.js','spotifyListeningMetadataV101.js','trustedListeningV99.js','uiPerformanceV126.js','uiPerformanceV127.js','alignedListeningBandsV144.js','listeningReviewRollout.js','listeningReviewReconcile.js','listeningCanonicalActivation.js','listeningPreparationRecovery.js','listeningPreparationV121.js','gau5PreparationIntegrationV121.js','listeningSpotifyIdentityReview.js','listeningSpotifyIdentityReviewUi.js','listeningIdentityPacingV105.js','listeningIdentityCompletionV104.js','listeningIdentityRecordingV106.js','listeningIdentityGroupingV104.js','devicePrivacy.js','browserFetchPolicy.js','securityHardening.js',
    'listeningInsightsV81.js','listeningV81BootFix.js','listeningV81ReviewFix.js','listeningV82Corrections.js','listeningV82GenreFix.js','listeningV82FailSafe.js','listeningV83ChartFix.js','listeningV83WindowFix.js','listeningV84ChartRenderFix.js','listeningV85RankingAndStatsUnits.js','dataLib.js','listeningStats.js','listeningStatsV81.js','listeningFixtures.js','listeningFixturesV99.js','listeningIdentityContracts.js','listeningDerivedStorage.js','listeningDerivedMigration.js','listeningBandActivity.js','spotifyHistoryImport.js','listeningVaultBridge.js',
    'listeningVault.js','listeningHistoryV2.js','listeningIncrementalVault.js','listenbrainzSync.js','listenbrainzReportingV145.js',
    'spotifyHistoryBootstrap.js','conflictMerge.js','remoteStore.js','ownedTickets.js','spotifyUserV100.js','service-worker.js'
  ],
  flags: {
    structuredResearchEnabled: /STRUCTURED_RESEARCH:\s*\{[^}]*enabled:\s*true/s.test(fs.readFileSync('scripts/lib/config.js','utf8')),
    musicbrainzEnabled: /MUSICBRAINZ:\s*\{[^}]*enabled:\s*true/s.test(fs.readFileSync('scripts/lib/config.js','utf8')),
    listenbrainzSyncEnabled: fs.existsSync('listenbrainzSync.js') && fs.existsSync('listeningIncrementalVault.js'),
    listeningIdentityCompletionEnabled: fs.existsSync('listeningIdentityCompletionV104.js') && fs.existsSync('listeningIdentityRecordingV106.js')
  }
};
const output = JSON.stringify(state, null, 2) + '\n';
const target = 'docs/LIVEVAULT_BUILD_STATE.json';
if (process.argv.includes('--check')) {
  if (!fs.existsSync(target) || fs.readFileSync(target,'utf8') !== output) throw new Error('Build state is stale; run npm run state:generate');
} else fs.writeFileSync(target, output);
console.log('Build state is current');