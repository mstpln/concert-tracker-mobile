'use strict';

const inventoryLib = require('./listening-inventory');
const runner = require('./listening-maintenance-runner');

const MB_ARTIST = '11111111-1111-4111-8111-111111111111';
const MB_RECORDING = '22222222-2222-4222-8222-222222222222';

function syntheticInventory() {
  return inventoryLib.buildListeningInventory({
    bands: [{
      id: 'qa-band-1',
      name: 'Synthetic Artist',
      musicbrainz: {
        mbid: MB_ARTIST,
        status: 'manual_confirmed',
        spotify: { id: 'SyntheticSpotifyArtist1', status: 'manual_confirmed' },
      },
    }],
    events: [{
      bandId: 'qa-band-1',
      artistCreditName: 'Synthetic Artist',
      recordingTitle: 'Synthetic Song',
      spotifyTrackId: 'SyntheticSpotifyTrack1',
    }],
  });
}

async function main() {
  const writes = [];
  const usage = {
    calls: [],
    async reserve(provider) {
      this.calls.push(provider);
      return true;
    },
  };
  const providers = {
    spotify: {
      exact_track: async () => ({
        kind: 'ok',
        data: {
          id: 'SyntheticSpotifyTrack1',
          artists: [{ id: 'SyntheticSpotifyArtist1' }],
          album: { id: 'SyntheticSpotifyAlbum1', images: [{ url: 'https://example.test/synthetic.jpg' }] },
          external_ids: { isrc: 'USABC1234567' },
        },
      }),
    },
    musicbrainz: {
      isrc_lookup: async () => ({
        kind: 'ok',
        data: {
          recordings: [{ id: MB_RECORDING, 'artist-credit': [{ artist: { id: MB_ARTIST } }] }],
        },
      }),
    },
    listenbrainz: {
      metadata_lookup: async () => ({ kind: 'no_match', reason: 'synthetic_unused' }),
    },
  };

  const result = await runner.runMaintenanceBatch({
    inventory: syntheticInventory(),
    providers,
    usage,
    maxSteps: 2,
    now: '2026-08-08T09:00:00.000Z',
    async persist(snapshot) {
      writes.push({ provider: snapshot.lastStep.provider, status: snapshot.lastOutcome.status });
    },
  });

  const safe = {
    ok: result.plan.complete === 1 && result.summary.persisted === 2,
    attempted: result.summary.attempted,
    persisted: result.summary.persisted,
    providerCalls: usage.calls.length,
    providers: Object.fromEntries(['spotify', 'musicbrainz', 'listenbrainz'].map((provider) => [provider, usage.calls.filter((value) => value === provider).length])),
    remainingPlan: result.plan,
    writes,
  };
  process.stdout.write(`${JSON.stringify(safe)}\n`);
  if (!safe.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error('Synthetic listening maintenance dry run failed.');
  process.exitCode = 1;
});
