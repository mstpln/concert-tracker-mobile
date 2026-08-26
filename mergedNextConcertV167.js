'use strict';

(function installMergedNextConcertV167(root) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  let ticker = null;

  function localDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function countdownParts(target, now) {
    const diff = Math.max(0, target.getTime() - now.getTime());
    const days = Math.floor(diff / DAY_MS);
    const hours = Math.floor((diff % DAY_MS) / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    return { days, hours, minutes, seconds };
  }

  function distanceText(card) {
    const row = card?.querySelector('.row-km');
    if (!row) return '';
    const firstPart = String(row.textContent || '').split('·')[0].trim();
    return /\bkm\b/i.test(firstPart) ? firstPart : '';
  }

  function bannerHtml({ today, target, dateKey, distance }) {
    if (today) {
      return `<div class="next-concert-banner-v167 is-concert-day"><strong>CONCERT DAY</strong>${distance ? `<span>${escapeHtml(distance)}</span>` : ''}</div>`;
    }
    const parts = countdownParts(target, typeof dlCurrentDate === 'function' ? dlCurrentDate() : new Date());
    return `<div class="next-concert-banner-v167" data-next-concert-target="${escapeAttr(target.toISOString())}" data-next-concert-date="${escapeAttr(dateKey)}"><strong><span class="next-concert-days-v167">${parts.days}</span> DAYS LEFT</strong><span class="next-concert-live-v167"><span data-v167-hours>${String(parts.hours).padStart(2, '0')}</span>h <span data-v167-minutes>${String(parts.minutes).padStart(2, '0')}</span>m <span data-v167-seconds>${String(parts.seconds).padStart(2, '0')}</span>s</span>${distance ? `<span class="next-concert-distance-v167">${escapeHtml(distance)}</span>` : ''}</div>`;
  }

  function updateCountdownBanner() {
    const banner = root.document?.querySelector('#screen-myconcerts .next-concert-banner-v167[data-next-concert-target]');
    if (!banner) return;
    const target = new Date(banner.dataset.nextConcertTarget || '');
    if (!Number.isFinite(target.getTime())) return;
    const now = typeof dlCurrentDate === 'function' ? dlCurrentDate() : new Date();
    if (banner.dataset.nextConcertDate && banner.dataset.nextConcertDate === localDateKey(now)) {
      if (typeof root.renderMyConcertsScreen === 'function') root.renderMyConcertsScreen();
      return;
    }
    const parts = countdownParts(target, now);
    const days = banner.querySelector('.next-concert-days-v167');
    const hours = banner.querySelector('[data-v167-hours]');
    const minutes = banner.querySelector('[data-v167-minutes]');
    const seconds = banner.querySelector('[data-v167-seconds]');
    if (days) days.textContent = String(parts.days);
    if (hours) hours.textContent = String(parts.hours).padStart(2, '0');
    if (minutes) minutes.textContent = String(parts.minutes).padStart(2, '0');
    if (seconds) seconds.textContent = String(parts.seconds).padStart(2, '0');
  }

  function ensureTicker() {
    if (ticker || typeof root.setInterval !== 'function') return;
    ticker = root.setInterval(updateCountdownBanner, 1000);
  }

  function directSectionLabel(container, text) {
    return [...(container?.children || [])].find((node) => node.classList?.contains('section-label') && String(node.textContent || '').trim().toLowerCase() === text);
  }

  function firstUpcomingCard(upcomingLabel) {
    let node = upcomingLabel?.nextElementSibling || null;
    while (node) {
      if (node.classList?.contains('row-card-mc')) return node;
      if (node.classList?.contains('section-label') && !node.classList.contains('year-divider')) return null;
      node = node.nextElementSibling;
    }
    return null;
  }

  function precedingYearDivider(card, stopNode) {
    let node = card?.previousElementSibling || null;
    while (node && node !== stopNode) {
      if (node.classList?.contains('year-divider')) return node;
      node = node.previousElementSibling;
    }
    return null;
  }

  function remainingSameYearDivider(sourceDivider, upcomingLabel) {
    const next = upcomingLabel?.nextElementSibling;
    if (!sourceDivider || !next?.classList?.contains('row-card-mc')) return null;
    const clone = sourceDivider.cloneNode(true);
    clone.classList.add('year-divider-v167-upcoming');
    const countNode = clone.querySelector('.year-divider-count');
    const raw = String(countNode?.textContent || '').match(/\d+/);
    const originalCount = raw ? Number(raw[0]) : 0;
    const remaining = Math.max(0, originalCount - 1);
    if (!remaining) return null;
    if (countNode) countNode.textContent = `${remaining} ${remaining === 1 ? 'show' : 'shows'}`;
    return clone;
  }

  function moveConcertDayActions(countdown, card) {
    if (!countdown || !card) return;
    const directions = countdown.querySelector('.countdown-v139-directions');
    const ticket = countdown.querySelector('.countdown-v139-ticket-actions') || countdown.querySelector('.countdown-v139-open-ticket');
    if (!directions && !ticket) return;

    const actions = root.document.createElement('div');
    actions.className = 'next-concert-actions-v167';
    actions.addEventListener('click', (event) => event.stopPropagation());
    if (directions) {
      directions.classList.add('next-concert-directions-v167');
      actions.append(directions);
    }
    if (ticket) {
      ticket.classList.add('next-concert-ticket-v167');
      actions.append(ticket);
    }

    const listening = card.querySelector('.concert-listening-row');
    const prep = card.querySelector('.concert-prep-group');
    (listening || prep || card.querySelector('.delete-corner-btn'))?.before(actions);
  }

  function applyCapacityTone(card) {
    card?.querySelectorAll('.venue-max-capacity-concert').forEach((node) => node.classList.add('venue-max-capacity-next-v167'));
  }

  function applyMergedPresentation() {
    const container = root.document?.getElementById('screen-myconcerts');
    if (!container) return false;
    const summary = container.querySelector(':scope > .myconcerts-summary');
    const countdown = summary?.querySelector('#countdown-card');
    const upcomingLabel = directSectionLabel(container, 'upcoming concerts');
    const card = firstUpcomingCard(upcomingLabel);
    if (!summary || !countdown || !upcomingLabel || !card) return false;

    const nextLabel = summary.querySelector('.section-label-v152-next') || root.document.createElement('p');
    nextLabel.className = 'section-label section-label-v152-next section-label-v167-next';
    nextLabel.textContent = 'Next concert';
    summary.after(nextLabel);

    const yearDivider = precedingYearDivider(card, upcomingLabel);
    if (yearDivider) nextLabel.after(yearDivider);
    (yearDivider || nextLabel).after(card);
    card.after(upcomingLabel);

    const remainingDivider = remainingSameYearDivider(yearDivider, upcomingLabel);
    if (remainingDivider) upcomingLabel.after(remainingDivider);
    else {
      const following = upcomingLabel.nextElementSibling;
      if (!following || (!following.classList.contains('row-card-mc') && !following.classList.contains('year-divider'))) upcomingLabel.remove();
    }

    card.classList.add('next-concert-merged-v167');
    const distance = distanceText(card);
    card.querySelector('.row-km')?.remove();

    const rawTarget = countdown.dataset.target || '';
    const target = new Date(rawTarget);
    const now = typeof dlCurrentDate === 'function' ? dlCurrentDate() : new Date();
    const datePart = rawTarget.slice(0, 10);
    const today = countdown.dataset.today === 'true' || (datePart && datePart === localDateKey(now));
    if (Number.isFinite(target.getTime())) card.insertAdjacentHTML('afterbegin', bannerHtml({ today, target, dateKey: datePart, distance }));
    if (today) moveConcertDayActions(countdown, card);
    applyCapacityTone(card);
    countdown.remove();
    ensureTicker();
    updateCountdownBanner();
    return true;
  }

  const api = Object.freeze({ countdownParts, distanceText, applyMergedPresentation, updateCountdownBanner });
  root.MergedNextConcertV167 = api;

  if (typeof root.renderMyConcertsScreen === 'function') {
    const render = root.renderMyConcertsScreen;
    root.renderMyConcertsScreen = function renderMyConcertsScreenV167(...args) {
      const result = render.apply(this, args);
      applyMergedPresentation();
      return result;
    };
  }

  applyMergedPresentation();
})(typeof globalThis !== 'undefined' ? globalThis : this);
