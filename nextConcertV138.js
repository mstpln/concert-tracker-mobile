'use strict';

// v139 correction: reproduce the approved ticket geometry while preserving
// the existing countdown tick, Maps URL and OwnedTickets behavior paths.
(function (global) {
  const RING_CIRC = 333.009;

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
    const cityLine = [postal, city].filter(Boolean).join(' ').trim();
    const addressLower = address.toLocaleLowerCase();
    if (cityLine && (!city || !addressLower.includes(city.toLocaleLowerCase())) && !addressLower.includes(cityLine.toLocaleLowerCase())) lines.push(cityLine);
    if (country && !addressLower.includes(country.toLocaleLowerCase()) && !cityLine.toLocaleLowerCase().includes(country.toLocaleLowerCase())) lines.push(country);
    return lines;
  }

  function ticketGeometrySvg() {
    return `
      <svg class="countdown-ticket-outline" viewBox="0 0 820 386" preserveAspectRatio="none" aria-hidden="true">
        <path class="countdown-ticket-contour" vector-effect="non-scaling-stroke" d="M0 1 L441 1 C442 15 452 24 468 24 C484 24 494 15 495 1 L820 1 L820 17 C808 17 808 35 820 35 L820 49 C808 49 808 67 820 67 L820 81 C808 81 808 99 820 99 L820 113 C808 113 808 131 820 131 L820 145 C808 145 808 163 820 163 L820 177 C808 177 808 195 820 195 L820 209 C808 209 808 227 820 227 L820 241 C808 241 808 259 820 259 L820 273 C808 273 808 291 820 291 L820 305 C808 305 808 323 820 323 L820 337 C808 337 808 355 820 355 L820 385 L495 385 C494 371 484 362 468 362 C452 362 442 371 441 385 L0 385 L0 355 C12 355 12 337 0 337 L0 323 C12 323 12 305 0 305 L0 291 C12 291 12 273 0 273 L0 259 C12 259 12 241 0 241 L0 227 C12 227 12 209 0 209 L0 195 C12 195 12 177 0 177 L0 163 C12 163 12 145 0 145 L0 131 C12 131 12 113 0 113 L0 99 C12 99 12 81 0 81 L0 67 C12 67 12 49 0 49 L0 35 C12 35 12 17 0 17 Z"></path>
        <path class="countdown-ticket-stub-fill" d="M495 3 L817 3 L817 17 C805 17 805 35 817 35 L817 49 C805 49 805 67 817 67 L817 81 C805 81 805 99 817 99 L817 113 C805 113 805 131 817 131 L817 145 C805 145 805 163 817 163 L817 177 C805 177 805 195 817 195 L817 209 C805 209 805 227 817 227 L817 241 C805 241 805 259 817 259 L817 273 C805 273 805 291 817 291 L817 305 C805 305 805 323 817 323 L817 337 C805 337 805 355 817 355 L817 383 L495 383 C494 371 484 362 468 362 L468 24 C484 24 494 15 495 3 Z"></path>
        <line class="countdown-ticket-tear" vector-effect="non-scaling-stroke" x1="468" y1="33" x2="468" y2="353"></line>
        <rect class="countdown-ticket-inner-frame" vector-effect="non-scaling-stroke" x="56" y="50" width="358" height="286" rx="17"></rect>
        <rect class="countdown-ticket-inner-frame" vector-effect="non-scaling-stroke" x="525" y="50" width="238" height="286" rx="17"></rect>
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
    const lowerContent = today
      ? `<p class="countdown-v139-show-venue">${escapeHtml(venueLine)}</p>${directionsHtml(concert)}`
      : `<p class="countdown-v139-venue">${escapeHtml(venue)}</p>${location.map((line) => `<p class="countdown-v139-address">${escapeHtml(line)}</p>`).join('')}`;
    return `<div class="countdown-v139-info"><p class="countdown-v139-label">${today ? 'Show today' : 'Next up'}</p><p class="countdown-v139-band">${escapeHtml(concert.bandName)}</p><span class="countdown-v139-artist-line" aria-hidden="true"></span>${lowerContent}</div>`;
  }

  function normalStubHtml(parts) {
    const { days, hours, minutes, seconds, innerPct } = parts;
    const offset = RING_CIRC * (1 - innerPct);
    return `<div class="countdown-v139-stub-content"><svg class="countdown-v139-countdown" viewBox="0 0 142 142" aria-label="${days} days until concert"><circle class="countdown-v139-silver" cx="71" cy="71" r="64" fill="none" stroke-width="14"></circle><circle class="countdown-v139-cut" cx="71" cy="71" r="57" fill="none" stroke-width="8"></circle><circle class="countdown-v139-track" cx="71" cy="71" r="53" fill="none" stroke-width="12"></circle><circle id="countdown-ring-outer" class="countdown-v139-hidden-live-ring" data-circ="${RING_CIRC}" cx="71" cy="71" r="53" fill="none" stroke-width="12" transform="rotate(-90 71 71)" stroke-dasharray="${RING_CIRC}" stroke-dashoffset="${offset}"></circle><circle id="countdown-ring-inner" class="countdown-v139-progress" data-circ="${RING_CIRC}" cx="71" cy="71" r="53" fill="none" stroke-width="12" transform="rotate(-90 71 71)" stroke-linecap="butt" stroke-dasharray="${RING_CIRC}" stroke-dashoffset="${offset}"></circle><circle class="countdown-v139-center" cx="71" cy="71" r="39"></circle><text id="countdown-ring-day" x="71" y="82" text-anchor="middle">${days}</text></svg><p class="countdown-breakdown countdown-v139-time"><span id="countdown-d">${days}</span>d <span id="countdown-h">${String(hours).padStart(2, '0')}</span>h <span id="countdown-m">${String(minutes).padStart(2, '0')}</span>m <span id="countdown-s">${String(seconds).padStart(2, '0')}</span>s</p></div>`;
  }

  function countdownCardV139(nextConcert) {
    if (!nextConcert) return `<div class="countdown-card countdown-empty"><p class="countdown-empty-text">No upcoming concert marked as attending</p></div>`;
    const time = nextConcert.time ? nextConcert.time.slice(0, 5) : '00:00';
    const targetIso = `${nextConcert.date}T${time}:00`;
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const today = nextConcert.date === todayStr;
    const stub = today ? showDayStubHtml(nextConcert) : normalStubHtml(dlCountdownParts(new Date(targetIso)));
    return `<div class="countdown-card countdown-v139-ticket${today ? ' countdown-card-today' : ''}" id="countdown-card" data-target="${escapeAttr(targetIso)}" data-today="${today ? 'true' : 'false'}">${ticketGeometrySvg()}${infoHtml(nextConcert, today)}<div class="countdown-v139-stub">${stub}</div></div>`;
  }

  global.countdownCardHtml = countdownCardV139;
})(window);
