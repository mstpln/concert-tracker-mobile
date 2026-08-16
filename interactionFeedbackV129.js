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

  function indicator() {
    return root.document?.getElementById?.('interaction-progress') || null;
  }

  function render() {
    const node = indicator();
    if (!node) return;
    node.classList.toggle('is-active', visible && pendingTokens.size > 0);
    node.setAttribute('aria-hidden', visible && pendingTokens.size > 0 ? 'false' : 'true');
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
    const token = `interaction-${++sequence}`;
    pendingTokens.add(token);
    if (key) pendingKeys.add(key);
    schedule(delayMs);
    return Object.freeze({ token, key });
  }

  function end(handle) {
    if (!handle?.token || !pendingTokens.has(handle.token)) return false;
    pendingTokens.delete(handle.token);
    if (handle.key) pendingKeys.delete(handle.key);
    if (pendingTokens.size === 0) {
      if (timer) {
        root.clearTimeout(timer);
        timer = null;
      }
      visible = false;
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
      end(handle);
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
