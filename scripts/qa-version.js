'use strict';
const fs = require('node:fs');
const version = fs.readFileSync('version.js', 'utf8').match(/APP_VERSION = '([^']+)'/)?.[1];
const cache = fs.readFileSync('service-worker.js', 'utf8').match(/CACHE_NAME_LITERAL = '([^']+)'/)?.[1];
if (!version || version !== cache) throw new Error('APP_VERSION and CACHE_NAME_LITERAL must match');
console.log(`Version/cache synchronized: ${version}`);
