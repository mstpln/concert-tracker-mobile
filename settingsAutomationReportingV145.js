'use strict';

(function attachSettingsAutomationReportingV145(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BandmarkrSettingsAutomationReportingV145 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const MAX_REASON_LENGTH = 140;
  let observer = null;
  let applying = false;
  let scheduled = false;

  const clean = (value) => String(value == null ? '' : value).trim();
  const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  const count = (value) => Math.max(0, finite(value) ? Math.trunc(Number(value)) : 0);
  const normalizedText = (value) => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toLocaleLowerCase('en');
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const plural = (n, one, many = `${one}s`) => `${count(n).toLocaleString()} ${count(n) === 1 ? one : many}`;

  function dateOnly(value) {
    const time = Date.parse(value || '');
    return Number.isFinite(time) ? new Intl.DateTimeFormat('en', { day:'numeric', month:'short', year:'numeric' }).format(new Date(time)) : 'Not available';
  }

  function knownBandIds(bands = []) {
    return new Set((bands || []).map((band) => clean(band?.id)).filter(Boolean));
  }

  function derivedArtworkForEvent(event, metadataApi = root.SpotifyListeningMetadataV99) {
    if (clean(event?.albumArtworkUrl || event?.artworkPath || event?.artworkUrl)) return true;
    const trackId = clean(event?.spotifyTrackId);
    if (!trackId || typeof metadataApi?.recordForTrack !== 'function') return false;
    try { return Boolean(clean(metadataApi.recordForTrack(trackId)?.artworkUrl)); }
    catch (_) { return false; }
  }

  function albumArtworkCoverage(bands = [], events = [], metadataApi = root.SpotifyListeningMetadataV99) {
    const ids = knownBandIds(bands);
    const albums = new Map();
    for (const event of events || []) {
      const bandId = clean(event?.localBandId || event?.bandId);
      if (!ids.has(bandId)) continue;
      const release = normalizedText(event?.releaseTitle);
      if (!release) continue;
      const key = `${bandId}\n${release}`;
      const covered = derivedArtworkForEvent(event, metadataApi);
      albums.set(key, Boolean(albums.get(key) || covered));
    }
    const matched = [...albums.values()].filter(Boolean).length;
    const total = albums.size;
    return {
      matched,
      total,
      percent: total ? Math.round(matched / total * 100) : 0,
      detail: total ? `${matched.toLocaleString()} of ${total.toLocaleString()} listened albums` : 'No followed-band albums in listening history yet',
    };
  }

  function safeFailureReason(source, fallbackProvider = 'Provider') {
    if (!source) return '';
    const code = clean(source.failureCode).toLowerCase();
    const stored = clean(source.failureReason).replace(/[\r\n\t]+/g, ' ').slice(0, MAX_REASON_LENGTH);
    const raw = clean(source.error || source.message || source.reason || source).toLowerCase();
    const combined = `${stored} ${raw}`.toLowerCase();
    const statusMatch = combined.match(/(?:http\s*)?(4\d\d|5\d\d)\b/i);
    const status = statusMatch ? Number(statusMatch[1]) : null;
    const looksSensitive = /bearer|authorization|api[_ -]?key|client[_ -]?secret|access[_ -]?token|token\s*[=:]|https?:\/\/|stack trace|\bat\s+\w+\s*\(/i.test(stored);
    if (stored && !looksSensitive && ['rate_limited','provider_unavailable','timeout','invalid_response','match_uncertain','network_error','provider_error','update_failed'].includes(code)) return stored;
    if (status === 429 || /rate[ _-]?limit|quota[_ -]?exceed|usage[_ -]?cap/.test(combined)) return 'Rate limit reached; the item will be retried';
    if (status && status >= 500) return `${fallbackProvider} temporarily unavailable (HTTP ${status})`;
    if (/timeout|timed out|aborterror|aborted/.test(combined)) return 'Request timed out';
    if (/invalid[_ -]?(json|response|provider)|unparseable|malformed/.test(combined)) return 'Provider returned an invalid response';
    if (/show[_ -]?identity[_ -]?conflict|ambiguous[_ -]?show|match[_ -]?conflict/.test(combined)) return 'Show could not be matched safely';
    if (/artist[_ -]?id[_ -]?mismatch|duplicate[_ -]?spotify[_ -]?identity|needs[_ -]?review/.test(combined)) return 'Artist could not be matched safely';
    if (/network|fetch failed|failed to fetch|econn|socket|dns/.test(combined)) return 'Network request failed';
    return source.failureCode || source.failureReason || source.error ? 'The latest update could not be completed safely.' : '';
  }

  function statusFromRun(run, provider = 'Provider') {
    if (!run) return { label:'Not reported', key:'neutral', problem:'' };
    const value = clean(run.status).toLowerCase();
    const problem = safeFailureReason(run, provider);
    if (['error','failed','failure'].includes(value)) return { label:'Failed', key:'bad', problem:problem || 'The latest update could not be completed safely.' };
    if (['attention','partial','deferred','warning','needs_attention'].includes(value)) return { label:'Needs attention', key:'warning', problem };
    if (['ok','success','successful','complete','completed','healthy'].includes(value)) return { label:'Healthy', key:'good', problem:'' };
    if (problem) return { label:'Needs attention', key:'warning', problem };
    return { label:'Not reported', key:'neutral', problem:'' };
  }

  function latestRun(...runs) {
    return runs.filter(Boolean).sort((a,b) => (Date.parse(b.finishedAt || b.startedAt || '') || 0) - (Date.parse(a.finishedAt || a.startedAt || '') || 0))[0] || null;
  }

  function nextMwfUtc(now = new Date()) {
    for (let offset=0; offset<8; offset+=1) {
      const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()+offset, 1));
      if ([1,3,5].includes(candidate.getUTCDay()) && candidate > now) return candidate.toISOString();
    }
    return null;
  }

  function nextFocusedWebUtc(now = new Date()) {
    return [
      new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1,2)),
      new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),15,2)),
      new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1,2)),
    ].filter((date)=>date>now).sort((a,b)=>a-b)[0]?.toISOString() || null;
  }

  function reportResult(report, workOne, workMany, changeOne, changeMany) {
    const work = report?.result?.workCount;
    const changed = report?.result?.changeCount;
    if (!finite(work) || !finite(changed)) return null;
    return `${plural(work,workOne,workMany)} · ${plural(changed,changeOne,changeMany)}`;
  }

  function legacyPair(run, workKey, workOne, workMany, changeKey, changeOne, changeMany) {
    if (!run || !finite(run[workKey]) || !finite(run[changeKey])) return null;
    return `${plural(run[workKey],workOne,workMany)} · ${plural(run[changeKey],changeOne,changeMany)}`;
  }

  function legacySetlistState(run) {
    if (!Array.isArray(run?.notes)) return null;
    const note = run.notes.find((value) => /setlist/i.test(clean(value)) && /(failed|returned\s+[45]\d\d|unparseable|invalid|conflict|ambiguous)/i.test(clean(value)));
    if (!note) return null;
    return { label:'Failed', key:'bad', problem:safeFailureReason({ error:note }, 'setlist.fm') || 'The latest setlist update recorded a failure.' };
  }

  function updateActivityRows(usage = {}, now = new Date(), listenBrainz = root.LiveVaultListenBrainz) {
    const legacyStructured = usage.lastRun?.mode === 'tavily-concert-only' ? null : usage.lastRun;
    const legacyFocused = usage.lastRun?.mode === 'tavily-concert-only' ? usage.lastRun : null;
    const structured = latestRun(usage.automationRuns?.structuredResearch, legacyStructured);
    const focused = latestRun(usage.automationRuns?.focusedTavilyConcert, legacyFocused);
    const providerIdentity = latestRun(usage.automationRuns?.providerIdentity, usage.lastProviderIdentityRun, usage.lastMusicbrainzRun);
    const structuredActivities = usage.automationRuns?.structuredResearch?.activities || {};
    const focusedActivity = usage.automationRuns?.focusedTavilyConcert?.activities?.webConcertSearch || null;
    const artistActivity = usage.automationRuns?.providerIdentity?.activities?.artistInformation || null;
    const concertsActivity = structuredActivities.concerts || null;
    const artworkActivity = structuredActivities.artistArtwork || null;
    const setlistsActivity = structuredActivities.setlists || null;
    const lb = listenBrainz?.connection?.() || null;

    const concertsState = statusFromRun(concertsActivity || structured, 'Concert research');
    const focusedState = statusFromRun(focusedActivity || focused, 'Web concert search');
    const artistState = statusFromRun(artistActivity || providerIdentity, 'Artist information');
    const artworkState = artworkActivity
      ? statusFromRun(artworkActivity, 'Artist artwork')
      : (legacyStructured && finite(legacyStructured.artistImagesUpdated) ? statusFromRun(legacyStructured, 'Artist artwork') : { label:'Not reported', key:'neutral', problem:'' });
    const legacySetlist = legacySetlistState(legacyStructured);
    const setlistState = setlistsActivity ? statusFromRun(setlistsActivity, 'setlist.fm') : (legacySetlist || statusFromRun(structured, 'setlist.fm'));

    const listeningResult = lb?.lastSyncResult && finite(lb.lastSyncResult.processed) && finite(lb.lastSyncResult.added)
      ? `${plural(lb.lastSyncResult.processed,'listen','listens')} processed · ${plural(lb.lastSyncResult.added,'listen','listens')} added`
      : (lb?.lastSyncAt ? 'No recent result reported.' : (lb ? 'No successful device sync is recorded yet.' : 'Connect ListenBrainz in Data.'));

    return [
      {
        name:'Concerts', ...concertsState, last:concertsActivity?.finishedAt || structured?.finishedAt, next:nextMwfUtc(now),
        result:reportResult(concertsActivity,'artist','artists','concert','concerts') || legacyPair(legacyStructured,'bandsProcessed','artist','artists','concertsAdded','concert','concerts') || 'No recent result reported.',
      },
      {
        name:'Web concert search', ...focusedState, last:focusedActivity?.finishedAt || focused?.finishedAt, next:nextFocusedWebUtc(now),
        result:reportResult(focusedActivity,'artist','artists','concert','concerts') || legacyPair(legacyFocused,'bandsAttempted','artist','artists','concertsAdded','concert','concerts') || 'No recent result reported.',
      },
      {
        name:'Listening history',
        label:lb ? (lb.lastSyncAt ? 'Healthy' : 'Needs attention') : 'Needs connection',
        key:lb?.lastSyncAt ? 'good' : 'warning',
        problem:'',
        last:lb?.lastSyncAt,
        next:lb?.lastSyncAt ? new Date(Date.parse(lb.lastSyncAt)+21600000).toISOString() : null,
        result:listeningResult,
      },
      {
        name:'Artist information', ...artistState, last:artistActivity?.finishedAt || providerIdentity?.finishedAt, next:null,
        result:reportResult(artistActivity,'artist','artists','artist','artists') || legacyPair(usage.lastProviderIdentityRun,'bandsConsidered','artist','artists','updates','artist','artists') || 'No recent result reported.',
      },
      {
        name:'Artist artwork', ...artworkState, last:artworkActivity?.finishedAt || (legacyStructured && finite(legacyStructured.artistImagesUpdated) ? legacyStructured.finishedAt : null), next:nextMwfUtc(now),
        result:reportResult(artworkActivity,'artist','artists','image','images') || 'No recent result reported.',
      },
      {
        name:'Setlists', ...setlistState, last:setlistsActivity?.finishedAt || structured?.finishedAt, next:nextMwfUtc(now),
        result:reportResult(setlistsActivity,'show','shows','setlist','setlists') || legacyPair(legacyStructured,'setlistChecksAttempted','show','shows','setlistsAdded','setlist','setlists') || 'No recent result reported.',
      },
    ];
  }

  function coverageLevel(percent) {
    const value = Math.max(0, Math.min(100, Number(percent) || 0));
    if (value >= 95) return 'good';
    if (value >= 90) return 'goodish';
    if (value >= 75) return 'watch';
    if (value >= 50) return 'warning';
    return 'bad';
  }

  function applyAlbumCoverage(screen, bands, events, metadataApi) {
    const metric = screen?.querySelector?.('[data-v123-metric="Album artwork"]');
    if (!metric) return false;
    const coverage = albumArtworkCoverage(bands, events, metadataApi);
    const detail = metric.querySelector('.settings-v123-row-head div p');
    const value = metric.querySelector('.settings-v123-metric-value');
    const progress = metric.querySelector('.settings-v123-progress');
    const fill = progress?.querySelector('span');
    if (!coverage.total) return false;
    const level = coverageLevel(coverage.percent);
    if (detail && detail.textContent !== coverage.detail) detail.textContent = coverage.detail;
    if (value) {
      value.className = `settings-v123-metric-value is-${level}`;
      value.innerHTML = `<i></i>${coverage.percent}%`;
    }
    if (progress) {
      progress.setAttribute('aria-label', `Album artwork ${coverage.percent}%`);
      progress.setAttribute('aria-valuenow', String(Math.min(100, coverage.percent)));
    }
    if (fill) {
      fill.className = `is-${level}`;
      fill.style.width = `${Math.min(100, coverage.percent)}%`;
    }
    return true;
  }

  function activityMarkup(row) {
    const meta = [row.last ? `Last updated ${dateOnly(row.last)}` : null, row.next ? `Next check ${dateOnly(row.next)}` : null].filter(Boolean).join(' · ');
    return `<div class="settings-v123-row-head"><div><strong>${esc(row.name)}</strong>${meta ? `<p>${esc(meta)}</p>` : ''}<p>${esc(row.result)}</p>${row.problem ? `<p class="settings-v123-problem">${esc(row.problem)}</p>` : ''}</div><span class="settings-v123-status is-${row.key || 'neutral'}"><i></i>${esc(row.label)}</span></div>`;
  }

  function applyActivityRows(screen, usage, now, listenBrainz) {
    const section = [...(screen?.querySelectorAll?.('.settings-v123-section') || [])].find((node) => node.querySelector('.settings-v123-section-head h3')?.textContent?.trim() === 'UPDATE ACTIVITY');
    if (!section) return false;
    const rows = [...section.querySelectorAll('.settings-v123-card > .settings-v123-row')];
    const model = updateActivityRows(usage, now, listenBrainz);
    for (const item of model) {
      const row = rows.find((node) => node.querySelector('strong')?.textContent?.trim() === item.name);
      if (!row) continue;
      const markup = activityMarkup(item);
      if (row.innerHTML !== markup) row.innerHTML = markup;
    }
    return true;
  }

  function currentBands() { try { return typeof bands !== 'undefined' && Array.isArray(bands) ? bands : []; } catch (_) { return []; } }
  function currentEvents() { try { return typeof listeningEvents !== 'undefined' && Array.isArray(listeningEvents) ? listeningEvents : []; } catch (_) { return []; } }
  function currentUsage() { try { return typeof apiUsage !== 'undefined' && apiUsage ? apiUsage : {}; } catch (_) { return {}; } }

  function applyCurrent() {
    if (applying) return false;
    const screen = root.document?.getElementById?.('screen-settings');
    if (!screen) return false;
    applying = true;
    try {
      applyActivityRows(screen, currentUsage(), new Date(), root.LiveVaultListenBrainz);
      applyAlbumCoverage(screen, currentBands(), currentEvents(), root.SpotifyListeningMetadataV99);
    } finally { applying = false; }
    return true;
  }

  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    Promise.resolve().then(() => { scheduled = false; applyCurrent(); });
  }

  function install() {
    if (!root.document) return false;
    const screen = root.document.getElementById('screen-settings');
    if (screen && root.MutationObserver && !observer) {
      observer = new root.MutationObserver(() => { if (!applying) scheduleApply(); });
      observer.observe(screen, { childList:true, subtree:true });
    }
    if (root.SpotifyListeningMetadataV99?.restore && !root.SpotifyListeningMetadataV99.restore.__settingsV145) {
      const originalRestore = root.SpotifyListeningMetadataV99.restore.bind(root.SpotifyListeningMetadataV99);
      const wrappedRestore = async (...args) => { const result = await originalRestore(...args); scheduleApply(); return result; };
      wrappedRestore.__settingsV145 = true;
      root.SpotifyListeningMetadataV99.restore = wrappedRestore;
    }
    scheduleApply();
    return true;
  }

  if (typeof root.document !== 'undefined') install();

  return {
    MAX_REASON_LENGTH,
    derivedArtworkForEvent,
    albumArtworkCoverage,
    safeFailureReason,
    statusFromRun,
    updateActivityRows,
    applyAlbumCoverage,
    applyActivityRows,
    applyCurrent,
    install,
  };
});
