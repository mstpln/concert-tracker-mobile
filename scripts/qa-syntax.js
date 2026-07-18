'use strict';
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'); const path = require('node:path');
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() && !['node_modules', 'dist', '.git'].includes(entry.name) ? walk(path.join(dir, entry.name)) : entry.isFile() && entry.name.endsWith('.js') ? [path.join(dir, entry.name)] : []); }
for (const file of walk('.')) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
