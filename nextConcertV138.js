'use strict';

// v138 Next Concert ticket presentation. This intentionally overrides only
// the existing countdown card renderer; countdown math, the once-per-second
// tick path, Maps URL construction and OwnedTickets PDF opening remain owned
// by the established app.js / ownedTickets.js code paths.
(function (global) {
  const OUTER_CIRC = 314.159;
  const INNER_CIRC = 238.761;

  function locationLines(concert) {
    const address = String(concert.venueAddress || concert.address || '').trim();
    const city = String(concert.city || '').trim();
    const postal = String(concert.postalCode || concert.postal || concert.zip || '').trim();
    const country = String(concert.country || '').trim();
    const addressLower = address.toLocaleLowerCase();
    const cityLine = [postal, city].filter(Boolean).join(' ').trim();
    const lines = [];
    if (address) lines.push(address);
    if (cityLine && !addressLower.includes(city.toLocaleLowerCase()) && !addressLower.includes(cityLine.toLocaleLowerCase())) lines.push(cityLine);
    if (country && !addressLower.includes(country.toLocaleLowerCase()) && !cityLine.toLocaleLowerCase().includes(country.toLocaleLowerCase())) lines.push(country);
    return lines;
  }

  function ticketOutlineSvg() {
    return `
      <svg class="countdown-ticket-outline" viewBox="0 0 1000 520" preserveAspectRatio="none" aria-hidden="true">
        <path class="countdown-ticket-contour" vector-effect="non-scaling-stroke" d="M40 20 H540 C540 48 562 70 590 70 C618 70 640 48 640 20 H960 V45 C942 45 942 78 960 78 V105 C942 105 942 138 960 138 V165 C942 165 942 198 960 198 V225 C942 225 942 258 960 258 V285 C942 285 942 318 960 318 V345 C942 345 942 378 960 378 V405 C942 405 942 438 960 438 V475 C942 475 942 500 960 500 H640 C640 472 618 450 590 450 C562 450 540 472 540 500 H40 V475 C58 475 58 442 40 442 V415 C58 415 58 382 40 382 V355 C58 355 58 322 40 322 V295 C58 295 58 262 40 262 V235 C58 235 58 202 40 202 V175 C58 175 58 142 40 142 V115 C58 115 58 82 40 82 V55 C58 55 58 20 40 20 Z"></path>
        <line class="countdown-ticket-tear" vector-effect="non-scaling-stroke" x1="590" y1="70" x2="590" y2="450"></line>
      </svg>`;
  }

  function directionsHtml(concert) {
    return `<a class="countdown-v138-directions" href="${escapeAttr(buildGoogleMapsUrl(concert))}" target="_blank" rel="noopener">${icon('mapPin')}<span>Get directions</span></a>`;
  }

  function singleTicketControl(concert, ticket) {
    if (ticket.type === 'url') {
      return `<a class="countdown-v138-ticket-circle" href="${escapeAttr(ticket.url)}" target="_blank" rel="noopener" aria-label="Open tickets">${icon('ticket')}<span>Open tickets</span></a>`;
    }
    return `<div class="countdown-ticket-actions countdown-v138-ticket-actions"><button type="button" class="countdown-v138-ticket-circle countdown-pdf-open-btn" data-concert-id="${escapeAttr(concert.id)}" data-ticket-id="${escapeAttr(ticket.id)}" aria-label="Open tickets">${icon('ticket')}<span>Open tickets</span></button><p class="countdown-ticket-error" aria-live="polite" hidden></p></div>`;
  }

  function multipleTicketControl(concert, tickets) {
    const items = tickets.map((ticket, index) => ticket.type === 'pdf'
      ? `<button type="button" class="countdown-v138-ticket-choice countdown-pdf-open-btn" data-concert-id="${escapeAttr(concert.id)}" data-ticket-id="${escapeAttr(ticket.id)}">${icon('ticket')}Ticket ${index + 1}</button>`
      : `<a class="countdown-v138-ticket-choice" href="${escapeAttr(ticket.url)}" target="_blank" rel="noopener">${icon('ticket')}Ticket link</a>`).join('');
    return `<div class="countdown-ticket-actions countdown-v138-ticket-actions"><details class="countdown-v138-ticket-picker"><summary class="countdown-v138-ticket-circle" aria-label="Open tickets">${icon('ticket')}<span>Open tickets</span></summary><div class="countdown-v138-ticket-menu">${items}</div></details><p class="countdown-ticket-error" aria-live="polite" hidden></p></div>`;
  }

  function showDayStubHtml(concert) {
    const ordered = OwnedTickets.orderedTickets(concert.ownedTickets);
    const pdfs = ordered.filter((item) => item.type === 'pdf').slice(0, 4);
    const usable = pdfs.length ? pdfs : ordered.filter((item) => item.type === 'url').slice(0, 1);
    if (!usable.length) return '<div class="countdown-v138-ticket-none" aria-hidden="true"></div>';
    return usable.length === 1 ? singleTicketControl(concert, usable[0]) : multipleTicketControl(concert, usable);
  }

  function frameHtml(kind, content) {
    return `<div class="countdown-v138-frame countdown-v138-${kind}-frame">${content}</div>`;
  }

  function infoHtml(concert, today) {
    const venueLine = [concert.venue, concert.city].filter(Boolean).join(', ');
    const fullLocation = locationLines(concert);
    return `
      <p class="countdown-v138-label">${today ? 'Show today' : 'Next up'}</p>
      <p class="countdown-v138-band">${escapeHtml(concert.bandName)}</p>
      <span class="countdown-v138-artist-rule" aria-hidden="true"></span>
      ${today
        ? `<p class="countdown-v138-venue countdown-v138-venue-today">${escapeHtml(venueLine)}</p>${directionsHtml(concert)}`
        : `<p class="countdown-v138-venue">${escapeHtml(concert.venue || '')}</p>${fullLocation.map((line) => `<p class="countdown-v138-location-line">${escapeHtml(line)}</p>`).join('')}`}
    `;
  }

  function normalStubHtml(parts) {
    const { days, hours, minutes, seconds, outerPct, innerPct } = parts;
    return `
      <div class="countdown-v138-countdown-group">
        <svg class="countdown-v138-ring" viewBox="0 0 132 132" aria-label="${days} days until concert">
          <circle class="countdown-ring-track countdown-v138-outer-track" cx="66" cy="66" r="50" fill="none" stroke-width="12"></circle>
          <circle id="countdown-ring-outer" class="countdown-v138-outer-progress" data-circ="${OUTER_CIRC}" cx="66" cy="66" r="50" fill="none" stroke-width="12" stroke-linecap="round" transform="rotate(-90 66 66)" stroke-dasharray="${OUTER_CIRC}" stroke-dashoffset="${OUTER_CIRC * (1 - outerPct)}"></circle>
          <circle class="countdown-ring-track countdown-v138-inner-track" cx="66" cy="66" r="38" fill="none" stroke-width="10"></circle>
          <circle id="countdown-ring-inner" class="countdown-v138-inner-progress" data-circ="${INNER_CIRC}" cx="66" cy="66" r="38" fill="none" stroke-width="10" stroke-linecap="round" transform="rotate(-90 66 66)" stroke-dasharray="${INNER_CIRC}" stroke-dashoffset="${INNER_CIRC * (1 - innerPct)}"></circle>
          <circle class="countdown-v138-ring-center" cx="66" cy="66" r="28"></circle>
          <text x="66" y="75" text-anchor="middle" id="countdown-ring-day">${days}</text>
        </svg>
        <p class="countdown-breakdown countdown-v138-breakdown"><span id="countdown-d">${days}</span>d <span id="countdown-h">${String(hours).padStart(2, '0')}</span>h <span id="countdown-m">${String(minutes).padStart(2, '0')}</span>m <span id="countdown-s">${String(seconds).padStart(2, '0')}</span>s</p>
      </div>`;
  }

  function countdownCardV138(nextConcert) {
    if (!nextConcert) {
      return `
        <div class="countdown-card countdown-empty">
          <p class="countdown-empty-text">No upcoming concert marked as attending</p>
        </div>`;
    }

    const time = nextConcert.time ? nextConcert.time.slice(0, 5) : '00:00';
    const targetIso = `${nextConcert.date}T${time}:00`;
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const today = nextConcert.date === todayStr;
    const stub = today ? showDayStubHtml(nextConcert) : normalStubHtml(dlCountdownParts(new Date(targetIso)));

    return `
      <div class="countdown-card countdown-v138-ticket${today ? ' countdown-card-today' : ''}" id="countdown-card" data-target="${escapeAttr(targetIso)}" data-today="${today ? 'true' : 'false'}">
        ${ticketOutlineSvg()}
        ${frameHtml('main', infoHtml(nextConcert, today))}
        ${frameHtml('stub', stub)}
      </div>`;
  }

  global.countdownCardHtml = countdownCardV138;
})(window);
