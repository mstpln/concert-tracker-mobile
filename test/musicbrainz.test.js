'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, countryFrom, candidateFrom, searchArtist, identityResult } = require('../scripts/lib/musicbrainz');
const { musicbrainzEligible, mergeMusicbrainzResults, processMusicbrainzIdentities } = require('../scripts/research');
const { UsageTracker, ensureMusicbrainzState } = require('../scripts/lib/usageTracker');
const { confirmedIdentity, rejectCandidates, retryIdentity } = require('../musicbrainzState');
const config = require('../scripts/lib/config');
const band = (name = 'The Cure', extra = {}) => ({ id: 'cure', name, ...extra });
const raw = (name = 'The Cure', extra = {}) => ({ id: 'mbid-1', name, type: 'Group', score: 100, ...extra });
const fakeUsage = () => ({ attempts: 0, canCallMusicbrainz: () => true, recordMusicbrainzAttempt: async function () { this.attempts++; } });
const response = (artists) => async () => ({ ok: true, json: async () => ({ artists }) });

test('1 exact normalized name match', () => assert.equal(candidateFrom(raw(), band())._exact, true));
test('2 exact alias match', () => assert.equal(candidateFrom(raw('X', { aliases: [{ name: 'The Cure' }] }), band())._exact, true));
test('3 punctuation differences', () => assert.equal(normalize('AC/DC'), 'ac dc'));
test('4 diacritics', () => assert.equal(normalize('Beyoncé'), 'beyonce'));
test('5 whitespace differences', () => assert.equal(normalize('  The   Cure '), 'cure'));
test('6 same-name artists from different countries', () => assert.equal(candidateFrom(raw('Muse', { country: 'US' }), band('Muse', { origin: 'United Kingdom' }))._contradictory, true));
test('7 solo artist versus group', () => assert.ok(candidateFrom(raw('Muse', { type: 'Person' }), band('Muse')).score < candidateFrom(raw('Muse'), band('Muse')).score));
test('8 artist-type agreement', () => assert.ok(candidateFrom(raw(), band()).score >= 90));
test('9 origin comparison normalizes country variants without false conflict', () => {
  assert.equal(countryFrom('Sweden'), countryFrom('SE'));
  assert.equal(countryFrom('United States'), countryFrom('US'));
  assert.equal(countryFrom('United Kingdom'), countryFrom('GB'));
  assert.equal(countryFrom('England'), countryFrom('GB'));
  assert.equal(candidateFrom(raw('Muse', { country: 'SE' }), band('Muse', { origin: 'Stockholm, Sweden' }))._contradictory, false);
  assert.equal(candidateFrom(raw('Muse', { country: 'US' }), band('Muse', { origin: 'United Kingdom' }))._contradictory, true);
});
test('10 tribute-act rejection', () => assert.equal(candidateFrom(raw('The Cure Tribute'), band())._bad, true));
test('11 cover-act rejection', () => assert.equal(candidateFrom(raw('The Cure Cover Band'), band())._bad, true));
test('12 parody or experience-act rejection', () => assert.equal(candidateFrom(raw('The Cure Experience'), band())._bad, true));
test('13 candidate metadata is retained for a matching artist', () => assert.equal(candidateFrom(raw('The Cure', { disambiguation: 'English rock band, formed 1978' }), band()).artistName, 'The Cure'));
test('14 missing results becomes no_match', () => assert.equal(identityResult(band(), { kind: 'ok', candidates: [], automatic: null }).status, 'no_match'));
test('15 malformed response is fatal', async () => assert.equal((await searchArtist(band(), fakeUsage(), async () => ({ ok: true, json: async () => ({}) }))).kind, 'fatal'));
test('16 invalid JSON is fatal', async () => assert.equal((await searchArtist(band(), fakeUsage(), async () => ({ ok: true, json: async () => { throw new Error('bad'); } }))).kind, 'fatal'));
test('17 timeout abort becomes a fatal provider result', async () => {
  const previous = config.MUSICBRAINZ.timeoutMs; config.MUSICBRAINZ.timeoutMs = 1;
  try { const result = await searchArtist(band(), fakeUsage(), (_url, opts) => new Promise((_resolve, reject) => opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))); assert.equal(result.kind, 'fatal'); assert.match(result.error, /timeout/); }
  finally { config.MUSICBRAINZ.timeoutMs = previous; }
});
test('18 HTTP 429 is fatal', async () => assert.equal((await searchArtist(band(), fakeUsage(), async () => ({ ok: false, status: 429 }))).kind, 'fatal'));
test('19 HTTP 503 is fatal', async () => assert.equal((await searchArtist(band(), fakeUsage(), async () => ({ ok: false, status: 503 }))).kind, 'fatal'));
test('20 sequential pacing uses UsageTracker state', async () => { const u = new UsageTracker({ musicbrainz:{perRunCap:5,callsThisRun:0,lastCallAt:null},ticketmaster:{},tavily:{},groq:{},setlistfm:{},spotify:{}}); await u.recordMusicbrainzAttempt(); const first = u._lastMusicbrainzCallAt; await u.recordMusicbrainzAttempt(); assert.ok(u._lastMusicbrainzCallAt - first >= config.MUSICBRAINZ.minDelayMs - 25); });
test('21 five-request per-run cap', () => { const u = new UsageTracker({ musicbrainz: { perRunCap: 5, callsThisRun: 5 }, ticketmaster:{},tavily:{},groq:{},setlistfm:{},spotify:{} }); assert.equal(u.canCallMusicbrainz(), false); });
test('22 attempt counted before HTTP request', async () => { const u = fakeUsage(); await searchArtist(band(), u, async () => { assert.equal(u.attempts, 1); return { ok: true, json: async () => ({ artists: [] }) }; }); });
test('23 disabled pipeline makes zero MusicBrainz requests, writes, and usage attempts', async () => {
  const calls = { searches: 0, reads: 0, writes: 0, attempts: 0 };
  const result = await processMusicbrainzIdentities({
    bands: [band()], enabled: false,
    usage: { recordMusicbrainzAttempt: async () => { calls.attempts++; } },
    searchArtist: async () => { calls.searches++; },
    readBands: async () => { calls.reads++; }, writeBands: async () => { calls.writes++; },
  });
  assert.deepEqual(result, { enabled: false, updates: 0 });
  assert.deepEqual(calls, { searches: 0, reads: 0, writes: 0, attempts: 0 });
  assert.equal(config.MUSICBRAINZ.enabled, false);
});
test('enabled pipeline safely leaves bands unchanged when UsageTracker skips MusicBrainz', async () => {
  const original = band('The Cure', { musicbrainz: { status:'pending', mbid:null, lastAttemptedAt:'before', reviewCandidates:[] } });
  const snapshot = JSON.parse(JSON.stringify(original));
  const calls = { canCall: 0, attempts: 0, reads: 0, writes: 0 };
  const usage = {
    canCallMusicbrainz() { calls.canCall++; return false; },
    recordMusicbrainzAttempt: async () => { calls.attempts++; },
    note() { throw new Error('a skipped lookup must not be noted as an error'); },
  };
  const result = await processMusicbrainzIdentities({
    bands: [original, band('Second band')], usage, enabled: true,
    readBands: async () => { calls.reads++; }, writeBands: async () => { calls.writes++; },
  });
  assert.deepEqual(result, { enabled: true, updates: 0 });
  assert.deepEqual(calls, { canCall: 1, attempts: 0, reads: 0, writes: 0 });
  assert.deepEqual(original, snapshot);
  assert.equal(identityResult(original, { kind:'skipped' }), null);
});
test('24 automatic-confirmation threshold uses production scoring', async () => { const result = await searchArtist(band(), fakeUsage(), response([raw()])); assert.equal(result.automatic.score, 95); });
test('25 clear-lead threshold leaves actual candidates for review', async () => { const result = await searchArtist(band(), fakeUsage(), response([raw('The Cure', { id:'a', score:100 }), raw('The Cure', { id:'b', score:95 })])); assert.equal(result.automatic, null); assert.equal(result.candidates.length, 2); });
test('26 ambiguous candidates become needs_review', () => assert.equal(identityResult(band(), { kind:'ok',automatic:null,candidates:[{mbid:'x'}] }).status, 'needs_review'));
test('27 unrelated candidates do not become needs_review', async () => { const result = await searchArtist(band(), fakeUsage(), response([raw('Unrelated Artist')])); assert.equal(identityResult(band(), result).status, 'no_match'); });
test('28 rejected-candidate suppression', async () => { const r = await searchArtist(band('The Cure',{musicbrainz:{rejectedCandidateMbids:['mbid-1']}}), fakeUsage(), response([raw()])); assert.equal(r.candidates.length,0); });
test('29 manual-confirmation protection', () => assert.equal(identityResult(band('',{musicbrainz:{status:'manual_confirmed'}}),{kind:'fatal'}),null));
test('30 manual-rejection protection in merge', () => assert.equal(mergeMusicbrainzResults([{id:'x',musicbrainz:{status:'manual_rejected'}}],[{id:'x',musicbrainz:{status:'needs_review'}}])[0].musicbrainz.status,'manual_rejected'));
test('31 needs_review is paused, while Try again changes review and rejection states to eligible pending', () => { const paused={status:'needs_review',mbid:'old',artistName:'Old',confidence:99,matchMethod:'automatic',matchedAt:'then',score:99,matchReasons:['old'],rejectedCandidateMbids:['x'],reviewCandidates:[{mbid:'y'}]}; assert.equal(musicbrainzEligible({musicbrainz:paused}), false); const retry=retryIdentity(paused, 'now'); assert.equal(retry.status,'pending'); assert.deepEqual(retry.rejectedCandidateMbids,['x']); assert.equal(retry.mbid,null); assert.equal(retry.confidence,null); assert.equal(retry.score,undefined); assert.equal(retry.matchReasons,undefined); assert.equal(musicbrainzEligible({musicbrainz:retry}), true); const rejectedRetry=retryIdentity({status:'manual_rejected',rejectedCandidateMbids:['z']}, 'later'); assert.equal(rejectedRetry.status,'pending'); assert.deepEqual(rejectedRetry.rejectedCandidateMbids,['z']); assert.equal(musicbrainzEligible({musicbrainz:rejectedRetry}), true); });
test('32 90-day retry timing', () => assert.equal(musicbrainzEligible(band('',{musicbrainz:{status:'no_match',lastAttemptedAt:new Date().toISOString()}})),false));
test('MusicBrainz eligibility preserves confirmed, rejected, error, and no_match rules', () => {
  for (const status of ['manual_confirmed', 'auto_confirmed', 'manual_rejected']) assert.equal(musicbrainzEligible({ musicbrainz: { status } }), false);
  assert.equal(musicbrainzEligible({ musicbrainz: { status:'error' } }), true);
  assert.equal(musicbrainzEligible({ musicbrainz: { status:'pending' } }), true);
  assert.equal(musicbrainzEligible({ musicbrainz: { status:'no_match', lastAttemptedAt:new Date(Date.now() - 91 * 86400000).toISOString() } }), true);
});
test('33 idempotent rerun keeps merged state stable', () => { const once=mergeMusicbrainzResults([{id:'x'}],[{id:'x',musicbrainz:{status:'needs_review'}}]); assert.deepEqual(mergeMusicbrainzResults(once,[{id:'x',musicbrainz:{status:'needs_review'}}]), once); });
test('34 candidate deduplication', async () => { const r=await searchArtist(band(),fakeUsage(),response([raw(),raw()])); assert.equal(r.candidates.length,1); });
test('35 maximum five candidates', async () => { const r=await searchArtist(band(),fakeUsage(),response(Array.from({length:7},(_,i)=>raw('The Cure',{id:String(i)})))); assert.equal(r.candidates.length,5); });
test('36 no unrelated band-field changes', () => assert.equal(mergeMusicbrainzResults([{id:'x',favorite:true}],[{id:'x',musicbrainz:{status:'pending'}}])[0].favorite,true));
test('37 latest-record merge protection', () => assert.equal(mergeMusicbrainzResults([{id:'x',name:'new'}],[{id:'x',musicbrainz:{status:'pending'}}])[0].name,'new'));
test('38 deleted band is not restored', () => assert.equal(mergeMusicbrainzResults([],[{id:'gone',musicbrainz:{}}]).length,0));
test('39 newer human decision wins over automation', () => assert.equal(mergeMusicbrainzResults([{id:'x',musicbrainz:{status:'manual_confirmed'}}],[{id:'x',musicbrainz:{status:'auto_confirmed'}}])[0].musicbrainz.status,'manual_confirmed'));
test('40 old band records without musicbrainz still work', () => assert.equal(musicbrainzEligible(band()),true));
test('41 old usage state initializes and manual transformations clear stale identity', () => { const state={}; ensureMusicbrainzState(state); assert.equal(state.musicbrainz.callsThisRun,0); const c={mbid:'m',artistName:'Artist',area:'Area',country:'SE',artistType:'Group',disambiguation:'d',score:88,matchReasons:['x']}; const confirmed=confirmedIdentity(c,{rejectedCandidateMbids:['old']},'now'); assert.equal(confirmed.score,undefined); assert.equal(confirmed.matchReasons,undefined); assert.equal(confirmed.mbid,'m'); const rejected=rejectCandidates({...confirmed,reviewCandidates:[c]},'later'); assert.deepEqual(rejected.rejectedCandidateMbids,['old','m']); assert.equal(rejected.matchMethod,null); assert.equal(rejected.matchedAt,null); });
test('automatic confirmation persists only identity fields, not candidate scoring details', () => {
  const identity = identityResult(band('', { musicbrainz: { rejectedCandidateMbids: ['old'], score: 1, matchReasons: ['old'] } }), { kind: 'ok', automatic: { mbid:'m',artistName:'Artist',area:'Area',country:'SE',artistType:'Group',disambiguation:'d',score:95,matchReasons:['Exact'] }, candidates: [] }, 'now');
  assert.equal(identity.score, undefined); assert.equal(identity.matchReasons, undefined);
  assert.deepEqual(Object.keys(identity).sort(), ['area','artistName','artistType','confidence','country','disambiguation','lastAttemptedAt','matchMethod','matchedAt','mbid','rejectedCandidateMbids','reviewCandidates','reviewedAt','source','status'].sort());
});
test('manual confirmation removes pre-existing stale score and matchReasons', () => {
  const identity = confirmedIdentity({ mbid:'m', artistName:'Artist', score:90 }, { score:1, matchReasons:['stale'] }, 'now');
  assert.equal(identity.score, undefined); assert.equal(identity.matchReasons, undefined);
});
test('no_match and needs_review clear stale confirmed identity', () => {
  const stale = { mbid:'old',artistName:'Old',area:'A',country:'SE',artistType:'Group',disambiguation:'d',confidence:99,matchMethod:'automatic',matchedAt:'then',score:99,matchReasons:['old'] };
  for (const result of [{ kind:'ok', candidates:[], automatic:null }, { kind:'ok', candidates:[{ mbid:'new', score:80, matchReasons:['name'] }], automatic:null }]) {
    const identity = identityResult(band('', { musicbrainz: stale }), result, 'now');
    assert.equal(identity.mbid, null); assert.equal(identity.artistName, null); assert.equal(identity.confidence, null); assert.equal(identity.matchMethod, null); assert.equal(identity.matchedAt, null); assert.equal(identity.score, undefined); assert.equal(identity.matchReasons, undefined);
  }
});
test('missing band origin is neutral for automatic confirmation', async () => assert.ok((await searchArtist(band(), fakeUsage(), response([raw()]))).automatic));
test('Australia and Canada origins are review-only until deterministic normalization supports them', async () => {
  for (const [origin, country] of [['Australia', 'AU'], ['Canada', 'CA']]) {
    const result = await searchArtist(band('The Cure', { origin }), fakeUsage(), response([raw('The Cure', { country })]));
    assert.equal(result.automatic, null); assert.equal(result.candidates.length, 1);
  }
});
test('unrecognized saved origin and unresolved candidate country block automatic confirmation', async () => {
  const unknownOrigin = await searchArtist(band('The Cure', { origin:'Mars Colony' }), fakeUsage(), response([raw('The Cure', { country:'SE' })]));
  const unknownCandidate = await searchArtist(band('The Cure', { origin:'Sweden' }), fakeUsage(), response([raw('The Cure', { country:'ZZ' })]));
  assert.equal(unknownOrigin.automatic, null); assert.equal(unknownCandidate.automatic, null);
});
test('internal origin safety flags never enter persisted review candidates', async () => {
  const result = await searchArtist(band('The Cure', { origin:'Mars Colony' }), fakeUsage(), response([raw('The Cure', { country:'SE' })]));
  const identity = identityResult(band(), result, 'now');
  assert.equal(identity.reviewCandidates[0]._originUnverified, undefined);
  assert.equal(identity.reviewCandidates[0]._contradictory, undefined);
});
test('known Sweden, US, and UK origin matches remain eligible, while conflicts stay blocked', async () => {
  for (const [origin, country] of [['Sweden', 'SE'], ['United States', 'US'], ['United Kingdom', 'GB']]) {
    assert.ok((await searchArtist(band('The Cure', { origin }), fakeUsage(), response([raw('The Cure', { country })]))).automatic);
  }
  assert.equal((await searchArtist(band('The Cure', { origin:'Sweden' }), fakeUsage(), response([raw('The Cure', { country:'US' })]))).automatic, null);
});
