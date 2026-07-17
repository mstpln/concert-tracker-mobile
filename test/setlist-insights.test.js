'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../scripts/lib/config');
const engine = require('../scripts/lib/setlistInsights');
const setlist = require('../scripts/lib/setlistfm');
const { processSetlistInsights, mergeSetlistInsightResults } = require('../scripts/research');
const { runSetlistInsightsBackfill } = require('../scripts/setlistInsightsBackfill');
process.env.SETLISTFM_API_KEY = 'test-key';
const now = new Date('2026-07-17T12:00:00Z');
const song = (name, extra = {}) => ({ name, ...extra });
const history = (id, eventDate, songs, extra = {}) => ({ id, eventDate, venue: { id: `v-${id}` }, songs, ...extra });
const band = { id: 'b', musicbrainz: { status: 'manual_confirmed', mbid: 'mbid' } };
const concert = (extra = {}) => ({ id: 'c', bandId: 'b', attending: true, date: '2025-01-01', setlist: { tourName: 'Tour', songs: [song('Open'), song('Rare'), song('Close'), song('Encore', { isEncore: true })], url: 'https://setlist.fm/x' }, rating: 5, notes: 'keep', playlistUrl: 'https://example.test/list', predictedSetlist: { status: 'ready' }, ...extra });
const enough = Array.from({ length: 20 }, (_, i) => history(`h${i}`, `2024-12-${String(20 - i).padStart(2, '0')}`, [song('Open'), song('Close')], { tourName: 'Tour' }));
function usage(canCall = true) { return { calls: 0, canCallSetlistfm: () => canCall, recordSetlistfmCall: async function () { this.calls++; }, note() {} }; }

test('insight engine excludes target, later, duplicate, malformed, empty and cover-only history', () => {
  const input = [...enough, history('target', '2025-01-01', [song('Rare')]), history('later', '2025-02-01', [song('Rare')]), history('h0', '2024-12-20', [song('Rare')]), history('bad', 'bad', [song('Rare')]), history('empty', '2024-01-01', []), history('cover', '2024-01-02', [song('Cover', { isCover: true })])];
  const prior = engine.usefulEarlierSetlists(input, '2025-01-01');
  assert.equal(prior.length, 20); assert.equal(prior.some((item) => ['target', 'later', 'bad', 'empty', 'cover'].includes(item.id)), false);
});
test('normalization, conservative rare threshold, tour context, long gap and stable maximum two selection work', () => {
  const old = history('old', '2022-01-01', [song('Raré!')], { tourName: 'Old Tour' });
  const result = engine.analyzeSetlistInsights(concert({ setlist: { tourName: 'Tour', songs: [song('Open'), song('Raré!'), song('Close'), song('Encore', { isEncore: true })] } }), [...enough, old], { now });
  assert.equal(result.status, 'ready'); assert.equal(result.insights.length, 2); assert.equal(result.insights.some((item) => item.label.startsWith('First in ')), true); assert.equal(result.insights.every((item) => !/first ever|career/i.test(`${item.label} ${item.explanation}`)), true);
  assert.equal(engine.analyzeSetlistInsights(concert(), enough.slice(0, 19).map((item) => ({ ...item, tourName: null })), { now }).status, 'insufficient_data');
});
test('provider dd-MM-yyyy dates normalize safely for both history paths and reject impossible dates', async () => {
  assert.equal(setlist.normalizeEventDate('23-08-1964'), '1964-08-23'); assert.equal(setlist.normalizeEventDate('17-07-2026'), '2026-07-17'); assert.equal(setlist.normalizeEventDate('03-04-2026'), '2026-04-03'); assert.equal(setlist.normalizeEventDate('31-02-2026'), null);
  const u = usage(); const result = await setlist.findRecentSetlistsForArtist('m', u, { fetchImpl: async () => ({ ok: true, json: async () => ({ setlist: [{ id: 'x', eventDate: '17-07-2026', sets: { set: [{ song: [song('A')] }] } }] }) }) }); assert.equal(result.setlists[0].eventDate, '2026-07-17');
});
test('retry policy protects ready and insufficient records, retries temporary states when due, and force overrides', () => {
  const base = concert(); const fp = engine.fingerprint(base.setlist); const stable = { algorithmVersion: config.SETLIST_INSIGHTS.algorithmVersion, sourceSetlistFingerprint: fp, sourceArtistMbid: 'mbid' };
  assert.equal(engine.insightsDue({ ...base, setlistInsights: { ...stable, status: 'ready' } }, 'mbid', { now }), false); assert.equal(engine.insightsDue({ ...base, setlistInsights: { ...stable, status: 'insufficient_data' } }, 'mbid', { now }), false);
  assert.equal(engine.insightsDue({ ...base, setlistInsights: { ...stable, status: 'error', nextEligibleCheckAt: '2026-07-18T00:00:00Z' } }, 'mbid', { now }), false); assert.equal(engine.insightsDue({ ...base, setlistInsights: { ...stable, status: 'quota_blocked', nextEligibleCheckAt: '2026-07-16T00:00:00Z' } }, 'mbid', { now }), true); assert.equal(engine.insightsDue({ ...base, setlistInsights: { ...stable, status: 'ready' } }, 'mbid', { now, force: true }), true);
});
test('position tags identify opener and main-set closer with and without an encore', () => {
  assert.deepEqual([...engine.positionTags([song('A'), song('B'), song('C', { isEncore: true })]).entries()], [[0, ['Opener']], [1, ['Main-set closer']]]);
  assert.deepEqual([...engine.positionTags([song('A'), song('B')]).entries()], [[0, ['Opener']], [1, ['Main-set closer']]]);
  assert.notEqual(engine.fingerprint({ tourName: 'A', songs: [song('Song')] }), engine.fingerprint({ tourName: 'B', songs: [song('Song')] }));
});
test('bounded MBID history pagination counts quota before every request and stops at its configured ceiling', async () => {
  const u = usage(); let pages = 0;
  const result = await setlist.findHistoricalSetlistsForArtist('mbid', u, { beforeDate: '2020-01-01', pageLimit: 2, fetchImpl: async () => ({ ok: true, json: async () => { pages++; return { setlist: [history(`p${pages}`, '2024-01-01', [song('A')])] }; } }) });
  assert.equal(u.calls, 2); assert.equal(pages, 2); assert.equal(result.kind, 'ok');
});
test('insight persistence is idempotent, preserves unrelated latest fields, does not restore deleted concerts, and keeps ready on temporary error', async () => {
  let latest = [concert({ ticketPrice: 123 })]; const next = { status: 'ready', algorithmVersion: config.SETLIST_INSIGHTS.algorithmVersion, sourceSetlistFingerprint: engine.fingerprint(latest[0].setlist), sourceArtistMbid: 'mbid', insights: [] };
  const merged = mergeSetlistInsightResults(latest, [{ id: 'c', setlistInsights: next }, { id: 'deleted', setlistInsights: next }]); assert.equal(merged.length, 1); assert.equal(merged[0].ticketPrice, 123); assert.equal(merged[0].predictedSetlist.status, 'ready');
  const result = await processSetlistInsights({ concerts: latest, bands: [band], usage: usage(), now, findHistory: async () => ({ kind: 'ok', setlists: enough }), analyze: () => next, readConcerts: async () => latest.map((item) => ({ ...item, notes: 'newer human note' })), writeConcerts: async (_name, value) => { latest = value; }, log: () => {} });
  assert.equal(result.updates, 1); assert.equal(latest[0].notes, 'newer human note');
  const unchanged = await processSetlistInsights({ concerts: latest, bands: [band], usage: usage(), now, findHistory: async () => ({ kind: 'error' }), readConcerts: async () => latest, writeConcerts: async () => { throw new Error('must not write'); }, log: () => {} });
  assert.equal(unchanged.updates, 0); assert.equal(latest[0].setlistInsights.status, 'ready');
});
test('backfill workflow is manual-only, confirmed, main-only, bounded, concurrent-safe and receives only Worker and setlist.fm secrets', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'setlist-insights-backfill.yml'), 'utf8'); const runner = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'setlistInsightsBackfill.js'), 'utf8'); const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(workflow, /^\s*workflow_dispatch:/m); assert.doesNotMatch(workflow, /^\s*(schedule|push|pull_request):/m); assert.match(workflow, /confirm:/); assert.match(workflow, /github\.ref == 'refs\/heads\/main'/); assert.match(workflow, /group: live-vault-data-writes/); assert.match(workflow, /SETLISTFM_API_KEY/); assert.doesNotMatch(workflow, /(TICKETMASTER|TAVILY|GROQ|SPOTIFY)/); assert.match(runner, /Math\.min\(10/);
  assert.match(app, /Opener/); assert.match(app, /Main-set closer/); assert.match(app, /setlist-insight-tag/); assert.match(app, /setlist-encore-divider/); assert.match(app, /spotifyUrl/); assert.match(app, /Compared with .* earlier recorded setlists/); assert.doesNotMatch(app, /First performance ever|career rarity/);
});
test('quota interruption marks every selected remaining concert retryable while preserving earlier ready work', async () => {
  const cs = ['a', 'b', 'c'].map((id) => concert({ id, bandId: id })); const bs = cs.map((item) => ({ id: item.bandId, musicbrainz: { status: 'manual_confirmed', mbid: `m-${item.id}` } })); let saved = cs;
  const first = await processSetlistInsights({ concerts: cs, bands: bs, usage: usage(), now, onlyConcertIds: new Set(cs.map((item) => item.id)), findHistory: async () => ({ kind: 'skipped' }), readConcerts: async () => saved, writeConcerts: async (_n, value) => { saved = value; }, log: () => {} });
  assert.equal(first.updates, 3); assert.equal(saved.every((item) => item.setlistInsights.status === 'quota_blocked' && item.setlistInsights.sourceArtistMbid === `m-${item.id}`), true);
  const ready = { status: 'ready', algorithmVersion: config.SETLIST_INSIGHTS.algorithmVersion, sourceSetlistFingerprint: engine.fingerprint(cs[0].setlist), sourceArtistMbid: 'm-a', insights: [] }; saved = [cs[0], cs[1], cs[2]].map((item, index) => index === 0 ? { ...item, setlistInsights: ready } : item);
  let calls = 0; await processSetlistInsights({ concerts: saved, bands: bs, usage: usage(), now, onlyConcertIds: new Set(saved.map((item) => item.id)), findHistory: async () => (++calls === 1 ? { kind: 'ok', setlists: enough } : { kind: 'skipped' }), analyze: () => ready, readConcerts: async () => saved, writeConcerts: async (_n, value) => { saved = value; }, log: () => {} });
  assert.equal(saved[0].setlistInsights.status, 'ready'); assert.equal(saved[1].setlistInsights.status, 'ready'); assert.equal(saved[2].setlistInsights.status, 'quota_blocked');
});
test('remaining completion helper counts only trusted identities and all incomplete trusted states', () => {
  const base = concert(); const fp = engine.fingerprint(base.setlist); const current = { algorithmVersion: config.SETLIST_INSIGHTS.algorithmVersion, sourceSetlistFingerprint: fp, sourceArtistMbid: 'm', status: 'ready' };
  assert.equal(engine.needsInsightCompletion(base, 'm', undefined, now), true); assert.equal(engine.needsInsightCompletion({ ...base, setlistInsights: current }, 'm', undefined, now), false); assert.equal(engine.needsInsightCompletion({ ...base, setlistInsights: { ...current, status: 'insufficient_data' } }, 'm', undefined, now), false); assert.equal(engine.needsInsightCompletion({ ...base, setlistInsights: { ...current, status: 'error' } }, 'm', undefined, now), true); assert.equal(engine.needsInsightCompletion({ ...base, setlistInsights: { ...current, sourceArtistMbid: 'other' } }, 'm', undefined, now), true);
  const { confirmedMbid } = require('../scripts/research'); for (const status of ['needs_review', 'manual_rejected', 'no_match', undefined]) assert.equal(confirmedMbid({ musicbrainz: { status, mbid: 'm' } }), false); assert.equal(confirmedMbid({ musicbrainz: { status: 'confirmed' } }), false);
});
test('history pagination reaches later pages, respects its ceiling, and reports incomplete versus exhausted history', async () => {
  const u = usage(); let page = 0; const reached = await setlist.findHistoricalSetlistsForArtist('m', u, { beforeDate: '2020-01-01', pageLimit: 10, fetchImpl: async () => ({ ok: true, json: async () => { page++; return { page, total: 200, itemsPerPage: 10, setlist: page === 6 ? Array.from({ length: 50 }, (_, i) => history(`old-${i}`, '01-01-2019', [song('A')])) : [history(`p${page}`, '01-01-2024', [song('A')])] }; } }) });
  assert.equal(reached.pagesFetched, 10); assert.equal(reached.historyComplete, false); assert.equal(u.calls, 10);
  const capped = await setlist.findHistoricalSetlistsForArtist('m', usage(), { beforeDate: '2020-01-01', pageLimit: 2, fetchImpl: async () => ({ ok: true, json: async () => ({ page: 1, total: 100, itemsPerPage: 10, setlist: [history('new', '01-01-2024', [song('A')])] }) }) }); assert.equal(capped.historyComplete, false);
  const exhausted = await setlist.findHistoricalSetlistsForArtist('m', usage(), { beforeDate: '2020-01-01', fetchImpl: async () => ({ ok: true, json: async () => ({ page: 1, total: 1, itemsPerPage: 20, setlist: [history('new', '01-01-2024', [song('A')])] }) }) }); assert.equal(exhausted.historyComplete, true); assert.equal(exhausted.providerExhausted, true);
});
test('incomplete history records retry after seven days without replacing ready results', async () => {
  let saved = [concert()]; const result = await processSetlistInsights({ concerts: saved, bands: [band], usage: usage(), now, findHistory: async () => ({ kind: 'ok', setlists: [], historyComplete: false, pagesFetched: 10 }), readConcerts: async () => saved, writeConcerts: async (_n, value) => { saved = value; }, log: () => {} });
  assert.equal(result.updates, 1); assert.equal(saved[0].setlistInsights.status, 'history_incomplete'); assert.equal(engine.insightsDue(saved[0], 'mbid', { now }), false); assert.equal(engine.insightsDue(saved[0], 'mbid', { now: new Date('2026-07-25') }), true);
  saved[0].setlistInsights.status = 'ready'; const protectedResult = await processSetlistInsights({ concerts: saved, bands: [band], usage: usage(), now, force: true, findHistory: async () => ({ kind: 'ok', setlists: [], historyComplete: false }), readConcerts: async () => saved, writeConcerts: async () => { throw new Error('no write'); }, log: () => {} }); assert.equal(protectedResult.updates, 0);
});
test('history completion requires twenty useful earlier setlists unless the provider is exhausted', () => {
  const one = [history('old', '2019-01-01', [song('A')])]; const noisy = [...one, history('cover', '2018-01-01', [song('C', { isCover: true })]), history('empty', '2017-01-01', []), history('old', '2019-01-01', [song('A')])];
  assert.equal(setlist.usefulEarlierCount(noisy, '2020-01-01'), 1);
  const prior = Array.from({ length: 20 }, (_, i) => history(`u${i}`, '2019-01-01', [song('A')])); assert.equal(setlist.usefulEarlierCount(prior, '2020-01-01'), 20);
});
test('outdated ready becomes history_incomplete but current ready remains protected', async () => {
  let saved = [concert({ setlistInsights: { status: 'ready', algorithmVersion: 1, sourceSetlistFingerprint: engine.fingerprint(concert().setlist), sourceArtistMbid: 'mbid', insights: [] } })];
  await processSetlistInsights({ concerts: saved, bands: [band], usage: usage(), now, findHistory: async () => ({ kind: 'ok', historyComplete: false, usefulEarlierCount: 1, pagesFetched: 10, setlists: [] }), readConcerts: async () => saved, writeConcerts: async (_n, value) => { saved = value; }, log: () => {} }); assert.equal(saved[0].setlistInsights.status, 'history_incomplete');
  saved[0].setlistInsights = { status: 'ready', algorithmVersion: config.SETLIST_INSIGHTS.algorithmVersion, sourceSetlistFingerprint: engine.fingerprint(saved[0].setlist), sourceArtistMbid: 'mbid', insights: [] };
  const result = await processSetlistInsights({ concerts: saved, bands: [band], usage: usage(), now, force: true, findHistory: async () => ({ kind: 'ok', historyComplete: false, setlists: [] }), readConcerts: async () => saved, writeConcerts: async () => { throw new Error('no write'); }, log: () => {} }); assert.equal(result.updates, 0);
});
test('backfill runner accepts injected processor without shadowing the Node process global', async () => {
  const tracker = { state: { setlistfm: { callsThisRun: 0 } }, save: async () => {} };
  const result = await runSetlistInsightsBackfill({
    maxConcerts: '5', forceRecalculate: false, now,
    readConcerts: async () => [], readBands: async () => [], loadUsage: async () => tracker,
    processInsights: async () => ({ concerts: [], diagnostics: { processed: 0, ready: 0, insufficient: 0, errors: 0, generated: 0 } }),
    log: () => {},
  });
  assert.equal(result.diagnostics.processed, 0);
});
