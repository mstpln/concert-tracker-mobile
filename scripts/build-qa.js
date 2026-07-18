'use strict';
const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
const root = process.cwd(); const out = path.join(root, 'dist');
const sourceId = process.env.QA_BUILD_ID || process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA || 'local-qa';
const id = String(sourceId).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80) || 'local-qa';
const shell = ['app.css','app.js','dataLib.js','icons.js','remoteStore.js','ownedTickets.js','musicbrainzState.js','providerIdentityState.js','weather.js','spotifyUser.js','version.js','manifest.json'];
for (const file of shell) if (!fs.existsSync(path.join(root, file))) throw new Error(`QA build is missing required shell file: ${file}`);
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(path.join(out, 'icons'), { recursive: true });
for (const file of shell) fs.copyFileSync(path.join(root, file), path.join(out, file));
for (const file of fs.readdirSync(path.join(root, 'icons'))) fs.copyFileSync(path.join(root, 'icons', file), path.join(out, 'icons', file));
for (const file of ['qa/qa-bootstrap.js','qa/qa.css','qa/fixtures/qa-fixtures.js']) { const target = path.join(out, path.basename(file)); fs.copyFileSync(path.join(root, file), target); }
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace('</head>', '<link rel="stylesheet" href="qa.css" /></head>');
html = html.replace('<script src="ownedTickets.js"></script>', '<script src="qa-fixtures.js"></script><script src="qa-build-config.js"></script><script src="qa-bootstrap.js"></script><script src="ownedTickets.js"></script>');
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, 'qa-build-config.js'), `window.__LIVEVAULT_QA_BUILD_ID__ = ${JSON.stringify(id)};\n`);
let sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
sw = sw.replace(/const CACHE_NAME = 'concert-tracker-shell-' \+ CACHE_NAME_LITERAL;/, `const CACHE_NAME = 'concert-tracker-qa-' + CACHE_NAME_LITERAL + '-${id}';`)
  .replace("  './version.js',", "  './version.js',\n  './qa-fixtures.js',\n  './qa-bootstrap.js',\n  './qa.css',");
fs.writeFileSync(path.join(out, 'service-worker.js'), sw);
fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
fs.writeFileSync(path.join(out, '_headers'), '/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  Content-Security-Policy: default-src \'self\'; connect-src \'self\'; img-src \'self\' data: blob:; style-src \'self\' \'unsafe-inline\'; script-src \'self\'; worker-src \'self\' blob:; object-src \'none\'; base-uri \'none\'; frame-ancestors \'none\'; form-action \'self\'\n');
const forbidden = ['bands.json','concerts.json','news.json','apiUsage.json','.env']; const files = fs.readdirSync(out, { recursive: true });
for (const file of files) if (forbidden.includes(path.basename(file)) || /ticket-files|\.pem$|\.key$/i.test(file)) throw new Error(`QA build rejected unsafe file name: ${path.basename(file)}`);
for (const src of [...html.matchAll(/(?:src|href)="([^"#?]+)"/g)].map((match) => match[1])) if (!src.startsWith('http') && !fs.existsSync(path.join(out, src))) throw new Error(`QA build generated missing shell reference: ${src}`);
fs.writeFileSync(path.join(out, 'qa-build.json'), JSON.stringify({ synthetic: true, buildId: id, checksum: crypto.createHash('sha256').update(id).digest('hex').slice(0, 12) }, null, 2) + '\n');
console.log(`Built synthetic QA preview: dist (${id})`);
