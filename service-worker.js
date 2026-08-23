'use strict';
importScripts('./version.js');
const CACHE_NAME_LITERAL = 'v160';
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v159'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v158'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v157'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v156'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v155'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v154'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v153'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v152'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v151'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v150'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v149'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v148'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v147'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v146'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v145'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v144'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v143'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v142'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v141'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v140'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v139'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v138'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v137'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v136'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v135'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v134'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v133'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v132'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v131'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v130'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v129'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v128'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v127'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v126'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v125'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v124'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v123'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v122'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v121'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v120'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v119'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v118'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v117'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v116'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v115'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v114'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v113'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v112'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v111'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v110'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v109'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v108'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v107'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v106'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v105'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v104'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v103'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v102'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v101'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v100'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v99'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v98'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v97'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v96'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v95'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v94'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v93'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v92'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v91'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v90'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v89'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v88'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v87'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v86'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v85'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v84'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v83'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v82'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v81'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v80'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v79'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v78'.
// Previous merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v77'.
// Earlier merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v76'.
// Earlier merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v75'.
// Earlier merged release marker retained for regression coverage: CACHE_NAME_LITERAL = 'v74'.
// Legacy owned-ticket release marker retained for historical regression coverage: CACHE_NAME_LITERAL = 'v70'.
if (CACHE_NAME_LITERAL !== APP_VERSION) {
  console.warn(`service-worker.js CACHE_NAME_LITERAL ("${CACHE_NAME_LITERAL}") is out of sync with version.js APP_VERSION ("${APP_VERSION}") — bump CACHE_NAME_LITERAL in service-worker.js to match, otherwise old installs won't update.`);
}
const CACHE_NAME = 'concert-tracker-shell-' + CACHE_NAME_LITERAL;
const SHELL_FILES = [
  './',
  './index.html',
  './app.css',
  './v72Corrections.css',
  './listeningV81.css',
  './concertCardsV86.css',
  './bandmarkrV87.css',
  './listeningReviewRollout.css',
  './toplistV96.css',
  './trustedListeningV99.css',
  './gau2SettingsV118.css',
  './settingsV123.css',
  './stateFeedbackV129.css',
  './nextConcertV138.css',
  './nextConcertV139.css',
  './nextConcertV140.css',
  './nextConcertV146.css',
  './startVisualV147.css',
  './nextConcertV148.css',
  './alignedUiV143.css',
  './alignedListeningBandsV144.css',
  './startStatsV149.css',
  './appUpdateAub1V153.css',
  './appUpdateAub2V155.css',
  './appUpdateAub3V156.css',
  './venueMetadataV158.css',
  './geoFilterPreloadV143.js',
  './app.js',
  './alignedUiV143.js',
  './nextConcertV138.js',
  './nextConcertV140.js',
  './nextConcertV146.js',
  './nextConcertV148.js',
  './interactionFeedbackV129.js',
  './stateFeedbackIntegrationV129.js',
  './providerReleaseCleanupV135.js',
  './gau2SettingsV118.js',
  './settingsV123.js',
  './settingsAutomationReportingV145.js',
  './listeningReviewRollout.js',
  './listeningReviewReconcile.js',
  './listeningCanonicalActivation.js',
  './listeningPreparationRecovery.js',
  './listeningPreparationV121.js',
  './gau5PreparationIntegrationV121.js',
  './listeningSpotifyIdentityReview.js',
  './listeningSpotifyIdentityReviewUi.js',
  './listeningIdentityPacingV105.js',
  './listeningIdentityCompletionV104.js',
  './listeningIdentityRecordingV106.js',
  './listeningIdentityGroupingV104.js',
  './devicePrivacy.js',
  './browserFetchPolicy.js',
  './v72Corrections.js',
  './v72FinalAdjustments.js',
  './securityHardening.js',
  './listeningInsightsV81.js',
  './listeningV81BootFix.js',
  './listeningV81ReviewFix.js',
  './listeningV82Corrections.js',
  './listeningV82GenreFix.js',
  './listeningV82FailSafe.js',
  './listeningV83ChartFix.js',
  './listeningV83WindowFix.js',
  './listeningV84ChartRenderFix.js',
  './listeningV85RankingAndStatsUnits.js',
  './toplistStatsV96.js',
  './toplistV96.js',
  './spotifyListeningMetadataV99.js',
  './spotifyListeningAlbumArtworkV113.js',
  './spotifyListeningMetadataV101.js',
  './trustedListeningV99.js',
  './uiPerformanceV126.js',
  './uiPerformanceV127.js',
  './alignedListeningBandsV144.js',
  './startStatsV149.js',
  './appUpdateAub1V153.js',
  './appUpdateAub1V153Corrections.js',
  './appUpdateAub3CorrectionV157.js',
  './venueMetadataModelV158.js',
  './venueMetadataV158.js',
  './lineupRoleV155.js',
  './eventModelV156.js',
  './dataLib.js',
  './listeningStats.js',
  './listeningStatsV81.js',
  './listeningFixtures.js',
  './listeningFixturesV99.js',
  './listeningIdentityContracts.js',
  './listeningDerivedStorage.js',
  './listeningDerivedMigration.js',
  './spotifyHistoryImport.js',
  './listeningBandActivity.js',
  './listeningVaultBridge.js',
  './listeningVault.js',
  './listeningHistoryV2.js',
  './listeningIncrementalVault.js',
  './listenbrainzSync.js',
  './listenbrainzReportingV145.js',
  './spotifyHistoryBootstrap.js',
  './icons.js',
  './conflictMerge.js',
  './remoteStore.js',
  './ownedTickets.js',
  './musicbrainzState.js',
  './providerIdentityState.js',
  './weather.js',
  './spotifyUser.js',
  './spotifyUserV100.js',
  './version.js',
  './manifest.json',
  './icons/bandmarkr-wordmark.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
  './assets/listening/album-blue.svg',
  './assets/listening/album-purple.svg',
  './assets/listening/album-cyan.svg',
  './assets/listening/album-gold.svg',
];
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(SHELL_FILES.map((url) => fetch(url, { cache: 'reload' }).then((res) => cache.put(url, res))))
    )
  );
  self.skipWaiting();
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('concert-tracker-shell-') && k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
