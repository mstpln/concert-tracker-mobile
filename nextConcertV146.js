'use strict';

// v146 normal-day Next Concert presentation. The established v140/v141
// renderer remains the behavior owner; this layer only adds the approved
// calendar treatment and subtly softened normal-day outer contour.
(function attachNextConcertV146(global) {
  const previousCountdownCardHtml = global.countdownCardHtml;
  if (typeof previousCountdownCardHtml !== 'function') return;

  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const PERFORATION_TOPS = Array.from({ length: 14 }, (_, index) => 17 + (index * 32));

  function formattedConcertDate(date) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
    if (!match) return '';
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);
    if (!MONTHS[monthIndex] || !Number.isInteger(day) || day < 1 || day > 31) return '';
    return `${day} ${MONTHS[monthIndex]} ${match[1]}`;
  }

  function roundedNormalContourPath() {
    let path = 'M11 1 L441 1 C442 11 452 18 468 18 C484 18 494 11 495 1 L809 1';
    for (const top of PERFORATION_TOPS) {
      const bottom = top + 18;
      path += ` L809 ${top - 4} Q809 ${top} 805 ${top} C795 ${top} 795 ${bottom} 805 ${bottom} Q809 ${bottom} 809 ${bottom + 4}`;
    }
    path += ' L809 462 L495 462 C494 452 484 445 468 445 C452 445 442 452 441 462 L11 462';
    for (const top of [...PERFORATION_TOPS].reverse()) {
      const bottom = top + 18;
      path += ` L11 ${bottom + 4} Q11 ${bottom} 15 ${bottom} C25 ${bottom} 25 ${top} 15 ${top} Q11 ${top} 11 ${top - 4}`;
    }
    return `${path} L11 1 Z`;
  }

  function addNormalDayPresentation(html, concert) {
    if (!html.includes('data-today="false"')) return html;

    const dateLabel = formattedConcertDate(concert?.date);
    const contour = `<path class="countdown-v146-ticket-contour" vector-effect="non-scaling-stroke" d="${roundedNormalContourPath()}"></path>`;
    let next = html.replace(
      /(<path class="countdown-ticket-contour"[^>]*><\/path>)/,
      `$1${contour}`,
    );

    const calendarHead = `<div class="countdown-v146-calendar-head" aria-hidden="true"><span class="countdown-v146-calendar-label">DATE</span><span class="countdown-v146-calendar-date">${dateLabel}</span></div>`;
    next = next.replace(
      '<div class="countdown-v139-stub"><div class="countdown-v139-stub-content">',
      `<div class="countdown-v139-stub countdown-v146-calendar-stub">${calendarHead}<div class="countdown-v139-stub-content">`,
    );
    return next;
  }

  global.countdownCardHtml = function countdownCardHtmlV146(nextConcert) {
    const html = previousCountdownCardHtml(nextConcert);
    if (!nextConcert) return html;
    return addNormalDayPresentation(html, nextConcert);
  };

  global.NextConcertV146 = Object.freeze({ formattedConcertDate, roundedNormalContourPath });
})(window);
