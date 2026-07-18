'use strict';
const fs = require('node:fs'); const path = require('node:path');
const forbidden = ['bands.json', 'concerts.json', 'news.json', 'apiUsage.json', '.env'];
const root = fs.existsSync('dist') ? 'dist' : '.';
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]); }
if (root === 'dist') for (const file of walk(root)) if (forbidden.includes(path.basename(file)) || /ticket-files|\.pem$|\.key$/i.test(file)) throw new Error(`QA safety check rejected generated file: ${path.basename(file)}`);
if (process.env.BASE_REF) {
  const { execFileSync } = require('node:child_process');
  const changed = execFileSync('git', ['diff', '--name-only', `${process.env.BASE_REF}...HEAD`], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  for (const file of changed) if ((forbidden.includes(path.basename(file)) || /ticket-files|\.(pdf|zip)$/i.test(file)) && !file.startsWith('qa/fixtures/')) throw new Error(`Production-data change guard rejected: ${path.basename(file)}`);
}
console.log('QA safety check passed');
