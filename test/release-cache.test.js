'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
test('release version and shell cache include preparation modules', () => { const root = path.join(__dirname, '..'); const version = fs.readFileSync(path.join(root, 'version.js'), 'utf8'); const worker = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8'); const appVersion = version.match(/APP_VERSION = '([^']+)'/)[1]; const cacheVersion = worker.match(/CACHE_NAME_LITERAL = '([^']+)'/)[1]; assert.equal(appVersion, cacheVersion); assert.match(worker, /'\.\/weather\.js'/); assert.match(worker, /'\.\/spotifyUser\.js'/); assert.match(worker, /'\.\/providerIdentityState\.js'/); assert.doesNotMatch(worker, /concerts\.json|bands\.json|apiUsage\.json/); });
