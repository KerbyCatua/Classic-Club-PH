(function () {
  'use strict';

  const summary = document.querySelector('.cc-confirmation-summary');
  if (!summary) return;

  function updateStickyOffset() {
    // Center the card and actions together when they fit. On short screens,
    // let the whole stack scroll into view before pinning its bottom.
    const gap = 24;
    const availableSpace = window.innerHeight - summary.getBoundingClientRect().height;
    const top = availableSpace >= 0 ? availableSpace / 2 : availableSpace - gap;
    summary.style.setProperty('--cc-confirmation-summary-top', `${top}px`);
  }

  // Order hydration, conditional actions and fonts can change the stack height.
  const observer = new ResizeObserver(updateStickyOffset);
  observer.observe(summary);
  window.addEventListener('resize', updateStickyOffset, { passive: true });
  updateStickyOffset();
})();
