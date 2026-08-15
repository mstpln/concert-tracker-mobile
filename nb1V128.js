'use strict';

(function attachNb1V128(root) {
  function calendarDayDiff(dateString, now = new Date()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateString || ''))) return null;
    const [year, month, day] = dateString.split('-').map(Number);
    const target = Date.UTC(year, month - 1, day);
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((target - today) / 86400000);
  }

  function countdownLabel(concert, now = new Date()) {
    const days = calendarDayDiff(concert?.date, now);
    if (days === null || days < 0) return '';
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    return `${days} days until concert`;
  }

  function addUpcomingCountdown(html, concert, isPast, now = new Date()) {
    if (isPast) return html;
    const label = countdownLabel(concert, now);
    if (!label) return html;
    const kmPattern = /<p class="row-km">([^<]+ away)<\/p>/;
    if (kmPattern.test(html)) {
      return html.replace(kmPattern, `<p class="row-km nb1-concert-meta">$1 <span class="nb1-meta-dot">·</span> ${label}</p>`);
    }
    const addressPattern = /(<a class="venue-address-link"[^>]*>.*?<\/a>)/;
    if (addressPattern.test(html)) {
      return html.replace(addressPattern, `$1<p class="row-km nb1-concert-meta">${label}</p>`);
    }
    const subPattern = /(<p class="row-sub">.*?<\/p>)/;
    return html.replace(subPattern, `$1<p class="row-km nb1-concert-meta">${label}</p>`);
  }

  function wrapBootstrap(api, onReady) {
    if (!api || typeof api.bootstrap !== 'function' || api.__nb1V128BootstrapWrapped) return false;
    const original = api.bootstrap;
    api.bootstrap = async function bootstrapWithNb1V128(...args) {
      try {
        return await original.apply(this, args);
      } finally {
        onReady();
      }
    };
    Object.defineProperty(api, '__nb1V128BootstrapWrapped', {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });
    return true;
  }

  function install() {
    if (typeof root.myConcertRowHtml !== 'function' || root.myConcertRowHtml.__nb1V128Wrapped) return false;
    const original = root.myConcertRowHtml;
    const wrapped = function myConcertRowHtmlNb1V128(concert, isPast, options) {
      return addUpcomingCountdown(original.call(this, concert, isPast, options), concert, isPast);
    };
    Object.defineProperty(wrapped, '__nb1V128Wrapped', { value: true });
    root.myConcertRowHtml = wrapped;
    return true;
  }

  // v72 owns the canonical concert-row compatibility renderer, and v127
  // deliberately installs its performance wrapper only after that async
  // bootstrap finishes. Wrap the already-v127-wrapped bootstrap so NB1 is
  // installed last and cannot be lost to either compatibility layer.
  if (typeof document !== 'undefined') {
    const wrapped = wrapBootstrap(root.LiveVaultV72, install);
    if (!wrapped) document.addEventListener('DOMContentLoaded', install, { once: true });
  }

  root.LiveVaultNb1V128 = Object.freeze({ calendarDayDiff, countdownLabel, addUpcomingCountdown, wrapBootstrap, install });
})(typeof globalThis !== 'undefined' ? globalThis : this);
