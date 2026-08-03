'use strict';

// v83 chart correction. This loads after all prior listening compatibility
// layers and owns the final bucket contract plus the yearly-hours axis.
(() => {
  const api = typeof ListeningStats === 'undefined' ? null : ListeningStats;
  if (!api) return;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const DAY_MS = 86400000;

  function validTime(listen) {
    const value = api.listenTimeMs(listen);
    return Number.isFinite(value) ? value : NaN;
  }

  function validDuration(listen) {
    const value = api.validDurationMs(listen);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function startOfBucket(value, kind) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    if (kind === 'day') return start;
    if (kind === 'week') {
      start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
      return start;
    }
    if (kind === 'month') return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    return new Date(Date.UTC(start.getUTCFullYear(), 0, 1));
  }

  function nextBucket(value, kind) {
    const next = new Date(value.getTime());
    if (kind === 'day') next.setUTCDate(next.getUTCDate() + 1);
    else if (kind === 'week') next.setUTCDate(next.getUTCDate() + 7);
    else if (kind === 'month') next.setUTCMonth(next.getUTCMonth() + 1);
    else next.setUTCFullYear(next.getUTCFullYear() + 1);
    return next;
  }

  function bucketLabel(value, kind) {
    const day = (date) => new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);
    if (kind === 'day') return day(value);
    if (kind === 'week') return `${day(value)} - ${day(new Date(value.getTime() + 6 * DAY_MS))}`;
    if (kind === 'month') return new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(value);
    return String(value.getUTCFullYear());
  }

  function timeBuckets(listens, window, kind = window?.bucket || 'year') {
    const startMs = Number(window?.startMs);
    const endMs = Number(window?.endMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
    const first = startOfBucket(startMs, kind);
    const last = startOfBucket(endMs - 1, kind);
    if (!first || !last) return [];

    const grouped = new Map();
    for (const listen of listens || []) {
      const timestamp = validTime(listen);
      if (!api.isValidListen(listen) || timestamp < startMs || timestamp >= endMs) continue;
      const bucket = startOfBucket(timestamp, kind);
      if (!bucket) continue;
      const key = bucket.toISOString();
      const item = grouped.get(key) || { durationMs: 0, listenCount: 0, unknownDurationCount: 0 };
      const durationMs = validDuration(listen);
      item.durationMs += durationMs;
      item.listenCount += 1;
      if (durationMs === 0) item.unknownDurationCount += 1;
      grouped.set(key, item);
    }

    const output = [];
    for (let cursor = first; cursor <= last; cursor = nextBucket(cursor, kind)) {
      const key = cursor.toISOString();
      const item = grouped.get(key) || { durationMs: 0, listenCount: 0, unknownDurationCount: 0 };
      output.push({ startAt: key, label: bucketLabel(cursor, kind), ...item, hours: item.durationMs / 3600000 });
    }
    return output;
  }

  function withAuthoritativeBuckets(result) {
    if (!result?.window) return result;
    const buckets = timeBuckets(result.listens || [], result.window, result.window.bucket);
    return {
      ...result,
      buckets,
      mostActive: buckets.length
        ? [...buckets].sort((a, b) => b.durationMs - a.durationMs || b.listenCount - a.listenCount || String(a.startAt).localeCompare(String(b.startAt)))[0]
        : null,
    };
  }

  function niceAxis(maxValue, targetIntervals = 4) {
    const maximum = Math.max(0, Number(maxValue) || 0);
    if (maximum === 0) return { max: 1, step: 0.25, ticks: [0, 0.25, 0.5, 0.75, 1] };
    const rawStep = maximum / Math.max(2, targetIntervals);
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const fraction = rawStep / magnitude;
    const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
    const step = niceFraction * magnitude;
    const max = Math.ceil(maximum / step) * step;
    const count = Math.round(max / step);
    return { max, step, ticks: Array.from({ length: count + 1 }, (_, index) => index * step) };
  }

  function axisText(value) {
    const number = Number(value) || 0;
    if (Math.abs(number) >= 1000) return `${Math.round(number / 100) / 10}k`;
    return Number.isInteger(number) ? number.toLocaleString('en') : number.toLocaleString('en', { maximumFractionDigits: 1 });
  }

  function svgElement(name, attributes = {}) {
    const node = document.createElementNS(SVG_NS, name);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
    return node;
  }

  function applyFixedYearAxis() {
    if (typeof document === 'undefined' || typeof listeningEvents === 'undefined') return;
    const card = document.querySelector('#screen-stats .yearly-listening-card');
    const svg = card?.querySelector('svg.yearly-line-chart');
    if (!svg) return;

    const activePill = card.querySelector('[data-v81-year-genre].active');
    const genre = activePill?.dataset.v81YearGenre || 'All';
    const allYears = api.yearlyListening(listeningEvents, typeof listeningNow === 'function' ? listeningNow() : new Date(), genre);
    if (!allYears.length) return;

    const oldPoints = [...svg.querySelectorAll('[data-v81-year-point]')];
    const metadata = new Map(oldPoints.map((node) => [Number(node.dataset.v81YearPoint), {
      selected: node.classList.contains('selected'),
      ariaLabel: node.getAttribute('aria-label') || '',
      label: node.querySelector('text')?.textContent || String(node.dataset.v81YearPoint),
    }]));
    const visibleYears = oldPoints.map((node) => Number(node.dataset.v81YearPoint)).filter(Number.isFinite);
    if (!visibleYears.length) return;
    const byYear = new Map(allYears.map((item) => [item.year, item]));
    const visible = visibleYears.map((year) => byYear.get(year)).filter(Boolean);
    if (!visible.length) return;

    const scale = niceAxis(Math.max(...allYears.map((item) => item.hours || 0)));
    const width = 600;
    const height = 210;
    const left = 66;
    const right = 12;
    const top = 18;
    const bottom = 38;
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const x = (index) => left + (visible.length === 1 ? plotWidth / 2 : index * (plotWidth / (visible.length - 1)));
    const y = (hours) => top + (scale.max - Math.max(0, Number(hours) || 0)) * (plotHeight / scale.max);
    const existingLine = svg.querySelector('.chart-line');
    const lineColor = existingLine?.style.stroke || 'currentColor';

    svg.replaceChildren();
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('aria-label', `Yearly listening hours for ${genre}. Fixed y-axis from 0 to ${axisText(scale.max)} hours across all years.`);
    svg.dataset.v83YAxisMax = String(scale.max);
    svg.dataset.v83YAxisGenre = genre;

    const title = svgElement('title');
    title.textContent = `Listening hours by year for ${genre}`;
    svg.appendChild(title);

    for (const tick of scale.ticks) {
      const tickY = y(tick);
      svg.appendChild(svgElement('line', {
        x1: left,
        x2: width - right,
        y1: tickY,
        y2: tickY,
        style: `stroke:currentColor;opacity:${tick === 0 ? 0.28 : 0.14};stroke-width:1`,
      }));
      const text = svgElement('text', {
        x: left - 9,
        y: tickY + 3.5,
        'text-anchor': 'end',
        style: 'fill:currentColor;opacity:.68;font-size:10px',
      });
      text.textContent = axisText(tick);
      svg.appendChild(text);
    }

    svg.appendChild(svgElement('line', {
      x1: left,
      x2: left,
      y1: top,
      y2: height - bottom,
      style: 'stroke:currentColor;opacity:.28;stroke-width:1',
    }));

    const axisLabel = svgElement('text', {
      x: 15,
      y: top + plotHeight / 2,
      transform: `rotate(-90 15 ${top + plotHeight / 2})`,
      'text-anchor': 'middle',
      style: 'fill:currentColor;opacity:.72;font-size:10px;font-weight:600',
    });
    axisLabel.textContent = 'Listening hours';
    svg.appendChild(axisLabel);

    const points = visible.map((item, index) => `${x(index)},${y(item.hours)}`).join(' ');
    svg.appendChild(svgElement('polyline', {
      points,
      class: 'chart-line',
      style: `stroke:${lineColor}`,
    }));

    visible.forEach((item, index) => {
      const saved = metadata.get(item.year) || {};
      const group = svgElement('g', {
        class: `year-point${saved.selected ? ' selected' : ''}`,
        'data-v81-year-point': item.year,
        role: 'button',
        tabindex: '0',
        'aria-label': saved.ariaLabel || `${item.year}: ${axisText(item.hours)} listening hours`,
      });
      group.appendChild(svgElement('circle', {
        cx: x(index),
        cy: y(item.hours),
        r: saved.selected ? 6 : 4,
        style: `stroke:${lineColor};fill:${lineColor}`,
      }));
      const label = svgElement('text', {
        x: x(index),
        y: height - 12,
        'text-anchor': 'middle',
      });
      label.textContent = saved.label || (item.isCurrentYear ? `${item.year} · YTD` : String(item.year));
      group.appendChild(label);
      svg.appendChild(group);
    });
  }

  const previousSelectedStats = api.selectedStats;
  api.timeBuckets = timeBuckets;
  if (typeof previousSelectedStats === 'function') {
    api.selectedStats = function selectedStatsV83(...args) {
      return withAuthoritativeBuckets(previousSelectedStats.apply(this, args));
    };
  }
  globalThis.ListeningV83ChartFix = { timeBuckets, withAuthoritativeBuckets, niceAxis, applyFixedYearAxis };

  if (typeof document !== 'undefined' && typeof renderStatsScreen === 'function') {
    const previousRenderStatsScreen = renderStatsScreen;
    renderStatsScreen = function renderStatsScreenV83(...args) {
      const result = previousRenderStatsScreen.apply(this, args);
      try { applyFixedYearAxis(); } catch (_) {}
      return result;
    };
    document.addEventListener('DOMContentLoaded', () => {
      try { applyFixedYearAxis(); } catch (_) {}
    });
  }
})();

if (typeof module === 'object' && module.exports) module.exports = globalThis.ListeningV83ChartFix;
