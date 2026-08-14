'use strict';

(function attachBandmarkrSettingsV123(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BandmarkrSettingsV123 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const COVERAGE_THRESHOLDS = Object.freeze([
    { min: 95, key: 'good', label: 'Strong' },
    { min: 90, key: 'goodish', label: 'Good' },
    { min: 75, key: 'watch', label: 'Needs work' },
    { min: 50, key: 'warning', label: 'Weak' },
    { min: 0, key: 'bad', label: 'Poor' },
  ]);
  const USAGE_THRESHOLDS = Object.freeze([
    { max: 50, key: 'good', label: 'Comfortable' },
    { max: 70, key: 'goodish', label: 'Moderate' },
    { max: 85, key: 'watch', label: 'Watch' },
    { max: 95, key: 'warning', label: 'High usage' },
    { max: Infinity, key: 'bad', label: 'Critical' },
  ]);
  const PROVIDER_PURPOSES = Object.freeze({
    ticketmaster: 'Concert discovery, event information and trusted attraction identity.',
    tavily: 'Targeted web concert searches when structured providers may have missed a show.',
    groq: 'Structured extraction and selected artist-information tasks.',
    setlistfm: 'Actual setlists and setlist history.',
    spotify: 'Artist identity, releases, track links, playlists, metadata and artwork.',
    musicbrainz: 'Artist identity, metadata and catalogue structure.',
    listenbrainz: 'Personal listening-history synchronization.',
  });

  let renderToken = 0;
  let spotifyAuthMessage = '';
  let reviewNotice = '';

  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const attr = esc;
  const clean = (value) => String(value == null ? '' : value).trim();
  const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const count = (value) => Math.max(0, finite(value) ? Number(value) : 0);
  const percentage = (value, total) => total > 0 ? Math.round((Number(value) || 0) / total * 100) : 0;
  const plural = (n, one, many = `${one}s`) => `${Number(n).toLocaleString()} ${Number(n) === 1 ? one : many}`;

  function coverageLevel(percent) {
    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    return COVERAGE_THRESHOLDS.find((rule) => p >= rule.min) || COVERAGE_THRESHOLDS.at(-1);
  }

  function usageLevel(percent) {
    const p = Math.max(0, Number(percent) || 0);
    return USAGE_THRESHOLDS.find((rule) => p <= rule.max) || USAGE_THRESHOLDS.at(-1);
  }

  function normalizedText(value) {
    return clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toLocaleLowerCase('en');
  }

  function dateTime(value) {
    const parsed = Date.parse(value || '');
    if (!Number.isFinite(parsed)) return 'Not available';
    return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(parsed));
  }

  function dateOnly(value) {
    const parsed = Date.parse(value || '');
    if (!Number.isFinite(parsed)) return 'Not available';
    return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(parsed));
  }

  function currentBands() { try { return typeof bands !== 'undefined' && Array.isArray(bands) ? bands : []; } catch (_) { return []; } }
  function currentConcerts() { try { return typeof concerts !== 'undefined' && Array.isArray(concerts) ? concerts : []; } catch (_) { return []; } }
  function currentListeningEvents() { try { return typeof listeningEvents !== 'undefined' && Array.isArray(listeningEvents) ? listeningEvents : []; } catch (_) { return []; } }
  function usageState() { try { return typeof apiUsage !== 'undefined' && apiUsage ? apiUsage : {}; } catch (_) { return {}; } }
  function remoteState() { try { return typeof remote !== 'undefined' ? remote : null; } catch (_) { return null; } }

  function trustedVisibleImage(band) {
    const helper = root.ProviderIdentityState?.visibleArtistImageUrl;
    if (typeof helper === 'function') return Boolean(helper(band));
    return Boolean(clean(band?.photoUrl) || clean(band?.artistArtwork?.officialSite?.url) || clean(band?.musicbrainz?.spotify?.images?.[0]?.url));
  }

  function trustedVisibleBio(band) {
    const helper = root.ProviderIdentityState?.visibleBio;
    if (typeof helper === 'function') return Boolean(helper(band));
    return Boolean(clean(band?.bio) || clean(band?.generatedBio));
  }

  function profileCoverage(bandRows = []) {
    const total = bandRows.length;
    const metric = (key, matched) => ({ key, matched, total, percent: percentage(matched, total) });
    return [
      metric('Images', bandRows.filter(trustedVisibleImage).length),
      metric('Descriptions', bandRows.filter(trustedVisibleBio).length),
      metric('Genres', bandRows.filter((band) => Boolean(clean(band?.genre))).length),
      metric('Origin', bandRows.filter((band) => Boolean(clean(band?.origin))).length),
    ];
  }

  function concertHasNamedVenue(concert) {
    const venue = clean(concert?.venue);
    return Boolean(venue && !/^unknown(?:\s+venue)?$/i.test(venue));
  }

  function concertHasActualSetlist(concert) {
    if (Array.isArray(concert?.setlist) && concert.setlist.length) return true;
    if (Array.isArray(concert?.setlistSongs) && concert.setlistSongs.length) return true;
    if (Array.isArray(concert?.actualSetlist) && concert.actualSetlist.length) return true;
    if (Array.isArray(concert?.setlist?.songs) && concert.setlist.songs.length) return true;
    return false;
  }

  function concertWasAttended(concert) {
    return concert?.attending === true || concert?.attended === true || concert?.status === 'attended';
  }

  function concertIsPast(concert, now = new Date()) {
    const raw = clean(concert?.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const event = new Date(`${raw}T00:00:00`);
    return Number.isFinite(event.getTime()) && event < today;
  }

  function concertCoverage(concertRows = [], now = new Date()) {
    const total = concertRows.length;
    const venueMatched = concertRows.filter(concertHasNamedVenue).length;
    const eligibleSetlists = concertRows.filter((concert) => concertWasAttended(concert) && concertIsPast(concert, now));
    const setlistMatched = eligibleSetlists.filter(concertHasActualSetlist).length;
    return [
      { key: 'Venue information', matched: venueMatched, total, percent: percentage(venueMatched, total), detail: `${venueMatched.toLocaleString()} of ${total.toLocaleString()} concerts have a named venue` },
      { key: 'Setlists', matched: setlistMatched, total: eligibleSetlists.length, percent: percentage(setlistMatched, eligibleSetlists.length), detail: `${setlistMatched.toLocaleString()} of ${eligibleSetlists.length.toLocaleString()} eligible attended concerts` },
    ];
  }

  function listeningCoverage(bandRows = [], events = []) {
    const bandIds = new Set(bandRows.map((band) => clean(band?.id)).filter(Boolean));
    const matchedBandIds = new Set(events.map((event) => clean(event?.localBandId || event?.bandId)).filter((id) => bandIds.has(id)));

    const songs = new Map();
    const albums = new Map();
    for (const event of events) {
      const bandKey = clean(event?.localBandId || event?.bandId) || `artist:${normalizedText(event?.artistCreditName)}`;
      const title = normalizedText(event?.recordingTitle);
      if (bandKey && title) {
        const key = `${bandKey}\n${title}`;
        const current = songs.get(key) || false;
        const identified = Boolean(clean(event?.musicbrainzRecordingId || event?.recordingMbid || event?.spotifyTrackId));
        songs.set(key, current || identified);
      }
      const release = normalizedText(event?.releaseTitle);
      if (bandKey && release) {
        const key = `${bandKey}\n${release}`;
        const current = albums.get(key) || false;
        const artwork = Boolean(clean(event?.albumArtworkUrl || event?.artworkPath || event?.artworkUrl));
        albums.set(key, current || artwork);
      }
    }
    const identifiedSongs = [...songs.values()].filter(Boolean).length;
    const artworkAlbums = [...albums.values()].filter(Boolean).length;
    return [
      { key: 'Artists matched', matched: matchedBandIds.size, total: bandRows.length, percent: percentage(matchedBandIds.size, bandRows.length), detail: `${matchedBandIds.size.toLocaleString()} of ${bandRows.length.toLocaleString()} followed artists linked` },
      { key: 'Songs identified', matched: identifiedSongs, total: songs.size, percent: percentage(identifiedSongs, songs.size), detail: `${identifiedSongs.toLocaleString()} of ${songs.size.toLocaleString()} unique songs` },
      { key: 'Album artwork', matched: artworkAlbums, total: albums.size, percent: percentage(artworkAlbums, albums.size), detail: `${artworkAlbums.toLocaleString()} of ${albums.size.toLocaleString()} listened albums` },
    ];
  }

  function identityCoverage(bandRows = []) {
    const coverage = root.ProviderIdentityState?.identityCoverage?.(bandRows) || null;
    if (!coverage) return [];
    return [
      { key: 'MusicBrainz', ...coverage.musicbrainz, detail: `${coverage.musicbrainz.confirmed.toLocaleString()} of ${coverage.musicbrainz.total.toLocaleString()} artists identified` },
      { key: 'Spotify', ...coverage.spotify, detail: `${coverage.spotify.confirmed.toLocaleString()} of ${coverage.spotify.total.toLocaleString()} artists identified`, attention: coverage.spotify.issueCount || 0 },
      { key: 'Ticketmaster', ...coverage.ticketmaster, detail: `${coverage.ticketmaster.confirmed.toLocaleString()} of ${coverage.ticketmaster.total.toLocaleString()} artists identified` },
      { key: 'setlist.fm', ...coverage.setlistfm, detail: `${coverage.setlistfm.confirmed.toLocaleString()} of ${coverage.setlistfm.total.toLocaleString()} artists linked` },
    ].map((row) => ({ ...row, percent: row.coveragePercent }));
  }

  function providerUsageRows(usage = usageState()) {
    const tm = usage.ticketmaster || {};
    const tv = usage.tavily || {};
    const gq = usage.groq || {};
    const sl = usage.setlistfm || {};
    const sp = usage.spotify || {};
    const mb = usage.musicbrainz || {};
    const lb = root.LiveVaultListenBrainz?.connection?.() || null;
    let tavilyUsed = count(tv.callsThisMonth);
    try {
      if (typeof RESEARCH_KEY_METADATA !== 'undefined' && tv.usageCounterEpoch !== RESEARCH_KEY_METADATA?.tavily?.usageCounterEpoch) tavilyUsed = 0;
    } catch (_) {}
    const tmCap = finite(tm.dailyCap) ? count(tm.dailyCap) : Math.round(count(tm.freeTierDailyLimit || 5000) * 0.5);
    const rows = [
      { id:'ticketmaster', name:'Ticketmaster', used:count(tm.callsToday), cap:tmCap, unit:'BANDMARKR daily calls used' },
      { id:'tavily', name:'Tavily', used:tavilyUsed, cap:count(tv.monthlyCap || 900), unit:'monthly searches used' },
      { id:'groq', name:'Groq', used:count(gq.tokensToday), cap:count(gq.safeTpd || 150000), unit:'daily tokens used' },
      { id:'setlistfm', name:'setlist.fm', used:count(sl.callsToday), cap:count(sl.dailyCap || 1200), unit:'daily calls used' },
      { id:'spotify', name:'Spotify', used:count(sp.callsToday), cap:count(sp.dailyCap || 6000), unit:'BANDMARKR daily safety limit' },
    ].map((row) => ({ ...row, percent: row.cap ? Math.round((row.used / row.cap) * 100) : 0, level: usageLevel(row.cap ? (row.used / row.cap) * 100 : 0) }));
    rows.push({ id:'musicbrainz', name:'MusicBrainz', status:'Healthy', statusLevel:'good', detail:mb.lastCallAt ? `Courtesy-paced automatically · last checked ${dateOnly(mb.lastCallAt)}` : 'Courtesy-paced automatically · no recent call recorded' });
    rows.push({ id:'listenbrainz', name:'ListenBrainz', status:lb ? 'Connected' : 'Not connected', statusLevel:lb ? 'good' : 'warning', detail:lb?.lastSyncAt ? `Keeps listening history current · last sync ${dateTime(lb.lastSyncAt)}` : 'Keeps your listening history up to date' });
    return rows;
  }

  function statusFromRun(run) {
    if (!run) return { label:'Needs attention', key:'warning', problem:'No recent status is available.' };
    const value = clean(run.status).toLowerCase();
    if (['error','failed','failure'].includes(value) || run.error) return { label:'Failed', key:'bad', problem:clean(run.error) || 'The latest run failed.' };
    if (['ok','success','successful','complete','completed'].includes(value)) return { label:'Healthy', key:'good', problem:'' };
    return { label:'Needs attention', key:'warning', problem:value ? `Latest status: ${value}.` : 'The latest outcome is not reported.' };
  }

  function latestRun(...runs) {
    return runs.filter(Boolean).sort((a,b) => (Date.parse(b.finishedAt || b.startedAt || '') || 0) - (Date.parse(a.finishedAt || a.startedAt || '') || 0))[0] || null;
  }

  function nextMwfUtc(now = new Date()) {
    for (let offset = 0; offset < 8; offset += 1) {
      const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offset, 1));
      if ([1,3,5].includes(candidate.getUTCDay()) && candidate > now) return candidate.toISOString();
    }
    return null;
  }

  function nextFocusedWebUtc(now = new Date()) {
    return [
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 2)),
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15, 2)),
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 2)),
    ].filter((date) => date > now).sort((a,b) => a-b)[0]?.toISOString() || null;
  }

  function updateActivityRows(usage = usageState(), now = new Date()) {
    const structured = latestRun(usage.automationRuns?.structuredResearch, usage.lastRun?.mode === 'tavily-concert-only' ? null : usage.lastRun);
    const focused = latestRun(usage.automationRuns?.focusedTavilyConcert, usage.lastRun?.mode === 'tavily-concert-only' ? usage.lastRun : null);
    const artist = latestRun(usage.lastProviderIdentityRun, usage.lastMusicbrainzRun);
    const lb = root.LiveVaultListenBrainz?.connection?.() || null;
    const structuredStatus = statusFromRun(structured);
    const focusedStatus = statusFromRun(focused);
    const artistStatus = statusFromRun(artist);
    const setlistFailed = Array.isArray(structured?.notes) && structured.notes.some((note) => /setlist.*failed/i.test(clean(note)));
    const setlistStatus = setlistFailed ? { label:'Failed', key:'bad', problem:'The latest setlist update recorded a failure.' } : structuredStatus;
    const artworkMissing = currentBands().filter((band) => !trustedVisibleImage(band)).length;
    const artworkStatus = artworkMissing ? { label:'Minor gap', key:'watch' } : { label:'Healthy', key:'good' };
    const lbStatus = !lb ? { label:'Needs connection', key:'warning' } : Number.isFinite(Date.parse(lb.lastSyncAt || '')) ? { label:'Healthy', key:'good' } : { label:'Needs attention', key:'warning' };
    const result = (run, a, aLabel, b, bLabel, fallback) => {
      if (!run) return fallback;
      const parts = [];
      if (finite(run[a])) parts.push(`${count(run[a]).toLocaleString()} ${aLabel}`);
      if (finite(run[b])) parts.push(`${count(run[b]).toLocaleString()} ${bLabel}`);
      return parts.join(' · ') || fallback;
    };
    return [
      { name:'Concerts', ...structuredStatus, last:structured?.finishedAt, next:nextMwfUtc(now), result:result(structured,'bandsProcessed','artists checked','concertsAdded','concerts added','No recent result reported.') },
      { name:'Web concert search', ...focusedStatus, last:focused?.finishedAt, next:nextFocusedWebUtc(now), result:result(focused,'bandsAttempted','artists checked','concertsAdded','concerts added','No recent result reported.') },
      { name:'Listening history', ...lbStatus, last:lb?.lastSyncAt, next:lb?.lastSyncAt ? new Date(Date.parse(lb.lastSyncAt) + 21600000).toISOString() : null, result:lb ? `Last sync ${dateTime(lb.lastSyncAt)}` : 'Connect ListenBrainz in Data.' },
      { name:'Artist information', ...artistStatus, last:artist?.finishedAt, next:null, result:result(artist,'identityUpdates','artists updated','spotifyCalls','Spotify checks','No recent result reported.') },
      { name:'Artist artwork', ...artworkStatus, last:null, next:null, result:artworkMissing ? `${plural(artworkMissing,'profile')} still waiting for usable artwork` : 'All followed artists have usable artwork' },
      { name:'Setlists', ...setlistStatus, last:structured?.finishedAt, next:nextMwfUtc(now), result:finite(structured?.setlistsAdded) ? `${plural(structured.setlistsAdded,'setlist')} updated` : 'No recent result reported.' },
    ];
  }

  function progressRowHtml(row, mode = 'coverage') {
    const total = Number(row.total ?? row.cap) || 0;
    const value = Number(row.matched ?? row.used) || 0;
    const percent = Math.max(0, Math.round(Number(row.percent) || 0));
    const level = mode === 'usage' ? usageLevel(percent) : coverageLevel(percent);
    const detail = row.detail || `${value.toLocaleString()} of ${total.toLocaleString()}`;
    return `<div class="settings-v123-row" data-v123-metric="${attr(row.key || row.id || row.name)}">
      <div class="settings-v123-row-head"><div><strong>${esc(row.key || row.name)}</strong><p>${esc(detail)}</p></div><span class="settings-v123-metric-value is-${level.key}"><i></i>${esc(String(percent))}%</span></div>
      <div class="settings-v123-progress" role="progressbar" aria-label="${attr(row.key || row.name)} ${percent}%" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100,percent)}"><span class="is-${level.key}" style="width:${Math.min(100,percent)}%"></span></div>
      ${row.attention ? `<p class="settings-v123-note">${plural(row.attention,'artist')} need attention.</p>` : ''}
    </div>`;
  }

  function sectionHeaderHtml(title, intro) {
    return `<div class="settings-v123-section-head"><span class="settings-v123-section-accent" aria-hidden="true"></span><div><h3>${esc(title)}</h3>${intro ? `<p>${esc(intro)}</p>` : ''}</div></div>`;
  }

  function tabsHtml(active) {
    const tabs = [['research','Automation'],['review','Review'],['data','Data']];
    return `<div class="settings-v123-tabs" role="tablist" aria-label="Settings sections">${tabs.map(([key,label]) => `<button type="button" class="settings-v123-tab${active === key ? ' is-selected' : ''}" data-settings-tab="${key}" role="tab" aria-selected="${active === key ? 'true' : 'false'}"${active === key ? '' : ' tabindex="-1"'}>${label}</button>`).join('')}</div>`;
  }

  function providerRowHtml(row) {
    const purpose = PROVIDER_PURPOSES[row.id] || '';
    if (finite(row.cap) && row.cap > 0) {
      const detail = `${row.used.toLocaleString()} of ${row.cap.toLocaleString()} ${row.unit}`;
      return `<div class="settings-v123-provider-wrap">${progressRowHtml({ ...row, key:row.name, detail }, 'usage')}<button type="button" class="settings-v123-detail-toggle" data-v123-provider-toggle="${attr(row.id)}" aria-expanded="false">Details</button><div class="settings-v123-provider-detail" data-v123-provider-detail="${attr(row.id)}" hidden><p>${esc(purpose)}</p>${row.id === 'groq' ? '<div data-v123-groq-settings></div>' : ''}</div></div>`;
    }
    return `<div class="settings-v123-provider-wrap"><div class="settings-v123-row"><div class="settings-v123-row-head"><div><strong>${esc(row.name)}</strong><p>${esc(row.detail)}</p></div><span class="settings-v123-status is-${attr(row.statusLevel || 'neutral')}"><i></i>${esc(row.status)}</span></div></div><button type="button" class="settings-v123-detail-toggle" data-v123-provider-toggle="${attr(row.id)}" aria-expanded="false">Details</button><div class="settings-v123-provider-detail" data-v123-provider-detail="${attr(row.id)}" hidden><p>${esc(purpose)}</p></div></div>`;
  }

  function activityRowHtml(row) {
    const meta = [row.last ? `Last updated ${dateOnly(row.last)}` : null, row.next ? `Next check ${dateOnly(row.next)}` : null].filter(Boolean).join(' · ');
    return `<div class="settings-v123-row"><div class="settings-v123-row-head"><div><strong>${esc(row.name)}</strong>${meta ? `<p>${esc(meta)}</p>` : ''}<p>${esc(row.result)}</p>${row.problem ? `<p class="settings-v123-problem">${esc(row.problem)}</p>` : ''}</div><span class="settings-v123-status is-${attr(row.key || 'neutral')}"><i></i>${esc(row.label)}</span></div></div>`;
  }

  async function spotifySettingsState() {
    try {
      const storage = root.chrome?.storage?.local;
      if (!storage?.get) return { clientId:'', auth:null };
      const values = await storage.get(['spotifyUserClientId', root.SpotifyUser?.TOKEN_KEY].filter(Boolean));
      return { clientId:clean(values.spotifyUserClientId), auth:root.SpotifyUser?.TOKEN_KEY ? values[root.SpotifyUser.TOKEN_KEY] || null : null };
    } catch (_) { return { clientId:'', auth:null }; }
  }

  async function groqSettingsState() {
    try {
      const storage = root.chrome?.storage?.local;
      if (!storage?.get) return { key:'', addedAt:null };
      const values = await storage.get(['groqApiKey','groqApiKeyAddedAt']);
      return { key:clean(values.groqApiKey), addedAt:values.groqApiKeyAddedAt || null };
    } catch (_) { return { key:'', addedAt:null }; }
  }

  function maskSecret(value) {
    const key = clean(value);
    if (!key) return '';
    if (key.length <= 8) return `${key.slice(0,1)}••••${key.slice(-1)}`;
    return `${key.slice(0,4)}••••••••${key.slice(-4)}`;
  }

  async function automationHtml() {
    const providers = providerUsageRows();
    const activity = updateActivityRows();
    const groq = await groqSettingsState();
    return `<div class="settings-v123-section">${sectionHeaderHtml('PROVIDER USAGE','Capacity and connection status for the services BANDMARKR uses.')}<div class="settings-v123-card settings-v123-provider-card">${providers.map(providerRowHtml).join('')}</div></div>
      <div class="settings-v123-section">${sectionHeaderHtml('UPDATE ACTIVITY','What BANDMARKR updates automatically and when it last ran.')}<div class="settings-v123-card">${activity.map(activityRowHtml).join('')}</div></div>
      <template data-v123-groq-template>${groq.key ? `<p class="settings-v123-note"><strong>${esc(maskSecret(groq.key))}</strong>${groq.addedAt ? ` · added ${esc(dateOnly(groq.addedAt))}` : ''}</p>` : ''}<label class="settings-v123-label" for="v123-groq-key">Groq API key (optional)</label><input class="settings-v123-input" id="v123-groq-key" type="password" autocomplete="off" placeholder="${groq.key ? 'Enter a new key to replace it' : 'Optional key for artist information'}"><p class="settings-v123-note">Used for artist information when you add a band. Leave blank to use the fallback.</p><div class="settings-v123-actions"><button type="button" class="btn-primary" data-v123-save-groq>Save</button>${groq.key ? '<button type="button" class="btn-secondary" data-v123-remove-groq>Remove key</button>' : ''}</div><p class="settings-v123-note" data-v123-groq-status aria-live="polite"></p></template>`;
  }

  function musicbrainzReviewItems(bandRows) {
    return bandRows.filter((band) => band?.musicbrainz?.status === 'needs_review' && Array.isArray(band.musicbrainz.reviewCandidates) && band.musicbrainz.reviewCandidates.length)
      .map((band) => ({ kind:'musicbrainz', band, candidates:band.musicbrainz.reviewCandidates.slice(0,5) }));
  }

  async function spotifyReviewItems(bandRows, events) {
    try {
      const rows = root.ListeningSpotifyIdentityReview?.auditSpotifyArtistIdentities?.(bandRows, events, { identityState:root.ProviderIdentityState }) || [];
      return rows.filter((row) => row.actionState === 'candidate_available').map((row) => ({ kind:'spotify', row }));
    } catch (_) { return []; }
  }

  async function listeningReviewItems() {
    try { return await root.BandmarkrListeningReviewRollout?.reviewQueue?.({ maxItems:20 }) || []; }
    catch (_) { return []; }
  }

  async function reviewModel() {
    const bandRows = currentBands();
    const events = currentListeningEvents();
    const musicbrainz = musicbrainzReviewItems(bandRows);
    const spotify = await spotifyReviewItems(bandRows, events);
    const listening = await listeningReviewItems();
    return { artist:[...musicbrainz,...spotify], listening };
  }

  function artistReviewHtml(item, index) {
    if (item.kind === 'musicbrainz') {
      const band = item.band;
      return `<article class="settings-v123-review-item" data-v123-artist-review="${index}"><div class="settings-v123-row-head"><div><strong>${esc(band.name)}</strong><p>${plural(item.candidates.length,'possible artist match','possible artist matches')} found.</p></div><span class="settings-v123-status is-warning"><i></i>Needs review</span></div><div class="settings-v123-candidates">${item.candidates.map((candidate) => `<div><span><strong>${esc(candidate.artistName || 'Unnamed artist')}</strong><small>${esc([candidate.area,candidate.country,candidate.disambiguation].filter(Boolean).join(' · ') || 'MusicBrainz candidate')}</small></span><button type="button" class="btn-primary" data-v123-mb-use="${attr(candidate.mbid)}">Use this artist</button></div>`).join('')}</div><div class="settings-v123-actions"><button type="button" class="btn-secondary" data-v123-mb-none>None of these</button><button type="button" class="btn-secondary" data-v123-review-later>Later</button></div></article>`;
    }
    const row = item.row;
    return `<article class="settings-v123-review-item" data-v123-artist-review="${index}"><div class="settings-v123-row-head"><div><strong>${esc(row.bandName)}</strong><p>${row.duplicateConflict ? 'Spotify has a conflicting artist match.' : 'Spotify needs you to confirm the artist match.'}</p></div><span class="settings-v123-status is-warning"><i></i>Needs review</span></div><div class="settings-v123-candidates">${(row.candidates || []).map((candidate) => `<div><span><strong>${esc(candidate.artistName || candidate.name || candidate.id)}</strong><small>Spotify candidate</small></span><button type="button" class="btn-primary" data-v123-spotify-use="${attr(candidate.id)}">Use this artist</button></div>`).join('')}</div><div class="settings-v123-actions"><button type="button" class="btn-secondary" data-v123-spotify-none>None of these</button><button type="button" class="btn-secondary" data-v123-review-later>Later</button></div></article>`;
  }

  function eventSummary(event) {
    if (!event) return 'Source details unavailable';
    return `${clean(event.artistCreditName) || 'Unknown artist'} — ${clean(event.recordingTitle) || 'Unknown track'} · ${dateTime(event.listenedAt)} · ${clean(event.source) || 'unknown source'}`;
  }

  function listeningReviewHtml(item, index) {
    const first = item.candidatePairs?.[0];
    return `<article class="settings-v123-review-item" data-v123-listening-review="${index}"><div class="settings-v123-row-head"><div><strong>${esc(first?.left?.recordingTitle || first?.right?.recordingTitle || 'Possible duplicate listen')}</strong><p>${esc(first?.left?.artistCreditName || first?.right?.artistCreditName || 'Listening history')}</p></div><span class="settings-v123-status is-warning"><i></i>Needs review</span></div><div class="settings-v123-listen-pairs">${(item.candidatePairs || []).map((pair) => `<div><p>${esc(eventSummary(pair.left))}</p><p>${esc(eventSummary(pair.right))}</p><button type="button" class="btn-primary" data-v123-listen-merge="${attr(pair.pairKey)}">Same listen</button></div>`).join('')}</div><div class="settings-v123-actions"><button type="button" class="btn-secondary" data-v123-listen-separate>Keep separate</button><button type="button" class="btn-secondary" data-v123-review-later>Later</button></div></article>`;
  }

  async function reviewHtml() {
    const model = await reviewModel();
    const artistCount = model.artist.length;
    const listeningCount = model.listening.length;
    const total = artistCount + listeningCount;
    const resolved = total === 0;
    return `<div class="settings-v123-section">${sectionHeaderHtml('REVIEW SUMMARY','Only decisions BANDMARKR cannot make safely appear here.')}<div class="settings-v123-card"><div class="settings-v123-summary"><strong>${resolved ? 'Everything is resolved.' : `${plural(total,'item')} need your attention`}</strong><p>${resolved ? 'No artist or listening matches need your attention.' : `${plural(artistCount,'artist match','artist matches')} · ${plural(listeningCount,'listening match','listening matches')}`}</p><div class="settings-v123-summary-grid"><span><b>${artistCount}</b><small>Artist matches</small></span><span><b>${listeningCount}</b><small>Listening match${listeningCount === 1 ? '' : 'es'}</small></span><span><b>0</b><small>Critical blockers</small></span></div>${reviewNotice ? `<p class="settings-v123-note" role="status">${esc(reviewNotice)}</p>` : ''}</div></div></div>
      ${artistCount ? `<div class="settings-v123-section">${sectionHeaderHtml('ARTIST MATCHES','Check artists BANDMARKR could not identify with confidence.')}<div class="settings-v123-card">${model.artist.map(artistReviewHtml).join('')}</div></div>` : ''}
      ${listeningCount ? `<div class="settings-v123-section">${sectionHeaderHtml('LISTENING MATCHES','Check listens that may be duplicates.')}<div class="settings-v123-card">${model.listening.map(listeningReviewHtml).join('')}</div></div>` : ''}`;
  }

  function coverageGroupHtml(title, rows) {
    return `<div class="settings-v123-group-label">${esc(title)}</div>${rows.map((row) => progressRowHtml(row,'coverage')).join('')}`;
  }

  function connectionRowHtml(name, status, level, detail, actions) {
    return `<div class="settings-v123-row"><div class="settings-v123-row-head"><div><strong>${esc(name)}</strong><p>${esc(detail)}</p></div><span class="settings-v123-status is-${attr(level)}"><i></i>${esc(status)}</span></div>${actions ? `<div class="settings-v123-actions">${actions}</div>` : ''}</div>`;
  }

  function activationMaintenanceHtml() {
    const activation = root.BandmarkrListeningCanonicalActivation;
    if (!activation?.stateStore) return '';
    const state = activation.stateStore(root.localStorage).load();
    const duplicateCount = count(state.duplicateCount);
    let status = 'Original listening totals are in use.';
    if (state.status === 'active') status = `Reviewed listening totals are active · ${plural(duplicateCount,'duplicate listen')} excluded.`;
    else if (state.status === 'ready') status = `Reviewed listening totals are ready · ${plural(duplicateCount,'duplicate listen')} found.`;
    else if (['preparing','gau5_preparing'].includes(state.status)) status = 'Listening statistics are being prepared on this device.';
    else if (state.status === 'stale') status = 'Listening history changed. Update listening statistics before using reviewed totals.';
    else if (state.status === 'error') status = `Listening statistics preparation stopped safely${state.error ? ` · ${state.error}` : ''}.`;
    return `<div class="settings-v123-maintenance-row"><strong>Listening statistics</strong><p>${esc(status)}</p><div class="settings-v123-actions"><button type="button" class="btn-secondary" data-v123-prepare-listening>${state.status === 'ready' ? 'Prepare again' : 'Update listening statistics'}</button>${state.status === 'ready' ? '<button type="button" class="btn-primary" data-v123-activate-listening>Use reviewed totals</button>' : ''}${state.status === 'active' ? '<button type="button" class="btn-secondary" data-v123-deactivate-listening>Use original totals</button>' : ''}</div><p class="settings-v123-note" data-v123-activation-status aria-live="polite"></p></div>`;
  }

  async function historyMaintenanceHtml() {
    let meta = null;
    try { meta = await root.LiveVaultSpotifyHistory?.getMeta?.(); } catch (_) {}
    return `<div class="settings-v123-maintenance-row"><strong>Listening history import</strong><p>${meta ? `${count(meta.eventCount).toLocaleString()} listens are stored on this device.` : 'No imported listening-history file is stored on this device.'}</p><input type="file" accept=".json,.gz,application/json,application/gzip" data-v123-history-file hidden><div class="settings-v123-actions"><button type="button" class="btn-secondary" data-v123-history-import>Import history</button>${meta ? '<button type="button" class="btn-secondary" data-v123-history-clear>Remove imported history</button>' : ''}</div><p class="settings-v123-note" data-v123-history-status aria-live="polite"></p></div>`;
  }

  async function dataHtml() {
    const bandRows = currentBands();
    const concertRows = currentConcerts();
    const events = currentListeningEvents();
    const spotify = await spotifySettingsState();
    const lb = root.LiveVaultListenBrainz?.connection?.() || null;
    const connection = remoteState();
    const identity = identityCoverage(bandRows);
    const profiles = profileCoverage(bandRows).map((row) => ({ ...row, detail:`${row.matched.toLocaleString()} of ${row.total.toLocaleString()} artist profiles` }));
    const concertMetrics = concertCoverage(concertRows);
    const listeningMetrics = listeningCoverage(bandRows, events);
    const spotifyStatus = spotify.clientId && spotify.auth ? 'Connected' : spotify.clientId ? 'Ready to connect' : 'Not configured';
    const spotifyLevel = spotify.clientId && spotify.auth ? 'good' : 'warning';
    const spotifyActions = !spotify.clientId ? '<label class="settings-v123-inline-field"><span>Public Client ID</span><input class="settings-v123-input" data-v123-spotify-client-id autocomplete="off"></label><button type="button" class="btn-primary" data-v123-save-spotify-client>Save Client ID</button>' : !spotify.auth ? '<button type="button" class="btn-primary" data-v123-connect-spotify>Connect</button><button type="button" class="btn-secondary" data-v123-remove-spotify-client>Remove Client ID</button>' : '<button type="button" class="btn-secondary" data-v123-disconnect-spotify>Disconnect</button>';
    const lbActions = lb ? '<button type="button" class="btn-primary" data-v123-listenbrainz-sync>Sync now</button><button type="button" class="btn-secondary" data-v123-listenbrainz-disconnect>Disconnect</button>' : '<label class="settings-v123-inline-field"><span>User token</span><input class="settings-v123-input" type="password" data-v123-listenbrainz-token autocomplete="off"></label><button type="button" class="btn-primary" data-v123-listenbrainz-connect>Connect</button>';
    return `<div class="settings-v123-section">${sectionHeaderHtml('DATA COVERAGE','How complete your artist, concert and listening data is.')}<div class="settings-v123-card settings-v123-coverage-card">${coverageGroupHtml('ARTIST IDS',identity)}${coverageGroupHtml('ARTIST PROFILES',profiles)}${coverageGroupHtml('CONCERT DATA',concertMetrics)}${coverageGroupHtml('LISTENING DATA',listeningMetrics)}</div></div>
      <div class="settings-v123-section">${sectionHeaderHtml('CONNECTIONS','Services connected to this device.')}<div class="settings-v123-card">${connectionRowHtml('Data storage',connection?.endpoint && connection?.token ? 'Connected' : 'Not connected',connection?.endpoint && connection?.token ? 'good' : 'warning','Stores your data privately in Cloudflare.',connection?.endpoint && connection?.token ? '<button type="button" class="btn-secondary" data-v123-disconnect-data>Disconnect</button>' : '<button type="button" class="btn-primary" data-v123-connect-data>Connect</button>')}${connectionRowHtml('Spotify',spotifyStatus,spotifyLevel,'Creates playlists and supplies trusted music information.',spotifyActions)}${connectionRowHtml('ListenBrainz',lb ? 'Connected' : 'Not connected',lb ? 'good' : 'warning',lb?.lastSyncAt ? `Keeps your listening history current · last sync ${dateTime(lb.lastSyncAt)}` : 'Keeps your listening history current.',lbActions)}<p class="settings-v123-note settings-v123-connection-message" data-v123-connection-status aria-live="polite">${esc(spotifyAuthMessage)}</p></div></div>
      <div class="settings-v123-section">${sectionHeaderHtml('EXPORT','Download a copy of your BANDMARKR data.')}<div class="settings-v123-card"><div class="settings-v123-row"><strong>Export your data</strong><p>Bands, concerts, ratings, notes, costs and setlists.</p><div class="settings-v123-actions"><button type="button" class="btn-secondary" data-v123-export-csv>Export CSV</button><button type="button" class="btn-secondary" data-v123-export-excel>Export Excel</button></div><p class="settings-v123-note" data-v123-export-status aria-live="polite"></p></div></div></div>
      <div class="settings-v123-section">${sectionHeaderHtml('DEVICE','Manage BANDMARKR data saved only on this device.')}<div class="settings-v123-card"><div class="settings-v123-row"><strong>Disconnect this device</strong><p>Removes the saved data connection. Local listening history and settings stay.</p><div class="settings-v123-actions"><button type="button" class="btn-secondary" data-v123-disconnect-data>Disconnect</button></div></div><div class="settings-v123-row"><strong>Erase this device</strong><p>Removes data stored only in this browser. Remote concert data is not deleted.</p><div class="settings-v123-actions"><button type="button" class="btn-secondary btn-danger" data-v123-erase-device>Erase this device</button></div></div><details class="settings-v123-maintenance"><summary>Maintenance & recovery</summary>${await historyMaintenanceHtml()}${activationMaintenanceHtml()}<div class="settings-v123-maintenance-row"><strong>Missing song information</strong><p>Try to fill trusted song identity details that are still missing.</p><button type="button" class="btn-secondary" data-v123-complete-identities>Fix missing song information</button><p class="settings-v123-note" data-v123-identity-status aria-live="polite"></p></div><div class="settings-v123-maintenance-row"><strong>Missing album artwork</strong><p>Try again for listened albums that still have trusted Spotify track IDs but no artwork.</p><button type="button" class="btn-secondary" data-v123-refresh-artwork>Refresh missing artwork</button><p class="settings-v123-note" data-v123-artwork-status aria-live="polite"></p></div></details></div><p class="settings-v123-version">Version ${esc(typeof APP_VERSION !== 'undefined' ? APP_VERSION : '?')}</p></div>`;
  }

  async function saveMusicbrainzDecision(item, candidateMbid) {
    if (typeof saveArtistIdentity !== 'function') throw new Error('Artist review is unavailable.');
    if (candidateMbid) {
      return saveArtistIdentity(item.band.id, (band) => {
        const state = band.musicbrainz || {};
        const candidate = (state.reviewCandidates || []).find((row) => row.mbid === candidateMbid);
        return candidate ? root.MusicbrainzState?.confirmedIdentity?.(candidate, state) : null;
      });
    }
    return saveArtistIdentity(item.band.id, (band) => root.MusicbrainzState?.rejectCandidates?.(band.musicbrainz || {}));
  }

  async function saveSpotifyDecision(item, action, candidateId) {
    const save = root.ListeningSpotifyIdentityReviewUi?.saveDecision;
    if (typeof save !== 'function') throw new Error('Spotify artist review is unavailable.');
    return save(item.row, action, candidateId || null);
  }

  async function wireReview(screen, model) {
    screen.querySelectorAll('[data-v123-artist-review]').forEach((article) => {
      const item = model.artist[Number(article.dataset.v123ArtistReview)];
      if (!item) return;
      article.querySelectorAll('[data-v123-mb-use]').forEach((button) => button.addEventListener('click', async () => {
        button.disabled = true;
        try { await saveMusicbrainzDecision(item, button.dataset.v123MbUse); reviewNotice = `${item.band.name} was linked.`; await renderUnifiedSettings(); }
        catch (error) { reviewNotice = error?.message || 'The artist match could not be saved.'; button.disabled = false; }
      }));
      article.querySelector('[data-v123-mb-none]')?.addEventListener('click', async (event) => {
        event.currentTarget.disabled = true;
        try { await saveMusicbrainzDecision(item, null); reviewNotice = `${item.band.name} candidates were rejected.`; await renderUnifiedSettings(); }
        catch (error) { reviewNotice = error?.message || 'The artist decision could not be saved.'; event.currentTarget.disabled = false; }
      });
      article.querySelectorAll('[data-v123-spotify-use]').forEach((button) => button.addEventListener('click', async () => {
        button.disabled = true;
        try { await saveSpotifyDecision(item, 'confirm', button.dataset.v123SpotifyUse); reviewNotice = `${item.row.bandName} was linked to Spotify.`; await renderUnifiedSettings(); }
        catch (error) { reviewNotice = error?.message || 'The Spotify match could not be saved.'; button.disabled = false; }
      }));
      article.querySelector('[data-v123-spotify-none]')?.addEventListener('click', async (event) => {
        event.currentTarget.disabled = true;
        try { await saveSpotifyDecision(item, 'reject'); reviewNotice = `${item.row.bandName} candidates were rejected.`; await renderUnifiedSettings(); }
        catch (error) { reviewNotice = error?.message || 'The Spotify decision could not be saved.'; event.currentTarget.disabled = false; }
      });
      article.querySelector('[data-v123-review-later]')?.addEventListener('click', () => { article.hidden = true; });
    });
    screen.querySelectorAll('[data-v123-listening-review]').forEach((article) => {
      const item = model.listening[Number(article.dataset.v123ListeningReview)];
      if (!item) return;
      article.querySelectorAll('[data-v123-listen-merge]').forEach((button) => button.addEventListener('click', async () => {
        button.disabled = true;
        try { await root.BandmarkrListeningReviewRollout.applyReview(item, 'merge', { pairKey:button.dataset.v123ListenMerge }); reviewNotice = 'Listening match saved.'; await renderUnifiedSettings(); }
        catch (error) { reviewNotice = error?.message || 'The listening decision could not be saved.'; button.disabled = false; }
      }));
      article.querySelector('[data-v123-listen-separate]')?.addEventListener('click', async (event) => {
        event.currentTarget.disabled = true;
        try { await root.BandmarkrListeningReviewRollout.applyReview(item, 'keep_separate', {}); reviewNotice = 'Listening records will stay separate.'; await renderUnifiedSettings(); }
        catch (error) { reviewNotice = error?.message || 'The listening decision could not be saved.'; event.currentTarget.disabled = false; }
      });
      article.querySelector('[data-v123-review-later]')?.addEventListener('click', () => { article.hidden = true; });
    });
  }

  async function wireAutomation(screen) {
    const template = screen.querySelector('[data-v123-groq-template]');
    const slot = screen.querySelector('[data-v123-groq-settings]');
    if (template && slot) slot.replaceChildren(template.content.cloneNode(true));
    screen.querySelectorAll('[data-v123-provider-toggle]').forEach((button) => button.addEventListener('click', () => {
      const detail = screen.querySelector(`[data-v123-provider-detail="${button.dataset.v123ProviderToggle}"]`);
      const open = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(open));
      if (detail) detail.hidden = !open;
    }));
    screen.querySelector('[data-v123-save-groq]')?.addEventListener('click', async () => {
      const input = screen.querySelector('#v123-groq-key');
      const status = screen.querySelector('[data-v123-groq-status]');
      const value = clean(input?.value);
      if (!value) { if (status) status.textContent = 'Enter a key to save.'; return; }
      await root.chrome?.storage?.local?.set?.({ groqApiKey:value, groqApiKeyAddedAt:new Date().toISOString() });
      if (status) status.textContent = 'Saved.';
    });
    screen.querySelector('[data-v123-remove-groq]')?.addEventListener('click', async () => {
      await root.chrome?.storage?.local?.remove?.(['groqApiKey','groqApiKeyAddedAt']);
      await renderUnifiedSettings();
    });
  }

  function setStatus(screen, selector, text) { const node = screen.querySelector(selector); if (node) node.textContent = text; }

  async function wireData(screen) {
    screen.querySelector('[data-v123-connect-data]')?.addEventListener('click', () => { if (typeof showOnboarding === 'function') showOnboarding(); });
    screen.querySelectorAll('[data-v123-disconnect-data]').forEach((button) => button.addEventListener('click', () => {
      if (root.LiveVaultDevicePrivacy?.disconnectDevice) root.LiveVaultDevicePrivacy.disconnectDevice();
      else if (typeof rsClearConnection === 'function') { rsClearConnection(); root.location?.reload?.(); }
    }));
    screen.querySelector('[data-v123-erase-device]')?.addEventListener('click', async (event) => {
      if (!root.confirm?.('Erase all BANDMARKR data stored on this device? Your remote concert data and permanent ticket files will remain in Cloudflare.')) return;
      event.currentTarget.disabled = true;
      await root.LiveVaultDevicePrivacy?.eraseDevice?.();
    });

    screen.querySelector('[data-v123-save-spotify-client]')?.addEventListener('click', async () => {
      const value = clean(screen.querySelector('[data-v123-spotify-client-id]')?.value);
      if (!value) { setStatus(screen,'[data-v123-connection-status]','Enter the public Spotify Client ID.'); return; }
      await root.chrome?.storage?.local?.set?.({ spotifyUserClientId:value });
      spotifyAuthMessage = 'Spotify Client ID saved.';
      await renderUnifiedSettings();
    });
    screen.querySelector('[data-v123-remove-spotify-client]')?.addEventListener('click', async () => {
      await root.chrome?.storage?.local?.remove?.('spotifyUserClientId');
      spotifyAuthMessage = '';
      await renderUnifiedSettings();
    });
    screen.querySelector('[data-v123-connect-spotify]')?.addEventListener('click', async () => {
      const state = await spotifySettingsState();
      root.SpotifyUser?.beginAuthorization?.(state.clientId);
    });
    screen.querySelector('[data-v123-disconnect-spotify]')?.addEventListener('click', async () => {
      await root.SpotifyUser?.clearAuth?.();
      spotifyAuthMessage = 'Spotify disconnected.';
      await renderUnifiedSettings();
    });

    screen.querySelector('[data-v123-listenbrainz-connect]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const token = clean(screen.querySelector('[data-v123-listenbrainz-token]')?.value);
      button.disabled = true;
      setStatus(screen,'[data-v123-connection-status]','Checking ListenBrainz connection…');
      try {
        const validated = await root.LiveVaultListenBrainz.validateToken(token);
        root.LiveVaultListenBrainz.saveConnection(validated);
        await root.LiveVaultListenBrainz.syncNow();
        await renderUnifiedSettings();
      } catch (error) { setStatus(screen,'[data-v123-connection-status]',error?.message || 'ListenBrainz connection failed.'); button.disabled = false; }
    });
    screen.querySelector('[data-v123-listenbrainz-sync]')?.addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      try {
        const result = await root.LiveVaultListenBrainz.syncNow();
        setStatus(screen,'[data-v123-connection-status]',result.added ? `${result.added.toLocaleString()} new listens added.` : 'Listening history is already up to date.');
      } catch (error) { setStatus(screen,'[data-v123-connection-status]',error?.message || 'ListenBrainz sync failed.'); }
      event.currentTarget.disabled = false;
    });
    screen.querySelector('[data-v123-listenbrainz-disconnect]')?.addEventListener('click', async () => { root.LiveVaultListenBrainz?.clearConnection?.(); await renderUnifiedSettings(); });

    screen.querySelector('[data-v123-export-csv]')?.addEventListener('click', () => { if (typeof exportDataAsCsv === 'function') exportDataAsCsv(); setStatus(screen,'[data-v123-export-status]','CSV files downloading…'); });
    screen.querySelector('[data-v123-export-excel]')?.addEventListener('click', async () => {
      try { if (typeof exportDataAsExcel === 'function') await exportDataAsExcel(); setStatus(screen,'[data-v123-export-status]','Excel export ready.'); }
      catch (_) { setStatus(screen,'[data-v123-export-status]',"Couldn't create the Excel export. Use CSV instead."); }
    });

    const fileInput = screen.querySelector('[data-v123-history-file]');
    screen.querySelector('[data-v123-history-import]')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      setStatus(screen,'[data-v123-history-status]','Importing privately on this device…');
      try {
        const result = await root.LiveVaultSpotifyHistory.importFile(file);
        await root.LiveVaultSpotifyHistory.applyToApp();
        setStatus(screen,'[data-v123-history-status]',`${result.imported.toLocaleString()} listens imported.`);
      } catch (error) { setStatus(screen,'[data-v123-history-status]',error?.message || 'Import failed.'); }
      fileInput.value = '';
    });
    screen.querySelector('[data-v123-history-clear]')?.addEventListener('click', async () => {
      await root.LiveVaultSpotifyHistory?.clear?.();
      try { if (typeof listeningEvents !== 'undefined') listeningEvents = []; } catch (_) {}
      await renderUnifiedSettings();
    });

    screen.querySelector('[data-v123-prepare-listening]')?.addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      setStatus(screen,'[data-v123-activation-status]','Updating listening statistics on this device…');
      try {
        if (root.BandmarkrGau5PreparationIntegrationV121?.runPreparation) await root.BandmarkrGau5PreparationIntegrationV121.runPreparation({ userInitiated:true });
        else await root.BandmarkrListeningCanonicalActivation?.prepare?.({ bands:currentBands() });
        await renderUnifiedSettings();
      } catch (error) { setStatus(screen,'[data-v123-activation-status]',error?.message || 'Listening statistics update stopped safely.'); event.currentTarget.disabled = false; }
    });
    screen.querySelector('[data-v123-activate-listening]')?.addEventListener('click', async () => {
      const result = await root.BandmarkrListeningCanonicalActivation.activate({ bands:currentBands() });
      try { if (typeof listeningEvents !== 'undefined') listeningEvents = result.events; } catch (_) {}
      await renderUnifiedSettings();
    });
    screen.querySelector('[data-v123-deactivate-listening]')?.addEventListener('click', async () => {
      const result = await root.BandmarkrListeningCanonicalActivation.deactivate({ bands:currentBands() });
      try { if (typeof listeningEvents !== 'undefined') listeningEvents = result.events; } catch (_) {}
      await renderUnifiedSettings();
    });

    screen.querySelector('[data-v123-complete-identities]')?.addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      setStatus(screen,'[data-v123-identity-status]','Checking missing song information…');
      try {
        const result = await root.BandmarkrListeningIdentityCompletionV104.complete({ onProgress:({checked,total}) => setStatus(screen,'[data-v123-identity-status]',`Checking ${checked} of ${total}…`) });
        setStatus(screen,'[data-v123-identity-status]',result.checked ? `${result.resolvedRecordings.toLocaleString()} song identities added · ${result.remaining.toLocaleString()} still unresolved.` : 'No safe song-information lookup is needed.');
      } catch (error) { setStatus(screen,'[data-v123-identity-status]',error?.message || 'Song-information update stopped safely.'); }
      event.currentTarget.disabled = false;
    });
    screen.querySelector('[data-v123-refresh-artwork]')?.addEventListener('click', async (event) => {
      event.currentTarget.disabled = true;
      setStatus(screen,'[data-v123-artwork-status]','Checking missing album artwork…');
      try {
        const result = await root.SpotifyListeningMetadataV99.enrich({ onProgress:({processed,total}) => setStatus(screen,'[data-v123-artwork-status]',`Checking ${processed} of ${total}…`) });
        setStatus(screen,'[data-v123-artwork-status]',result.requested ? `${result.added.toLocaleString()} artwork records added.` : 'Album artwork is already complete for trusted Spotify track IDs.');
      } catch (error) { setStatus(screen,'[data-v123-artwork-status]',error?.message || 'Artwork refresh stopped safely.'); }
      event.currentTarget.disabled = false;
    });
  }

  async function renderUnifiedSettings() {
    const screen = root.document?.getElementById('screen-settings');
    if (!screen) return false;
    const token = ++renderToken;
    let active = 'research';
    try { if (typeof settingsTab !== 'undefined' && ['research','review','data'].includes(settingsTab)) active = settingsTab; } catch (_) {}
    let body = '';
    if (active === 'review') body = await reviewHtml();
    else if (active === 'data') body = await dataHtml();
    else body = await automationHtml();
    if (token !== renderToken || !root.document?.contains(screen)) return false;
    screen.innerHTML = `${tabsHtml(active)}<div class="settings-v123-body" data-v123-tab-panel="${attr(active)}">${body}</div>`;
    screen.querySelectorAll('[data-settings-tab]').forEach((button) => button.addEventListener('click', async () => {
      try { settingsTab = button.dataset.settingsTab; } catch (_) {}
      reviewNotice = '';
      await renderUnifiedSettings();
    }));
    if (active === 'review') await wireReview(screen, await reviewModel());
    else if (active === 'data') await wireData(screen);
    else await wireAutomation(screen);
    return true;
  }

  function install() {
    if (typeof root.document === 'undefined') return false;
    if (typeof renderSettingsScreen === 'function' && !renderSettingsScreen.__bandmarkrV123) {
      const replacement = async function renderSettingsScreenV123() { return renderUnifiedSettings(); };
      replacement.__bandmarkrV123 = true;
      replacement.__legacy = renderSettingsScreen;
      renderSettingsScreen = replacement;
    }
    return true;
  }

  if (typeof root.document !== 'undefined') install();

  return {
    COVERAGE_THRESHOLDS,
    USAGE_THRESHOLDS,
    PROVIDER_PURPOSES,
    coverageLevel,
    usageLevel,
    normalizedText,
    profileCoverage,
    concertHasNamedVenue,
    concertHasActualSetlist,
    concertWasAttended,
    concertIsPast,
    concertCoverage,
    listeningCoverage,
    providerUsageRows,
    statusFromRun,
    nextMwfUtc,
    nextFocusedWebUtc,
    updateActivityRows,
    renderUnifiedSettings,
    install,
  };
});