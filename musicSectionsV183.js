'use strict';

// v183 only rearranges the existing DOM after the v167/v169/v181 renderers.
// No saved records, event identities, action handlers or provider calls change.
(function installMusicSectionsV183(root) {
  let musicTab = 'highlights';

  function escapeText(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function dateParts(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
    if (!match) return null;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return { year: year, month: month, day: day, date: date };
  }

  // UTC day serials derived from local calendar parts avoid DST hour changes.
  function calendarDaysSince(date, now) {
    const parts = dateParts(date);
    if (!parts || !(now instanceof Date) || !Number.isFinite(now.getTime())) return null;
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const prior = Date.UTC(parts.year, parts.month - 1, parts.day);
    const days = Math.round((today - prior) / 86400000);
    return days >= 0 ? days : null;
  }

  function lastAttendedModel(items, bandList, now) {
    const eligible = (Array.isArray(items) ? items : []).filter(function (item) {
      return item && dateParts(item.date) && calendarDaysSince(item.date, now) !== null;
    }).sort(function (a, b) {
      const byDate = String(b.date).localeCompare(String(a.date));
      if (byDate) return byDate;
      const byTime = String(b.time || '').localeCompare(String(a.time || ''));
      if (byTime) return byTime;
      const headliner = function (item) {
        return item.lineupRole === 'headliner' ? 1 : 0;
      };
      return headliner(b) - headliner(a);
    });
    if (!eligible.length) return null;
    const event = eligible[0];
    const parts = dateParts(event.date);
    const days = calendarDaysSince(event.date, now);
    const band = (Array.isArray(bandList) ? bandList : []).find(function (item) {
      return item && String(item.id) === String(event.bandId);
    });
    const artist = String(band?.name || event.bandName || 'Unknown artist').trim();
    const formattedDate = new Intl.DateTimeFormat('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric',
    }).format(parts.date).toUpperCase();
    return {
      artist: artist,
      date: event.date,
      formattedDate: formattedDate,
      days: days,
      elapsed: days === 0 ? 'Today' : days === 1 ? '1 day ago' : days + ' days ago',
    };
  }

  function latestAttendedHtml() {
    const records = typeof concerts !== 'undefined' && Array.isArray(concerts) ? concerts : [];
    const knownBands = typeof bands !== 'undefined' && Array.isArray(bands) ? bands : [];
    const live = records.filter(function (concert) {
      return knownBands.some(function (band) { return band.id === concert.bandId; });
    });
    const past = typeof dlMyConcerts === 'function' ? dlMyConcerts(live).past : [];
    const now = typeof dlCurrentDate === 'function' ? dlCurrentDate() : new Date();
    const last = lastAttendedModel(past, knownBands, now);
    if (!last) {
      return '<p class="music-last-label-v183">LAST ATTENDED CONCERT</p>' +
        '<p class="music-last-empty-v183">No attended concerts yet.</p>';
    }
    return '<p class="music-last-label-v183">LAST ATTENDED CONCERT</p>' +
      '<div class="music-last-row-v183">' +
        '<strong class="music-last-artist-v183" title="' + escapeText(last.artist) + '">' + escapeText(last.artist) + '</strong>' +
        '<span class="music-last-elapsed-v183">' + escapeText(last.elapsed) + '</span>' +
      '</div>' +
      '<p class="music-last-date-v183">' + escapeText(last.formattedDate) + '</p>';
  }

  // The existing year-divider DOM is the authority for visible calendar-year
  // labels, event-aware totals and the special "more shows" wording. Moving
  // its first heading (not reconstructing counts) preserves all v182 rules.
  function syncHistoryYear(screen) {
    const header = screen.querySelector(':scope > .music-history-year-v183');
    const tabs = screen.querySelector(':scope > .myconcerts-history-tabs');
    if (!header || !tabs) return;
    const selected = tabs.querySelector('[data-my-history-tab][aria-selected="true"]')?.dataset.myHistoryTab || 'upcoming';
    const panel = screen.querySelector('#my-history-' + selected);
    const dividers = [...(panel?.querySelectorAll('.year-divider') || [])];
    dividers.forEach(function (divider, index) {
      divider.classList.toggle('music-history-first-year-v183', index === 0);
    });
    const first = dividers[0];
    header.hidden = !first;
    header.innerHTML = first ? first.innerHTML : '';
  }

  function selectMusicTab(screen, target, focus, resetScroll) {
    musicTab = target === 'concerts' ? 'concerts' : 'highlights';
    screen.dataset.musicSectionV183 = musicTab;
    const nav = screen.querySelector(':scope > .music-primary-tabs-v183');
    nav?.querySelectorAll('[data-music-section]').forEach(function (button) {
      const active = button.dataset.musicSection === musicTab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      if (active && focus) button.focus();
    });
    const scroll = root.document?.getElementById('content');
    if (scroll && resetScroll) scroll.scrollTop = 0;
  }

  function makePrimaryTabs(doc) {
    const tabs = doc.createElement('div');
    tabs.className = 'stats-subtabs music-primary-tabs-v183';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Music sections');
    tabs.innerHTML =
      '<button type="button" class="stats-subtab-btn" id="music-tab-highlights" ' +
        'data-music-section="highlights" role="tab" aria-controls="music-highlights-v183">Highlights</button>' +
      '<button type="button" class="stats-subtab-btn" id="music-tab-concerts" ' +
        'data-music-section="concerts" role="tab" aria-controls="music-last-v183">Concerts</button>';
    return tabs;
  }

  function organizeMusic() {
    const screen = root.document?.getElementById('screen-myconcerts');
    if (!screen) return false;
    const summary = screen.querySelector(':scope > .myconcerts-summary');
    const oldTabs = screen.querySelector(':scope > .myconcerts-history-tabs');
    if (!summary || !oldTabs) return false;

    const nav = makePrimaryTabs(root.document);
    screen.prepend(nav);
    summary.id = 'music-highlights-v183';
    summary.setAttribute('role', 'tabpanel');
    summary.setAttribute('aria-labelledby', 'music-tab-highlights');

    const last = root.document.createElement('section');
    last.className = 'music-last-v183';
    last.id = 'music-last-v183';
    last.setAttribute('aria-label', 'Last attended concert');
    last.innerHTML = latestAttendedHtml();
    summary.after(last);

    // The old empty countdown still belongs to Concerts even when no next
    // event can be promoted. Moving nodes retains the original handlers.
    const emptyCountdown = summary.querySelector('.countdown-card');
    if (emptyCountdown) last.after(emptyCountdown);

    const year = root.document.createElement('p');
    year.className = 'section-label year-divider music-history-year-v183';
    oldTabs.before(year);
    oldTabs.classList.add('music-history-tabs-v183');
    oldTabs.querySelectorAll('[data-my-history-tab]').forEach(function (button) {
      const key = button.dataset.myHistoryTab;
      button.textContent = key === 'upcoming' ? 'Upcoming' : key === 'past' ? 'Past' : 'Cancelled';
    });
    syncHistoryYear(screen);
    // The v180 history controller switches native hidden panels in place,
    // without re-rendering. Refresh the outside-card year/count after it runs.
    const syncSelectedHistory = function (event) {
      if (event.target.closest('[data-my-history-tab]')) syncHistoryYear(screen);
    };
    oldTabs.addEventListener('click', syncSelectedHistory);
    oldTabs.addEventListener('keydown', syncSelectedHistory);

    [...screen.children].forEach(function (node) {
      if (node !== nav && node !== summary) node.classList.add('music-concert-content-v183');
    });
    nav.querySelectorAll('[data-music-section]').forEach(function (button) {
      button.addEventListener('click', function () {
        selectMusicTab(screen, button.dataset.musicSection, false, true);
      });
      button.addEventListener('keydown', function (event) {
        let next = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          next = button.dataset.musicSection === 'highlights' ? 'concerts' : 'highlights';
        } else if (event.key === 'Home') next = 'highlights';
        else if (event.key === 'End') next = 'concerts';
        if (!next) return;
        event.preventDefault();
        selectMusicTab(screen, next, true, true);
      });
    });
    selectMusicTab(screen, musicTab, false, false);
    return true;
  }

  function organizeBandListening() {
    const screen = root.document?.getElementById('screen-profile');
    const panel = screen?.querySelector('.band-listening-panel');
    const summary = panel?.querySelector(':scope > .listening-summary');
    const timeframe = panel?.querySelector(':scope > .listening-timeframe');
    if (!summary || !timeframe) return false;
    summary.classList.add('music-band-summary-v183');
    timeframe.classList.add('music-band-timeframe-v183');
    summary.prepend(timeframe);
    return true;
  }

  root.MusicSectionsV183 = Object.freeze({
    calendarDaysSince: calendarDaysSince,
    lastAttendedModel: lastAttendedModel,
    organizeMusic: organizeMusic,
    organizeBandListening: organizeBandListening,
  });
  if (typeof module === 'object' && module.exports) module.exports = root.MusicSectionsV183;

  if (typeof root.renderMyConcertsScreen === 'function') {
    const previous = root.renderMyConcertsScreen;
    root.renderMyConcertsScreen = function renderMyConcertsScreenV183() {
      const result = previous.apply(this, arguments);
      organizeMusic();
      return result;
    };
  }
  if (typeof root.renderProfileScreen === 'function') {
    const previous = root.renderProfileScreen;
    root.renderProfileScreen = function renderProfileScreenV183() {
      const result = previous.apply(this, arguments);
      organizeBandListening();
      return result;
    };
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
