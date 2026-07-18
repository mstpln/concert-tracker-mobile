'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = process.cwd();
const out = path.join(root, 'dist');
const sourceId = process.env.QA_BUILD_ID || process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA || 'local-qa';
const id = String(sourceId).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 80) || 'local-qa';
const shell = ['app.css','app.js','dataLib.js','icons.js','remoteStore.js','ownedTickets.js','musicbrainzState.js','providerIdentityState.js','weather.js','spotifyUser.js','version.js','manifest.json'];

for (const file of shell) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`QA build is missing required shell file: ${file}`);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'icons'), { recursive: true });

for (const file of shell) fs.copyFileSync(path.join(root, file), path.join(out, file));
for (const file of fs.readdirSync(path.join(root, 'icons'))) {
  fs.copyFileSync(path.join(root