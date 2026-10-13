'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const node = process.execPath;
const root = path.resolve(__dirname, '..');

test('QA build installs fixtures and bootstrap before app without inline configuration', () => {
  execFileSync(node, ['scripts/build-qa.js'], {
    cwd: root,
    env: { ...process.env, QA_BUILD_ID: 'safe-test-id' },
  });

  const html = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
  const config = fs.readFileSync(path.join(root, 'dist/qa-build-config.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'dist/service-worker.js'), 'utf8');

  assert.ok(html.indexOf('qa-fixtures.js') < html.indexOf('qa-bootstrap.js'));
  assert.ok(html.indexOf('qa-bootstrap.js') < html.indexOf('app.js'));
  assert.match(config, /safe-test-id/);
  assert.equal(/<script>window\.__LIVEVAULT_QA_BUILD_ID__/.test(html), false);
  assert.match(sw, /concert-tracker-qa-' \+ CACHE_NAME_LITERAL \+ '-safe-test-id/);
  assert.match(sw, /'\.\/qa-build-config\.js'/);
});

test('QA service worker removes only obsolete QA caches', () => {
  execFileSync(node, ['scripts/build-qa.js'], {
    cwd: root,
    env: { ...process.env, QA_BUILD_ID: 'cache-isolation-test' },
  });

  const sw = fs.readFileSync(path.join(root, 'dist/service-worker.js'), 'utf8');
  assert.match(
    sw,
    /keys\.filter\(\(k\) => k\.startsWith\('concert-tracker-qa-'\) && k !== CACHE_NAME\)/
  );
  assert.doesNotMatch(sw, /keys\.filter\(\(k\) => k !== CACHE_NAME\)/);
});

test('synthetic shell includes every app script referenced by the production HTML and blocks live providers', () => {
  execFileSync(node, ['scripts/build-qa.js'], {
    cwd: root,
    env: { ...process.env, QA_BUILD_ID: 'complete-shell-test' },
  });

  const sourceHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
  const scriptFiles = [...sourceHtml.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]);
  for (const file of scriptFiles) assert.ok(fs.existsSync(path.join(root, 'dist', file)), `missing synthetic app module ${file}`);
  for (const file of ['listeningVaultBridge.js', 'listeningVault.js', 'listeningHistoryV2.js', 'listeningIncrementalVault.js', 'listenbrainzSync.js', 'spotifyHistoryImport.js']) {
    assert.match(html, new RegExp(`<script src="${file.replace('.', '\\.')}"></script>`));
  }
  assert.match(html, /connect-src 'self' https:\/\/qa\.invalid/);
  assert.match(html, /connect-src 'self' https:\/\/qa\.invalid;/);
});

test('live-reload build config is opt-in and keeps its generated output isolated', () => {
  const output = path.join(root, `.qa-build-test-${process.pid}`);
  try {
    execFileSync(node, ['scripts/build-qa.js'], {
      cwd: root,
      env: { ...process.env, QA_BUILD_ID: 'live-reload-test', QA_LIVE_RELOAD: '1', QA_OUTPUT_DIR: output },
    });
    const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
    const config = fs.readFileSync(path.join(output, 'qa-build-config.js'), 'utf8');
    assert.match(html, /<script src="qa-live-reload\.js"><\/script>/);
    assert.match(config, /window\.__LIVEVAULT_QA_LIVE_RELOAD__ = true/);
  } finally {
    fs.rmSync(output, { recursive: true, force: true });
  }
});
