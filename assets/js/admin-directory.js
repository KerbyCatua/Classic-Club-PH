function initDashboardDirectory() {
  const directory = document.getElementById('module-directory');
  const main = directory.closest('main');
  const modules = Array.from(directory.querySelectorAll('.admin-module-link'), link => ({
    link,
    section: document.getElementById(link.hash.slice(1)),
    label: link.querySelector('span').textContent.trim().replace(/^\d+ \/ /, '')
  }));

  main.insertAdjacentHTML('afterbegin', `
    <nav class="admin-sticky-nav px-4 px-lg-5 d-flex align-items-center gap-3" aria-label="Module shortcuts">
      <div class="dropdown">
        <button class="btn-admin-outline btn-admin-sm dropdown-toggle" type="button" data-bs-toggle="dropdown"
          data-bs-display="static" aria-expanded="false">Modules</button>
        <ul class="dropdown-menu bg-cc-surface border-cc shadow"></ul>
      </div>
      <span class="small text-muted-cc text-truncate" data-current-module></span>
      <a href="#module-directory" class="text-muted-cc cc-underline-link admin-directory-return ms-auto">Directory</a>
    </nav>`);

  const toolbar = main.firstElementChild;
  const menu = toolbar.querySelector('.dropdown-menu');
  const currentLabel = toolbar.querySelector('[data-current-module]');
  modules.forEach(module => {
    const option = document.createElement('a');
    option.className = 'dropdown-item py-2';
    option.href = module.link.hash;
    option.textContent = module.label;
    menu.appendChild(document.createElement('li')).appendChild(option);
    module.option = option;
  });

  let current;
  let frame;
  function updateCurrentModule() {
    frame = null;
    const threshold = toolbar.offsetHeight + 16;
    const { scrollTop, clientHeight, scrollHeight } = document.scrollingElement;
    const atPageEnd = scrollTop + clientHeight >= scrollHeight - 1;
    const next = atPageEnd
      ? modules.at(-1)
      : modules.findLast(module => module.section.getBoundingClientRect().top <= threshold);
    if (next === current) return;

    current = next;
    currentLabel.textContent = current?.label || '';
    modules.forEach(module => {
      for (const link of [module.link, module.option]) {
        link.classList.toggle('active', module === current);
        if (module === current) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      }
    });
  }

  function scheduleUpdate() {
    if (!frame) frame = requestAnimationFrame(updateCurrentModule);
  }

  const destinations = new Map([[`#${directory.id}`, directory], ...modules.map(({ link, section }) => [link.hash, section])]);
  let target = destinations.get(window.location.hash);

  // The browser may have resolved this fragment while the dashboard was still hidden.
  if (target) {
    target.focus({ preventScroll: true });
    target.scrollIntoView();
  }

  window.addEventListener('hashchange', () => {
    const destination = destinations.get(window.location.hash);
    // History can also restore a scroll position farther inside the module.
    const top = destination?.getBoundingClientRect().top;
    const toolbarHeight = toolbar.offsetHeight;
    target = document.activeElement === destination || (top >= toolbarHeight && top <= toolbarHeight + 16)
      ? destination
      : null;
    scheduleUpdate();
  });

  function stopTrackingTarget() { target = null; }
  for (const event of ['pointerdown', 'wheel', 'keydown']) {
    window.addEventListener(event, stopTrackingTarget, { passive: true });
  }
  updateCurrentModule();
  window.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', scheduleUpdate);
  new ResizeObserver(() => {
    // Data can change the height of sections above the requested destination.
    target?.scrollIntoView();
    scheduleUpdate();
  }).observe(main);
}
