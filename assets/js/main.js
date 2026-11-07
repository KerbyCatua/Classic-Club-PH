/**
 * Classic Club PH - Global UI Controller (main.js)
 * Syncs Header Badges, Product Card Links, Dynamic Product Details, and Wishlist across all 18 pages.
 */
document.addEventListener('DOMContentLoaded', () => {
  if (typeof CCStore === 'undefined') return;

  // 1. Sync Header Cart & Wishlist Badges
  function syncHeaderBadges() {
    const totalItems = CCStore.getCartTotalItems();
    const wishlistCount = CCStore.getWishlist().length;

    // Update any cart link or badge inside header
    const cartLinks = document.querySelectorAll('a[href="cart.html"], #header-cart-count, .cc-cart-count');
    cartLinks.forEach(el => {
      if (el.id === 'header-cart-count' || el.classList.contains('cc-cart-count')) {
        el.textContent = totalItems;
      } else {
        // Check if there is a number text node next to the bag icon in header.html
        const badgeSpan = el.querySelector('.cart-badge-num, span');
        if (badgeSpan) {
          badgeSpan.textContent = totalItems;
        }
      }
    });

  }

  // Run badge sync on load, after partials.js injects header, and when cart updates
  syncHeaderBadges();
  setTimeout(syncHeaderBadges, 150);
  setTimeout(syncHeaderBadges, 500);
  if (typeof CCStore.syncServerState === 'function') {
    CCStore.syncServerState().then(syncHeaderBadges);
  }
  window.addEventListener('cc:cartUpdated', syncHeaderBadges);
  window.addEventListener('cc:wishlistUpdated', syncHeaderBadges);

  // 2. Automatically Decorate Product Card Links with ?id=<product-id> across all pages
  const productCards = document.querySelectorAll('.cc-product-card');
  productCards.forEach(card => {
    const productId =
      card.getAttribute('data-product-id') ||
      card.querySelector('[data-product-id]')?.getAttribute('data-product-id');

    if (!productId) return;

    const links = card.querySelectorAll('a[href*="product-detail.html"]');

    links.forEach(link => {
      const currentHref = link.getAttribute('href') || '';
      const path = currentHref.startsWith('/')
        ? currentHref.slice(1)
        : currentHref.split('?')[0];

      link.setAttribute(
        'href',
        `${path}?id=${encodeURIComponent(productId)}`
      );
    });
  });

  // 3. Dynamic Hydration for product-detail.html based on URL ?id=...
  function hydrateProductDetail() {
    const addToCartBtn = document.getElementById('add-to-cart-btn');
    if (!addToCartBtn) return;
    const params = new URLSearchParams(window.location.search);
    const requestedId = params.get('id');

    if (requestedId) {
      const product = CCStore.getProductById(requestedId);
      if (product) {
        document.title = product.name + ' — Classic Club PH';

        // Update Breadcrumb
        const breadcrumbTitle = document.getElementById('product-breadcrumb-title');
        if (breadcrumbTitle) {
          breadcrumbTitle.textContent = product.name;
          const categoryLink = breadcrumbTitle.previousElementSibling?.previousElementSibling;
          if (categoryLink && categoryLink.tagName === 'A') {
            categoryLink.textContent = product.category;
            categoryLink.setAttribute('href', product.categoryUrl);
          }
        }

        // Update Title, SKU, Price, Description
        const stickyBox = addToCartBtn.closest('.sticky-top');
        if (stickyBox) {
          const eyebrow = stickyBox.querySelector('.cc-eyebrow-teal');
          const titleEl = stickyBox.querySelector('h1.cc-phil-title');
          const priceEl = titleEl ? titleEl.nextElementSibling : null;
          const descEl = priceEl ? priceEl.nextElementSibling : null;

          if (eyebrow) eyebrow.textContent = product.badge + ' / ' + product.sku;
          if (titleEl) titleEl.textContent = product.name;
          if (priceEl) priceEl.textContent = CCStore.formatPHP(product.price);
          if (descEl) descEl.textContent = product.description;
        }

        // Update Gallery Asset Labels
        const galleryLabels = document.querySelectorAll('.col-lg-7 .cc-asset-label');
        if (galleryLabels[0]) galleryLabels[0].textContent = product.name + ' / ' + product.color + ' / front';
        if (galleryLabels[1]) galleryLabels[1].textContent = product.name + ' / ' + product.color + ' / back';

        // Update Color Label
        const colorLabel = document.getElementById('selected-color-label');
        if (colorLabel) colorLabel.textContent = 'Colour — ' + product.color;

        // Update Button Data & Price Text
        addToCartBtn.setAttribute('data-product-id', product.id);
        addToCartBtn.setAttribute('data-product-name', product.name);
        addToCartBtn.setAttribute('data-product-price', product.price);
        addToCartBtn.setAttribute('data-product-color', product.color);
        addToCartBtn.innerHTML = '<span>Add to bag — ' + CCStore.formatPHP(product.price) + '</span><i class="bi bi-arrow-right"></i>';

        const mainWishBtn = document.querySelector('.cc-main-wishlist-toggle');
        if (mainWishBtn) {
          mainWishBtn.setAttribute('data-product-id', product.id);
        }

        const detailImage = document.querySelector('[data-product-detail-image]');
        if (detailImage && product.srcImage) {
          detailImage.src = product.srcImage;
          detailImage.alt = product.name + ' / ' + product.color;
        }
      }
    }
  }

  // 4. Hydrate product cards (live prices, titles, images) across shop-all & collections
  function hydrateProductCards() {
    // Find all product card containers or cards with data-product-id
    const cards = document.querySelectorAll('.cc-product-card, .product-item');
    cards.forEach(card => {
      const productId =
        card.getAttribute('data-product-id') ||
        card.querySelector('[data-product-id]')?.getAttribute('data-product-id');

      if (!productId) return;
      const product = CCStore.getProductById(productId);
      if (!product) {
        card.style.display = 'none';
        return;
      }
      card.style.display = CCStore.isProductAvailable(productId) ? '' : 'none';

      // Update image
      const image = card.querySelector('[data-product-image]');
      if (image && product.srcImage) {
        image.src = product.srcImage;
        image.alt = product.name + ' / ' + (product.color || '');
      }

      // Update live price text (find the element displaying the price)
      const priceEls = card.querySelectorAll('.text-light-cc, [data-product-price]');
      priceEls.forEach(priceEl => {
        if (product.price) {
          priceEl.textContent = CCStore.formatPHP(product.price);
        }
      });

      // Update live title text
      const titleEl = card.querySelector('.cc-product-title');
      if (titleEl && product.name) {
        titleEl.textContent = product.name;
      }
    });
  }

  function escapeHtml(value) {
    const element = document.createElement('span');
    element.textContent = String(value ?? '');
    return element.innerHTML;
  }

  function renderNewLiveCatalogCards() {
    const grid = document.getElementById('product-grid');
    if (!grid || typeof CCStore.getLiveCatalogItems !== 'function') return;

    const existingSkus = new Set(
      Array.from(grid.querySelectorAll('[data-product-id]'))
        .map(element => CCStore.getProductById(element.getAttribute('data-product-id'))?.sku)
        .filter(Boolean)
    );
    const existingProductIds = new Set(
      Array.from(grid.querySelectorAll('[data-product-id]'))
        .map(element => element.getAttribute('data-product-id'))
        .filter(Boolean)
    );

    const pageName = window.location.pathname.split('/').pop() || 'shop-all.html';
    const pageCategory = pageName.replace(/\.html$/, '');
    CCStore.getLiveCatalogItems().forEach(item => {
      const productId = item.catalog_key || `catalog-${item.id}-${item.variant_id}`;
      if (!item.sku || existingSkus.has(item.sku) || existingProductIds.has(productId)) return;
      const product = CCStore.getProductById(productId);
      if (!product) return;
      if (
        pageName !== 'shop-all.html' &&
        !(
          (pageName === 'new-arrivals.html' && product.isNew) ||
          product.categorySlug === pageCategory
        )
      ) return;

      const card = document.createElement('div');
      card.className = 'col product-item';
      card.setAttribute('data-product-id', productId);
      card.innerHTML = `
        <article class="cc-product-card d-flex flex-column gap-3 h-100">
          <div class="position-relative">
            <a href="product-detail.html?id=${encodeURIComponent(productId)}" class="text-decoration-none">
              <img src="${escapeHtml(product.srcImage || '')}" data-product-image
                alt="${escapeHtml(product.name)} / ${escapeHtml(product.color || '')}"
                class="img-fluid w-100 object-fit-cover border border-cc" style="height: 370px;">
            </a>
            <button type="button" class="cc-wishlist-btn" data-product-id="${escapeHtml(productId)}"
              aria-label="Add to wishlist"><i class="bi bi-heart"></i></button>
          </div>
          <div class="d-flex flex-column gap-2">
            <span class="cc-eyebrow">${escapeHtml(product.badge || 'LIVE CATALOG')}</span>
            <a href="product-detail.html?id=${encodeURIComponent(productId)}" class="cc-product-title">${escapeHtml(product.name)}</a>
            <div class="d-flex justify-content-between align-items-start">
              <span class="cc-xs-text">${escapeHtml(product.color || 'Standard')}</span>
              <span class="cc-small-text text-light-cc">${CCStore.formatPHP(product.price)}</span>
            </div>
          </div>
        </article>`;
      grid.appendChild(card);
      existingSkus.add(item.sku);
      existingProductIds.add(productId);
    });
  }

  // Initial render from local definitions
  hydrateProductDetail();
  hydrateProductCards();

  // Sync live database catalog (prices, availability) and re-hydrate
  if (typeof CCStore !== 'undefined' && typeof CCStore.syncCatalogFromApi === 'function') {
    CCStore.syncCatalogFromApi().then(() => {
      renderNewLiveCatalogCards();
      hydrateProductCards();
      hydrateProductDetail();
    });
  }


    // Handle wishlist buttons on pages that use button elements
  document.querySelectorAll('.cc-wishlist-btn').forEach(button => {
    if (
      button.tagName !== 'BUTTON' ||
      button.hasAttribute('data-product-id')
    ) {
      return;
    }

    const card = button.closest('.cc-product-card');
    const productId =
      button.getAttribute('data-product-id') ||
      card?.getAttribute('data-product-id');

    if (!productId) return;

    function updateWishlistButton() {
      const saved = CCStore.isInWishlist(productId);
      const icon = button.querySelector('i');

      if (icon) {
        icon.classList.toggle('bi-heart-fill', saved);
        icon.classList.toggle('bi-heart', !saved);
      }

      button.classList.toggle('text-accent', saved);
      button.setAttribute('aria-pressed', String(saved));
      button.setAttribute(
        'aria-label',
        saved ? 'Remove from wishlist' : 'Save to wishlist'
      );
    }

    updateWishlistButton();

    button.addEventListener('click', event => {
      event.preventDefault();
      CCStore.toggleWishlist(productId);
      updateWishlistButton();
    });
  });


  // 4. Apply Favicon
  const CC_FAVICON = {
    path: '/assets/favicon.ico',
    type: 'image/x-icon'
  };

  function applyFavicon() {
    let favicon = document.querySelector('link[data-cc-favicon]');

    if (!favicon) {
      favicon = document.createElement('link');
      favicon.rel = 'icon';
      favicon.dataset.ccFavicon = 'true';
      document.head.appendChild(favicon);
    }

    favicon.type = CC_FAVICON.type;
    favicon.href = CC_FAVICON.path;
  }

  applyFavicon();
  // 4. End Apply Favicon

});

function initializeNewsletterForm() {
  const form = document.querySelector('#footer-partial form');
  const input = document.getElementById('footer-email');
  if (!form || !input || form.dataset.initialized === 'true') return;

  form.dataset.initialized = 'true';
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const csrf = await fetch('public/api/auth/csrf.php', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      }).then(response => response.json());
      const response = await fetch('public/api/newsletter/subscribe.php', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-CSRF-Token': csrf.data.token
        },
        body: JSON.stringify({ email: input.value })
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error?.message || 'Unable to subscribe.');
      }
      input.value = '';
      input.setAttribute('placeholder', 'You are on the list');
    } catch (error) {
      window.alert(error.message);
    } finally {
      button.disabled = false;
    }
  });
}

document.addEventListener('cc:partialsLoaded', initializeNewsletterForm);
document.addEventListener('DOMContentLoaded', () => window.setTimeout(initializeNewsletterForm, 250));