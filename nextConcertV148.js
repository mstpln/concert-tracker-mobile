'use strict';

// v148 normal-day Next Concert visual correction. The v140/v146 renderers
// remain the behavior owners; this layer only replaces the visually masked
// right inner-frame stroke with an exact overlay using the same SVG geometry
// and non-scaling 3px stroke contract as the existing left inner frame.
(function attachNextConcertV148(global) {
  const previousCountdownCardHtml = global.countdownCardHtml;
  if (typeof previousCountdownCardHtml !== 'function') return;

  const rightFramePattern = /<rect class="countdown-ticket-inner-frame" vector-effect="non-scaling-stroke" x="525" y="50" width="238" height="363" rx="17"><\/rect>/;
  const overlay = '<svg class="countdown-v148-right-frame-overlay" viewBox="0 0 820 463" preserveAspectRatio="none" aria-hidden="true"><rect class="countdown-v148-right-frame" vector-effect="non-scaling-stroke" x="525" y="50" width="238" height="363" rx="17"></rect></svg>';

  function addMatchedRightFrame(html) {
    if (!html.includes('data-today="false"')) return html;

    let next = html.replace(
      rightFramePattern,
      '<rect class="countdown-ticket-inner-frame countdown-v148-right-frame-base" vector-effect="non-scaling-stroke" x="525" y="50" width="238" height="363" rx="17"></rect>',
    );
    if (next === html) return html;

    next = next.replace(
      '</svg><div class="countdown-v139-info">',
      `</svg>${overlay}<div class="countdown-v139-info">`,
    );
    return next;
  }

  global.countdownCardHtml = function countdownCardHtmlV148(nextConcert) {
    const html = previousCountdownCardHtml(nextConcert);
    if (!nextConcert) return html;
    return addMatchedRightFrame(html);
  };

  global.NextConcertV148 = Object.freeze({ addMatchedRightFrame });
})(window);
