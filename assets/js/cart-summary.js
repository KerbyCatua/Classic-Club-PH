(function () {
  'use strict';

  const summary = document.querySelector('.cc-cart-summary');
  if (!summary) return;

  function updateStickyOffset() {
    // Center the full stack when it fits. A taller stack scrolls into view
    // before its bottom pins, keeping the promo form and cart advice reachable.
    const gap = 24;
    const availableSpace = window.innerHeight - summary.getBoundingClientRect().height;
    const top = availableSpace >= 0 ? availableSpace / 2 : availableSpace - gap;
    summary.style.setProperty('--cc-cart-summary-top', `${top}px`);
  }

  // Promotions, totals, wrapping and fonts can all change the stack's height.
  const observer = new ResizeObserver(updateStickyOffset);
  observer.observe(summary);
  window.addEventListener('resize', updateStickyOffset, { passive: true });
  updateStickyOffset();
})();
