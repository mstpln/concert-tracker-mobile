'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const forbiddenNames = new Set(['bands.json', 'concerts.json', 'news.json', 'apiUsage.json', '.env']);
const forbiddenPathPattern = /ticket-files|\.(?:pem|key|p12|pfx)$/i;
const credentialLiteralPattern = /(?:api[_-]?key|token|secret)\s*[:=]\s*['"][^'"\r\n]{12,}['"]/i;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

if (fs.existsSync('dist')) {
  const files = walk('dist');
  for (const file of files) {
    const relative = path.relative('dist', file);
    if (forbiddenNames.has(path.basename(file)) || forbiddenPathPattern.test(relative)) {
      throw new Error(`QA safety check rejected generated file: ${relative}`);
    }

    const stat = fs.statSync(file);
    if (stat.size <= 1024 * 1024 && /\.(?:html|js|json|css|txt|map)$/i.test(file)) {
      const content = fs.readFileSync(file, 'utf8');
      if (credentialLiteralPattern.test(content)) {
        throw new Error(`QA safety check rejected credential-like literal in: ${relative}`);
      }
    }
  }

  const manifestPath = path.join('dist', 'qa-build.json');
  if (!fs.existsSync(manifestPath)) throw new Error('QA safety check requires dist/qa-build.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.synthetic !== true || typeof manifest.buildId !== 'string' || !manifest.buildId) {
    throw new Error('QA safety check rejected invalid synthetic build metadata');
  }
}

if (process.env.BASE_REF) {
  const changed = execFileSync('git', ['diff', '--name-only', `${process.env.BASE_REF}...HEAD`], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);

  for (const file of changed) {
    if ((forbiddenNames.has(path.basename(file)) || /ticket-files|\.(?:pdf|zip|pem|key|p12|pfx)$/i.test(file)) && !file.startsWith('qa/fixtures/')) {
      throw new Error(`Production-data change guard rejected: ${file}`);
    }
  }
}

console.log('QA safety check passed');
