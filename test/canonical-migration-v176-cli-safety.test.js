'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Migration = require('../scripts/lib/canonicalMigrationV176Contract');

const VENUE_ID = 'venue-a1b2c3d4';

function venue() {
  return { venueId: VENUE_ID, name: 'Main Hall', currentName: 'Main Hall', city: 'Malmo', country: 'Sweden', address: 'Main Street 1' };
}

function concert() {
  return { id: 'concert-a', bandId: 'band-a', date: '2026-10-10', venue: 'Main Hall', city: 'Malmo', country: 'Sweden', venueAddress: 'Main Street 1', canonicalVenueId: VENUE_ID };
}

function fixtureDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const venuesPath = path.join(dir, 'venues.json');
  const concertsPath = path.join(dir, 'concerts.json');
  const venueBytes = Buffer.from(`${JSON.stringify([venue()], null, 2)}\n`);
  const concertBytes = Buffer.from(`${JSON.stringify([concert()], null, 2)}\n`);
  fs.writeFileSync(venuesPath, venueBytes);
  fs.writeFileSync(concertsPath, concertBytes);
  return { dir, venuesPath, concertsPath, venueBytes, concertBytes };
}

function scriptPath() {
  return path.join(__dirname, '..', 'scripts', 'canonical-audit-migrate-v176.js');
}

test('v176 CLI rejects a known decision section with the wrong JSON type', () => {
  const fixture = fixtureDir('lv-v176-shape-');
  const decisionsPath = path.join(fixture.dir, 'decisions.json');
  fs.writeFileSync(decisionsPath, JSON.stringify({ venueMerges: {} }));
  const run = spawnSync(process.execPath, [
    scriptPath(), 'audit', '--venues', fixture.venuesPath, '--concerts', fixture.concertsPath,
    '--decisions', decisionsPath, '--out', path.join(fixture.dir, 'audit.json'),
  ], { encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /venueMerges must be an array/);
});

test('v176 CLI rejects malformed decision member list types', () => {
  const fixture = fixtureDir('lv-v176-member-shape-');
  const decisionsPath = path.join(fixture.dir, 'decisions.json');
  fs.writeFileSync(decisionsPath, JSON.stringify({ concertDistinct: [{ ids: 'concert-a' }] }));
  const run = spawnSync(process.execPath, [
    scriptPath(), 'audit', '--venues', fixture.venuesPath, '--concerts', fixture.concertsPath,
    '--decisions', decisionsPath, '--out', path.join(fixture.dir, 'audit.json'),
  ], { encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /concertDistinct\[0\]\.ids must be an array/);
});

test('v176 audit refuses an output symlink that resolves to a source input', { skip: process.platform === 'win32' }, () => {
  const fixture = fixtureDir('lv-v176-symlink-');
  const alias = path.join(fixture.dir, 'audit-link.json');
  fs.symlinkSync(fixture.venuesPath, alias);
  const original = fs.readFileSync(fixture.venuesPath);
  const run = spawnSync(process.execPath, [
    scriptPath(), 'audit', '--venues', fixture.venuesPath, '--concerts', fixture.concertsPath, '--out', alias,
  ], { encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /must not overwrite a source input file/);
  assert.deepEqual(fs.readFileSync(fixture.venuesPath), original);
});

test('v176 audit refuses a hard-link output that aliases a source input', { skip: process.platform === 'win32' }, () => {
  const fixture = fixtureDir('lv-v176-hardlink-');
  const alias = path.join(fixture.dir, 'audit-hardlink.json');
  fs.linkSync(fixture.venuesPath, alias);
  const original = fs.readFileSync(fixture.venuesPath);
  const run = spawnSync(process.execPath, [
    scriptPath(), 'audit', '--venues', fixture.venuesPath, '--concerts', fixture.concertsPath, '--out', alias,
  ], { encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /must not overwrite a source input file/);
  assert.deepEqual(fs.readFileSync(fixture.venuesPath), original);
});

test('v176 plan accepts a genuinely empty output directory and writes a valid dry run', () => {
  const fixture = fixtureDir('lv-v176-empty-out-');
  const outDir = path.join(fixture.dir, 'out');
  fs.mkdirSync(outDir);
  const run = spawnSync(process.execPath, [
    scriptPath(), 'plan', '--venues', fixture.venuesPath, '--concerts', fixture.concertsPath,
    '--expected-venues-sha256', Migration.sha256Bytes(fixture.venueBytes),
    '--expected-concerts-sha256', Migration.sha256Bytes(fixture.concertBytes),
    '--out-dir', outDir,
  ], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(fs.existsSync(path.join(outDir, 'migration-report.json')), true);
});
