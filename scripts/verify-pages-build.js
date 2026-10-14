'use strict';

const fs = require('node:fs');
const path = require('node:path');

const siteRoot = path.resolve(process.argv[2] || '_site');
const failures = [];

function fail(message) {
  failures.push(message);
}

if (!fs.existsSync(siteRoot) || !fs.statSync(siteRoot).isDirectory()) {
  throw new Error(`GitHub Pages output directory does not exist: ${siteRoot}`);
}

function resolveLocalReference(reference, fromFile) {
  const value = String(reference || '').trim();
  if (!value || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value)) return null;

  let resolvedUrl;
  try {
    const base = new URL(`https://pages.invalid/${path.posix.dirname(fromFile)}/`);
    resolvedUrl = new URL(value, base);
  } catch {
    fail(`Invalid local asset reference in ${fromFile}: ${value}`);
    return null;
  }

  if (resolvedUrl.origin !== 'https://pages.invalid') return null;

  let relativePath;
  try {
    relativePath = decodeURIComponent(resolvedUrl.pathname).replace(/^\/+/, '');
  } catch {
    fail(`Invalid URL encoding in asset reference from ${fromFile}: ${value}`);
    return null;
  }

  const resolvedPath = path.resolve(siteRoot, relativePath);
  if (resolvedPath !== siteRoot && !resolvedPath.startsWith(`${siteRoot}${path.sep}`)) {
    fail(`Asset reference escapes the Pages output from ${fromFile}: ${value}`);
    return null;
  }
  return path.relative(siteRoot, resolvedPath);
}

function requireAsset(reference, fromFile) {
  const relativePath = resolveLocalReference(reference, fromFile);
  if (!relativePath) return;
  const assetPath = path.join(siteRoot, relativePath);
  if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
    fail(`Missing production asset in Pages output: ${relativePath} (referenced by ${fromFile})`);
  }
}

const requiredAssets = [
  'index.html',
  'app.js',
  'app.css',
  'manifest.json',
  'service-worker.js',
  'version.js',
  'icons/icon-192.png',
];

for (const asset of requiredAssets) {
  const assetPath = path.join(siteRoot, asset);
  if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
    fail(`Required production asset is missing from Pages output: ${asset}`);
  }
}

const indexPath = path.join(siteRoot, 'index.html');
if (fs.existsSync(indexPath)) {
  const html = fs.readFileSync(indexPath, 'utf8');
  for (const match of html.matchAll(/\b(?:src|href|poster)=["']([^"']+)["']/gi)) {
    requireAsset(match[1], 'index.html');
  }
}

const manifestPath = path.join(siteRoot, 'manifest.json');
if (fs.existsSync(manifestPath)) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const icon of manifest.icons || []) {
      requireAsset(icon.src, 'manifest.json');
    }
  } catch (error) {
    fail(`Invalid production web manifest: ${error.message}`);
  }
}

const serviceWorkerPath = path.join(siteRoot, 'service-worker.js');
if (fs.existsSync(serviceWorkerPath)) {
  const serviceWorker = fs.readFileSync(serviceWorkerPath, 'utf8');
  const shellMatch = serviceWorker.match(/const\s+SHELL_FILES\s*=\s*\[([\s\S]*?)\]\s*;/);
  if (!shellMatch) {
    fail('Could not find the production service-worker shell asset list');
  } else {
    for (const match of shellMatch[1].matchAll(/['"]([^'"]+)['"]/g)) {
      requireAsset(match[1], 'service-worker.js');
    }
  }
  for (const match of serviceWorker.matchAll(/importScripts\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    requireAsset(match[1], 'service-worker.js');
  }
}

const forbiddenPaths = [
  'attached_assets',
  'playwright',
  'playwright.config.js',
  'qa',
  'test',
  'listeningFixtures.js',
  'listeningFixturesV99.js',
  'scripts/build-qa.js',
  'scripts/qa-cloudflare-builds.js',
  'scripts/qa-safety.js',
  'scripts/qa-syntax.js',
  'scripts/qa-version.js',
  'scripts/qa-workflows.js',
  'scripts/qa-output-path.js',
  'scripts/serve-qa.js',
  'scripts/validate-qa-fixtures.js',
  'scripts/verify-pages-build.js',
];

for (const forbidden of forbiddenPaths) {
  if (fs.existsSync(path.join(siteRoot, forbidden))) {
    fail(`QA-only source was included in the Pages output: ${forbidden}`);
  }
}

const syntheticMarkers = [
  'QA Artist One',
  'Synthetic Blue Record',
  'qa-synthetic-token',
  'qa.invalid',
  'synthetic-listenbrainz',
  'Synthetic ListenBrainz Track',
  'Unmatched Synthetic Release',
];
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.md', '.svg', '.txt', '.webmanifest', '.xml']);

function scanForSyntheticExamples(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      scanForSyntheticExamples(filePath);
      continue;
    }
    if (!entry.isFile() || !textExtensions.has(path.extname(entry.name).toLowerCase())) continue;

    const content = fs.readFileSync(filePath, 'utf8');
    for (const marker of syntheticMarkers) {
      if (content.includes(marker)) {
        fail(`Synthetic QA example found in Pages output: ${path.relative(siteRoot, filePath)}`);
        break;
      }
    }
  }
}

scanForSyntheticExamples(siteRoot);

if (failures.length > 0) {
  console.error(`GitHub Pages artifact safety failed (${failures.length} issue${failures.length === 1 ? '' : 's'}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`GitHub Pages artifact verified: QA sources and synthetic examples are excluded; ${requiredAssets.length} required app assets and all referenced production assets are present.`);
}
