/**
 * Scroll Reveal — bidirectional scroll-triggered reveal animations
 * Classic Club PH
 *
 * Uses IntersectionObserver to add/remove the `.is-visible` class on
 * `.cc-reveal` elements whenever they enter or leave the viewport.
 * The animation repeats in both scroll directions.
 */
(function () {
  'use strict';

  // ── Accessibility gate ──
  // If the user prefers reduced motion, make everything visible and bail out.
  var motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (motionQuery && motionQuery.matches) {
    document.addEventListener('DOMContentLoaded', function () {
      var els = document.querySelectorAll('.cc-reveal');
      for (var i = 0; i < els.length; i++) {
        els[i].classList.add('is-visible');
      }
    });
    return;
  }

  // ── Selectors to auto-tag ──
  // Every element matching these selectors inside <main> (or the whole body
  // if no <main> exists) will receive the `.cc-reveal` class automatically
  // so authors don't need to add it by hand.
  var SELECTORS = [
    'section',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p',
    'img',
    'figure',
    'blockquote',
    'ul', 'ol',
    'table',
    'form',
    'nav[aria-label="breadcrumb"]',
    '.card',
    '.btn-cc-teal',
    '.btn-cc-outline',
    '.btn-cc-dark',
    '.cc-asset-box',
    '[class*="col-"]  > div',
    '.d-flex.flex-column.gap-4 > div',
    '.row'
  ];

  // ── Elements to NEVER animate ──
  // These selectors are excluded from auto-tagging to avoid visual glitches,
  // broken layouts, or conflicts with existing behaviour.
  var EXCLUDE_SELECTORS = [
    '#header-partial',
    '#header-partial *',
    '#footer-partial',
    '#footer-partial *',
    '#adminLoadingOverlay',
    '#adminLoadingOverlay *',
    '.toast-container',
    '.toast-container *',
    '.cc-global-loader',
    '.cc-global-loader *',
    '.modal',
    '.modal *',
    '.modal-backdrop',
    '.offcanvas',
    '.offcanvas *',
    '.dropdown-menu',
    '.dropdown-menu *',
    '.tooltip',
    '.popover',
    '[aria-hidden="true"]',
    '.cc-reveal *'           // don't double-tag nested children
  ];

  /**
   * Returns true if the element matches any of the exclude selectors.
   */
  function isExcluded(el) {
    for (var i = 0; i < EXCLUDE_SELECTORS.length; i++) {
      try {
        if (el.matches(EXCLUDE_SELECTORS[i])) return true;
      } catch (_) { /* ignore invalid selectors */ }
    }
    return false;
  }

  /**
   * Tag qualifying elements with the `.cc-reveal` class.
   * Called once on DOMContentLoaded.
   */
  function tagElements() {
    var scope = document.querySelector('main') || document.body;
    var joined = SELECTORS.join(', ');
    var candidates = scope.querySelectorAll(joined);

    for (var i = 0; i < candidates.length; i++) {
      var el = candidates[i];

      // Skip elements that are already tagged or should be excluded.
      if (el.classList.contains('cc-reveal')) continue;
      if (isExcluded(el)) continue;

      // Skip tiny / invisible utility elements (e.g., separators, spacers).
      // We only animate elements that have meaningful rendered size.
      if (el.offsetHeight === 0 && el.offsetWidth === 0) continue;

      el.classList.add('cc-reveal');
    }
  }

  /**
   * Create and start the IntersectionObserver.
   */
  function initObserver() {
    var options = {
      root: null,           // viewport
      rootMargin: '0px 0px -40px 0px', // trigger slightly before bottom edge
      threshold: 0.08       // at least 8% visible
    };

    var observer = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
        } else {
          entry.target.classList.remove('is-visible');
        }
      }
    }, options);

    var elements = document.querySelectorAll('.cc-reveal');
    for (var i = 0; i < elements.length; i++) {
      observer.observe(elements[i]);
    }

    return observer;
  }

  // ── Bootstrap ──
  // Wait for the DOM (and the page loader) before running so we don't
  // cause a flash of hidden content while the loader overlay is active.
  function boot() {
    tagElements();
    initObserver();
  }

  // Expose global refresh function so dynamic pages can re-scan and observe newly added elements
  window.refreshScrollReveal = boot;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
