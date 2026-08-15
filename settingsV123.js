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
    ticketmaster: 'Concert discovery, event information and trusted artist identity.',
    tavily: 'Targeted web concert searches when structured providers may have missed a show.',
    groq: 'Structured extraction and selected artist-information tasks.',
    setlistfm: 'Actual setlists and setlist history.',
    spotify: 'Artist identity, releases, track links, playlists, metadata and artwork.',
    musicbrainz: 'Artist identity, metadata and catalogue structure.',
    listenbrainz: 'Personal listening-history synchronization.',
  });
  const SETTINGS_TABS = Object.freeze(['research', 'review', 'data']);

  let renderToken = 0;
  let reviewNotice = '';
  let connectionNotice = '';
  const deferredReviewKeys = new Set();

  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const clean = (value) => String(value == null ? '' : value).trim();
  const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const count = (value) => Math.max(0, finite(value) ? Number(value) : 0);
  const pct = (value, total) => total > 0 ? Math.round((Number(value) || 0) / total * 100) : 0;
  const plural = (n, one, many = `${one}s`) => `${Number(n).toLocaleString()} ${Number(n) === 1 ? one : many}`;

  function coverageLevel(percent) {
    const value = Math.max(0, Math.min(100, Number(percent) || 0));
    return COVERAGE_THRESHOLDS.find((rule) => value >= rule.min) || COVERAGE_THRESHOLDS.at(-1);
  }

  function usageLevel(percent) {
    const value = Math.max(0, Number(percent) || 0);
    return USAGE_THRESHOLDS.find((rule) => value <= rule.max) || USAGE_THRESHOLDS.at(-1);
  }

  function normalizedText(value) {
    return clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toLocaleLowerCase('en');
  }

  function dateOnly(value) {
    const time = Date.parse(value || '');
    return Number.isFinite(time) ? new Intl.DateTimeFormat('en', { day:'numeric', month:'short', year:'numeric' }).format(new Date(time)) : 'Not available';
  }

  function dateTime(value) {
    const time = Date.parse(value || '');
    return Number.isFinite(time) ? new Intl.DateTimeFormat('en', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }).format(new Date(time)) : 'Not available';
  }

  function bandState() { try { return typeof bands !== 'undefined' && Array.isArray(bands) ? bands : []; } catch (_) { return []; } }
  function concertState() { try { return typeof concerts !== 'undefined' && Array.isArray(concerts) ? concerts : []; } catch (_) { return []; } }
  function listeningState() { try { return typeof listeningEvents !== 'undefined' && Array.isArray(listeningEvents) ? listeningEvents : []; } catch (_) { return []; } }
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

  function profileCoverage(rows = []) {
    const total = rows.length;
    const metric = (key, matched) => ({ key, matched, total, percent:pct(matched,total) });
    return [
      metric('Images', rows.filter(trustedVisibleImage).length),
      metric('Descriptions', rows.filter(trustedVisibleBio).length),
      metric('Genres', rows.filter((band) => Boolean(clean(band?.genre))).length),
      metric('Origin', rows.filter((band) => Boolean(clean(band?.origin))).length),
    ];
  }

  function concertHasNamedVenue(concert) {
    const venue = clean(concert?.venue);
    return Boolean(venue && !/^unknown(?:\s+venue)?$/i.test(venue));
  }

  function concertHasActualSetlist(concert) {
    return Boolean(
      (Array.isArray(concert?.setlist) && concert.setlist.length) ||
      (Array.isArray(concert?.setlistSongs) && concert.setlistSongs.length) ||
      (Array.isArray(concert?.actualSetlist) && concert.actualSetlist.length) ||
      (Array.isArray(concert?.setlist?.songs) && concert.setlist.songs.length)
    );
  }

  function concertWasAttended(concert) {
    return concert?.attended === true || concert?.status === 'attended' || concert?.attending === true;
  }

  function concertIsPast(concert, now = new Date()) {
    const raw = clean(concert?.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
    const event = new Date(`${raw}T00:00:00`);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Number.isFinite(event.getTime()) && event < today;
  }

  function concertCoverage(rows = [], now = new Date()) {
    const venueMatched = rows.filter(concertHasNamedVenue).length;
    const eligible = rows.filter((concert) => concertWasAttended(concert) && concertIsPast(concert, now));
    const setlists = eligible.filter(concertHasActualSetlist).length;
    return [
      { key:'Venue information', matched:venueMatched, total:rows.length, percent:pct(venueMatched,rows.length), detail:rows.length ? `${venueMatched.toLocaleString()} of ${rows.length.toLocaleString()} concerts have a named venue` : 'No concerts yet' },
      { key:'Setlists', matched:setlists, total:eligible.length, percent:pct(setlists,eligible.length), detail:eligible.length ? `${setlists.toLocaleString()} of ${eligible.length.toLocaleString()} eligible attended concerts` : 'No eligible attended concerts yet' },
    ];
  }

  function uniqueBandNameOwners(bandRows) {
    const owners = new Map();
    for (const band of bandRows || []) {
      const id = clean(band?.id);
      const name = normalizedText(band?.name);
      if (!id || !name) continue;
      const ids = owners.get(name) || new Set();
      ids.add(id);
      owners.set(name, ids);
    }
    return owners;
  }

  function listeningCoverage(bandRows = [], events = []) {
    const knownBandIds = new Set(bandRows.map((band) => clean(band?.id)).filter(Boolean));
    const owners = uniqueBandNameOwners(bandRows);
    const eligibleBandIds = new Set();
    const matchedBandIds = new Set();
    const followedEvents = [];

    for (const event of events || []) {
      const explicitId = clean(event?.localBandId || event?.bandId);
      if (knownBandIds.has(explicitId)) {
        eligibleBandIds.add(explicitId);
        matchedBandIds.add(explicitId);
        followedEvents.push(event);
        continue;
      }
      const possible = owners.get(normalizedText(event?.artistCreditName));
      if (possible?.size === 1) eligibleBandIds.add([...possible][0]);
    }

    const songs = new Map();
    const albums = new Map();
    for (const event of followedEvents) {
      const bandId = clean(event?.localBandId || event?.bandId);
      const title = normalizedText(event?.recordingTitle);
      if (title) {
        const key = `${bandId}\n${title}`;
        const identified = Boolean(clean(event?.musicbrainzRecordingId || event?.recordingMbid || event?.stableRecordingId || event?.spotifyTrackId));
        songs.set(key, Boolean(songs.get(key) || identified));
      }
      const release = normalizedText(event?.releaseTitle);
      if (release) {
        const key = `${bandId}\n${release}`;
        const artwork = Boolean(clean(event?.albumArtworkUrl || event?.artworkPath || event?.artworkUrl));
        albums.set(key, Boolean(albums.get(key) || artwork));
      }
    }

    const identifiedSongs = [...songs.values()].filter(Boolean).length;
    const artworkAlbums = [...albums.values()].filter(Boolean).length;
    return [
      { key:'Artists matched', matched:matchedBandIds.size, total:eligibleBandIds.size, percent:pct(matchedBandIds.size,eligibleBandIds.size), detail:eligibleBandIds.size ? `${matchedBandIds.size.toLocaleString()} of ${eligibleBandIds.size.toLocaleString()} listened followed artists linked` : 'No followed-artist listening history yet' },
      { key:'Songs identified', matched:identifiedSongs, total:songs.size, percent:pct(identifiedSongs,songs.size), detail:songs.size ? `${identifiedSongs.toLocaleString()} of ${songs.size.toLocaleString()} unique songs` : 'No followed-band songs in listening history yet' },
      { key:'Album artwork', matched:artworkAlbums, total:albums.size, percent:pct(artworkAlbums,albums.size), detail:albums.size ? `${artworkAlbums.toLocaleString()} of ${albums.size.toLocaleString()} listened albums` : 'No followed-band albums in listening history yet' },
    ];
  }

  function identityCoverage(rows = []) {
    const coverage = root.ProviderIdentityState?.identityCoverage?.(rows);
    if (!coverage) return [];
    const metric = (key, data, verb, attention = 0) => ({ key, matched:data.confirmed, total:data.total, percent:data.coveragePercent, detail:data.total ? `${data.confirmed.toLocaleString()} of ${data.total.toLocaleString()} artists ${verb}` : 'No followed artists yet', attention });
    return [
      metric('MusicBrainz',coverage.musicbrainz,'identified'),
      metric('Spotify',coverage.spotify,'identified',coverage.spotify.issueCount || 0),
      metric('Ticketmaster',coverage.ticketmaster,'identified'),
      metric('setlist.fm',coverage.setlistfm,'linked'),
    ];
  }

  function reportedCap(source, keys) {
    for (const key of keys) if (finite(source?.[key]) && Number(source[key]) > 0) return Number(source[key]);
    return null;
  }

  function ticketmasterSafetyCap(ticketmaster) {
    const explicit = reportedCap(ticketmaster, ['dailyCap']);
    if (explicit) return explicit;
    return finite(ticketmaster?.freeTierDailyLimit) && Number(ticketmaster.freeTierDailyLimit) > 0
      ? Math.round(Number(ticketmaster.freeTierDailyLimit) * 0.5)
      : null;
  }

  function usageMetric(id, name, used, cap, unit) {
    if (!finite(used) || !finite(cap) || Number(cap) <= 0) return { id,name,status:'Usage unavailable',statusLevel:'neutral',detail:'A current safety budget is not reported.' };
    const percent = Math.round(Number(used) / Number(cap) * 100);
    return { id,name,used:Number(used),cap:Number(cap),unit,percent,level:usageLevel(percent) };
  }

  function providerUsageRows(usage = usageState()) {
    const tm = usage.ticketmaster || {};
    const tv = usage.tavily || {};
    const gq = usage.groq || {};
    const sl = usage.setlistfm || {};
    const sp = usage.spotify || {};
    const mb = usage.musicbrainz || {};
    const lb = root.LiveVaultListenBrainz?.connection?.() || null;
    let tavilyUsed = finite(tv.callsThisMonth) ? Number(tv.callsThisMonth) : null;
    try {
      if (typeof RESEARCH_KEY_METADATA !== 'undefined' && RESEARCH_KEY_METADATA?.tavily?.usageCounterEpoch && tv.usageCounterEpoch !== RESEARCH_KEY_METADATA.tavily.usageCounterEpoch) tavilyUsed = 0;
    } catch (_) {}
    const rows = [
      usageMetric('ticketmaster','Ticketmaster',tm.callsToday,ticketmasterSafetyCap(tm),'BANDMARKR daily calls used'),
      usageMetric('tavily','Tavily',tavilyUsed,reportedCap(tv,['monthlyCap']),'monthly searches used'),
      usageMetric('groq','Groq',gq.tokensToday,reportedCap(gq,['safeTpd']),'daily tokens used'),
      usageMetric('setlistfm','setlist.fm',sl.callsToday,reportedCap(sl,['dailyCap']),'daily calls used'),
      usageMetric('spotify','Spotify',sp.callsToday,reportedCap(sp,['dailyCap']),'BANDMARKR daily safety limit'),
    ];
    const mbRun = usage.lastProviderIdentityRun || usage.lastMusicbrainzRun || null;
    const mbState = mbRun ? statusFromRun(mbRun) : null;
    rows.push({ id:'musicbrainz', name:'MusicBrainz', status:mbState ? mbState.label : 'Courtesy paced', statusLevel:mbState ? mbState.key : 'neutral', detail:mb.lastCallAt ? `Courtesy-paced automatically · last checked ${dateOnly(mb.lastCallAt)}` : 'Courtesy-paced automatically · no recent call recorded' });
    rows.push({ id:'listenbrainz', name:'ListenBrainz', status:lb ? 'Connected' : 'Not connected', statusLevel:lb ? 'good' : 'warning', detail:lb?.lastSyncAt ? `Keeps listening history current · last sync ${dateTime(lb.lastSyncAt)}` : 'Keeps your listening history up to date' });
    return rows;
  }

  function statusFromRun(run) {
    if (!run) return { label:'Not reported', key:'neutral', problem:'' };
    const value = clean(run.status).toLowerCase();
    if (['error','failed','failure'].includes(value) || run.error) return { label:'Failed', key:'bad', problem:clean(run.error) || 'The latest run failed.' };
    if (['ok','success','successful','complete','completed'].includes(value)) return { label:'Healthy', key:'good', problem:'' };
    return { label:'Needs attention', key:'warning', problem:value ? `Latest status: ${value}.` : 'The latest outcome is not reported.' };
  }

  function latestRun(...runs) {
    return runs.filter(Boolean).sort((a,b) => (Date.parse(b.finishedAt || b.startedAt || '') || 0) - (Date.parse(a.finishedAt || a.startedAt || '') || 0))[0] || null;
  }

  function nextMwfUtc(now = new Date()) {
    for (let offset=0; offset<8; offset+=1) {
      const candidate = new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+offset,1));
      if ([1,3,5].includes(candidate.getUTCDay()) && candidate > now) return candidate.toISOString();
    }
    return null;
  }

  function nextFocusedWebUtc(now = new Date()) {
    return [new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1,2)),new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),15,2)),new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1,2))].filter((d)=>d>now).sort((a,b)=>a-b)[0]?.toISOString() || null;
  }

  function updateActivityRows(usage = usageState(), now = new Date()) {
    const structured = latestRun(usage.automationRuns?.structuredResearch,usage.lastRun?.mode === 'tavily-concert-only' ? null : usage.lastRun);
    const focused = latestRun(usage.automationRuns?.focusedTavilyConcert,usage.lastRun?.mode === 'tavily-concert-only' ? usage.lastRun : null);
    const artist = latestRun(usage.lastProviderIdentityRun,usage.lastMusicbrainzRun);
    const lb = root.LiveVaultListenBrainz?.connection?.() || null;
    const structuredState = statusFromRun(structured);
    const focusedState = statusFromRun(focused);
    const artistState = statusFromRun(artist);
    const setlistFailed = Array.isArray(structured?.notes) && structured.notes.some((note)=>/setlist.*failed/i.test(clean(note)));
    const result = (run,a,aLabel,b,bLabel,fallback) => {
      if (!run) return fallback;
      const parts=[];
      if (finite(run[a])) parts.push(`${count(run[a]).toLocaleString()} ${aLabel}`);
      if (finite(run[b])) parts.push(`${count(run[b]).toLocaleString()} ${bLabel}`);
      return parts.join(' · ') || fallback;
    };
    return [
      { name:'Concerts',...structuredState,last:structured?.finishedAt,next:nextMwfUtc(now),result:result(structured,'bandsProcessed','artists checked','concertsAdded','concerts added','No recent result reported.') },
      { name:'Web concert search',...focusedState,last:focused?.finishedAt,next:nextFocusedWebUtc(now),result:result(focused,'bandsAttempted','artists checked','concertsAdded','concerts added','No recent result reported.') },
      { name:'Listening history',label:lb ? (lb.lastSyncAt ? 'Healthy' : 'Needs attention') : 'Needs connection',key:lb?.lastSyncAt ? 'good' : 'warning',last:lb?.lastSyncAt,next:lb?.lastSyncAt ? new Date(Date.parse(lb.lastSyncAt)+21600000).toISOString() : null,result:lb?.lastSyncAt ? `Listening history synced through ${dateTime(lb.lastSyncAt)}` : (lb ? 'No successful device sync is recorded yet.' : 'Connect ListenBrainz in Data.') },
      { name:'Artist information',...artistState,last:artist?.finishedAt,next:null,result:result(artist,'identityUpdates','artists updated','spotifyCalls','Spotify checks','No recent result reported.') },
      { name:'Artist artwork',label:'Not reported',key:'neutral',last:null,next:null,result:'Artwork scheduler state is not reported to this device.' },
      { name:'Setlists',...(setlistFailed ? {label:'Failed',key:'bad',problem:'The latest setlist update recorded a failure.'} : structuredState),last:structured?.finishedAt,next:nextMwfUtc(now),result:finite(structured?.setlistsAdded) ? `${plural(structured.setlistsAdded,'setlist')} updated` : 'No recent result reported.' },
    ];
  }

  function sectionHeader(title,intro) {
    return `<div class="settings-v123-section-head"><span class="settings-v123-section-accent" aria-hidden="true"></span><div><h3>${esc(title)}</h3>${intro ? `<p>${esc(intro)}</p>` : ''}</div></div>`;
  }

  function tabsHtml(active) {
    return `<div class="settings-v123-tabs" role="tablist" aria-label="Settings sections">${[['research','Automation'],['review','Review'],['data','Data']].map(([key,label])=>`<button type="button" class="settings-v123-tab${active===key?' is-selected':''}" data-settings-tab="${key}" role="tab" aria-selected="${active===key?'true':'false'}"${active===key?'':' tabindex="-1"'}>${label}</button>`).join('')}</div>`;
  }

  function progressRow(row,mode='coverage') {
    if (mode === 'coverage' && finite(row.total) && Number(row.total) <= 0) {
      return `<div class="settings-v123-row" data-v123-metric="${esc(row.key || row.name)}"><div class="settings-v123-row-head"><div><strong>${esc(row.key || row.name)}</strong><p>${esc(row.detail)}</p></div><span class="settings-v123-status is-neutral"><i></i>Not applicable</span></div></div>`;
    }
    const percent = Math.max(0,Math.round(Number(row.percent)||0));
    const level = mode === 'usage' ? usageLevel(percent) : coverageLevel(percent);
    return `<div class="settings-v123-row" data-v123-metric="${esc(row.key || row.name)}"><div class="settings-v123-row-head"><div><strong>${esc(row.key || row.name)}</strong><p>${esc(row.detail)}</p></div><span class="settings-v123-metric-value is-${level.key}"><i></i>${percent}%</span></div><div class="settings-v123-progress" role="progressbar" aria-label="${esc(row.key || row.name)} ${percent}%" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100,percent)}"><span class="is-${level.key}" style="width:${Math.min(100,percent)}%"></span></div>${row.attention ? `<p class="settings-v123-note">${plural(row.attention,'artist')} need attention.</p>` : ''}</div>`;
  }

  function providerRow(row, extraDetail = '') {
    const purpose = PROVIDER_PURPOSES[row.id] || '';
    const body = finite(row.cap) ? progressRow({ ...row,key:row.name,detail:`${row.used.toLocaleString()} of ${row.cap.toLocaleString()} ${row.unit}` },'usage') : `<div class="settings-v123-row"><div class="settings-v123-row-head"><div><strong>${esc(row.name)}</strong><p>${esc(row.detail)}</p></div><span class="settings-v123-status is-${row.statusLevel || 'neutral'}"><i></i>${esc(row.status)}</span></div></div>`;
    return `<div class="settings-v123-provider-wrap">${body}<button type="button" class="settings-v123-detail-toggle" data-v123-provider-toggle="${row.id}" aria-expanded="false">Details</button><div class="settings-v123-provider-detail" data-v123-provider-detail="${row.id}" hidden><p>${esc(purpose)}</p>${extraDetail}</div></div>`;
  }

  function activityRow(row) {
    const meta=[row.last?`Last updated ${dateOnly(row.last)}`:null,row.next?`Next check ${dateOnly(row.next)}`:null].filter(Boolean).join(' · ');
    return `<div class="settings-v123-row"><div class="settings-v123-row-head"><div><strong>${esc(row.name)}</strong>${meta?`<p>${esc(meta)}</p>`:''}<p>${esc(row.result)}</p>${row.problem?`<p class="settings-v123-problem">${esc(row.problem)}</p>`:''}</div><span class="settings-v123-status is-${row.key || 'neutral'}"><i></i>${esc(row.label)}</span></div></div>`;
  }

  function groupHtml(title,rows) {
    return `<div class="settings-v123-group-label">${esc(title)}</div>${rows.map((row)=>progressRow(row)).join('')}`;
  }

  async function spotifyState() {
    try {
      const key=root.SpotifyUser?.TOKEN_KEY;
      const values=await root.chrome?.storage?.local?.get?.(['spotifyUserClientId',key].filter(Boolean));
      return { clientId:clean(values?.spotifyUserClientId),auth:key ? values?.[key] || null : null };
    } catch (_) { return {clientId:'',auth:null}; }
  }

  async function groqState() {
    try {
      const values = await root.chrome?.storage?.local?.get?.(['groqApiKey','groqApiKeyAddedAt']);
      return { key:clean(values?.groqApiKey), addedAt:values?.groqApiKeyAddedAt || null };
    } catch (_) { return { key:'', addedAt:null }; }
  }

  function maskSecret(value) {
    const key = clean(value);
    if (!key) return '';
    if (key.length <= 8) return `${key.slice(0,1)}••••${key.slice(-1)}`;
    return `${key.slice(0,4)}••••••••${key.slice(-4)}`;
  }

  function groqDetailHtml(state) {
    return `<div class="settings-v123-provider-setting"><p><strong>Device key (optional)</strong></p>${state.key ? `<p class="settings-v123-note">${esc(maskSecret(state.key))}${state.addedAt ? ` · added ${esc(dateOnly(state.addedAt))}` : ''}</p>` : ''}<label class="settings-v123-inline-field"><span>Groq API key</span><input class="settings-v123-input" type="password" autocomplete="off" data-v123-groq-key placeholder="${state.key ? 'Enter a new key to replace it' : 'Optional key for adding artist information'}"></label><p class="settings-v123-note">Used only for artist information when you add a band on this device. Scheduled research uses its separately configured credential.</p><div class="settings-v123-actions"><button type="button" class="btn-primary" data-v123-save-groq>Save</button>${state.key ? '<button type="button" class="btn-secondary" data-v123-remove-groq>Remove key</button>' : ''}</div><p class="settings-v123-note" data-v123-groq-status aria-live="polite"></p></div>`;
  }

  function connectionRow(name,status,level,detail,actions='') {
    return `<div class="settings-v123-row"><div class="settings-v123-row-head"><div><strong>${esc(name)}</strong><p>${esc(detail)}</p></div><span class="settings-v123-status is-${level}"><i></i>${esc(status)}</span></div>${actions?`<div class="settings-v123-actions">${actions}</div>`:''}</div>`;
  }

  function reviewItemKey(item) {
    if (item?.kind === 'musicbrainz') return `artist:musicbrainz:${clean(item.band?.id) || normalizedText(item.band?.name)}`;
    if (item?.kind === 'spotify') return `artist:spotify:${clean(item.row?.bandId || item.row?.localBandId) || normalizedText(item.row?.bandName)}`;
    const explicit = clean(item?.reviewGroupId || item?.groupId || item?.id);
    if (explicit) return `listening:${explicit}`;
    const pairs = (item?.candidatePairs || []).map((pair) => clean(pair?.pairKey)).filter(Boolean).sort();
    return `listening:${pairs.join(',')}`;
  }

  function musicbrainzReviewItems(rows) {
    return rows.filter((band)=>band?.musicbrainz?.status==='needs_review' && Array.isArray(band.musicbrainz.reviewCandidates) && band.musicbrainz.reviewCandidates.length).map((band)=>({kind:'musicbrainz',band,candidates:band.musicbrainz.reviewCandidates.slice(0,5)}));
  }

  async function reviewModel() {
    const rows=bandState();
    const events=listeningState();
    let spotify=[];
    let listening=[];
    try { spotify=(root.ListeningSpotifyIdentityReview?.auditSpotifyArtistIdentities?.(rows,events,{identityState:root.ProviderIdentityState})||[]).filter((row)=>row.actionState==='candidate_available').map((row)=>({kind:'spotify',row})); } catch (_) {}
    try { listening=await root.BandmarkrListeningReviewRollout?.reviewQueue?.({maxItems:20}) || []; } catch (_) {}
    return {
      artist:[...musicbrainzReviewItems(rows),...spotify].filter((item)=>!deferredReviewKeys.has(reviewItemKey(item))),
      listening:listening.filter((item)=>!deferredReviewKeys.has(reviewItemKey(item))),
    };
  }

  function artistReview(item,index) {
    if (item.kind==='musicbrainz') {
      return `<article class="settings-v123-review-item" data-v123-artist-review="${index}"><div class="settings-v123-row-head"><div><strong>${esc(item.band.name)}</strong><p>${plural(item.candidates.length,'possible artist match','possible artist matches')} found.</p></div><span class="settings-v123-status is-warning"><i></i>Needs review</span></div><div class="settings-v123-candidates">${item.candidates.map((candidate)=>{const id=clean(candidate.mbid || candidate.id);return `<div><span><strong>${esc(candidate.artistName || 'Unnamed artist')}</strong><small>${esc([candidate.area,candidate.country,candidate.disambiguation].filter(Boolean).join(' · ') || 'MusicBrainz candidate')}</small></span><button type="button" class="btn-primary" data-v123-mb-use="${esc(id)}">Use this artist</button></div>`;}).join('')}</div><div class="settings-v123-actions"><button type="button" class="btn-secondary" data-v123-mb-none>None of these</button><button type="button" class="btn-secondary" data-v123-review-later>Later</button></div></article>`;
    }
    return `<article class="settings-v123-review-item" data-v123-artist-review="${index}"><div class="settings-v123-row-head"><div><strong>${esc(item.row.bandName)}</strong><p>${item.row.duplicateConflict?'Spotify has a conflicting artist match.':'Spotify needs you to confirm the artist match.'}</p></div><span class="settings-v123-status is-warning"><i></i>Needs review</span></div><div class="settings-v123-candidates">${(item.row.candidates||[]).map((candidate)=>`<div><span><strong>${esc(candidate.artistName || candidate.name || candidate.id)}</strong><small>Spotify candidate</small></span><button type="button" class="btn-primary" data-v123-spotify-use="${esc(candidate.id)}">Use this artist</button></div>`).join('')}</div><div class="settings-v123-actions"><button type="button" class="btn-secondary" data-v123-spotify-none>None of these</button><button type="button" class="btn-secondary" data-v123-review-later>Later</button></div></article>`;
  }

  function eventSummary(event) {
    return event ? `${clean(event.artistCreditName)||'Unknown artist'} — ${clean(event.recordingTitle)||'Unknown track'} · ${dateTime(event.listenedAt)} · ${clean(event.source)||'unknown source'}` : 'Source details unavailable';
  }

  function listeningReview(item,index) {
    const first=item.candidatePairs?.[0];
    return `<article class="settings-v123-review-item" data-v123-listening-review="${index}"><div class="settings-v123-row-head"><div><strong>${esc(first?.left?.recordingTitle || first?.right?.recordingTitle || 'Possible duplicate listen')}</strong><p>${esc(first?.left?.artistCreditName || first?.right?.artistCreditName || 'Listening history')}</p></div><span class="settings-v123-status is-warning"><i></i>Needs review</span></div><div class="settings-v123-listen-pairs">${(item.candidatePairs||[]).map((pair)=>`<div><p>${esc(eventSummary(pair.left))}</p><p>${esc(eventSummary(pair.right))}</p><button type="button" class="btn-primary" data-v123-listen-merge="${esc(pair.pairKey)}">Same listen</button></div>`).join('')}</div><div class="settings-v123-actions"><button type="button" class="btn-secondary" data-v123-listen-separate>Keep separate</button><button type="button" class="btn-secondary" data-v123-review-later>Later</button></div></article>`;
  }

  async function automationHtml() {
    const groq = await groqState();
    return `<div class="settings-v123-section">${sectionHeader('PROVIDER USAGE','Capacity and connection status for the services BANDMARKR uses.')}<div class="settings-v123-card">${providerUsageRows().map((row)=>providerRow(row,row.id==='groq'?groqDetailHtml(groq):'')).join('')}</div></div><div class="settings-v123-section">${sectionHeader('UPDATE ACTIVITY','What BANDMARKR updates automatically and when it last ran.')}<div class="settings-v123-card">${updateActivityRows().map(activityRow).join('')}</div></div>`;
  }

  function reviewHtml(model) {
    const artistCount=model.artist.length;
    const listeningCount=model.listening.length;
    const total=artistCount+listeningCount;
    const resolved=!total;
    return `<div class="settings-v123-section">${sectionHeader('REVIEW SUMMARY','Only decisions BANDMARKR cannot make safely appear here.')}<div class="settings-v123-card"><div class="settings-v123-summary"><strong>${resolved?'Everything is resolved.':`${plural(total,'item')} need your attention`}</strong><p>${resolved?'No artist or listening matches need your attention.':`${plural(artistCount,'artist match','artist matches')} · ${plural(listeningCount,'listening match','listening matches')}`}</p><div class="settings-v123-summary-grid"><span><b>${artistCount}</b><small>Artist matches</small></span><span><b>${listeningCount}</b><small>Listening match${listeningCount===1?'':'es'}</small></span><span><b>${total}</b><small>Total items</small></span></div>${reviewNotice?`<p class="settings-v123-note" role="status">${esc(reviewNotice)}</p>`:''}</div></div></div>${artistCount?`<div class="settings-v123-section">${sectionHeader('ARTIST MATCHES','Check artists BANDMARKR could not identify with confidence.')}<div class="settings-v123-card">${model.artist.map(artistReview).join('')}</div></div>`:''}${listeningCount?`<div class="settings-v123-section">${sectionHeader('LISTENING MATCHES','Check listens that may be duplicates.')}<div class="settings-v123-card">${model.listening.map(listeningReview).join('')}</div></div>`:''}`;
  }

  function activationPresentation(activation, gau5State, storage = root.localStorage) {
    const status = clean(activation?.status) || 'inactive';
    if (status === 'active') return { text:'Reviewed listening totals are active.', prepareLabel:'Update listening statistics', showPrepare:true, showActivate:false, showDeactivate:true };
    if (status === 'ready') return { text:'Reviewed listening totals are ready to use.', prepareLabel:'Update listening statistics', showPrepare:true, showActivate:true, showDeactivate:false };
    if (status === 'stale') return { text:'Listening history changed. Update listening statistics before using reviewed totals.', prepareLabel:'Update listening statistics', showPrepare:true, showActivate:false, showDeactivate:false };
    if (status === 'preparing') {
      const text = root.BandmarkrListeningPreparationRecovery?.progressText?.(storage) || 'Preparing listening statistics on this device…';
      return { text, prepareLabel:'Preparing…', showPrepare:false, showActivate:false, showDeactivate:false };
    }
    if (status === 'gau5_preparing') {
      const current = gau5State || {};
      if (current.status === 'error') return { text:`Preparation stopped safely: ${current.error || activation?.error || 'Listening preparation stopped safely.'}`, prepareLabel:'Resume preparation', showPrepare:true, showActivate:false, showDeactivate:false };
      if (current.status === 'paused') return { text:root.BandmarkrListeningPreparationV121?.progressText?.(current) || 'Paused safely. Preparation will resume from the saved checkpoint.', prepareLabel:'Resume preparation', showPrepare:true, showActivate:false, showDeactivate:false };
      if (current.status === 'complete') return { text:'Reviewed listening totals are ready to use.', prepareLabel:'Update listening statistics', showPrepare:true, showActivate:true, showDeactivate:false };
      return { text:root.BandmarkrListeningPreparationV121?.progressText?.(current) || 'Preparing listening statistics on this device…', prepareLabel:'Preparing…', showPrepare:false, showActivate:false, showDeactivate:false };
    }
    if (status === 'error') return { text:`Preparation stopped safely: ${activation?.error || 'Listening preparation stopped safely.'}`, prepareLabel:'Prepare again', showPrepare:true, showActivate:false, showDeactivate:false };
    return { text:'Reviewed listening totals have not been prepared.', prepareLabel:'Update listening statistics', showPrepare:true, showActivate:false, showDeactivate:false };
  }

  async function maintenanceHtml() {
    let meta=null;
    try { meta=await root.LiveVaultSpotifyHistory?.getMeta?.(); } catch (_) {}
    const activation=root.BandmarkrListeningCanonicalActivation?.stateStore?.(root.localStorage)?.load?.() || null;
    const gau5State=root.BandmarkrGau5PreparationIntegrationV121?.gau5Store?.()?.load?.() || null;
    const presentation=activationPresentation(activation,gau5State,root.localStorage);
    return `<details class="settings-v123-maintenance"><summary>Maintenance & recovery</summary><div class="settings-v123-maintenance-row"><strong>Listening history import</strong><p>${meta?`${count(meta.eventCount).toLocaleString()} listens are stored on this device.`:'Use this only to restore a prepared listening-history file.'}</p><input type="file" data-v123-history-file accept=".json,.gz,application/json,application/gzip" hidden><div class="settings-v123-actions"><button type="button" class="btn-secondary" data-v123-history-import>Import history</button>${meta?'<button type="button" class="btn-secondary" data-v123-history-clear>Remove imported history</button>':''}</div><p class="settings-v123-note" data-v123-history-status aria-live="polite"></p></div><div class="settings-v123-maintenance-row"><strong>Listening statistics</strong><p data-v123-activation-copy>${esc(presentation.text)}</p><div class="settings-v123-actions">${presentation.showPrepare?`<button type="button" class="btn-secondary" data-v123-prepare-listening>${esc(presentation.prepareLabel)}</button>`:''}${presentation.showActivate?'<button type="button" class="btn-primary" data-v123-activate-listening>Use reviewed totals</button>':''}${presentation.showDeactivate?'<button type="button" class="btn-secondary" data-v123-deactivate-listening>Use original totals</button>':''}</div><p class="settings-v123-note" data-v123-activation-status aria-live="polite"></p></div><div class="settings-v123-maintenance-row"><strong>Missing song information</strong><p>Try to fill trusted song details that are still missing.</p><button type="button" class="btn-secondary" data-v123-complete-identities>Fix missing song information</button><p class="settings-v123-note" data-v123-identity-status aria-live="polite"></p></div><div class="settings-v123-maintenance-row"><strong>Missing album artwork</strong><p>Try again for listened albums that still have trusted Spotify track IDs but no artwork.</p><button type="button" class="btn-secondary" data-v123-refresh-artwork>Refresh missing artwork</button><p class="settings-v123-note" data-v123-artwork-status aria-live="polite"></p></div></details>`;
  }

  async function dataHtml() {
    const rows=bandState();
    const spotify=await spotifyState();
    const lb=root.LiveVaultListenBrainz?.connection?.() || null;
    const connection=remoteState();
    const profiles=profileCoverage(rows).map((row)=>({...row,detail:row.total ? `${row.matched.toLocaleString()} of ${row.total.toLocaleString()} artist profiles` : 'No followed artists yet'}));
    const spotifyConnected=Boolean(spotify.clientId && spotify.auth);
    const spotifyStatus=spotifyConnected?'Connected':spotify.clientId?'Ready to connect':'Not configured';
    const spotifyActions=!spotify.clientId?'<label class="settings-v123-inline-field"><span>Public Client ID</span><input class="settings-v123-input" data-v123-spotify-client-id autocomplete="off"></label><button type="button" class="btn-primary" data-v123-save-spotify-client>Save Client ID</button>':!spotify.auth?'<button type="button" class="btn-primary" data-v123-connect-spotify>Connect</button><button type="button" class="btn-secondary" data-v123-remove-spotify-client>Remove Client ID</button>':'<button type="button" class="btn-secondary" data-v123-disconnect-spotify>Disconnect</button>';
    const lbActions=lb?'<button type="button" class="btn-primary" data-v123-listenbrainz-sync>Sync now</button><button type="button" class="btn-secondary" data-v123-listenbrainz-disconnect>Disconnect</button>':'<label class="settings-v123-inline-field"><span>User token</span><input class="settings-v123-input" type="password" data-v123-listenbrainz-token autocomplete="off"></label><button type="button" class="btn-primary" data-v123-listenbrainz-connect>Connect</button>';
    return `<div class="settings-v123-section">${sectionHeader('DATA COVERAGE','How complete your artist, concert and listening data is.')}<div class="settings-v123-card">${groupHtml('ARTIST IDS',identityCoverage(rows))}${groupHtml('ARTIST PROFILES',profiles)}${groupHtml('CONCERT DATA',concertCoverage(concertState()))}${groupHtml('LISTENING DATA',listeningCoverage(rows,listeningState()))}</div></div><div class="settings-v123-section">${sectionHeader('CONNECTIONS','Services connected to this device.')}<div class="settings-v123-card">${connectionRow('Data storage',connection?.endpoint&&connection?.token?'Connected':'Not connected',connection?.endpoint&&connection?.token?'good':'warning','Stores your data privately in Cloudflare.',connection?.endpoint&&connection?.token?'<button type="button" class="btn-secondary" data-v123-disconnect-data>Disconnect</button>':'<button type="button" class="btn-primary" data-v123-connect-data>Connect</button>')}${connectionRow('Spotify',spotifyStatus,spotifyConnected?'good':'warning','Creates playlists and supplies trusted music information.',spotifyActions)}${connectionRow('ListenBrainz',lb?'Connected':'Not connected',lb?'good':'warning',lb?.lastSyncAt?`Keeps your listening history current · last sync ${dateTime(lb.lastSyncAt)}`:'Keeps your listening history current.',lbActions)}<p class="settings-v123-note settings-v123-connection-message" data-v123-connection-status aria-live="polite">${esc(connectionNotice)}</p></div></div><div class="settings-v123-section">${sectionHeader('EXPORT','Download a copy of your BANDMARKR data.')}<div class="settings-v123-card"><div class="settings-v123-row"><strong>Export your data</strong><p>Bands, concerts, ratings, notes, costs and setlists.</p><div class="settings-v123-actions"><button type="button" class="btn-secondary" data-v123-export-csv>Export CSV</button><button type="button" class="btn-secondary" data-v123-export-excel>Export Excel</button></div><p class="settings-v123-note" data-v123-export-status aria-live="polite"></p></div></div></div><div class="settings-v123-section">${sectionHeader('DEVICE','Manage BANDMARKR data saved only on this device.')}<div class="settings-v123-card"><div class="settings-v123-row"><strong>Disconnect this device</strong><p>Removes the saved data connection. Local listening history and settings stay.</p><div class="settings-v123-actions"><button type="button" class="btn-secondary" data-v123-disconnect-data>Disconnect</button></div></div><div class="settings-v123-row"><strong>Erase this device</strong><p>Removes data stored only in this browser. Remote concert data is not deleted.</p><div class="settings-v123-actions"><button type="button" class="btn-secondary btn-danger" data-v123-erase-device>Erase this device</button></div></div>${await maintenanceHtml()}</div><p class="settings-v123-version">Version ${esc(typeof APP_VERSION!=='undefined'?APP_VERSION:'?')}</p></div>`;
  }

  function setStatus(screen,selector,text) {
    const node=screen.querySelector(selector);
    if (node) node.textContent=text;
  }

  async function saveMusicbrainz(item,candidateId) {
    if (typeof saveArtistIdentity!=='function') throw new Error('Artist review is unavailable.');
    return saveArtistIdentity(item.band.id,(band)=>{
      const state=band.musicbrainz || {};
      if (!candidateId) return root.MusicbrainzState?.rejectCandidates?.(state);
      const candidate=(state.reviewCandidates||[]).find((row)=>clean(row.mbid || row.id)===candidateId);
      return candidate ? root.MusicbrainzState?.confirmedIdentity?.(candidate,state) : null;
    });
  }

  async function deferReview(item) {
    deferredReviewKeys.add(reviewItemKey(item));
    reviewNotice='Deferred for this session.';
    await renderUnifiedSettings();
  }

  async function wireReview(screen,model) {
    screen.querySelectorAll('[data-v123-artist-review]').forEach((article)=>{
      const item=model.artist[Number(article.dataset.v123ArtistReview)];
      if (!item) return;
      article.querySelectorAll('[data-v123-mb-use]').forEach((button)=>button.addEventListener('click',async()=>{button.disabled=true;try{await saveMusicbrainz(item,button.dataset.v123MbUse);reviewNotice=`${item.band.name} was linked.`;await renderUnifiedSettings();}catch(error){reviewNotice=error?.message||'The artist match could not be saved.';button.disabled=false;}}));
      article.querySelector('[data-v123-mb-none]')?.addEventListener('click',async(event)=>{event.currentTarget.disabled=true;try{await saveMusicbrainz(item,null);reviewNotice=`${item.band.name} candidates were rejected.`;await renderUnifiedSettings();}catch(error){reviewNotice=error?.message||'The artist decision could not be saved.';event.currentTarget.disabled=false;}});
      article.querySelectorAll('[data-v123-spotify-use]').forEach((button)=>button.addEventListener('click',async()=>{button.disabled=true;try{await root.ListeningSpotifyIdentityReviewUi.saveDecision(item.row,'confirm',button.dataset.v123SpotifyUse);reviewNotice=`${item.row.bandName} was linked to Spotify.`;await renderUnifiedSettings();}catch(error){reviewNotice=error?.message||'The Spotify match could not be saved.';button.disabled=false;}}));
      article.querySelector('[data-v123-spotify-none]')?.addEventListener('click',async(event)=>{event.currentTarget.disabled=true;try{await root.ListeningSpotifyIdentityReviewUi.saveDecision(item.row,'reject',null);reviewNotice=`${item.row.bandName} candidates were rejected.`;await renderUnifiedSettings();}catch(error){reviewNotice=error?.message||'The Spotify decision could not be saved.';event.currentTarget.disabled=false;}});
      article.querySelector('[data-v123-review-later]')?.addEventListener('click',()=>deferReview(item));
    });
    screen.querySelectorAll('[data-v123-listening-review]').forEach((article)=>{
      const item=model.listening[Number(article.dataset.v123ListeningReview)];
      if (!item) return;
      article.querySelectorAll('[data-v123-listen-merge]').forEach((button)=>button.addEventListener('click',async()=>{button.disabled=true;try{await root.BandmarkrListeningReviewRollout.applyReview(item,'merge',{pairKey:button.dataset.v123ListenMerge});reviewNotice='Listening match saved.';await renderUnifiedSettings();}catch(error){reviewNotice=error?.message||'The listening decision could not be saved.';button.disabled=false;}}));
      article.querySelector('[data-v123-listen-separate]')?.addEventListener('click',async(event)=>{event.currentTarget.disabled=true;try{await root.BandmarkrListeningReviewRollout.applyReview(item,'keep_separate',{});reviewNotice='Listening records will stay separate.';await renderUnifiedSettings();}catch(error){reviewNotice=error?.message||'The listening decision could not be saved.';event.currentTarget.disabled=false;}});
      article.querySelector('[data-v123-review-later]')?.addEventListener('click',()=>deferReview(item));
    });
  }

  function wireAutomation(screen) {
    screen.querySelectorAll('[data-v123-provider-toggle]').forEach((button)=>button.addEventListener('click',()=>{
      const detail=screen.querySelector(`[data-v123-provider-detail="${button.dataset.v123ProviderToggle}"]`);
      const open=button.getAttribute('aria-expanded')!=='true';
      button.setAttribute('aria-expanded',String(open));
      if(detail)detail.hidden=!open;
    }));
    screen.querySelector('[data-v123-save-groq]')?.addEventListener('click', async () => {
      const input = screen.querySelector('[data-v123-groq-key]');
      const value = clean(input?.value);
      if (!value) { setStatus(screen,'[data-v123-groq-status]','Enter a key to save, or use Remove key to clear it.'); return; }
      await root.chrome?.storage?.local?.set?.({ groqApiKey:value, groqApiKeyAddedAt:new Date().toISOString() });
      await renderUnifiedSettings();
    });
    screen.querySelector('[data-v123-remove-groq]')?.addEventListener('click', async () => {
      await root.chrome?.storage?.local?.remove?.(['groqApiKey','groqApiKeyAddedAt']);
      await renderUnifiedSettings();
    });
  }

  async function wireData(screen) {
    screen.querySelector('[data-v123-connect-data]')?.addEventListener('click',()=>{if(typeof showOnboarding==='function')showOnboarding();});
    screen.querySelectorAll('[data-v123-disconnect-data]').forEach((button)=>button.addEventListener('click',()=>root.LiveVaultDevicePrivacy?.disconnectDevice?.()));
    screen.querySelector('[data-v123-erase-device]')?.addEventListener('click',async(event)=>{if(!root.confirm?.('Erase all BANDMARKR data stored on this device? Your remote concert data and permanent ticket files will remain in Cloudflare.'))return;event.currentTarget.disabled=true;await root.LiveVaultDevicePrivacy?.eraseDevice?.();});
    screen.querySelector('[data-v123-save-spotify-client]')?.addEventListener('click',async()=>{const value=clean(screen.querySelector('[data-v123-spotify-client-id]')?.value);if(!value){setStatus(screen,'[data-v123-connection-status]','Enter the public Spotify Client ID.');return;}await root.chrome?.storage?.local?.set?.({spotifyUserClientId:value});connectionNotice='Spotify Client ID saved.';await renderUnifiedSettings();});
    screen.querySelector('[data-v123-remove-spotify-client]')?.addEventListener('click',async()=>{await root.chrome?.storage?.local?.remove?.('spotifyUserClientId');connectionNotice='';await renderUnifiedSettings();});
    screen.querySelector('[data-v123-connect-spotify]')?.addEventListener('click',async()=>{const state=await spotifyState();root.SpotifyUser?.beginAuthorization?.(state.clientId);});
    screen.querySelector('[data-v123-disconnect-spotify]')?.addEventListener('click',async()=>{await root.SpotifyUser?.clearAuth?.();connectionNotice='Spotify disconnected.';await renderUnifiedSettings();});
    screen.querySelector('[data-v123-listenbrainz-connect]')?.addEventListener('click',async(event)=>{event.currentTarget.disabled=true;try{const validated=await root.LiveVaultListenBrainz.validateToken(clean(screen.querySelector('[data-v123-listenbrainz-token]')?.value));root.LiveVaultListenBrainz.saveConnection(validated);await root.LiveVaultListenBrainz.syncNow();await renderUnifiedSettings();}catch(error){setStatus(screen,'[data-v123-connection-status]',error?.message||'ListenBrainz connection failed.');event.currentTarget.disabled=false;}});
    screen.querySelector('[data-v123-listenbrainz-sync]')?.addEventListener('click',async(event)=>{event.currentTarget.disabled=true;try{const result=await root.LiveVaultListenBrainz.syncNow();setStatus(screen,'[data-v123-connection-status]',result.added?`${result.added.toLocaleString()} new listens added.`:'Listening history is already up to date.');}catch(error){setStatus(screen,'[data-v123-connection-status]',error?.message||'ListenBrainz sync failed.');}event.currentTarget.disabled=false;});
    screen.querySelector('[data-v123-listenbrainz-disconnect]')?.addEventListener('click',async()=>{root.LiveVaultListenBrainz?.clearConnection?.();await renderUnifiedSettings();});
    screen.querySelector('[data-v123-export-csv]')?.addEventListener('click',()=>{if(typeof exportDataAsCsv==='function')exportDataAsCsv();setStatus(screen,'[data-v123-export-status]','CSV files downloading…');});
    screen.querySelector('[data-v123-export-excel]')?.addEventListener('click',async()=>{try{if(typeof exportDataAsExcel==='function')await exportDataAsExcel();setStatus(screen,'[data-v123-export-status]','Excel export ready.');}catch(_){setStatus(screen,'[data-v123-export-status]',"Couldn't create the Excel export. Use CSV instead.");}});
    const file=screen.querySelector('[data-v123-history-file]');
    screen.querySelector('[data-v123-history-import]')?.addEventListener('click',()=>file?.click());
    file?.addEventListener('change',async()=>{const selected=file.files?.[0];if(!selected)return;try{const result=await root.LiveVaultSpotifyHistory.importFile(selected);await root.LiveVaultSpotifyHistory.applyToApp();setStatus(screen,'[data-v123-history-status]',`${result.imported.toLocaleString()} listens imported.`);}catch(error){setStatus(screen,'[data-v123-history-status]',error?.message||'Import failed.');}file.value='';});
    screen.querySelector('[data-v123-history-clear]')?.addEventListener('click',async()=>{await root.LiveVaultSpotifyHistory?.clear?.();try{if(typeof listeningEvents!=='undefined')listeningEvents=[];}catch(_){}await renderUnifiedSettings();});
    screen.querySelector('[data-v123-prepare-listening]')?.addEventListener('click',async(event)=>{event.currentTarget.disabled=true;try{if(root.BandmarkrGau5PreparationIntegrationV121?.runPreparation)await root.BandmarkrGau5PreparationIntegrationV121.runPreparation({userInitiated:true});else await root.BandmarkrListeningCanonicalActivation?.prepare?.({bands:bandState()});await renderUnifiedSettings();}catch(error){setStatus(screen,'[data-v123-activation-status]',error?.message||'Listening statistics update stopped safely.');event.currentTarget.disabled=false;}});
    screen.querySelector('[data-v123-activate-listening]')?.addEventListener('click',async()=>{const result=await root.BandmarkrListeningCanonicalActivation.activate({bands:bandState()});try{if(typeof listeningEvents!=='undefined')listeningEvents=result.events;}catch(_){}await renderUnifiedSettings();});
    screen.querySelector('[data-v123-deactivate-listening]')?.addEventListener('click',async()=>{const result=await root.BandmarkrListeningCanonicalActivation.deactivate({bands:bandState()});try{if(typeof listeningEvents!=='undefined')listeningEvents=result.events;}catch(_){}await renderUnifiedSettings();});
    screen.querySelector('[data-v123-complete-identities]')?.addEventListener('click',async(event)=>{event.currentTarget.disabled=true;try{const result=await root.BandmarkrListeningIdentityCompletionV104.complete({onProgress:({checked,total})=>setStatus(screen,'[data-v123-identity-status]',`Checking ${checked} of ${total}…`)});setStatus(screen,'[data-v123-identity-status]',result.checked?`${result.resolvedRecordings.toLocaleString()} song identities added · ${result.remaining.toLocaleString()} still unresolved.`:'No safe song-information lookup is needed.');}catch(error){setStatus(screen,'[data-v123-identity-status]',error?.message||'Song-information update stopped safely.');}event.currentTarget.disabled=false;});
    screen.querySelector('[data-v123-refresh-artwork]')?.addEventListener('click',async(event)=>{event.currentTarget.disabled=true;try{const result=await root.SpotifyListeningMetadataV99.enrich({onProgress:({processed,total})=>setStatus(screen,'[data-v123-artwork-status]',`Checking ${processed} of ${total}…`)});setStatus(screen,'[data-v123-artwork-status]',result.requested?`${result.added.toLocaleString()} artwork records added.`:'Album artwork is already complete for trusted Spotify track IDs.');}catch(error){setStatus(screen,'[data-v123-artwork-status]',error?.message||'Artwork refresh stopped safely.');}event.currentTarget.disabled=false;});
  }

  async function selectTab(key, focus = false) {
    if (!SETTINGS_TABS.includes(key)) return;
    try { settingsTab=key; } catch (_) {}
    reviewNotice='';
    await renderUnifiedSettings();
    if (focus) root.document?.querySelector(`#screen-settings [data-settings-tab="${key}"]`)?.focus?.();
  }

  function wireTabs(screen, active) {
    screen.querySelectorAll('[data-settings-tab]').forEach((button)=>{
      button.addEventListener('click',()=>selectTab(button.dataset.settingsTab));
      button.addEventListener('keydown',(event)=>{
        const index=SETTINGS_TABS.indexOf(active);
        let next=null;
        if(event.key==='ArrowRight')next=SETTINGS_TABS[(index+1)%SETTINGS_TABS.length];
        else if(event.key==='ArrowLeft')next=SETTINGS_TABS[(index-1+SETTINGS_TABS.length)%SETTINGS_TABS.length];
        else if(event.key==='Home')next=SETTINGS_TABS[0];
        else if(event.key==='End')next=SETTINGS_TABS.at(-1);
        if(!next)return;
        event.preventDefault();
        selectTab(next,true);
      });
    });
  }

  async function renderUnifiedSettings() {
    const screen=root.document?.getElementById('screen-settings');
    if(!screen)return false;
    const token=++renderToken;
    let active='research';
    try{if(typeof settingsTab!=='undefined'&&SETTINGS_TABS.includes(settingsTab))active=settingsTab;}catch(_){}
    let model=null;
    let body='';
    if(active==='review'){model=await reviewModel();body=reviewHtml(model);}else if(active==='data')body=await dataHtml();else body=await automationHtml();
    if(token!==renderToken||!root.document?.contains(screen))return false;
    screen.innerHTML=`${tabsHtml(active)}<div class="settings-v123-body" data-v123-tab-panel="${active}">${body}</div>`;
    wireTabs(screen,active);
    if(active==='review')await wireReview(screen,model);else if(active==='data')await wireData(screen);else wireAutomation(screen);
    return true;
  }

  function install() {
    if(typeof root.document==='undefined')return false;
    if(typeof renderSettingsScreen==='function'&&!renderSettingsScreen.__bandmarkrV123){
      const previous=renderSettingsScreen;
      const replacement=async function(){return renderUnifiedSettings();};
      replacement.__bandmarkrV123=true;
      replacement.__legacy=previous;
      renderSettingsScreen=replacement;
    }
    return true;
  }

  if(typeof root.document!=='undefined')install();

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
    ticketmasterSafetyCap,
    providerUsageRows,
    statusFromRun,
    nextMwfUtc,
    nextFocusedWebUtc,
    updateActivityRows,
    reviewItemKey,
    activationPresentation,
    renderUnifiedSettings,
    install,
  };
});
