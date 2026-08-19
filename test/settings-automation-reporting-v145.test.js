'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const settings = require('../settingsAutomationReportingV145');

function activity(status, workCount, changeCount, extra = {}) {
  return {
    status,
    startedAt: '2026-08-19T01:00:00.000Z',
    finishedAt: '2026-08-19T01:15:00.000Z',
    result: { workCount, changeCount },
    ...extra,
  };
}

test('album artwork coverage joins immutable source listens to separate Spotify metadata and groups by band plus release', () => {
  const bands = [{ id:'a', name:'Artist A' }, { id:'b', name:'Artist B' }];
  const events = [
    { stableListenId:'1', localBandId:'a', releaseTitle:'Shared Album', recordingTitle:'One', spotifyTrackId:'track-a1' },
    { stableListenId:'2', localBandId:'a', releaseTitle:'Shared Album', recordingTitle:'Two', spotifyTrackId:'track-a2' },
    { stableListenId:'3', localBandId:'a', releaseTitle:'Shared Album', recordingTitle:'One', spotifyTrackId:'track-a1' },
    { stableListenId:'4', localBandId:'b', releaseTitle:'Shared Album', recordingTitle:'Three', spotifyTrackId:'track-b1' },
    { stableListenId:'5', localBandId:'a', releaseTitle:null, recordingTitle:'No release', spotifyTrackId:'track-extra' },
  ];
  const before = JSON.stringify(events);
  const metadata = {
    recordForTrack(id) {
      if (id === 'track-a1') return { artworkUrl:'https://example.invalid/a.jpg' };
      if (id === 'track-a2' || id === 'track-b1') return { artworkUrl:null };
      return null;
    },
  };
  const result = settings.albumArtworkCoverage(bands, events, metadata);
  assert.deepEqual(result, { matched:1, total:2, percent:50, detail:'1 of 2 listened albums' });
  assert.equal(JSON.stringify(events), before);
});

test('album artwork coverage accepts provider-neutral event artwork and fails safely on malformed derived metadata', () => {
  const bands = [{ id:'a', name:'Artist A' }];
  const providerNeutral = [{ localBandId:'a', releaseTitle:'Album', artworkPath:'assets/listening/album-blue.svg' }];
  assert.equal(settings.albumArtworkCoverage(bands, providerNeutral, { recordForTrack(){ throw new Error('should not be called'); } }).matched, 1);

  const sourceClean = [{ localBandId:'a', releaseTitle:'Album', spotifyTrackId:'track-a' }];
  const broken = { recordForTrack(){ throw new Error('malformed metadata'); } };
  assert.deepEqual(settings.albumArtworkCoverage(bands, sourceClean, broken), { matched:0, total:1, percent:0, detail:'0 of 1 listened albums' });
});

test('album artwork coverage is stable whether artwork is transiently hydrated onto events or only available in metadata', () => {
  const bands = [{ id:'a', name:'Artist A' }];
  const cleanEvents = [{ localBandId:'a', releaseTitle:'Hydration Album', spotifyTrackId:'track-a' }];
  const metadata = { recordForTrack(){ return { artworkUrl:'https://example.invalid/a.jpg' }; } };
  const cleanResult = settings.albumArtworkCoverage(bands, cleanEvents, metadata);
  const hydratedResult = settings.albumArtworkCoverage(bands, [{ ...cleanEvents[0], albumArtworkUrl:'https://example.invalid/a.jpg' }], metadata);
  assert.deepEqual(cleanResult, hydratedResult);
  assert.equal(cleanResult.total, 1);
  assert.notEqual(cleanResult.total, 525);
});

test('all six Update activity rows use truthful standardized aggregate results including zero', () => {
  const usage = {
    automationRuns: {
      structuredResearch: {
        startedAt:'2026-08-19T01:00:00.000Z', finishedAt:'2026-08-19T01:15:00.000Z', status:'ok',
        activities: {
          concerts: activity('ok', 370, 31),
          artistArtwork: activity('ok', 10, 3),
          setlists: activity('ok', 4, 0),
        },
      },
      focusedTavilyConcert: {
        startedAt:'2026-08-15T02:00:00.000Z', finishedAt:'2026-08-15T02:10:00.000Z', status:'ok',
        activities: { webConcertSearch: activity('ok', 8, 2) },
      },
      providerIdentity: {
        startedAt:'2026-08-18T10:00:00.000Z', finishedAt:'2026-08-18T10:10:00.000Z', status:'ok',
        activities: { artistInformation: activity('ok', 12, 2) },
      },
    },
  };
  const listenBrainz = { connection: () => ({ lastSyncAt:'2026-08-19T06:00:00.000Z', lastSyncResult:{ processed:24, added:24, skipped:0 } }) };
  const rows = settings.updateActivityRows(usage, new Date('2026-08-19T08:00:00.000Z'), listenBrainz);
  assert.deepEqual(Object.fromEntries(rows.map((row) => [row.name, row.result])), {
    Concerts:'370 artists checked · 31 concerts added',
    'Web concert search':'8 artists checked · 2 concerts added',
    'Listening history':'24 listens processed · 24 listens added',
    'Artist information':'12 artists checked · 2 artists updated',
    'Artist artwork':'10 artists checked · 3 images added',
    Setlists:'4 shows checked · 0 setlists added',
  });
  assert.equal(rows.find((row) => row.name === 'Artist artwork').label, 'Healthy');
  assert.ok(rows.find((row) => row.name === 'Artist artwork').next);
});

test('result wording pluralizes singular counts correctly', () => {
  const usage = {
    automationRuns: {
      structuredResearch: { status:'ok', activities:{ concerts:activity('ok',1,1), artistArtwork:activity('ok',1,1), setlists:activity('ok',1,1) } },
      focusedTavilyConcert: { status:'ok', activities:{ webConcertSearch:activity('ok',1,1) } },
      providerIdentity: { status:'ok', activities:{ artistInformation:activity('ok',1,1) } },
    },
  };
  const lb = { connection: () => ({ lastSyncAt:'2026-08-19T06:00:00.000Z', lastSyncResult:{ processed:1, added:1, skipped:0 } }) };
  const rows = Object.fromEntries(settings.updateActivityRows(usage, new Date('2026-08-19T08:00:00.000Z'), lb).map((row) => [row.name,row.result]));
  assert.equal(rows.Concerts, '1 artist checked · 1 concert added');
  assert.equal(rows['Web concert search'], '1 artist checked · 1 concert added');
  assert.equal(rows['Listening history'], '1 listen processed · 1 listen added');
  assert.equal(rows['Artist information'], '1 artist checked · 1 artist updated');
  assert.equal(rows['Artist artwork'], '1 artist checked · 1 image added');
  assert.equal(rows.Setlists, '1 show checked · 1 setlist added');
});

test('missing legacy metrics stay missing instead of becoming false zeroes', () => {
  const usage = { lastRun:{ status:'ok', finishedAt:'2026-08-19T01:00:00.000Z', artistImagesUpdated:0 } };
  const rows = settings.updateActivityRows(usage, new Date('2026-08-19T08:00:00.000Z'), { connection:()=>null });
  assert.equal(rows.find((row) => row.name === 'Artist artwork').result, 'No recent result reported.');
  assert.equal(rows.find((row) => row.name === 'Concerts').result, 'No recent result reported.');
});

test('legacy aggregate pairs remain readable while zero additions are preserved', () => {
  const usage = {
    lastRun:{ status:'ok', finishedAt:'2026-08-19T01:00:00.000Z', bandsProcessed:9, concertsAdded:0, setlistChecksAttempted:4, setlistsAdded:0 },
    lastProviderIdentityRun:{ status:'ok', finishedAt:'2026-08-18T01:00:00.000Z', bandsConsidered:7, updates:0 },
  };
  const rows = Object.fromEntries(settings.updateActivityRows(usage, new Date('2026-08-19T08:00:00.000Z'), { connection:()=>null }).map((row)=>[row.name,row.result]));
  assert.equal(rows.Concerts, '9 artists checked · 0 concerts added');
  assert.equal(rows['Artist information'], '7 artists checked · 0 artists updated');
  assert.equal(rows.Setlists, '4 shows checked · 0 setlists added');
});

test('lane-specific failure reason does not poison unrelated healthy rows', () => {
  const usage = {
    automationRuns:{
      structuredResearch:{ status:'ok', activities:{
        concerts:activity('ok',10,1),
        artistArtwork:activity('ok',5,0),
        setlists:activity('error',4,0,{ failureCode:'provider_unavailable', failureReason:'setlist.fm temporarily unavailable (HTTP 503)' }),
      } },
    },
  };
  const rows = settings.updateActivityRows(usage, new Date('2026-08-19T08:00:00.000Z'), { connection:()=>null });
  const setlists = rows.find((row)=>row.name === 'Setlists');
  assert.equal(setlists.label, 'Failed');
  assert.equal(setlists.problem, 'setlist.fm temporarily unavailable (HTTP 503)');
  assert.equal(rows.find((row)=>row.name === 'Concerts').label, 'Healthy');
  assert.equal(rows.find((row)=>row.name === 'Artist artwork').label, 'Healthy');
});

test('failure rendering never echoes raw secret-looking diagnostic text', () => {
  const secret = 'Bearer abcdef Authorization: token=very-secret https://private.example.invalid/path\n at fn(file.js:1:1)';
  const reason = settings.safeFailureReason({ failureCode:'update_failed', failureReason:secret, error:secret }, 'Provider');
  assert.equal(reason, 'The latest update could not be completed safely.');
  assert.doesNotMatch(reason, /abcdef|very-secret|private\.example|Bearer|Authorization/i);
  assert.equal(settings.safeFailureReason({ error:'provider returned HTTP 503 token=secret' }, 'Artist artwork'), 'Artist artwork temporarily unavailable (HTTP 503)');
});
