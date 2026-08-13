'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cases = [
  ['research.yml', 'structured-research', 'node -r ./scripts/preloadStructuredRun.js scripts/research.js'],
  ['tavily-concert-research.yml', 'focused-tavily-concert', 'node scripts/tavilyConcertRun.js'],
  ['musicbrainz.yml', 'musicbrainz-identity-backfill', 'node scripts/musicbrainz-backfill.js'],
  ['provider-identity-backfill.yml', 'provider-identity-backfill', 'node scripts/provider-identity-backfill.js'],
  ['spotify-candidate-acquisition.yml', 'spotify-candidate-acquisition', 'node scripts/spotify-candidate-acquisition.js'],
  ['setlist-insights-backfill.yml', 'setlist-insights-backfill', 'node scripts/setlistInsightsBackfill.js'],
];

test('provider-using GitHub workflows execute through the shared DAB7 lease wrapper', () => {
  for (const [filename, owner, command] of cases) {
    const source = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', filename), 'utf8');
    const expected = `node scripts/run-with-scheduler-lease.js ${owner} -- ${command}`;
    assert.match(source, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `${filename} must execute its provider command under the shared scheduler lease`);
    assert.match(source, /group:\s*live-vault-data-writes/,
      `${filename} must retain GitHub Actions concurrency as defense in depth`);
  }
});
