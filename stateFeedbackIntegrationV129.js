'use strict';

(function installStateFeedbackIntegrationV129(root) {
  if (root.__LIVEVAULT_STATE_FEEDBACK_INTEGRATION_V129__) return;
  root.__LIVEVAULT_STATE_FEEDBACK_INTEGRATION_V129__ = true;

  const feedback = root.LiveVaultInteractionFeedbackV129;
  if (!feedback) return;

  let armedContext = null;
  const pendingContexts = new Set();

  function decoratePastDivider() {
    const screen = document.getElementById('screen-myconcerts');
    if (!screen) return;
    for (const label of screen.querySelectorAll('.section-label')) {
      if (label.textContent?.trim().toLowerCase() !== 'past concerts') continue;
      label.className = 'myconcerts-past-divider';
      label.innerHTML = '<span>Past concerts</span>';
    }
  }

  function wrapMyConcertsRender() {
    if (typeof root.renderMyConcertsScreen !== 'function' || root.renderMyConcertsScreen.__stateFeedbackV129) return;
    const original = root.renderMyConcertsScreen;
    const wrapped = function renderMyConcertsScreenV129(...args) {
      const result = original.apply(this, args);
      decoratePastDivider();
      return result;
    };
    Object.defineProperty(wrapped, '__stateFeedbackV129', { value: true });
    root.renderMyConcertsScreen = wrapped;
  }

  function userActionKey(target) {
    const actionable = target?.closest?.('button, a, [role="button"], input[type="submit"]');
    if (!actionable || actionable.closest('#onboarding')) return null;
    const tab = actionable.closest('.tabitem')?.dataset?.tab;
    if (tab) return `tab:${tab}`;
    if (actionable.id) return `control:${actionable.id}`;
    const href = actionable.getAttribute?.('href');
    if (href && href !== '#') return `link:${href}`;
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

  function finishContext(context) {
    if (context.inFlight > 0 || !context.handle) return;
    if (context.settleTimer) root.clearTimeout(context.settleTimer);
    context.settleTimer = root.setTimeout(() => {
      context.settleTimer = null;
      if (context.inFlight > 0) return;
      pendingContexts.delete(context);
      context.actionable?.removeAttribute?.('aria-busy');
      feedback.end(context.handle);
      context.handle = null;
    }, 0);
  }

  function contextForFetch() {
    if (armedContext) return armedContext;
    if (pendingContexts.size === 1) return pendingContexts.values().next().value;
    return null;
  }

  function installFetchTracking() {
    if (typeof root.fetch !== 'function' || root.fetch.__stateFeedbackV129) return;
    const originalFetch = root.fetch.bind(root);
    const trackedFetch = function trackedFetchV129(...args) {
      const context = contextForFetch();
      if (!context) return originalFetch(...args);

      clearArmed(context);
      if (!context.handle) {
        context.handle = feedback.begin({ key: context.key });
        if (!context.handle) return originalFetch(...args);
        context.actionable?.setAttribute?.('aria-busy', 'true');
        pendingContexts.add(context);
      }
      if (context.settleTimer) {
        root.clearTimeout(context.settleTimer);
        context.settleTimer = null;
      }
      context.inFlight += 1;

      let request;
      try {
        request = originalFetch(...args);
      } catch (error) {
        context.inFlight -= 1;
        finishContext(context);
        throw error;
      }
      return Promise.resolve(request).finally(() => {
        context.inFlight -= 1;
        finishContext(context);
      });
    };
    Object.defineProperty(trackedFetch, '__stateFeedbackV129', { value: true });
    root.fetch = trackedFetch;
  }

  function installUserActionFeedback() {
    if (typeof document === 'undefined' || document.__stateFeedbackV129Installed) return;
    document.__stateFeedbackV129Installed = true;

    document.addEventListener('click', (event) => {
      const app = document.getElementById('app');
      if (!app || app.classList.contains('hidden')) return;
      const actionable = event.target?.closest?.('button, a, [role="button"]');
      if (!actionable || actionable.disabled || actionable.getAttribute('aria-disabled') === 'true') return;
      const key = userActionKey(actionable);
      if (!key) return;

      if (feedback.isPending(key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      if (armedContext) clearArmed(armedContext);
      const context = { key, actionable, handle: null, inFlight: 0, settleTimer: null, armTimer: null };
      armedContext = context;
      context.armTimer = root.setTimeout(() => clearArmed(context), 500);
    }, true);
  }

  function install() {
    wrapMyConcertsRender();
    installFetchTracking();
    installUserActionFeedback();
    if (typeof root.renderMyConcertsScreen === 'function') decoratePastDivider();
  }

  root.addEventListener?.('load', install, { once: true });

  root.LiveVaultStateFeedbackIntegrationV129 = Object.freeze({
    decoratePastDivider,
    userActionKey,
    install,
  });
})(globalThis);
