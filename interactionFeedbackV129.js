'use strict';

(function attachInteractionFeedbackV129(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LiveVaultInteractionFeedbackV129 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const DEFAULT_DELAY_MS = 140;
  const pendingTokens = new Set();
  const pendingKeys = new Set();
  let sequence = 0;
  let visible = false;
  let timer = null;
  let hideTimer = null;

  function indicator() {
    return root.document?.getElementById?.('interaction-progress') || null;
  }

  function render() {
    const node = indicator();
    if (!node) return;
    const active = visible && (pendingTokens.size > 0 || !!hideTimer);
    node.classList.toggle('is-active', active);
    node.setAttribute('aria-hidden', active ? 'false' : 'true');
  }

  function clearHideTimer() {
    if (!hideTimer) return;
    root.clearTimeout(hideTimer);
    hideTimer = null;
  }

  function schedule(delayMs = DEFAULT_DELAY_MS) {
    if (visible || timer || pendingTokens.size === 0) return;
    const delay = Math.max(0, Number(delayMs) || 0);
    if (delay === 0) {
      visible = true;
      render();
      return;
    }
    timer = root.setTimeout(() => {
      timer = null;
      if (!pendingTokens.size) return;
      visible = true;
      render();
    }, delay);
  }

  function begin({ key = null, delayMs = DEFAULT_DELAY_MS } = {}) {
    if (key && pendingKeys.has(key)) return null;
    clearHideTimer();
    const token = `interaction-${++sequence}`;
    pendingTokens.add(token);
    if (key) pendingKeys.add(key);
    schedule(delayMs);
    return Object.freeze({ token, key, startedAt: Date.now() });
  }

  function end(handle, options = {}) {
    if (!handle?.token || !pendingTokens.has(handle.token)) return false;
    pendingTokens.delete(handle.token);
    if (handle.key) pendingKeys.delete(handle.key);
    if (pendingTokens.size === 0) {
      if (timer) {
        root.clearTimeout(timer);
        timer = null;
      }
      const minimum = Math.max(0, Number(options.minVisibleMs) || 0);
      const elapsed = Date.now() - (Number(handle.startedAt) || Date.now());
      const remaining = visible ? Math.max(0, minimum - elapsed) : 0;
      clearHideTimer();
      if (remaining > 0) {
        hideTimer = root.setTimeout(() => {
          hideTimer = null;
          if (!pendingTokens.size) visible = false;
          render();
        }, remaining);
      } else {
        visible = false;
      }
    }
    render();
    return true;
  }

  async function run(key, work, options = {}) {
    const handle = begin({ key, delayMs: options.delayMs });
    if (!handle) return { duplicate: true, value: undefined };
    try {
      return { duplicate: false, value: await work() };
    } finally {
      end(handle, { minVisibleMs: options.minVisibleMs });
    }
  }

  function isPending(key) {
    return key ? pendingKeys.has(key) : pendingTokens.size > 0;
  }

  function snapshot() {
    return Object.freeze({ pending: pendingTokens.size, visible, keys: [...pendingKeys] });
  }

  return Object.freeze({ begin, end, run, isPending, snapshot, DEFAULT_DELAY_MS });
});
