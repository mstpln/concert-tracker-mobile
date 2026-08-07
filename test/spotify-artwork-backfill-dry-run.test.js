'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dryRun = require('../scripts/spotify-artwork-backfill-dry-run.js');

function writeJson(filename, value) {
  fs.writeFileSync(filename, `${JSON.stringify(value)}\n`);
}

test('dry-run creates a private checkpoint and reports aggregate counts without network work or track IDs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bandmarkr-backfill-'));
  const eventsFile = path.join(dir, 'events.json');
  const metadataFile = path.join(dir, 'metadata.json');
  const checkpointFile = path.join(dir, 'checkpoint.json');
  writeJson(eventsFile, [
    { spotifyTrackId: 'SyntheticTrackA', recordingTitle: 'Do not print me' },
    { spotifyTrackId: 'SyntheticTrackB', recordingTitle: 'Do not print me either' },
  ]);
  writeJson(metadataFile, {
    kind: 'livevault-spotify-listening-metadata',
    schemaVersion: 1,
    records: {
      SyntheticTrackA: { spotifyTrackId: 'SyntheticTrackA' },
    },
  });
  const messages = [];
  const summary = dryRun.main([
    '--events', eventsFile,
    '--metadata', metadataFile,
    '--checkpoint', checkpointFile,
    '--cap', '25',
  ], (message) => messages.push(message));

  assert.equal(summary.networkCalls, 0);
  assert.equal(summary.productionWrites, 0);
  assert.equal(summary.uniqueTrustedTrackIds, 2);
  assert.equal(summary.plannedThisLogicalRun, 1);
  assert.equal(summary.remainingThisLogicalRun, 1);
  assert.equal(fs.existsSync(checkpointFile), true);
  const output = messages.join('\n');
  assert.doesNotMatch(output, /SyntheticTrackA|SyntheticTrackB|Do not print/);
});

test('dry-run resumes an existing logical checkpoint instead of expanding it to another cap', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bandmarkr-backfill-'));
  const eventsFile = path.join(dir, 'events.json');
  const metadataFile = path.join(dir, 'metadata.json');
  const checkpointFile = path.join(dir, 'checkpoint.json');
  writeJson(eventsFile, Array.from({ length: 40 }, (_, index) => ({ spotifyTrackId: `Synthetic${index}` })));
  writeJson(metadataFile, { kind: 'livevault-spotify-listening-metadata', schemaVersion: 1, records: {} });

  const first = dryRun.main([
    '--events', eventsFile,
    '--metadata', metadataFile,
    '--checkpoint', checkpointFile,
    '--cap', '25',
  ], () => {});
  assert.equal(first.plannedThisLogicalRun, 25);

  const checkpoint = JSON.parse(fs.readFileSync(checkpointFile, 'utf8'));
  checkpoint.remainingIds = checkpoint.remainingIds.slice(10);
  fs.writeFileSync(checkpointFile, `${JSON.stringify(checkpoint)}\n`);

  const resumed = dryRun.main([
    '--events', eventsFile,
    '--metadata', metadataFile,
    '--checkpoint', checkpointFile,
    '--cap', '25',
  ], () => {});
  assert.equal(resumed.plannedThisLogicalRun, 25);
  assert.equal(resumed.remainingThisLogicalRun, 15);
});
