'use strict';

(function attachSpotifyIdentityReviewUi(root) {
  const SECTION_ID = 'spotify-identity-review-section';
  let renderToken = 0;
  let notice = '';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function statusLabel(value) {
    return String(value || 'unchecked').replaceAll('_', ' ');
  }

  async function loadListeningEvents() {
    try {
      if (Array.isArray(listeningEvents)) return listeningEvents;
    } catch (_) {}
    if (root.LiveVaultSpotifyHistory?.loadEvents) {
      try { return await root.LiveVaultSpotifyHistory.loadEvents([]); } catch (_) { return []; }
    }
    return [];
  }

  function impactHtml(row) {
    const counts = row.affectedListens;
    return `<p class="settings-hint spotify-review-impact">${escapeHtml(String(counts.allTime))} listens affected · ${escapeHtml(String(counts.twoWeeks))} in 2 weeks · ${escapeHtml(String(counts.threeMonths))} in 3 months · ${escapeHtml(String(counts.oneYear))} in 1 year · ${escapeHtml(String(counts.spotify))} Spotify listens</p>`;
  }

  function candidateHtml(row, candidate) {
    const url = root.ListeningSpotifyIdentityReview.safeSpotifyArtistUrl(candidate);
    const detail = [candidate.artistName || candidate.name, candidate.area || candidate.country, candidate.disambiguation].filter(Boolean).join(' · ');
    return `<div class="spotify-review-candidate">
      <div>
        <strong>${escapeHtml(detail || candidate.id)}</strong>
        ${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open Spotify</a>` : ''}
      </div>
      <button class="btn-primary" type="button" data-spotify-review-action="confirm" data-band-id="${escapeHtml(row.bandId)}" data-candidate-id="${escapeHtml(candidate.id)}">Use this artist</button>
    </div>`;
  }

  function rowHtml(row) {
    const candidates = row.candidates.map((candidate) => candidateHtml(row, candidate)).join('');
    return `<article class="settings-card spotify-review-card" data-spotify-review-band="${escapeHtml(row.bandId)}">
      <div class="spotify-review-heading">
        <strong>${escapeHtml(row.bandName)}</strong>
        <span>${escapeHtml(statusLabel(row.status))}</span>
      </div>
      ${impactHtml(row)}
      ${row.duplicateConflict ? '<p class="settings-hint spotify-review-warning"><strong>Duplicate Spotify ID conflict.</strong> This identity needs manual review.</p>' : ''}
      ${row.actionState === 'candidate_acquisition_required'
        ? '<p class="settings-hint"><strong>Candidate acquisition required.</strong> No exact Spotify artist candidate is currently stored.</p>'
        : `<div class="spotify-review-candidates">${candidates}</div><button class="btn-secondary" type="button" data-spotify-review-action="reject" data-band-id="${escapeHtml(row.bandId)}">None of these</button>`}
    </article>`;
  }

  async function render() {
    const screen = document.getElementById('screen-settings');
    if (!screen || !screen.querySelector('[data-settings-tab="review"].active')) return;
    let section = document.getElementById(SECTION_ID);
    if (!section) {
      section = document.createElement('section');
      section.id = SECTION_ID;
      section.className = 'spotify-identity-review';
      screen.appendChild(section);
    }
    const token = ++renderToken;
    section.innerHTML = '<div class="settings-card"><p class="settings-hint" style="margin:0">Checking Spotify artist identities…</p></div>';
    const events = await loadListeningEvents();
    if (token !== renderToken || !document.body.contains(section)) return;
    let currentBands = [];
    try { currentBands = Array.isArray(bands) ? bands : []; } catch (_) {}
    const rows = root.ListeningSpotifyIdentityReview.auditSpotifyArtistIdentities(currentBands, events, { identityState: root.ProviderIdentityState });
    const actionable = rows.filter((row) => row.actionState === 'candidate_available').length;
    const acquisition = rows.length - actionable;
    section.innerHTML = `<div class="settings-section-header"><h3>Spotify artist review</h3><p class="settings-hint">${escapeHtml(String(rows.length))} unresolved · ${escapeHtml(String(actionable))} ready to review · ${escapeHtml(String(acquisition))} need candidate acquisition</p></div>
      ${notice ? `<p class="settings-hint spotify-review-notice" role="status">${escapeHtml(notice)}</p>` : ''}
      ${rows.length ? rows.map(rowHtml).join('') : '<div class="settings-card"><p class="settings-hint" style="margin:0">All bands have a trusted Spotify artist identity.</p></div>'}`;
    wireActions(section, rows);
  }

  async function saveDecision(row, action, candidateId) {
    if (!remote) throw new Error('No connection');
    const latestBands = await dlReadJsonFile(remote, 'bands.json', []);
    const result = root.ListeningSpotifyIdentityReview.applySpotifyReviewDecision(latestBands, row, { action, candidateId });
    const messages = {
      missing_band: 'Band no longer exists',
      newer_manual_decision: 'A newer manual decision already exists',
      candidate_missing: 'Candidate is no longer available',
      candidate_set_changed: 'The candidate list changed. Review the refreshed list before deciding.',
      no_change: 'No decision was made',
    };
    if (result.kind !== 'updated') throw new Error(messages[result.kind] || 'The decision could not be saved');
    await dlWriteJsonFile(remote, 'bands.json', result.bands);
    bands = result.bands;
  }

  function wireActions(section, rows) {
    section.querySelectorAll('[data-spotify-review-action]').forEach((button) => button.addEventListener('click', async () => {
      const row = rows.find((item) => item.bandId === button.dataset.bandId);
      if (!row) return;
      button.disabled = true;
      const previous = button.textContent;
      button.textContent = 'Saving…';
      try {
        await saveDecision(row, button.dataset.spotifyReviewAction, button.dataset.candidateId || null);
        notice = button.dataset.spotifyReviewAction === 'confirm' ? `${row.bandName} was linked to Spotify.` : `${row.bandName} candidates were rejected.`;
        await render();
      } catch (error) {
        notice = error?.message || 'The decision could not be saved.';
        button.disabled = false;
        button.textContent = previous;
        await render();
      }
    }));
  }

  const observer = new MutationObserver(() => {
    const screen = document.getElementById('screen-settings');
    if (!screen || screen.classList.contains('hidden')) return;
    if (screen.querySelector('[data-settings-tab="review"].active') && !document.getElementById(SECTION_ID)) render();
  });

  function start() {
    const screen = document.getElementById('screen-settings');
    if (screen) observer.observe(screen, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();

  root.ListeningSpotifyIdentityReviewUi = { render, saveDecision, loadListeningEvents };
})(window);
