(function () {
  'use strict';

  const perspective = document.querySelector('.cc-review-perspective');
  if (!perspective) return;

  function updateStickyOffset() {
    // Center the complete intro when it fits. On shorter screens, scroll
    // through it before pinning its bottom so the contact link stays reachable.
    const space = window.innerHeight - perspective.getBoundingClientRect().height;
    const top = space >= 0 ? space / 2 : space - 24;
    perspective.style.setProperty('--cc-review-perspective-top', `${top}px`);
  }

  // Product hydration, font loading and wrapping can change the intro's height.
  const observer = new ResizeObserver(updateStickyOffset);
  observer.observe(perspective);
  window.addEventListener('resize', updateStickyOffset, { passive: true });
  updateStickyOffset();
})();
