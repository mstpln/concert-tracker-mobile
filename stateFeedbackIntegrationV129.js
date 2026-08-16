'use strict';

(function installStateFeedbackIntegrationV129(root) {
  if (root.__LIVEVAULT_STATE_FEEDBACK_INTEGRATION_V129__) return;
  root.__LIVEVAULT_STATE_FEEDBACK_INTEGRATION_V129__ = true;

  const feedback = root.LiveVaultInteractionFeedbackV129;
  if (!feedback) return;

  const ACTIONABLE_SELECTOR = 'button, a, [role="button"], input[type="submit"], .clickable';
  const LOCAL_ACTION_DELAY_MS = 0;
  const LOCAL_ACTION_MIN_VISIBLE_MS = 240;
  const LOCAL_ACTION_FAILSAFE_MS = 10000;
  let armedContext = null;
  const pendingContexts = new Set();

  function ownDataKey(actionable) {
    const entries = Object.entries(actionable?.dataset || {})
      .filter(([, value]) => value !== undefined && value !== '')
      .sort(([a], [b]) => a.localeCompare(b));
    if (!entries.length) return null;
    return entries.map(([name, value]) => `${name}=${value}`).join('&');
  }

  function userActionKey(target) {
    const actionable = target?.closest?.(ACTIONABLE_SELECTOR);
    if (!actionable || actionable.closest('#onboarding')) return null;
    const tab = actionable.closest('.tabitem')?.dataset?.tab;
    if (tab) return `tab:${tab}`;
    if (actionable.id) return `control:${actionable.id}`;
    const href = actionable.getAttribute?.('href');
    if (href && href !== '#') return `link:${href}`;
    const ownData = ownDataKey(actionable);
    if (ownData) return `data:${ownData}`;
    const row = actionable.closest('[data-id], [data-concert-id], [data-band-id]');
    if (row) return `row:${row.dataset.id || row.dataset.concertId || row.dataset.bandId}:${actionable.textContent?.trim() || actionable.tagName}`;
    return `action:${actionable.textContent?.trim() || actionable.getAttribute?.('aria-label') || actionable.tagName}`;
  }

  function clearArmed(context) {
    if (armedContext === context) armedContext = null;
    if (context.armTimer) {
      root.clearTimeout(context.armTimer);
      context.armTimer = null;
    }
  }

  function clearSettlement(context) {
    context.settleGeneration += 1;
    if (context.failsafeTimer) {
      root.clearTimeout(context.failsafeTimer);
      context.failsafeTimer = null;
    }
  }

  function releaseContext(context) {
    if (!context?.handle) return;
    clearArmed(context);
    clearSettlement(context);
    context.observer?.disconnect?.();
    context.observer = null;
    pendingContexts.delete(context);
    context.actionable?.removeAttribute?.('aria-busy');
    feedback.end(context.handle, { minVisibleMs: LOCAL_ACTION_MIN_VISIBLE_MS });
    context.handle = null;
  }

  function scheduleDomSettlement(context) {
    if (!context?.handle || context.inFlight > 0) return;
    const generation = ++context.settleGeneration;
    const settle = () => {
      if (!context.handle || context.inFlight > 0 || generation !== context.settleGeneration) return;
      releaseContext(context);
    };
    if (typeof root.requestAnimationFrame === 'function') {
      root.requestAnimationFrame(() => root.requestAnimationFrame(settle));
    } else {
      root.setTimeout(settle, 0);
    }
  }

  function observeLocalSettlement(context) {
    const target = document.getElementById('content') || document.getElementById('app') || document.body;
    if (typeof root.MutationObserver === 'function' && target) {
      context.observer = new root.MutationObserver(() => scheduleDomSettlement(context));
      context.observer.observe(target, { subtree: true, childList: true, attributes: true, characterData: true });
    }
    scheduleDomSettlement(context);
    context.failsafeTimer = root.setTimeout(() => {
      if (context.handle) releaseContext(context);
    }, LOCAL_ACTION_FAILSAFE_MS);
  }

  /* Async work belongs to a click only while that click is armed. Falling back
     to the sole pending context allowed unrelated background IndexedDB/fetch
     activity to continually adopt an old click and keep its bar alive. */
  function contextForAsyncWork() {
    return armedContext?.handle ? armedContext : null;
  }

  function beginAsyncWork(context) {
    if (!context?.handle) return false;
    clearArmed(context);
    context.settleGeneration += 1;
    context.inFlight += 1;
    return true;
  }

  function endAsyncWork(context) {
    if (!context?.handle) return;
    context.inFlight = Math.max(0, context.inFlight - 1);
    scheduleDomSettlement(context);
  }

  function trackPromise(context, work) {
    if (!beginAsyncWork(context)) return work;
    return Promise.resolve(work).finally(() => endAsyncWork(context));
  }

  function installFetchTracking() {
    if (typeof root.fetch !== 'function' || root.fetch.__stateFeedbackV129) return;
    const originalFetch = root.fetch.bind(root);
    const trackedFetch = function trackedFetchV129(...args) {
      const context = contextForAsyncWork();
      if (!context) return originalFetch(...args);
      let request;
      try {
        request = originalFetch(...args);
      } catch (error) {
        if (beginAsyncWork(context)) endAsyncWork(context);
        throw error;
      }
      return trackPromise(context, request);
    };
    Object.defineProperty(trackedFetch, '__stateFeedbackV129', { value: true });
    root.fetch = trackedFetch;
  }

  function installIndexedDbTracking() {
    const prototype = root.IDBDatabase?.prototype;
    if (!prototype || typeof prototype.transaction !== 'function' || prototype.transaction.__stateFeedbackV130) return;
    const originalTransaction = prototype.transaction;
    const trackedTransaction = function trackedIndexedDbTransactionV130(...args) {
      const context = contextForAsyncWork();
      const transaction = originalTransaction.apply(this, args);
      if (!context || !beginAsyncWork(context)) return transaction;

      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        endAsyncWork(context);
      };
      transaction.addEventListener('complete', finish, { once: true });
      transaction.addEventListener('abort', finish, { once: true });
      return transaction;
    };
    Object.defineProperty(trackedTransaction, '__stateFeedbackV130', { value: true });
    try {
      prototype.transaction = trackedTransaction;
    } catch (_) {}
  }

  function installUserActionFeedback() {
    if (typeof document === 'undefined' || document.__stateFeedbackV129Installed) return;
    document.__stateFeedbackV129Installed = true;

    document.addEventListener('click', (event) => {
      const app = document.getElementById('app');
      if (!app || app.classList.contains('hidden')) return;
      const actionable = event.target?.closest?.(ACTIONABLE_SELECTOR);
      if (!actionable || actionable.disabled || actionable.getAttribute('aria-disabled') === 'true') return;
      const key = userActionKey(actionable);
      if (!key) return;

      if (feedback.isPending(key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      if (armedContext?.handle) releaseContext(armedContext);
      const handle = feedback.begin({ key, delayMs: LOCAL_ACTION_DELAY_MS });
      if (!handle) return;
      const context = {
        key,
        actionable,
        handle,
        inFlight: 0,
        armTimer: null,
        failsafeTimer: null,
        observer: null,
        settleGeneration: 0,
      };
      armedContext = context;
      pendingContexts.add(context);
      actionable.setAttribute?.('aria-busy', 'true');
      /* Keep ownership through the current event turn so synchronous handlers
         can start fetch/IndexedDB work, but do not let later background work
         attach itself to this click. */
      context.armTimer = root.setTimeout(() => clearArmed(context), 0);
      observeLocalSettlement(context);
    }, true);
  }

  function install() {
    installFetchTracking();
    installIndexedDbTracking();
    installUserActionFeedback();
  }

  root.addEventListener?.('load', install, { once: true });

  root.LiveVaultStateFeedbackIntegrationV129 = Object.freeze({
    userActionKey,
    install,
  });
})(globalThis);
