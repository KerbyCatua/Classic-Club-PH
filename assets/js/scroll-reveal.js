/** Shared bidirectional reveals, with individual product-card sequences. */
(function () {
  'use strict';

  var motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  var STAGGER_MS = 120;
  var observer;
  var productObserver;
  var mutationObserver;
  var refreshFrame;
  var revealFrame;
  var observedElements = new Set();
  var products = new Map();
  var pendingProducts = new Set();
  var sequenceEnds = new WeakMap();

  var SELECTORS = [
    'section',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'img', 'figure', 'blockquote', 'ul', 'ol', 'table', 'form',
    'nav[aria-label="breadcrumb"]',
    '.card', '.btn-cc-teal', '.btn-cc-outline', '.btn-cc-dark',
    '.cc-asset-box', '[class*="col-"] > div',
    '.d-flex.flex-column.gap-4 > div', '.row'
  ].join(', ');

  var EXCLUDE_SELECTORS = [
    '#header-partial', '#footer-partial', '#adminLoadingOverlay',
    '.toast-container', '.cc-global-loader', '.modal', '.modal-backdrop',
    '.offcanvas', '.dropdown-menu', '.tooltip', '.popover',
    '[aria-hidden="true"]'
  ].join(', ');

  function untagElement(element) {
    element.classList.remove('cc-reveal', 'is-visible');
    if (observedElements.delete(element)) observer.unobserve(element);
  }

  function resetProduct(state, entry) {
    pendingProducts.delete(state);
    state.intersecting = false;
    state.card.classList.remove('is-visible');
    state.card.style.removeProperty('--cc-product-reveal-delay');
    // Exit above: slide down on the next upward visit. Exit below: slide up.
    if (entry && entry.rootBounds) {
      state.card.style.setProperty('--cc-product-reveal-offset',
        entry.boundingClientRect.bottom <= entry.rootBounds.top ? '-24px' : '24px');
    }
  }

  function revealProducts() {
    revealFrame = null;
    var groups = new Map();
    pendingProducts.forEach(function (state) {
      if (!state.intersecting || !state.card.isConnected) return;
      var group = state.card.closest('.row') || state.card.parentElement;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(state);
    });
    pendingProducts.clear();

    groups.forEach(function (states, group) {
      // DOM order also follows the collection's current filter/sort order.
      states.sort(function (a, b) {
        return a.card.compareDocumentPosition(b.card) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });
      var now = performance.now();
      var next = Math.max(now, sequenceEnds.get(group) || 0);
      states.forEach(function (state) {
        var delay = motionQuery.matches ? 0 : Math.round(next - now);
        state.card.style.setProperty('--cc-product-reveal-delay', delay + 'ms');
        state.card.classList.add('is-visible');
        next += motionQuery.matches ? 0 : STAGGER_MS;
      });
      sequenceEnds.set(group, next);
    });
  }

  function initObservers() {
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        entry.target.classList.toggle('is-visible', entry.isIntersecting);
      });
    }, { rootMargin: '0px 0px -40px 0px', threshold: 0.08 });

    productObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var state = products.get(entry.target);
        if (!state) return;
        if (!entry.isIntersecting) {
          resetProduct(state, entry);
        } else if (!state.intersecting) {
          state.intersecting = true;
          pendingProducts.add(state);
        }
      });
      // Drop the old queue when a grid has left the viewport entirely.
      var activeGroups = new Set();
      products.forEach(function (state) {
        if (state.intersecting) activeGroups.add(state.card.closest('.row') || state.card.parentElement);
      });
      products.forEach(function (state) {
        var group = state.card.closest('.row') || state.card.parentElement;
        if (!activeGroups.has(group)) sequenceEnds.delete(group);
      });
      if (pendingProducts.size && !revealFrame) {
        revealFrame = window.requestAnimationFrame(revealProducts);
      }
    }, { rootMargin: '0px', threshold: 0 });
  }

  function refresh() {
    refreshFrame = null;
    var scope = document.querySelector('main') || document.body;
    if (!('IntersectionObserver' in window)) {
      document.querySelectorAll('.cc-reveal').forEach(function (element) {
        element.classList.add('is-visible');
      });
      return;
    }
    if (!observer) initObservers();

    // Reuse observers on refresh, and release removed wishlist/catalog nodes.
    observedElements.forEach(function (element) {
      if (!element.isConnected) {
        observer.unobserve(element);
        observedElements.delete(element);
      }
    });
    products.forEach(function (state, target) {
      if (!state.card.isConnected || !target.contains(state.card)) {
        resetProduct(state);
        productObserver.unobserve(target);
        products.delete(target);
      }
    });

    scope.querySelectorAll('.cc-product-card').forEach(function (card) {
      if (card.closest(EXCLUDE_SELECTORS)) return;

      // Containers and card contents must not mask the individual reveals.
      var parent = card.parentElement;
      while (parent && parent !== scope) {
        if (parent.classList.contains('cc-reveal')) untagElement(parent);
        parent = parent.parentElement;
      }
      card.querySelectorAll('.cc-reveal').forEach(untagElement);
      if (observedElements.has(card)) untagElement(card);
      card.classList.add('cc-reveal', 'cc-product-reveal');

      // Observe the stationary grid cell, not the translated card itself.
      var target = card.closest('.product-item, .col') || card;
      var state = products.get(target);
      if (state && state.card === card) return;
      if (state) resetProduct(state);
      products.set(target, { card: card, intersecting: false });
      productObserver.observe(target);
    });

    scope.querySelectorAll(SELECTORS).forEach(function (element) {
      if (element.classList.contains('cc-reveal') ||
          element.closest(EXCLUDE_SELECTORS) || element.closest('.cc-reveal') ||
          element.closest('.cc-product-card') || element.querySelector('.cc-product-card')) return;
      if (element.offsetHeight === 0 && element.offsetWidth === 0) return;
      element.classList.add('cc-reveal');
    });
    scope.querySelectorAll('.cc-reveal:not(.cc-product-reveal)').forEach(function (element) {
      if (observedElements.has(element)) return;
      observedElements.add(element);
      observer.observe(element);
    });
  }

  function boot() {
    refresh();
    if (mutationObserver || !('IntersectionObserver' in window)) return;
    // Catalog additions, wishlist replacements, and sorted cards share this path.
    mutationObserver = new MutationObserver(function (records) {
      var changedProducts = records.some(function (record) {
        return Array.from(record.addedNodes).concat(Array.from(record.removedNodes)).some(function (node) {
          return node.nodeType === 1 &&
            (node.matches('.cc-product-card') || node.querySelector('.cc-product-card'));
        });
      });
      if (changedProducts && !refreshFrame) refreshFrame = window.requestAnimationFrame(refresh);
    });
    mutationObserver.observe(document.querySelector('main') || document.body, { childList: true, subtree: true });
  }

  window.refreshScrollReveal = refresh;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
