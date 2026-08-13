'use strict';
// Focused browser-side hardening for external navigation. The app is a
// single-user PWA, so this deliberately stays small: relative/same-origin
// links keep working in local QA, external links must use HTTPS, and every
// new-tab link is isolated from the opener and referrer.
(function (global) {
  const ARTIST_ENRICHMENT_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;

  function baseUrl() {
    return global.location?.href || 'https://livevault.invalid/';
  }

  function safeExternalUrl(value) {
    try {
      const url = new URL(String(value || '').trim(), baseUrl());
      const base = new URL(baseUrl());
      if (url.origin === base.origin && (url.protocol === 'http:' || url.protocol === 'https:')) return url.href;
      return url.protocol === 'https:' ? url.href : null;
    } catch {
      return null;
    }
  }

  function hardenAnchor(anchor) {
    if (!anchor || anchor.tagName !== 'A') return;
    const raw = anchor.getAttribute('href');
    if (!raw || raw.startsWith('#')) return;
    const safe = safeExternalUrl(raw);
    if (!safe) {
      anchor.removeAttribute('href');
      anchor.setAttribute('aria-disabled', 'true');
      return;
    }
    anchor.setAttribute('href', safe);
    if (anchor.target === '_blank') anchor.setAttribute('rel', 'noopener noreferrer');
  }

  function disableExcelExport(root) {
    const button = root?.id === 'export-excel-btn' ? root : root?.querySelector?.('#export-excel-btn');
    button?.remove();
  }

  function hardenTree(root) {
    if (!root) return;
    if (root.tagName === 'A') hardenAnchor(root);
    root.querySelectorAll?.('a').forEach(hardenAnchor);
    disableExcelExport(root);
  }

  function preparePendingArtistEnrichment(band, now = new Date().toISOString()) {
    if (!band || typeof band !== 'object' || !band._enriching || band.artistEnrichment) return band;
    const parsed = Date.parse(now);
    const delay = Number(global.ProviderIdentityState?.artistEnrichment?.RETRY_DELAY_MS) || ARTIST_ENRICHMENT_RETRY_DELAY_MS;
    band.artistEnrichment = {
      status: 'retryable',
      lastAttemptedAt: now,
      nextEligibleCheckAt: new Date((Number.isFinite(parsed) ? parsed : Date.now()) + delay).toISOString(),
      errorCategory: 'pending_enrichment',
    };
    return band;
  }

  function armNextBandCheckpoint() {
    let rows;
    try { rows = bands; } catch (_) { return; }
    if (!Array.isArray(rows)) return;
    const originalPush = rows.push;
    rows.push = function (...items) {
      rows.push = originalPush;
      for (const item of items) preparePendingArtistEnrichment(item);
      return originalPush.apply(rows, items);
    };
  }

  function init(documentRef = global.document) {
    if (!documentRef?.documentElement) return;
    hardenTree(documentRef);
    documentRef.addEventListener('click', (event) => {
      if (event.target?.closest?.('#add-band-submit')) armNextBandCheckpoint();
      const anchor = event.target?.closest?.('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      if (!safeExternalUrl(href)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === 1) hardenTree(node);
        }
      }
    });
    observer.observe(documentRef.documentElement, { childList: true, subtree: true });
  }

  const api = { safeExternalUrl, hardenAnchor, hardenTree, disableExcelExport, preparePendingArtistEnrichment, armNextBandCheckpoint, init };
  global.LiveVaultSecurity = api;
  if (typeof module !== 'undefined') module.exports = api;

  if (global.document) {
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', () => init());
    else init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
