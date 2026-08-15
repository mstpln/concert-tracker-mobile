'use strict';

(function installStateFeedbackIntegrationV129(root) {
  if (root.__LIVEVAULT_STATE_FEEDBACK_INTEGRATION_V129__) return;
  root.__LIVEVAULT_STATE_FEEDBACK_INTEGRATION_V129__ = true;

  const feedback = root.LiveVaultInteractionFeedbackV129;
  if (!feedback) return;

  function installStyles() {
    if (typeof document === 'undefined' || document.getElementById('state-feedback-v129-runtime')) return;
    const style = document.createElement('style');
    style.id = 'state-feedback-v129-runtime';
    style.textContent = `
      @media (prefers-color-scheme: dark) {
        #screen-myconcerts .row-card-mc.is-past { background: #1d2124; }
      }
    `;
    document.head.appendChild(style);
  }

  function decoratePastRowsAndDivider() {
    const screen = document.getElementById('screen-myconcerts');
    if (!screen) return;

    for (const row of screen.querySelectorAll('.row-card-mc')) {
      const attended = row.querySelector('.attended-badge');
      row.classList.toggle('is-past', Boolean(attended));
    }

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
      decoratePastRowsAndDivider();
      return result;
    };
    Object.defineProperty(wrapped, '__stateFeedbackV129', { value: true });
    root.renderMyConcertsScreen = wrapped;
  }

  function userActionKey(target) {
    const actionable = target?.closest?.('button, a, [role="button"], select, input[type="submit"]');
    if (!actionable) return null;
    if (actionable.closest('#onboarding')) return null;
    const tab = actionable.closest('.tabitem')?.dataset?.tab;
    if (tab) return `tab:${tab}`;
    if (actionable.id) return `control:${actionable.id}`;
    const href = actionable.getAttribute?.('href');
    if (href && href !== '#') return `link:${href}`;
    const row = actionable.closest('[data-id], [data-concert-id], [data-band-id]');
    if (row) return `row:${row.dataset.id || row.dataset.concertId || row.dataset.bandId}:${actionable.textContent?.trim() || actionable.tagName}`;
    return `action:${actionable.textContent?.trim() || actionable.getAttribute?.('aria-label') || actionable.tagName}`;
  }

  function installUserActionFeedback() {
    if (typeof document === 'undefined' || document.__stateFeedbackV129Installed) return;
    document.__stateFeedbackV129Installed = true;
    const handles = new WeakMap();

    document.addEventListener('click', (event) => {
      if (!document.getElementById('app') || document.getElementById('app').classList.contains('hidden')) return;
      const actionable = event.target?.closest?.('button, a, [role="button"]');
      if (!actionable || actionable.disabled || actionable.getAttribute('aria-disabled') === 'true') return;
      const key = userActionKey(actionable);
      if (!key) return;

      if (feedback.isPending(key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      const handle = feedback.begin({ key });
      if (!handle) return;
      handles.set(actionable, handle);
      actionable.setAttribute('aria-busy', 'true');

      // Synchronous navigation/rendering completes before the next paint, so
      // it never crosses the controller's 140 ms display threshold. Genuine
      // waits remain pending until the browser reaches an idle turn after the
      // initiating event; overlapping actions are reference-counted by the
      // controller rather than sharing a fragile boolean.
      const finish = () => {
        if (handles.get(actionable) !== handle) return;
        handles.delete(actionable);
        actionable.removeAttribute('aria-busy');
        feedback.end(handle);
      };
      root.setTimeout(finish, 180);
    }, true);
  }

  function install() {
    installStyles();
    wrapMyConcertsRender();
    installUserActionFeedback();
    if (typeof root.renderMyConcertsScreen === 'function') decoratePastRowsAndDivider();
  }

  // uiPerformanceV127 installs after the v72 bootstrap and may replace the
  // My Concerts renderer. Install after the same startup work so this wrapper
  // remains outermost and decorates the final DOM.
  root.addEventListener?.('load', install, { once: true });

  root.LiveVaultStateFeedbackIntegrationV129 = Object.freeze({
    decoratePastRowsAndDivider,
    userActionKey,
    install,
  });
})(globalThis);
