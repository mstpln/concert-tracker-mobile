'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const settings = require('../settingsV123');

test('coverage status thresholds move from green to red as completeness falls', () => {
  assert.equal(settings.coverageLevel(100).key, 'good');
  assert.equal(settings.coverageLevel(95).key, 'good');
  assert.equal(settings.coverageLevel(94).key, 'goodish');
  assert.equal(settings.coverageLevel(90).key, 'goodish');
  assert.equal(settings.coverageLevel(89).key, 'watch');
  assert.equal(settings.coverageLevel(75).key, 'watch');
  assert.equal(settings.coverageLevel(74).key, 'warning');
  assert.equal(settings.coverageLevel(50).key, 'warning');
  assert.equal(settings.coverageLevel(49).key, 'bad');
});

test('usage status thresholds move from green to red as safety-budget use rises', () => {
  assert.equal(settings.usageLevel(0).key, 'good');
  assert.equal(settings.usageLevel(50).key, 'good');
  assert.equal(settings.usageLevel(51).key, 'goodish');
  assert.equal(settings.usageLevel(70).key, 'goodish');
  assert.equal(settings.usageLevel(71).key, 'watch');
  assert.equal(settings.usageLevel(85).key, 'watch');
  assert.equal(settings.usageLevel(86).key, 'warning');
  assert.equal(settings.usageLevel(95).key, 'warning');
  assert.equal(settings.usageLevel(96).key, 'bad');
});

test('provider usage does not invent missing safety-budget denominators', () => {
  const rows = settings.providerUsageRows({
    ticketmaster:{ callsToday:12 },
    tavily:{ callsThisMonth:20 },
    groq:{ tokensToday:30 },
    setlistfm:{ callsToday:4 },
    spotify:{ callsToday:5 },
  });
  for (const row of rows.slice(0,5)) {
    assert.equal(row.cap, undefined);
    assert.equal(row.status, 'Usage unavailable');
  }
});

test('artist profile coverage counts visible information without mutating records', () => {
  const rows = [
    { id:'a', photoUrl:'https://example.invalid/a.jpg', bio:'Manual biography', genre:'Rock', origin:'Sweden', future:{ keep:true } },
    { id:'b', generatedBio:'Generated biography', musicbrainz:{ spotify:{ images:[{ url:'https://example.invalid/b.jpg' }] } }, genre:'Metal' },
    { id:'c' },
  ];
  const before = JSON.stringify(rows);
  const result = settings.profileCoverage(rows);
  assert.deepEqual(result.map((row) => [row.key,row.matched,row.total]), [
    ['Images',2,3],
    ['Descriptions',2,3],
    ['Genres',2,3],
    ['Origin',1,3],
  ]);
  assert.equal(JSON.stringify(rows), before);
});

test('concert coverage treats only named venues and past attended setlists as coverage', () => {
  const rows = [
    { id:'a', date:'2026-01-01', attending:true, attended:true, venue:'Arena', setlist:{ songs:[{ name:'One' }] } },
    { id:'b', date:'2026-02-01', attending:true, attended:true, venue:'Unknown Venue', setlist:null },
    { id:'c', date:'2027-01-01', attending:true, venue:'Future Hall', setlist:{ songs:[{ name:'Future' }] } },
  ];
  const result = settings.concertCoverage(rows, new Date('2026-08-14T12:00:00Z'));
  assert.deepEqual(result.map((row) => [row.key,row.matched,row.total]), [
    ['Venue information',2,3],
    ['Setlists',1,2],
  ]);
});

test('listening coverage stays scoped to followed bands and unique song/album evidence', () => {
  const bands = [{ id:'band-a' }, { id:'band-b' }];
  const events = [
    { stableListenId:'1', localBandId:'band-a', artistCreditName:'Band A', recordingTitle:'Song One', releaseTitle:'Album One', musicbrainzRecordingId:'mbid-1', albumArtworkUrl:'https://example.invalid/one.jpg' },
    { stableListenId:'2', localBandId:'band-a', artistCreditName:'Band A', recordingTitle:'Song One', releaseTitle:'Album One', musicbrainzRecordingId:'mbid-1' },
    { stableListenId:'3', localBandId:'band-b', artistCreditName:'Band B', recordingTitle:'Song Two', releaseTitle:'Album Two' },
    { stableListenId:'4', artistCreditName:'Unfollowed Artist', recordingTitle:'Song Three', releaseTitle:'Album Three', spotifyTrackId:'track-3', albumArtworkUrl:'https://example.invalid/three.jpg' },
  ];
  const result = settings.listeningCoverage(bands, events);
  assert.deepEqual(result.map((row) => [row.key,row.matched,row.total]), [
    ['Artists matched',2,2],
    ['Songs identified',1,2],
    ['Album artwork',1,2],
  ]);
});

test('review item keys are stable enough for session-only defer without source mutation', () => {
  assert.equal(settings.reviewItemKey({ kind:'musicbrainz', band:{ id:'band-a', name:'Band A' } }), 'artist:musicbrainz:band-a');
  assert.equal(settings.reviewItemKey({ kind:'spotify', row:{ bandId:'band-a', bandName:'Band A' } }), 'artist:spotify:band-a');
  assert.equal(settings.reviewItemKey({ candidatePairs:[{ pairKey:'b|c' }, { pairKey:'a|b' }] }), 'listening:a|b,b|c');
});

test('listening maintenance presentation preserves active, paused, preparing, stale and error states', () => {
  const paused = settings.activationPresentation(
    { status:'gau5_preparing' },
    { status:'paused', phase:'candidates', stagedEventCount:12, candidateCount:3 },
    null
  );
  assert.match(paused.text, /Paused safely/);
  assert.equal(paused.prepareLabel, 'Resume preparation');
  assert.equal(paused.showPrepare, true);

  const running = settings.activationPresentation(
    { status:'gau5_preparing' },
    { status:'running', phase:'verification', verifiedCanonicalCount:20 },
    null
  );
  assert.match(running.text, /Preparing listening statistics/);
  assert.equal(running.showPrepare, false);

  const interrupted = settings.activationPresentation({ status:'error', error:'Preparation was interrupted.' }, null, null);
  assert.match(interrupted.text, /Preparation stopped safely/);
  assert.equal(interrupted.prepareLabel, 'Prepare again');

  const stale = settings.activationPresentation({ status:'stale' }, null, null);
  assert.match(stale.text, /Listening history changed/);
  assert.equal(stale.showActivate, false);

  const active = settings.activationPresentation({ status:'active' }, null, null);
  assert.equal(active.showDeactivate, true);
});
