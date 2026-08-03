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
  expectedNodeMajor: 20,
  qaOutputDirectory: 'dist',
  playwrightProjects: ['desktop-chromium','mobile-chromium'],
  workflows: ['pr-qa.yml','full-pwa-qa.yml','production-smoke.yml'],
  shellFiles: [
    'index.html','app.css','listeningV81.css','app.js','devicePrivacy.js','browserFetchPolicy.js','securityHardening.js',
    'listeningInsightsV81.js','listeningV81BootFix.js','listeningV81ReviewFix.js','listeningV82Corrections.js','listeningV82GenreFix.js','listeningV82FailSafe.js','listeningV83ChartFix.js','listeningV83WindowFix.js','listeningV84ChartRenderFix.js','dataLib.js','listeningStats.js','listeningStatsV81.js','listeningFixtures.js','spotifyHistoryImport.js','listeningVaultBridge.js',
    'listeningVault.js','listeningHistoryV2.js','listeningIncrementalVault.js','listenbrainzSync.js',
    'spotifyHistoryBootstrap.js','conflictMerge.js','remoteStore.js','ownedTickets.js','service-worker.js'
  ],
  flags: {
    structuredResearchEnabled: /STRUCTURED_RESEARCH:\s*\{[^}]*enabled:\s*true/s.test(fs.readFileSync('scripts/lib/config.js','utf8')),
    musicbrainzEnabled: /MUSICBRAINZ:\s*\{[^}]*enabled:\s*true/s.test(fs.readFileSync('scripts/lib/config.js','utf8')),
    listenbrainzSyncEnabled: fs.existsSync('listenbrainzSync.js') && fs.existsSync('listeningIncrementalVault.js')
  }
};
const output = JSON.stringify(state, null, 2) + '\n';
const target = 'docs/LIVEVAULT_BUILD_STATE.json';
if (process.argv.includes('--check')) {
  if (!fs.existsSync(target) || fs.readFileSync(target,'utf8') !== output) throw new Error('Build state is stale; run npm run state:generate');
} else fs.writeFileSync(target, output);
console.log('Build state is current');
