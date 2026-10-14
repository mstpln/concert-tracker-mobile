'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const resolveQaOutputPath = require('../scripts/qa-output-path');

const node = process.execPath;
const root = path.resolve(__dirname, '..');
const qaBuildOutput = path.join(root, 'qa-artifacts', 'qa-build-unit');

fs.mkdirSync(path.dirname(qaBuildOutput), { recursive: true });

function buildQa(extraEnv) {
  fs.rmSync(qaBuildOutput, { recursive: true, force: true });
  execFileSync(node, ['scripts/build-qa.js'], {
    cwd: root,
    env: { ...process.env, ...extraEnv, QA_OUTPUT_DIR: qaBuildOutput },
  });
}

test.after(() => fs.rmSync(qaBuildOutput, { recursive: true, force: true }));

test('QA output path accepts only dedicated generated directories and rejects symlinks', () => {
  assert.equal(resolveQaOutputPath(root, 'dist'), path.join(root, 'dist'));
  assert.equal(resolveQaOutputPath(root, 'qa-artifacts/playwright'), path.join(root, 'qa-artifacts/playwright'));
  assert.throws(() => resolveQaOutputPath(root, path.join(root, '.git')), /dedicated generated-output directory/);
  assert.throws(() => resolveQaOutputPath(root, path.resolve(root, '..', 'outside')), /dedicated generated-output directory/);

  const symlink = path.join(root, 'qa-artifacts', `unsafe-output-${process.pid}`);
  fs.symlinkSync(path.join(root, '.git'), symlink, 'dir');
  try {
    assert.throws(() => resolveQaOutputPath(root, path.join(symlink, 'build')), /symbolic links/);
  } finally {
    fs.unlinkSync(symlink);
  }
});

test('QA build rejects Git metadata and other non-generated output locations', () => {
  const result = spawnSync(node, ['scripts/build-qa.js'], {
    cwd: root,
    env: { ...process.env, QA_OUTPUT_DIR: path.join(root, '.git') },
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /dedicated generated-output directory/);
  assert.ok(fs.existsSync(path.join(root, '.git')), 'Git metadata must remain intact');
});

test('QA build installs fixtures and bootstrap before app without inline configuration', () => {
  buildQa({ QA_BUILD_ID: 'safe-test-id' });

  const html = fs.readFileSync(path.join(qaBuildOutput, 'index.html'), 'utf8');
  const config = fs.readFileSync(path.join(qaBuildOutput, 'qa-build-config.js'), 'utf8');
  const sw = fs.readFileSync(path.join(qaBuildOutput, 'service-worker.js'), 'utf8');

  assert.doesNotMatch(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /<script src="listeningFixtures(?:V99)?\.js"><\/script>/);
  assert.ok(html.indexOf('qa-fixtures.js') < html.indexOf('qa-bootstrap.js'));
  assert.ok(html.indexOf('qa-bootstrap.js') < html.indexOf('app.js'));
  assert.match(html, /<script src="listeningFixtures\.js"><\/script>/);
  assert.match(html, /<script src="listeningFixturesV99\.js"><\/script>/);
  assert.ok(html.indexOf('listeningFixtures.js') < html.indexOf('app.js'));
  assert.ok(html.indexOf('listeningFixturesV99.js') < html.indexOf('app.js'));
  assert.match(sw, /'\.\/listeningFixtures\.js'/);
  assert.match(sw, /'\.\/listeningFixturesV99\.js'/);
  assert.match(config, /safe-test-id/);
  assert.equal(/<script>window\.__LIVEVAULT_QA_BUILD_ID__/.test(html), false);
  assert.match(sw, /concert-tracker-qa-' \+ CACHE_NAME_LITERAL \+ '-safe-test-id/);
  assert.match(sw, /'\.\/qa-build-config\.js'/);
});

test('QA service worker removes only obsolete QA caches', () => {
  buildQa({ QA_BUILD_ID: 'cache-isolation-test' });

  const sw = fs.readFileSync(path.join(qaBuildOutput, 'service-worker.js'), 'utf8');
  assert.match(
    sw,
    /keys\.filter\(\(k\) => k\.startsWith\('concert-tracker-qa-'\) && k !== CACHE_NAME\)/
  );
  assert.doesNotMatch(sw, /keys\.filter\(\(k\) => k !== CACHE_NAME\)/);
});

test('synthetic shell includes every app script referenced by the production HTML and blocks live providers', () => {
  buildQa({ QA_BUILD_ID: 'complete-shell-test' });

  const sourceHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const html = fs.readFileSync(path.join(qaBuildOutput, 'index.html'), 'utf8');
  const scriptFiles = [...sourceHtml.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]);
  for (const file of scriptFiles) assert.ok(fs.existsSync(path.join(qaBuildOutput, file)), `missing synthetic app module ${file}`);
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
