'use strict';

// v140 approved Start-screen Next Concert presentation. This layer changes
// presentation only; the existing countdown tick, Maps URL and OwnedTickets
// behavior paths remain authoritative.
(function (global) {
  const RING_CIRC = 333.009;
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

  function isUnknownVenue(value) {
    const normalized = String(value || '').trim().toLocaleLowerCase();
    return !normalized || normalized === 'unknown venue' || normalized === 'venue tba' || normalized === 'tba';
  }

  function displayVenue(concert) {
    const candidates = [concert.venue, concert.venueName, concert.providerVenueName, concert.venueDisplayName];
    return candidates.find((value) => !isUnknownVenue(value)) || String(concert.venue || '').trim();
  }

  function locationLines(concert) {
    const address = String(concert.venueAddress || concert.address || '').trim();
    const city = String(concert.city || '').trim();
    const postal = String(concert.postalCode || concert.postal || concert.zip || '').trim();
    const country = String(concert.country || '').trim();
    const lines = [];
    if (address) lines.push(address);

    const addressLower = address.toLocaleLowerCase();
    const cityLine = [postal, city].filter(Boolean).join(' ').trim();
    const cityLower = city.toLocaleLowerCase();
    const cityLineLower = cityLine.toLocaleLowerCase();
    let locality = '';
    if (cityLine && (!city || !addressLower.includes(cityLower)) && !addressLower.includes(cityLineLower)) locality = cityLine;

    const countryLower = country.toLocaleLowerCase();
    if (country && !addressLower.includes(countryLower) && !locality.toLocaleLowerCase().includes(countryLower)) {
      locality = [locality, country].filter(Boolean).join(', ');
    }
    if (locality) lines.push(locality);
    return lines;
  }

  function formattedConcertDate(date) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
    if (!match) return '';
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    if (!MONTHS[monthIndex] || !Number.isInteger(day) || day < 1 || day > 31) return '';
    return `${day} ${MONTHS[monthIndex]} ${match[1]}`;
  }

  function registeredTicketQuantity(concert) {
    const value = Number(concert.ticketQuantity);
    return Number.isInteger(value) && value > 0 ? value : 0;
  }

  function ticketGeometrySvg() {
    return `
      <svg class="countdown-ticket-outline" viewBox="0 0 820 463" preserveAspectRatio="none" aria-hidden="true">
        <path class="countdown-ticket-contour" vector-effect="non-scaling-stroke" d="M11 1 L441 1 C442 11 452 18 468 18 C484 18 494 11 495 1 L809 1 L809 17 C797 17 797 35 809 35 L809 49 C797 49 797 67 809 67 L809 81 C797 81 797 99 809 99 L809 113 C797 113 797 131 809 131 L809 145 C797 145 797 163 809 163 L809 177 C797 177 797 195 809 195 L809 209 C797 209 797 227 809 227 L809 241 C797 241 797 259 809 259 L809 273 C797 273 797 291 809 291 L809 305 C797 305 797 323 809 323 L809 337 C797 337 797 355 809 355 L809 369 C797 369 797 387 809 387 L809 401 C797 401 797 419 809 419 L809 433 C797 433 797 451 809 451 L809 462 L495 462 C494 452 484 445 468 445 C452 445 442 452 441 462 L11 462 L11 451 C23 451 23 433 11 433 L11 419 C23 419 23 401 11 401 L11 387 C23 387 23 369 11 369 L11 355 C23 355 23 337 11 337 L11 323 C23 323 23 305 11 305 L11 291 C23 291 23 273 11 273 L11 259 C23 259 23 241 11 241 L11 227 C23 227 23 209 11 209 L11 195 C23 195 23 177 11 177 L11 163 C23 163 23 145 11 145 L11 131 C23 131 23 113 11 113 L11 99 C23 99 23 81 11 81 L11 67 C23 67 23 49 11 49 L11 35 C23 35 23 17 11 17 Z"></path>
        <line class="countdown-ticket-tear" vector-effect="non-scaling-stroke" x1="468" y1="28" x2="468" y2="435"></line>
        <rect class="countdown-ticket-inner-frame" vector-effect="non-scaling-stroke" x="56" y="50" width="358" height="363" rx="17"></rect>
        <rect class="countdown-ticket-inner-frame" vector-effect="non-scaling-stroke" x="525" y="50" width="238" height="363" rx="17"></rect>
      </svg>`;
  }

  function directionsHtml(concert) {
    return `<a class="countdown-v139-directions" href="${escapeAttr(buildGoogleMapsUrl(concert))}" target="_blank" rel="noopener">${icon('mapPin')}<span>Get directions</span></a>`;
  }

  function ticketSymbolSvg() {
    return `<svg class="countdown-v139-ticket-symbol" viewBox="0 0 58 42" aria-hidden="true"><path d="M8 4H50A4 4 0 0 1 54 8V13A5 5 0 0 0 54 23V34A4 4 0 0 1 50 38H8A4 4 0 0 1 4 34V23A5 5 0 0 0 4 13V8A4 4 0 0 1 8 4Z" fill="none" stroke="currentColor" stroke-width="2.4"></path><line x1="29" y1="7" x2="29" y2="35" stroke="currentColor" stroke-width="2" stroke-dasharray="3 3"></line></svg>`;
  }

  function singleTicketControl(concert, ticket) {
    const inner = `${ticketSymbolSvg()}<span>Open tickets</span>`;
    if (ticket.type === 'url') {
      return `<a class="countdown-v139-open-ticket" href="${escapeAttr(ticket.url)}" target="_blank" rel="noopener" aria-label="Open tickets">${inner}</a>`;
    }
    return `<div class="countdown-ticket-actions countdown-v139-ticket-actions"><button type="button" class="countdown-v139-open-ticket countdown-pdf-open-btn" data-concert-id="${escapeAttr(concert.id)}" data-ticket-id="${escapeAttr(ticket.id)}" aria-label="Open tickets">${inner}</button><p class="countdown-ticket-error" aria-live="polite" hidden></p></div>`;
  }

  function multipleTicketControl(concert, tickets) {
    const items = tickets.map((ticket, index) => ticket.type === 'pdf'
      ? `<button type="button" class="countdown-v139-ticket-choice countdown-pdf-open-btn" data-concert-id="${escapeAttr(concert.id)}" data-ticket-id="${escapeAttr(ticket.id)}">${ticketSymbolSvg()}Ticket ${index + 1}</button>`
      : `<a class="countdown-v139-ticket-choice" href="${escapeAttr(ticket.url)}" target="_blank" rel="noopener">${ticketSymbolSvg()}Ticket link</a>`).join('');
    return `<div class="countdown-ticket-actions countdown-v139-ticket-actions"><details class="countdown-v139-ticket-picker"><summary class="countdown-v139-open-ticket" aria-label="Open tickets">${ticketSymbolSvg()}<span>Open tickets</span></summary><div class="countdown-v139-ticket-menu">${items}</div></details><p class="countdown-ticket-error" aria-live="polite" hidden></p></div>`;
  }

  function showDayStubHtml(concert) {
    const ordered = OwnedTickets.orderedTickets(concert.ownedTickets);
    const pdfs = ordered.filter((item) => item.type === 'pdf').slice(0, 4);
    const usable = pdfs.length ? pdfs : ordered.filter((item) => item.type === 'url').slice(0, 1);
    if (!usable.length) return '<div class="countdown-v139-ticket-none" aria-hidden="true"></div>';
    return usable.length === 1 ? singleTicketControl(concert, usable[0]) : multipleTicketControl(concert, usable);
  }

  function infoHtml(concert, today) {
    const venue = displayVenue(concert);
    const location = locationLines(concert);
    const city = String(concert.city || '').trim();
    const venueLine = [venue, city].filter(Boolean).join(', ');
    const performances = Array.isArray(concert.eventPerformances) ? concert.eventPerformances : [];
    if (performances.length > 1) {
      const headliner = [...performances].reverse().find((record) => record.lineupRole !== 'support') || performances[performances.length - 1];
      const supports = performances.filter((record) => record.id !== headliner.id);
      return `<div class="countdown-v139-info countdown-v156-grouped-info"><p class="countdown-v139-label">${today ? 'Show today' : 'Next up'}</p><p class="countdown-v139-band countdown-v156-headliner">${escapeHtml(headliner.bandName)}</p><div class="countdown-v156-supports">${supports.map((record) => `<p>${escapeHtml(record.bandName)}</p>`).join('')}</div><span class="countdown-v139-artist-line" aria-hidden="true"></span><p class="countdown-v139-venue">${escapeHtml(venue)}</p>${city ? `<p class="countdown-v139-address">${escapeHtml(city)}</p>` : ''}${today ? directionsHtml(concert) : ''}</div>`;
    }
    const lowerContent = today
      ? `<p class="countdown-v139-show-venue">${escapeHtml(venueLine)}</p>${directionsHtml(concert)}`
      : `<p class="countdown-v139-venue">${escapeHtml(venue)}</p>${location.map((line) => `<p class="countdown-v139-address">${escapeHtml(line)}</p>`).join('')}`;
    return `<div class="countdown-v139-info"><p class="countdown-v139-label">${today ? 'Show today' : 'Next up'}</p><p class="countdown-v139-band">${escapeHtml(concert.bandName)}</p><span class="countdown-v139-artist-line" aria-hidden="true"></span>${lowerContent}</div>`;
  }

  function ticketQuantityHtml(concert, today) {
    if (today) return '';
    const quantity = registeredTicketQuantity(concert);
    if (!quantity) return '';
    const label = quantity === 1 ? '1 TICKET' : `${quantity} TICKETS`;
    const conflict = concert.eventTicketQuantityConflict === true;
    return `<div class="countdown-v140-ticket-count${conflict ? ' countdown-v156-ticket-conflict' : ''}" aria-label="${escapeAttr(`${label.toLocaleLowerCase()}${conflict ? ', grouped ticket counts differ' : ''}`)}"><span class="countdown-v140-ticket-count-line" aria-hidden="true"></span><strong>${label}</strong><span class="countdown-v140-ticket-count-line" aria-hidden="true"></span>${conflict ? '<small>CHECK COUNT</small>' : ''}</div>`;
  }

  function normalStubHtml(parts, concert) {
    const { days, hours, minutes, seconds, innerPct } = parts;
    const offset = RING_CIRC * (1 - innerPct);
    const dateLabel = formattedConcertDate(concert.date);
    const dateSpacer = dateLabel ? `<p class="countdown-v140-date-spacer" aria-hidden="true">${dateLabel}</p>` : '';
    return `<div class="countdown-v139-stub-content"><svg class="countdown-v139-countdown" viewBox="0 0 142 142" aria-label="${days} days until concert"><circle class="countdown-v139-silver" cx="71" cy="71" r="64" fill="none" stroke-width="16"></circle><circle class="countdown-v139-cut" cx="71" cy="71" r="57" fill="none" stroke-width="8"></circle><circle class="countdown-v139-track" cx="71" cy="71" r="53" fill="none" stroke-width="14"></circle><circle id="countdown-ring-outer" class="countdown-v139-hidden-live-ring" data-circ="${RING_CIRC}" cx="71" cy="71" r="53" fill="none" stroke-width="14" transform="rotate(-90 71 71)" stroke-dasharray="${RING_CIRC}" stroke-dashoffset="${offset}"></circle><circle id="countdown-ring-inner" class="countdown-v139-progress" data-circ="${RING_CIRC}" cx="71" cy="71" r="53" fill="none" stroke-width="14" transform="rotate(-90 71 71)" stroke-linecap="butt" stroke-dasharray="${RING_CIRC}" stroke-dashoffset="${offset}"></circle><circle class="countdown-v139-center" cx="71" cy="71" r="37"></circle><text id="countdown-ring-day" x="71" y="81" text-anchor="middle">${days}</text></svg><p class="countdown-breakdown countdown-v139-time"><span id="countdown-d">${days}</span>d <span id="countdown-h">${String(hours).padStart(2, '0')}</span>h <span id="countdown-m">${String(minutes).padStart(2, '0')}</span>m <span id="countdown-s">${String(seconds).padStart(2, '0')}</span>s</p>${dateSpacer}</div>`;
  }

  function concertDateHtml(concert, today) {
    if (today) return '';
    const dateLabel = formattedConcertDate(concert.date);
    return dateLabel ? `<p class="countdown-v140-date">${dateLabel}</p>` : '';
  }

  function countdownCardV140(nextConcert) {
    if (!nextConcert) return `<div class="countdown-card countdown-empty"><p class="countdown-empty-text">No upcoming concert marked as attending</p></div>`;
    const time = nextConcert.time ? nextConcert.time.slice(0, 5) : '00:00';
    const targetIso = `${nextConcert.date}T${time}:00`;
    const now = typeof dlCurrentDate === 'function' ? dlCurrentDate() : new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const today = nextConcert.date === todayStr;
    const stub = today ? showDayStubHtml(nextConcert) : normalStubHtml(dlCountdownParts(new Date(targetIso)), nextConcert);
    return `<div class="countdown-card countdown-v139-ticket countdown-v140-ticket${today ? ' countdown-card-today' : ''}" id="countdown-card" data-target="${escapeAttr(targetIso)}" data-today="${today ? 'true' : 'false'}">${ticketGeometrySvg()}${infoHtml(nextConcert, today)}${ticketQuantityHtml(nextConcert, today)}${concertDateHtml(nextConcert, today)}<div class="countdown-v139-stub">${stub}</div></div>`;
  }

  global.countdownCardHtml = countdownCardV140;
})(window);
