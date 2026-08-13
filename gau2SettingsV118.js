'use strict';

(function attachGau2Settings(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BandmarkrGau2SettingsV118 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const AUTOMATION_GROUPS = Object.freeze([
    ['Concert Updates', 'Finds new concerts and updates known concert information.'],
    ['Web Concert Search', 'Looks for concerts that structured providers may have missed.'],
    ['Listening Updates', 'Keeps listening history up to date.'],
    ['Artist Updates', 'Fills in and refreshes artist identity and metadata.'],
    ['Artist Images', 'Fills in missing artist artwork.'],
    ['Setlist Updates', 'Finds and refreshes setlists and related setlist data.'],
  ]);

  const PROVIDER_PURPOSES = Object.freeze({
    ticketmaster: 'Concert discovery, event information, venue information and trusted attraction identity.',
    tavily: 'Targeted web concert research when structured providers may have missed a show.',
    groq: 'Structured extraction and selected artist-enrichment tasks.',
    setlistfm: 'Actual setlists, setlist history and setlist-derived context.',
    spotify: 'Artist identity, releases, track links, metadata and artwork.',
    musicbrainz: 'Artist identity, artist metadata and release/catalogue structure.',
    listenbrainz: 'Listening-history ingestion and synchronization.',
  });

  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const finite = (value) => Number.isFinite(Number(value));
  const count = (value) => Math.max(0, finite(value) ? Number(value) : 0);
  const hasFiniteConfidence = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

  function formatMusicbrainzConfidence(value) {
    return hasFiniteConfidence(value) ? `${Math.max(0, Math.min(100, Math.round(Number(value))))}/100` : 'Confidence unavailable';
  }

  function repairMusicbrainzConfidenceHtml(html) {
    return String(html || '').replace(/(?:undefined|null|NaN)\/100/g, 'Confidence unavailable');
  }

  function statusFromRun(run) {
    if (!run) return { label: 'Warning', kind: 'warning', problem: 'No recent status is available.' };
    const value = String(run.status || '').trim().toLowerCase();
    if (['ok', 'success', 'successful', 'complete', 'completed'].includes(value)) return { label: 'Healthy', kind: 'healthy', problem: '' };
    if (['error', 'failed', 'failure'].includes(value)) return { label: 'Failed', kind: 'failed', problem: String(run.error || 'The latest run failed.') };
    return { label: 'Warning', kind: 'warning', problem: value ? `Latest status: ${value}.` : 'The latest outcome is not reported.' };
  }

  function dateTime(value) {
    const parsed = Date.parse(value || '');
    if (!Number.isFinite(parsed)) return 'Not available';
    return new Intl.DateTimeFormat('en', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(new Date(parsed));
  }

  function nextMwfUtc(now = new Date()) {
    const base = new Date(now.getTime());
    for (let offset = 0; offset < 8; offset += 1) {
      const candidate = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + offset, 1, 0, 0));
      if ([1, 3, 5].includes(candidate.getUTCDay()) && candidate.getTime() > now.getTime()) return candidate.toISOString();
    }
    return null;
  }

  function nextFocusedWebUtc(now = new Date()) {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const candidates = [
      new Date(Date.UTC(year, month, 1, 2)),
      new Date(Date.UTC(year, month, 15, 2)),
      new Date(Date.UTC(year, month + 1, 1, 2)),
    ].filter((candidate) => candidate.getTime() > now.getTime());
    return candidates.sort((a, b) => a - b)[0]?.toISOString() || null;
  }

  function usageState() {
    try { return typeof apiUsage === 'undefined' ? null : apiUsage; } catch (_) { return null; }
  }

  function bandState() {
    try { return Array.isArray(bands) ? bands : []; } catch (_) { return []; }
  }

  function concertState() {
    try { return Array.isArray(concerts) ? concerts : []; } catch (_) { return []; }
  }

  function listeningState() {
    try { return Array.isArray(listeningEvents) ? listeningEvents : []; } catch (_) { return []; }
  }

  function listenBrainzConnection() {
    try { return root.LiveVaultListenBrainz?.connection?.() || null; } catch (_) { return null; }
  }

  function latestRunByMode(usage, mode) {
    const explicit = usage?.automationRuns?.[mode];
    if (explicit) return explicit;
    const last = usage?.lastRun;
    if (!last) return null;
    if (mode === 'focusedTavilyConcert') return last.mode === 'tavily-concert-only' ? last : null;
    if (mode === 'structuredResearch') return last.mode !== 'tavily-concert-only' ? last : null;
    return null;
  }

  function resultForStructured(run) {
    if (!run) return 'No separate recent result is reported.';
    const parts = [];
    if (finite(run.bandsProcessed)) parts.push(`${count(run.bandsProcessed).toLocaleString()} bands checked`);
    if (finite(run.concertsAdded)) parts.push(`${count(run.concertsAdded).toLocaleString()} concerts found`);
    return parts.join(' · ') || 'Run completed; no outcome counts were reported.';
  }

  function resultForFocused(run) {
    if (!run) return 'No separate recent result is reported.';
    const parts = [];
    if (finite(run.bandsAttempted)) parts.push(`${count(run.bandsAttempted).toLocaleString()} artists checked`);
    if (finite(run.concertsAdded)) parts.push(`${count(run.concertsAdded).toLocaleString()} concerts found`);
    return parts.join(' · ') || 'Run completed; no outcome counts were reported.';
  }

  function resultForArtist(run) {
    if (!run) return 'No recent artist-update result is reported.';
    const parts = [];
    if (finite(run.identityUpdates)) parts.push(`${count(run.identityUpdates).toLocaleString()} identities updated`);
    if (finite(run.ticketmasterCalls)) parts.push(`${count(run.ticketmasterCalls).toLocaleString()} Ticketmaster checks`);
    if (finite(run.spotifyCalls)) parts.push(`${count(run.spotifyCalls).toLocaleString()} Spotify checks`);
    return parts.join(' · ') || 'Run completed; no outcome counts were reported.';
  }

  function automationRows(now = new Date()) {
    const usage = usageState() || {};
    const structured = latestRunByMode(usage, 'structuredResearch');
    const focused = latestRunByMode(usage, 'focusedTavilyConcert');
    const artistRun = usage.lastProviderIdentityRun || usage.lastMusicbrainzRun || null;
    const lb = listenBrainzConnection();
    const listeningStatus = lb
      ? { label: 'Healthy', kind: 'healthy', problem: '' }
      : { label: 'Warning', kind: 'warning', problem: 'ListenBrainz is not connected on this device.' };
    const nextListening = lb?.lastSyncAt ? new Date(Date.parse(lb.lastSyncAt) + 6 * 60 * 60 * 1000).toISOString() : null;
    const imageStatus = { label: 'Warning', kind: 'warning', problem: 'Trusted-local artwork scheduler status is not reported to this device.' };
    const structuredStatus = statusFromRun(structured);
    const focusedStatus = statusFromRun(focused);
    const artistStatus = statusFromRun(artistRun);

    return [
      {
        name: AUTOMATION_GROUPS[0][0], description: AUTOMATION_GROUPS[0][1], ...structuredStatus,
        lastSuccess: structuredStatus.kind === 'healthy' ? structured?.finishedAt : null,
        nextExpected: nextMwfUtc(now), result: resultForStructured(structured),
      },
      {
        name: AUTOMATION_GROUPS[1][0], description: AUTOMATION_GROUPS[1][1], ...focusedStatus,
        lastSuccess: focusedStatus.kind === 'healthy' ? focused?.finishedAt : null,
        nextExpected: nextFocusedWebUtc(now), result: resultForFocused(focused),
      },
      {
        name: AUTOMATION_GROUPS[2][0], description: AUTOMATION_GROUPS[2][1], ...listeningStatus,
        lastSuccess: lb?.lastSyncAt || null, nextExpected: nextListening,
        result: lb?.lastSyncAt ? `Listening history synced through ${dateTime(lb.lastSyncAt)}` : 'No device sync has been recorded.',
      },
      {
        name: AUTOMATION_GROUPS[3][0], description: AUTOMATION_GROUPS[3][1], ...artistStatus,
        lastSuccess: artistStatus.kind === 'healthy' ? artistRun?.finishedAt : null,
        nextExpected: null, result: resultForArtist(artistRun),
      },
      {
        name: AUTOMATION_GROUPS[4][0], description: AUTOMATION_GROUPS[4][1], ...imageStatus,
        lastSuccess: null, nextExpected: null,
        result: 'Artwork maintenance remains owned by the trusted-local scheduler; this PWA does not invent its run state.',
      },
      {
        name: AUTOMATION_GROUPS[5][0], description: AUTOMATION_GROUPS[5][1], ...structuredStatus,
        lastSuccess: structuredStatus.kind === 'healthy' ? structured?.finishedAt : null,
        nextExpected: nextMwfUtc(now),
        result: structured && finite(structured.setlistsAdded) ? `${count(structured.setlistsAdded).toLocaleString()} setlists updated` : 'No separate recent setlist result is reported.',
      },
    ];
  }

  function automationRowHtml(row) {
    return `<article class="gau2-automation-row">
      <div class="gau2-automation-heading"><strong>${esc(row.name)}</strong><span class="gau2-status is-${esc(row.kind)}">${esc(row.label)}</span></div>
      <p class="settings-hint gau2-automation-description">${esc(row.description)}</p>
      <div class="gau2-automation-meta">
        <span><b>Last successful run</b>${esc(row.lastSuccess ? dateTime(row.lastSuccess) : 'Not available')}</span>
        <span><b>Next expected run</b>${esc(row.nextExpected ? dateTime(row.nextExpected) : 'Not reported')}</span>
        <span><b>Last result</b>${esc(row.result)}</span>
      </div>
      ${row.problem ? `<p class="gau2-problem is-${esc(row.kind)}">${esc(row.problem)}</p>` : ''}
    </article>`;
  }

  function providerDetailsHtml(id, headline, detail) {
    return `<div class="gau2-provider-details"><p><strong>${esc(headline)}</strong></p><p class="settings-hint">${esc(detail)}</p><p class="settings-hint"><strong>Used for:</strong> ${esc(PROVIDER_PURPOSES[id])}</p></div>`;
  }

  function supplementalProvidersHtml() {
    const usage = usageState() || {};
    const spotify = usage.spotify || {};
    const mb = usage.musicbrainz || {};
    const lb = listenBrainzConnection();
    const rows = [
      {
        id: 'spotify', name: 'Spotify', state: 'Safety budget',
        summary: `${count(spotify.callsToday).toLocaleString()} calls today${finite(spotify.dailyCap) ? ` · BANDMARKR cap ${count(spotify.dailyCap).toLocaleString()}/day` : ''}`,
        headline: 'No fixed provider percentage shown',
        detail: 'BANDMARKR shows its own current safety budget instead of pretending Spotify has a fixed free-tier percentage.',
      },
      {
        id: 'musicbrainz', name: 'MusicBrainz', state: 'Courtesy pacing',
        summary: mb.lastCallAt ? `Last provider call ${dateTime(mb.lastCallAt)}` : `No recent call recorded${finite(mb.perRunCap) ? ` · max ${count(mb.perRunCap).toLocaleString()}/run` : ''}`,
        headline: 'Courtesy limits',
        detail: 'MusicBrainz is paced conservatively; BANDMARKR does not present a made-up daily quota percentage.',
      },
      {
        id: 'listenbrainz', name: 'ListenBrainz', state: lb ? 'Connected' : 'Not connected',
        summary: lb ? `Last sync ${dateTime(lb.lastSyncAt)}` : 'No device connection',
        headline: lb ? `Connected as ${lb.userName || 'ListenBrainz user'}` : 'Optional device connection',
        detail: lb ? 'This device can ingest new listens using the saved private token.' : 'Connect in Data when you want this device to keep listening history current.',
      },
    ];
    return rows.map((provider) => `<div class="research-tool-overview-row gau2-provider-row" data-gau2-provider="${provider.id}">
      <button type="button" class="research-tool-overview-button gau2-provider-button" aria-expanded="false">
        <span class="research-tool-overview-title">${esc(provider.name)}</span>
        <span class="gau2-provider-state">${esc(provider.state)}</span>
        <span class="research-tool-overview-usage">${esc(provider.summary)}</span>
      </button>
      <div class="research-tool-details gau2-provider-expand">${providerDetailsHtml(provider.id, provider.headline, provider.detail)}</div>
    </div>`).join('');
  }

  function appendExistingProviderPurpose(screen) {
    screen.querySelectorAll('.research-tool-overview-row:not(.gau2-provider-row)').forEach((row) => {
      const id = row.querySelector('[data-research-tool]')?.dataset.researchTool;
      const card = row.querySelector('.usage-service-card');
      if (!id || !card || !PROVIDER_PURPOSES[id] || card.querySelector('[data-gau2-provider-purpose]')) return;
      const note = root.document.createElement('div');
      note.dataset.gau2ProviderPurpose = 'true';
      note.className = 'usage-detail-row gau2-provider-purpose';
      note.innerHTML = `<span><strong>Used for:</strong> ${esc(PROVIDER_PURPOSES[id])}</span>`;
      card.appendChild(note);
    });
  }

  function renderAutomation(screen) {
    const labels = [...screen.querySelectorAll('.section-label')];
    const toolsLabel = labels.find((node) => node.textContent.trim() === 'Research tools' || node.textContent.trim() === 'Provider/API status');
    if (toolsLabel) toolsLabel.textContent = 'Provider/API status';
    const intro = screen.querySelector('.settings-section-intro');
    if (intro) intro.textContent = 'Usage, connection and safety state for the services BANDMARKR relies on.';
    const overview = screen.querySelector('.research-tools-overview');
    if (overview && !overview.querySelector('[data-gau2-provider="spotify"]')) overview.insertAdjacentHTML('beforeend', supplementalProvidersHtml());
    appendExistingProviderPurpose(screen);

    const pipelineLabel = [...screen.querySelectorAll('.section-label')].find((node) => node.textContent.trim() === 'Research pipeline' || node.textContent.trim() === 'Automation status');
    if (pipelineLabel) {
      pipelineLabel.textContent = 'Automation status';
      const card = pipelineLabel.nextElementSibling;
      if (card?.classList.contains('settings-card')) {
        card.classList.add('gau2-automation-card');
        card.innerHTML = automationRows().map(automationRowHtml).join('');
      }
      const after = card?.nextElementSibling;
      if (after?.classList.contains('settings-hint') && /Updated automatically|pipeline/i.test(after.textContent || '')) after.remove();
    }

    screen.querySelectorAll('.gau2-provider-button').forEach((button) => {
      if (button.dataset.gau2Wired === 'true') return;
      button.dataset.gau2Wired = 'true';
      button.addEventListener('click', () => {
        const row = button.closest('.gau2-provider-row');
        const details = row?.querySelector('.gau2-provider-expand');
        const open = button.getAttribute('aria-expanded') !== 'true';
        button.setAttribute('aria-expanded', String(open));
        details?.classList.toggle('is-open', open);
      });
    });
  }

  function cardContaining(screen, text) {
    return [...screen.querySelectorAll('.settings-card')].find((card) => (card.textContent || '').includes(text)) || null;
  }

  function renderReview(screen) {
    const runCard = cardContaining(screen, 'Last manual MusicBrainz run:');
    runCard?.remove();
    [...screen.querySelectorAll('p, a')].forEach((node) => {
      const text = (node.textContent || '').trim();
      if (/Weekly automatic MusicBrainz lookups are off/i.test(text) || /Open MusicBrainz runs/i.test(text)) node.remove();
    });
    const retryLabel = screen.querySelector('.identity-retry-label');
    if (retryLabel) {
      const next = retryLabel.nextElementSibling;
      if (next?.querySelector('.identity-retry')) next.remove();
      retryLabel.remove();
    }

    const mbSummary = (() => {
      try { return root.MusicbrainzState?.artistIdentitySummary?.(bandState()) || null; } catch (_) { return null; }
    })();
    const summaryCard = screen.querySelector('.identity-review > .settings-card');
    if (summaryCard && mbSummary) {
      const identified = count(mbSummary.autoConfirmed) + count(mbSummary.manualConfirmed);
      summaryCard.innerHTML = `<p class="settings-hint gau2-review-line"><strong>Artist matches</strong><span>${identified.toLocaleString()} identified · ${count(mbSummary.awaitingReview).toLocaleString()} need review</span></p>`;
    }

    const listeningReview = screen.querySelector('#listening-review-maintenance');
    if (listeningReview) {
      const hasItems = Boolean(listeningReview.querySelector('.listening-review-item'));
      const loading = /Checking local derived listening data/i.test(listeningReview.textContent || '');
      listeningReview.hidden = !hasItems && !loading;
      const status = listeningReview.querySelector('[data-listening-review-status]');
      if (hasItems && status) status.hidden = true;
      const label = listeningReview.querySelector('.section-label');
      if (label) label.textContent = 'Listening matches';
    }

    const spotifySection = screen.querySelector('#spotify-identity-review-section');
    if (spotifySection) {
      spotifySection.querySelectorAll('.spotify-review-card').forEach((card) => {
        if (/Candidate acquisition required/i.test(card.textContent || '')) card.hidden = true;
      });
    }

    let top = screen.querySelector('[data-gau2-review-summary]');
    if (!top) {
      top = root.document.createElement('div');
      top.dataset.gau2ReviewSummary = 'true';
      top.className = 'settings-card gau2-review-summary';
      const tabs = screen.querySelector('.settings-subtab-switch');
      tabs?.after(top);
    }
    const musicbrainzReviewCount = screen.querySelectorAll('.identity-review-card').length;
    const listeningReviewCount = screen.querySelectorAll('.listening-review-item').length;
    const spotifyReviewCount = [...screen.querySelectorAll('.spotify-review-card')].filter((card) => !card.hidden).length;
    const total = musicbrainzReviewCount + listeningReviewCount + spotifyReviewCount;
    top.innerHTML = total
      ? `<p><strong>${total.toLocaleString()} item${total === 1 ? '' : 's'} need your review.</strong></p><p class="settings-hint">Only matches that need your judgment are shown below.</p>`
      : '<p><strong>Everything is resolved.</strong></p><p class="settings-hint">No artist or listening matches need your attention.</p>';
  }

  function ensureLegacyExportAnchor(screen) {
    let visible = [...screen.querySelectorAll('.section-label')].find((node) => node.textContent.trim() === 'Data export' && !node.dataset.gau2LegacyExportAnchor);
    if (!visible) visible = [...screen.querySelectorAll('.section-label')].find((node) => node.textContent.trim() === 'Export & backup');
    if (!visible) return;
    if (!screen.querySelector('[data-gau2-legacy-export-anchor]')) {
      const anchor = root.document.createElement('p');
      anchor.className = 'section-label gau2-legacy-anchor';
      anchor.dataset.gau2LegacyExportAnchor = 'true';
      anchor.textContent = 'Data export';
      visible.before(anchor);
    }
    visible.textContent = 'Export & backup';
  }

  function dataOverviewHtml() {
    const bandCount = bandState().length;
    const concertCount = concertState().length;
    const listens = listeningState();
    return `<p class="section-label" data-gau2-data-overview-label>Data overview</p>
      <div class="settings-card gau2-data-overview" data-gau2-data-overview>
        <div class="gau2-data-metrics">
          <span><strong>${bandCount.toLocaleString()}</strong><small>bands</small></span>
          <span><strong>${concertCount.toLocaleString()}</strong><small>concerts</small></span>
          <span><strong>${listens.length.toLocaleString()}</strong><small>listens on this device</small></span>
        </div>
        <p class="settings-hint">Core Live Vault data is stored through the private Cloudflare connection. Listening history and some connection state are stored on this device.</p>
      </div>`;
  }

  function moveDeviceActions(screen) {
    const button = screen.querySelector('#change-connection-btn');
    if (!button || screen.querySelector('[data-gau2-device-reset]')) return;
    const sourceCard = button.closest('.settings-card');
    if (!sourceCard) return;
    const section = root.document.createElement('div');
    section.dataset.gau2DeviceReset = 'true';
    section.innerHTML = '<p class="section-label">Device & reset</p><div class="settings-card gau2-device-card"></div>';
    const version = screen.querySelector('.settings-version');
    if (version) version.before(section); else screen.append(section);
    const target = section.querySelector('.gau2-device-card');
    const privacyHint = sourceCard.querySelector('[data-device-privacy-hint]');
    const eraseButton = sourceCard.querySelector('#erase-device-btn');
    const eraseHint = sourceCard.querySelector('[data-device-erase-hint]');
    [privacyHint, button, eraseButton, eraseHint].filter(Boolean).forEach((node) => target.append(node));
    const intro = root.document.createElement('p');
    intro.className = 'settings-hint';
    intro.textContent = 'Disconnect this device from Live Vault, or erase data stored only on this device.';
    target.prepend(intro);
  }

  function renderData(screen) {
    ensureLegacyExportAnchor(screen);
    const identityLabel = [...screen.querySelectorAll('.section-label')].find((node) => node.textContent.trim() === 'Artist identity coverage');
    if (identityLabel && !screen.querySelector('[data-gau2-data-overview]')) identityLabel.insertAdjacentHTML('beforebegin', dataOverviewHtml());

    const bandLabel = [...screen.querySelectorAll('.section-label')].find((node) => node.textContent.trim() === 'Band status');
    if (bandLabel) {
      const card = bandLabel.nextElementSibling;
      bandLabel.remove();
      if (card?.classList.contains('settings-card')) card.remove();
    }

    const connectionLabel = [...screen.querySelectorAll('.section-label')].find((node) => ['Connection', 'Connections'].includes(node.textContent.trim()));
    if (connectionLabel) connectionLabel.textContent = 'Connections';
    const connectionCard = screen.querySelector('#change-connection-btn')?.closest('.settings-card');
    if (connectionCard && !connectionCard.querySelector('[data-gau2-core-status]')) {
      const first = connectionCard.querySelector('p');
      if (first) {
        const endpoint = (() => { try { return typeof remote !== 'undefined' ? remote?.endpoint : null; } catch (_) { return null; } })();
        first.textContent = endpoint || 'Core data connection unavailable';
      }
      const status = root.document.createElement('p');
      status.dataset.gau2CoreStatus = 'true';
      status.className = 'settings-hint gau2-connection-status';
      status.innerHTML = '<strong>Core Live Vault data:</strong> Connected';
      connectionCard.prepend(status);
    }

    moveDeviceActions(screen);
  }

  function activeSettingsTab(screen) {
    return screen.querySelector('[data-settings-tab].active')?.dataset.settingsTab || null;
  }

  function renameTab(screen) {
    const research = screen.querySelector('[data-settings-tab="research"]');
    if (research && research.textContent.trim() !== 'Automation') research.textContent = 'Automation';
  }

  function applyPresentation() {
    const screen = root.document?.getElementById('screen-settings');
    if (!screen || screen.classList.contains('hidden')) return;
    renameTab(screen);
    const tab = activeSettingsTab(screen);
    if (tab === 'research') renderAutomation(screen);
    else if (tab === 'review') renderReview(screen);
    else if (tab === 'data') renderData(screen);
  }

  let scheduled = false;
  function schedulePresentation() {
    if (scheduled) return;
    scheduled = true;
    root.setTimeout?.(() => {
      scheduled = false;
      applyPresentation();
    }, 0);
  }

  function install() {
    if (typeof artistIdentityReviewHtml === 'function' && !artistIdentityReviewHtml.__gau2V118) {
      const originalReviewHtml = artistIdentityReviewHtml;
      const wrappedReviewHtml = function gau2ReviewHtml(...args) {
        return repairMusicbrainzConfidenceHtml(originalReviewHtml.apply(this, args));
      };
      wrappedReviewHtml.__gau2V118 = true;
      artistIdentityReviewHtml = wrappedReviewHtml;
    }

    if (typeof renderSettingsScreen === 'function' && !renderSettingsScreen.__gau2V118) {
      const originalRender = renderSettingsScreen;
      const wrappedRender = async function gau2RenderSettings(...args) {
        const result = await originalRender.apply(this, args);
        applyPresentation();
        schedulePresentation();
        return result;
      };
      wrappedRender.__gau2V118 = true;
      renderSettingsScreen = wrappedRender;
    }

    const screen = root.document?.getElementById('screen-settings');
    if (screen && root.MutationObserver && !screen.dataset.gau2Observer) {
      screen.dataset.gau2Observer = 'true';
      new root.MutationObserver(schedulePresentation).observe(screen, { childList: true, subtree: true });
    }
    schedulePresentation();
  }

  if (typeof root?.document !== 'undefined') {
    if (root.document.readyState === 'loading') root.addEventListener('DOMContentLoaded', install, { once: true });
    else install();
  }

  return {
    AUTOMATION_GROUPS,
    PROVIDER_PURPOSES,
    formatMusicbrainzConfidence,
    repairMusicbrainzConfidenceHtml,
    statusFromRun,
    nextMwfUtc,
    nextFocusedWebUtc,
    automationRows,
    applyPresentation,
    install,
  };
});
