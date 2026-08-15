'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const conflictMerge = require('../conflictMerge');
const structured = require('../scripts/lib/structuredResearch');
const { createWorkerClient } = require('../scripts/lib/workerClient');

const manualSpotify = {
  id: null,
  status: 'manual_rejected',
  reason: 'known_merged_profile',
  futureField: { keep: true },
};
const manualTicketmaster = {
  id: 'tm-user',
  status: 'manual_confirmed',
  reviewedAt: '2026-08-15T11:00:00.000Z',
  futureField: { keep: true },
};
const fakeWorkerEnv = { CF_WORKER_ENDPOINT: 'https://example.test', CF_WORKER_TOKEN: 'fake' };

function response(status, body, etag) {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: etag ? { ETag: etag, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
  });
}

test('structured latest-record merge preserves newer nested reviewed provider decisions', () => {
  const latest = [{
    id: 'dollface',
    notes: 'keep me',
    musicbrainz: { mbid: 'mbid', status: 'auto_confirmed', spotify: manualSpotify, ticketmaster: manualTicketmaster },
    structuredResearch: { future: { keep: true } },
  }];
  const staleAutomation = [{
    id: 'dollface',
    musicbrainz: {
      mbid: 'mbid', status: 'auto_confirmed',
      spotify: { id: 'spotify-auto', status: 'confirmed' },
      ticketmaster: { id: 'tm-auto', status: 'confirmed' },
      metadata: { artistName: 'Dollface' },
    },
    structuredResearch: { routing: { lastTavilyTourAt: '2026-08-15T10:00:00.000Z' } },
  }];

  const merged = structured.mergeStructuredBandUpdates(latest, staleAutomation)[0];
  assert.deepEqual(merged.musicbrainz.spotify, manualSpotify);
  assert.deepEqual(merged.musicbrainz.ticketmaster, manualTicketmaster);
  assert.deepEqual(merged.musicbrainz.metadata, { artistName: 'Dollface' });
  assert.equal(merged.notes, 'keep me');
  assert.deepEqual(merged.structuredResearch.future, { keep: true });
});

test('structured latest-record merge still replaces ordinary automated nested provider state', () => {
  const latest = [{ id: 'band', musicbrainz: { status: 'auto_confirmed', spotify: { id: 'old', status: 'confirmed' } } }];
  const update = [{ id: 'band', musicbrainz: { status: 'auto_confirmed', spotify: { id: 'new', status: 'confirmed' } } }];
  assert.equal(structured.mergeStructuredBandUpdates(latest, update)[0].musicbrainz.spotify.id, 'new');
});

test('pre-write protection preserves whole reviewed provider objects in stable-id documents', () => {
  const current = [{
    id: 'dollface',
    musicbrainz: { status: 'pending', spotify: manualSpotify, ticketmaster: manualTicketmaster },
  }];
  const intended = [{
    id: 'dollface',
    musicbrainz: {
      status: 'auto_confirmed',
      spotify: { id: 'spotify-auto', status: 'confirmed' },
      ticketmaster: { id: 'tm-auto', status: 'confirmed' },
      metadata: { artistName: 'Dollface' },
    },
  }];

  const merged = conflictMerge.preserveReviewedDecisions(current, intended);
  assert.deepEqual(merged[0].musicbrainz.spotify, manualSpotify);
  assert.deepEqual(merged[0].musicbrainz.ticketmaster, manualTicketmaster);
  assert.deepEqual(merged[0].musicbrainz.metadata, { artistName: 'Dollface' });
});

test('normal bands write cannot erase a manual provider decision made after automation starts', async () => {
  const latest = [{ id: 'dollface', musicbrainz: { status: 'pending', spotify: manualSpotify, ticketmaster: manualTicketmaster } }];
  const stale = [{ id: 'dollface', musicbrainz: { status: 'auto_confirmed', spotify: { id: 'auto', status: 'confirmed' }, ticketmaster: { id: 'tm-auto', status: 'confirmed' } } }];
  const requests = [];
  const fetchImpl = async (_url, options = {}) => {
    requests.push(options);
    if (!options.method) return response(200, latest, 'v2');
    const written = JSON.parse(options.body);
    assert.deepEqual(written[0].musicbrainz.spotify, manualSpotify);
    assert.deepEqual(written[0].musicbrainz.ticketmaster, manualTicketmaster);
    return response(200, undefined, 'v3');
  };
  const client = createWorkerClient({ env: fakeWorkerEnv, fetchImpl });
  await client.readJson('bands.json', []);
  await client.writeJson('bands.json', stale);
  assert.equal(requests.length, 2);
});

test('reviewed-decision pre-write protection is not applied to unrelated documents', async () => {
  const current = [{ id: 'news-1', state: manualSpotify }];
  const intended = [{ id: 'news-1', state: { id: 'generated', status: 'confirmed' } }];
  const fetchImpl = async (_url, options = {}) => {
    if (!options.method) return response(200, current, 'v1');
    assert.deepEqual(JSON.parse(options.body), intended);
    return response(200, undefined, 'v2');
  };
  const client = createWorkerClient({ env: fakeWorkerEnv, fetchImpl });
  await client.readJson('news.json', []);
  await client.writeJson('news.json', intended);
});

test('ETag retry keeps a reviewed provider decision made between GET and PUT', async () => {
  const base = [{ id: 'dollface', musicbrainz: { status: 'auto_confirmed', spotify: { id: 'old', status: 'confirmed' } } }];
  const intended = [{ id: 'dollface', musicbrainz: { status: 'auto_confirmed', spotify: { id: 'automation-new', status: 'confirmed' } } }];
  const latest = [{ id: 'dollface', musicbrainz: { status: 'auto_confirmed', spotify: manualSpotify } }];
  let step = 0;
  const fetchImpl = async (_url, options = {}) => {
    step += 1;
    if (step === 1) return response(200, base, 'v1');
    if (step === 2) return response(412, undefined);
    if (step === 3) return response(200, latest, 'v2');
    const written = JSON.parse(options.body);
    assert.deepEqual(written[0].musicbrainz.spotify, manualSpotify);
    return response(200, undefined, 'v3');
  };
  const client = createWorkerClient({ env: fakeWorkerEnv, fetchImpl });
  await client.readJson('bands.json', []);
  await client.writeJson('bands.json', intended);
  assert.equal(step, 4);
});
