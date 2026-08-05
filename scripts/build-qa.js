'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = process.cwd();
const out = path.join(root, 'dist');
const sourceId = process.env.QA_BUILD_ID || process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA || 'local-qa';
const id = String(sourceId).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80) || 'local-qa';
const shell = [
  'app.css', 'v72Corrections.css', 'listeningV81.css', 'concertCardsV86.css', 'bandmarkrV87.css', 'listeningReviewRollout.css', 'app.js', 'listeningReviewRollout.js', 'devicePrivacy.js',
  'browserFetchPolicy.js', 'v72Corrections.js', 'v72FinalAdjustments.js',
  'securityHardening.js', 'listeningInsightsV81.js', 'listeningV81BootFix.js', 'listeningV81ReviewFix.js', 'listeningV82Corrections.js', 'listeningV82GenreFix.js', 'listeningV82FailSafe.js', 'listeningV83ChartFix.js', 'listeningV83WindowFix.js', 'listeningV84ChartRenderFix.js', 'listeningV85RankingAndStatsUnits.js', 'dataLib.js', 'listeningStats.js', 'listeningStatsV81.js',
  'listeningFixtures.js', 'listeningIdentityContracts.js', 'listeningDerivedStorage.js', 'listeningDerivedMigration.js',
  'spotifyHistoryImport.js', 'listeningVaultBridge.js', 'listeningVault.js', 'listeningHistoryV2.js',
  'listeningIncrementalVault.js', 'listenbrainzSync.js', 'spotifyHistoryBootstrap.js', 'icons.js',
  'conflictMerge.js', 'remoteStore.js', 'ownedTickets.js', 'musicbrainzState.js',
  'providerIdentityState.js', 'weather.js', 'spotifyUser.js', 'version.js',
  'manifest.json',
];

for (const file of shell) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`QA build is missing required shell file: ${file}`);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'icons'), { recursive: true });
fs.mkdirSync(path.join(out, 'assets', 'listening'), { recursive: true });
for (const file of shell) fs.copyFileSync(path.join(root, file), path.join(out, file));
for (const file of fs.readdirSync(path.join(root, 'icons'))) fs.copyFileSync(path.join(root, 'icons', file), path.join(out, 'icons', file));
for (const file of fs.readdirSync(path.join(root, 'assets', 'listening'))) fs.copyFileSync(path.join(root, 'assets', 'listening', file), path.join(out, 'assets', 'listening', file));
for (const file of ['qa/qa-bootstrap.js', 'qa/qa.css', 'qa/fixtures/qa-fixtures.js', 'qa/qa-v77-fixtures.js']) {
  fs.copyFileSync(path.join(root, file), path.join(out, path.basename(file)));
}

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace('</head>', '<link rel="stylesheet" href="qa.css" /></head>');
html = html.replace(
  '<script src="ownedTickets.js"></script>',
  '<script src="qa-fixtures.js"></script><script src="qa-v77-fixtures.js"></script><script src="qa-build-config.js"></script><script src="qa-bootstrap.js"></script><script src="ownedTickets.js"></script>'
);
html = html
  .replace('<script src="spotifyHistoryImport.js"></script>', '')
  .replace('<script src="listeningVaultBridge.js"></script>', '')
  .replace('<script src="listeningVault.js"></script>', '')
  .replace('<script src="listeningHistoryV2.js"></script>', '')
  .replace('<script src="listeningIncrementalVault.js"></script>', '')
  .replace('<script src="listenbrainzSync.js"></script>', '')
  .replace('<script src="spotifyHistoryBootstrap.js"></script>', '');
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, 'qa-build-config.js'), `window.__LIVEVAULT_QA_BUILD_ID__ = ${JSON.stringify(id)};\n`);

let sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
sw = sw
  .replace(/const CACHE_NAME = 'concert-tracker-shell-' \+ CACHE_NAME_LITERAL;/, `const CACHE_NAME = 'concert-tracker-qa-' + CACHE_NAME_LITERAL + '-${id}';`)
  .replace(
    "  './version.js',",
    "  './version.js',\n  './qa-fixtures.js',\n  './qa-v77-fixtures.js',\n  './qa-build-config.js',\n  './qa-bootstrap.js',\n  './qa.css',"
  )
  .replace(
    "k.startsWith('concert-tracker-shell-') && k !== CACHE_NAME",
    "k.startsWith('concert-tracker-qa-') && k !== CACHE_NAME"
  );
if (!sw.includes("k.startsWith('concert-tracker-qa-') && k !== CACHE_NAME")) {
  throw new Error('QA build could not scope service-worker cache cleanup to the QA namespace');
}
if (!sw.includes("'./qa-bootstrap.js'")) {
  throw new Error('QA build could not add synthetic fixture files to the service-worker shell cache');
}
fs.writeFileSync(path.join(out, 'service-worker.js'), sw);

fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
fs.writeFileSync(path.join(out, '_headers'), "/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  Content-Security-Policy: default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'\n");

const forbidden = ['bands.json', 'concerts.json', 'news.json', 'apiUsage.json', '.env'];
const files = fs.readdirSync(out, { recursive: true });
for (const file of files) {
  if (forbidden.includes(path.basename(file)) || /ticket-files|\.pem$|\.key$/i.test(file)) throw new Error(`QA build rejected unsafe file name: ${path.basename(file)}`);
}
for (const src of [...html.matchAll(/(?:src|href)="([^"#?]+)"/g)].map((match) => match[1])) {
  if (!src.startsWith('http') && !fs.existsSync(path.join(out, src))) throw new Error(`QA build generated missing shell reference: ${src}`);
}
fs.writeFileSync(path.join(out, 'qa-build.json'), `${JSON.stringify({ synthetic: true, buildId: id, checksum: crypto.createHash('sha256').update(id).digest('hex').slice(0, 12) }, null, 2)}\n`);
console.log(`Built synthetic QA preview: dist (${id})`);
