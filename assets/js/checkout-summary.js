(function () {
  'use strict';

  const summary = document.querySelector('.cc-checkout-summary');
  if (!summary) return;

  function updateStickyOffset() {
    // Center cards that fit, keeping the same sticky boundary at the form end.
    // Taller cards still pin at their bottom so the totals remain reachable.
    const gap = 24;
    const availableSpace = window.innerHeight - summary.getBoundingClientRect().height;
    const top = availableSpace >= 0 ? availableSpace / 2 : availableSpace - gap;
    summary.style.setProperty('--cc-checkout-summary-top', `${top}px`);
  }

  // Cart rendering, image loading and font changes can resize the card.
  const observer = new ResizeObserver(updateStickyOffset);
  observer.observe(summary);
  window.addEventListener('resize', updateStickyOffset, { passive: true });
  updateStickyOffset();
})();
