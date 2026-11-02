(function () {
  'use strict';

  // ==========================================
  // GLOBAL LOADER CONFIGURATION
  // ==========================================

    const LOADER_CONFIG = {
    // Generates a new duration on every page load:
    // Minimum: 200ms
    // Maximum: 1200ms
    duration: Math.floor(Math.random() * (1200 - 200 + 1)) + 200,

    blur: 5,
    overlayOpacity: 0.5,
    overlayColor: '#000000',
    zIndex: 9999,
    fadeDuration: 300
    };

  const LOADER_ID = 'cc-global-loader';

  function createLoader() {
    const existingLoader = document.getElementById(LOADER_ID);

    if (existingLoader) {
      return existingLoader;
    }

    const loader = document.createElement('div');

    loader.id = LOADER_ID;
    loader.className = 'cc-global-loader';
    loader.setAttribute('role', 'status');
    loader.setAttribute('aria-label', 'Loading page');

    loader.innerHTML = `
      <div class="loader" aria-hidden="true">
        <div class="inner one"></div>
        <div class="inner two"></div>
        <div class="inner three"></div>
      </div>
    `;

    loader.style.setProperty(
      '--cc-loader-blur',
      `${LOADER_CONFIG.blur}px`
    );

    loader.style.setProperty(
      '--cc-loader-overlay-opacity',
      String(LOADER_CONFIG.overlayOpacity)
    );

    loader.style.setProperty(
      '--cc-loader-overlay-color',
      LOADER_CONFIG.overlayColor
    );

    loader.style.setProperty(
      '--cc-loader-z-index',
      String(LOADER_CONFIG.zIndex)
    );

    document.body.appendChild(loader);

    return loader;
  }

  function hideLoader(loader) {
    if (!loader || !loader.isConnected) {
      return;
    }

    loader.classList.add('is-hidden');
    document.body.removeAttribute('aria-busy');

    window.setTimeout(() => {
      if (loader.isConnected) {
        loader.remove();
      }
    }, LOADER_CONFIG.fadeDuration);
  }

  function initializeLoader() {
    if (window.CCGlobalLoaderInitialized) {
      return;
    }

    window.CCGlobalLoaderInitialized = true;

    const startTime = performance.now();
    const loader = createLoader();

    document.body.setAttribute('aria-busy', 'true');

    const pageReady = new Promise(resolve => {
      if (document.readyState === 'loading') {
        document.addEventListener(
          'DOMContentLoaded',
          resolve,
          { once: true }
        );
      } else {
        resolve();
      }
    });

    const minimumDisplayTime = new Promise(resolve => {
      window.setTimeout(resolve, LOADER_CONFIG.duration);
    });

    Promise.all([pageReady, minimumDisplayTime]).then(() => {
      const elapsedTime = performance.now() - startTime;
      const remainingTime = Math.max(
        0,
        LOADER_CONFIG.duration - elapsedTime
      );

      window.setTimeout(() => {
        hideLoader(loader);
      }, remainingTime);
    });
  }

  if (document.body) {
    initializeLoader();
  } else {
    document.addEventListener(
      'DOMContentLoaded',
      initializeLoader,
      { once: true }
    );
  }
})();