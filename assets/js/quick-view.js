/** One delegated quick view for static, catalog-rendered and wishlist cards. */
(() => {
  'use strict';
  if (window.CCQuickView) return;
  let modal, product, selectedSize, opener, previousOverflow, pending = false;
  const colors = { obsidian: '#181a1b', graphite: '#444647', charcoal: '#383a3b', oat: '#c8c0a9', chalk: '#eeeae0', ivory: '#e5dfcc', stone: '#b5ae9d', ash: '#8d8e89', natural: '#d3c6a6', black: '#111' };
  const find = selector => modal.querySelector(selector);
  function cardId(card) {
    return card.dataset.productId || card.closest('[data-product-id]')?.dataset.productId ||
      card.querySelector('[data-product-id]')?.dataset.productId ||
      new URL(card.querySelector('a[href*="product-detail.html"]')?.href || location.href).searchParams.get('id');
  }
  function decorate(root = document) {
    const cards = [...root.querySelectorAll('.cc-product-card')];
    if (root.matches?.('.cc-product-card')) cards.push(root);
    cards.forEach(card => {
      const link = card.querySelector('a:has(img), a:has(.cc-asset-box)');
      const placeholder = link?.querySelector('.cc-asset-box');
      if (placeholder) {
        const image = document.createElement('img');
        image.className = 'img-fluid w-100 object-fit-cover border border-cc';
        image.style.height = placeholder.style.height || '370px';
        image.setAttribute('data-product-image', '');
        placeholder.replaceWith(image);
      }
      const item = typeof CCStore !== 'undefined' && CCStore.getProductById(cardId(card));
      if (item && link?.querySelector('img')) {
        link.querySelector('img').src = item.srcImage;
        link.querySelector('img').alt = `${item.name} / ${item.color}`;
      }
      if (!link || link.classList.contains('cc-qv-image-link')) return;
      link.classList.add('cc-qv-image-link');
      link.setAttribute('aria-haspopup', 'dialog');
      const overlay = document.createElement('span');
      overlay.className = 'cc-qv-overlay';
      overlay.textContent = 'Quick View';
      link.append(overlay);
    });
  }
  function create() {
    modal = document.createElement('dialog');
    modal.className = 'cc-qv';
    modal.setAttribute('aria-labelledby', 'cc-qv-title');
    modal.innerHTML = `
      <button class="cc-qv-close" type="button" aria-label="Close quick view" autofocus>×</button>
      <div class="cc-qv-layout">
        <div class="cc-qv-media"><img class="cc-qv-photo" alt=""><div class="cc-qv-lens" hidden></div><span class="cc-qv-hint">MOVE TO MAGNIFY</span></div>
        <div class="cc-qv-info">
          <div class="cc-qv-badge"></div><h2 class="cc-qv-title" id="cc-qv-title"></h2><div class="cc-qv-price"></div>
          <p class="cc-qv-description"></p>
          <div class="cc-qv-section"><div class="cc-qv-label cc-qv-color-label"></div><div class="cc-qv-options cc-qv-colors" role="group" aria-label="Colour"></div></div>
          <div class="cc-qv-section"><div class="cc-qv-label"><span class="cc-qv-size-label"></span><a href="size-guide.html" target="_blank" rel="noopener">Size & fit guide</a></div><div class="cc-qv-options cc-qv-sizes" role="group" aria-label="Size"></div></div>
          <div class="cc-qv-stock"></div><button type="button" class="cc-qv-action cc-qv-add"></button>
          <a class="cc-qv-action cc-qv-details">View full product details　 ↗</a>
          <div class="cc-qv-status" role="status" aria-live="polite"></div>
          <p class="cc-qv-note">Shipping calculated at checkout. Eligible returns within 14 days of delivery. <a href="faq-shipping.html">Shipping & returns</a></p>
        </div>
      </div><div class="cc-qv-zoom" aria-hidden="true" hidden></div>`;
    document.body.append(modal);
    modal.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const controls = [...modal.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]')]
        .filter(element => element.getClientRects().length);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    find('.cc-qv-close').onclick = () => modal.close();
    modal.addEventListener('click', event => {
      const rect = modal.getBoundingClientRect();
      if (event.target === modal && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) modal.close();
    });
    modal.addEventListener('close', () => {
      hideZoom();
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    });
    find('.cc-qv-add').onclick = async () => {
      if (pending || !selectedSize) return;
      const adding = product;
      pending = true;
      updateAction();
      try {
        const added = await CCStore.addToCart({ id: adding.id, name: adding.name, price: adding.price, color: adding.color, size: selectedSize, image: adding.srcImage, quantity: 1 });
        if (product === adding) find('.cc-qv-status').textContent = added ? 'Added to your bag.' : 'Unable to add this item. Please check availability or sign in.';
      } catch (error) {
        if (product === adding) find('.cc-qv-status').textContent = 'Unable to add this item. Please try again.';
      } finally { pending = false; updateAction(); }
    };
    find('.cc-qv-media').addEventListener('pointermove', magnify);
    find('.cc-qv-media').addEventListener('pointerleave', hideZoom);
    find('.cc-qv-photo').addEventListener('error', () => {
      hideZoom();
      find('.cc-qv-status').textContent = 'Product image could not be loaded.';
    });
    modal.addEventListener('scroll', hideZoom);
    window.addEventListener('resize', hideZoom);
  }
  function updateAction() {
    find('.cc-qv-size-label').textContent = `Size — ${selectedSize || 'Unavailable'}`;
    find('.cc-qv-add').disabled = pending || !selectedSize || product.stockQty <= 0;
    find('.cc-qv-add').textContent = pending ? 'Adding…' : `Add to bag — ${CCStore.formatPHP(product.price)}　 ↗`;
  }
  function option(label, selected, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cc-qv-option';
    button.textContent = label;
    button.setAttribute('aria-pressed', String(selected));
    button.onclick = handler;
    return button;
  }
  function render(next) {
    product = next;
    hideZoom();
    const image = find('.cc-qv-photo');
    image.src = product.srcImage;
    image.alt = `${product.name} / ${product.color}`;
    find('.cc-qv-title').textContent = product.name;
    find('.cc-qv-badge').textContent = product.badge;
    find('.cc-qv-price').textContent = CCStore.formatPHP(product.price);
    find('.cc-qv-description').textContent = product.description;
    find('.cc-qv-color-label').textContent = `Colour — ${product.color}`;
    find('.cc-qv-details').href = `product-detail.html?id=${encodeURIComponent(product.id)}`;
    find('.cc-qv-status').textContent = '';
    find('.cc-qv-stock').textContent = product.stockQty > 0 ? 'IN STOCK / READY TO SHIP' : 'OUT OF STOCK';
    const variants = Object.values(CCStore.getProducts()).filter(p => p.id === product.id || (p.productGroup && p.productGroup === product.productGroup));
    find('.cc-qv-colors').replaceChildren(...variants.map(p => {
      const button = option('', p.id === product.id, () => render(p));
      button.classList.add('cc-qv-swatch');
      button.style.setProperty('--swatch', colors[p.color.toLowerCase()] || '#777');
      button.setAttribute('aria-label', p.color);
      button.title = p.color;
      return button;
    }));
    const sizes = CCStore.getSizes(product.id);
    selectedSize = sizes.find(s => s.code === 'M' && s.stock > 0)?.code || sizes.find(s => s.stock > 0)?.code || '';
    find('.cc-qv-sizes').replaceChildren(...sizes.map(size => {
      const button = option(size.code, selectedSize === size.code, () => {
        selectedSize = size.code;
        find('.cc-qv-sizes').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
        find('.cc-qv-status').textContent = '';
        updateAction();
      });
      button.disabled = size.stock <= 0;
      return button;
    }));
    updateAction();
    modal.scrollTop = 0;
  }
  function hideZoom() {
    if (!modal) return;
    find('.cc-qv-lens').hidden = true;
    find('.cc-qv-zoom').hidden = true;
  }
  function magnify(event) {
    if (event.pointerType === 'touch') return;
    const img = find('.cc-qv-photo');
    if (!img.complete || !img.naturalWidth) return hideZoom();
    const rect = img.getBoundingClientRect();
    // Account for the exact object-fit: contain rectangle, including letterboxing.
    const scale = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
    const width = img.naturalWidth * scale, height = img.naturalHeight * scale;
    const left = (rect.width - width) / 2, top = (rect.height - height) / 2;
    const x = event.clientX - rect.left - left, y = event.clientY - rect.top - top;
    if (x < 0 || y < 0 || x > width || y > height) return hideZoom();
    const zoom = find('.cc-qv-zoom'), lens = find('.cc-qv-lens');
    zoom.hidden = false;
    const factor = 2.5;
    const lensWidth = Math.min(width, zoom.clientWidth / factor), lensHeight = Math.min(height, zoom.clientHeight / factor);
    const lx = Math.max(0, Math.min(width - lensWidth, x - lensWidth / 2));
    const ly = Math.max(0, Math.min(height - lensHeight, y - lensHeight / 2));
    lens.hidden = false;
    Object.assign(lens.style, { left: `${left + lx}px`, top: `${top + ly}px`, width: `${lensWidth}px`, height: `${lensHeight}px` });
    zoom.style.backgroundImage = `url("${img.src}")`;
    zoom.style.backgroundSize = `${width * factor}px ${height * factor}px`;
    zoom.style.backgroundPosition = `${-lx * factor}px ${-ly * factor}px`;
  }
  async function open(id, trigger) {
    await CCStore.syncCatalogFromApi();
    const next = CCStore.getProductById(id);
    if (!next) return;
    if (!modal) create();
    opener = trigger || document.activeElement;
    render(next);
    if (!modal.open) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      modal.showModal();
    }
    find('.cc-qv-close').focus();
  }
  window.CCQuickView = { open };
  function init() {
    decorate();
    window.addEventListener('cc:catalogReady', () => decorate());
    new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
      if (node.nodeType === 1) decorate(node);
    }))).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('click', event => {
      const card = event.target.closest('.cc-product-card');
      if (!card || event.target.closest('button, select, input, label, .cc-wishlist-btn')) return;
      const link = event.target.closest('a');
      if (link && !link.href.includes('product-detail.html')) return;
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const id = cardId(card);
      if (!id) return;
      event.preventDefault();
      open(id, link || card.querySelector('.cc-qv-image-link'));
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
