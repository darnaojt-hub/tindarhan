/**
 * motion.js
 * Neon-rebuild interaction layer: one-shot scroll-reveal entrances,
 * magnetic hover on primary buttons, a tab-switch entrance transition,
 * and animated number count-up for the Reports stat cards.
 *
 * Every piece here is purely additive polish layered on top of content
 * that is already fully visible/functional without it:
 *  - [data-reveal] elements carry no "hidden by default" CSS of their own
 *    (see the .reveal-pending / .reveal-in rules in style.css) -- this
 *    module is the ONLY thing that ever hides them, right before it
 *    reveals them, and it always schedules a fallback timer so a stalled
 *    or missing IntersectionObserver can never leave content invisible.
 *  - Every rAF/interval loop here checks prefers-reduced-motion itself,
 *    since the blanket CSS override elsewhere in the app only neutralises
 *    CSS animations/transitions, not JS-driven ones.
 *  - None of this runs on the silent 6s live-sync poll -- callers only
 *    invoke it from genuine navigation/user moments (tab switches, first
 *    load), matching the same discipline already used for the item grid
 *    and stat pulses.
 */
const Motion = (() => {
  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // ---- Scroll reveal ----
  let revealObserver = null;
  const REVEAL_FALLBACK_MS = 1600;

  function settleReveal(el) {
    el.classList.remove('reveal-pending');
    el.classList.add('reveal-in');
  }

  function observeReveal(root) {
    const scope = (root && root.querySelectorAll) ? root : document;
    const targets = scope.querySelectorAll('[data-reveal]:not(.reveal-in):not(.reveal-pending)');
    if (!targets.length) return;

    if (reducedMotion() || !('IntersectionObserver' in window)) {
      // Nothing to animate with -- leave elements exactly as they already
      // render (fully visible), no class changes needed.
      return;
    }

    if (!revealObserver) {
      revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            settleReveal(entry.target);
            revealObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12 });
    }

    targets.forEach((el) => {
      el.classList.add('reveal-pending');
      revealObserver.observe(el);
      // Safety net: guarantee visibility even if the observer never fires
      // (e.g. an element stuck at zero size) -- this can only reveal, it
      // can never re-hide something already shown.
      setTimeout(() => {
        if (el.classList.contains('reveal-pending')) {
          settleReveal(el);
          revealObserver.unobserve(el);
        }
      }, REVEAL_FALLBACK_MS);
    });
  }

  // ---- Magnetic primary buttons ----
  // A gentle pull toward the cursor, pointer (mouse/trackpad) devices
  // only. Skipped entirely for touch and reduced-motion.
  let magneticInitialized = false;
  function initMagnetic() {
    if (magneticInitialized) return;
    if (reducedMotion()) return;
    if (!(window.matchMedia && window.matchMedia('(pointer: fine)').matches)) return;
    magneticInitialized = true;

    document.addEventListener('pointermove', (e) => {
      document.querySelectorAll('.btn-primary:not(:disabled)').forEach((btn) => {
        const rect = btn.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        const dist = Math.hypot(dx, dy);
        const radius = Math.max(rect.width, rect.height) * 1.3;
        if (dist < radius && dist > 0.01) {
          const pull = (1 - dist / radius) * 7;
          btn.style.transform = 'translate(' + ((dx / dist) * pull).toFixed(1) + 'px, ' + ((dy / dist) * pull).toFixed(1) + 'px)';
        } else if (btn.style.transform) {
          btn.style.transform = '';
        }
      });
    }, { passive: true });
  }

  // ---- Tab-switch entrance ----
  function playTabEnter(panel) {
    if (!panel || reducedMotion()) return;
    panel.classList.remove('tab-panel-in');
    void panel.offsetWidth; // restart the animation even on repeated switches
    panel.classList.add('tab-panel-in');
  }

  // ---- Number count-up ----
  // Animates `el`'s displayed text from whatever number it currently
  // shows to `targetValue`, formatting each frame with `formatFn` (e.g.
  // UI.peso, or String for a plain integer). Falls back to an instant
  // set on first paint, when reduced motion is on, or when the value
  // hasn't actually changed.
  function countUp(el, targetValue, formatFn, duration) {
    if (!el) return;
    const targetText = formatFn(targetValue);
    const raw = (el.textContent || '').replace(/[^0-9.\-]/g, '');
    const from = raw === '' || isNaN(parseFloat(raw)) ? targetValue : parseFloat(raw);

    if (reducedMotion() || from === targetValue) {
      el.textContent = targetText;
      return;
    }

    const start = performance.now();
    const dur = duration || 650;
    function tick(now) {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      el.textContent = formatFn(from + (targetValue - from) * eased);
      if (t < 1) requestAnimationFrame(tick);
      else el.textContent = targetText;
    }
    requestAnimationFrame(tick);
  }

  return { reducedMotion, observeReveal, initMagnetic, playTabEnter, countUp };
})();
