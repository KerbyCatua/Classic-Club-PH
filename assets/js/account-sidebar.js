(function () {
  'use strict';

  const sidebar = document.querySelector('.cc-account-sidebar');
  if (!sidebar) return;

  const desktop = window.matchMedia('(min-width: 992px)');

  function updateStickyPosition() {
    const space = window.innerHeight - sidebar.getBoundingClientRect().height;
    // Keep equal viewport margins when it fits; taller stacks use page scrolling.
    sidebar.style.setProperty('--cc-account-sidebar-top', `${Math.max(0, space / 2)}px`);
    sidebar.toggleAttribute('data-sticky', desktop.matches && space >= 0);
  }

  // Account loading, font loading and text wrapping can change the full height.
  const observer = new ResizeObserver(updateStickyPosition);
  observer.observe(sidebar);
  window.addEventListener('resize', updateStickyPosition, { passive: true });
  updateStickyPosition();
})();
