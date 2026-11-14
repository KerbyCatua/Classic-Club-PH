/** Shared live filtering for the five catalog collections. */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';
  const grid = document.querySelector('#product-grid[data-collection]');
  if (!grid || typeof CCStore === 'undefined') return;
  const section = grid.closest('section');
  const state = { size: '', colour: '', inStock: false, search: '', category: 'all', sort: 'featured' };
  const categoryAliases = { outerwear: 'outerwear-hoodies', bottoms: 'bottoms-accessories' };
  let records = [];
  let nextOrder = 1;
  let animation;

  const controls = section.querySelector('.cc-collection-controls');
  controls.innerHTML = `
    <div class="cc-catalog-fields" role="group" aria-label="Filter and sort products">
      <label class="cc-catalog-search cc-xs-text" for="product-search">Search
        <input id="product-search" type="search" class="cc-catalog-input" placeholder="Search this collection" autocomplete="off">
      </label>
      <label class="cc-xs-text" for="filter-size">Size<select id="filter-size" class="cc-catalog-input"><option value="">All sizes</option></select></label>
      <label class="cc-xs-text" for="filter-colour">Colour<select id="filter-colour" class="cc-catalog-input"><option value="">All colours</option></select></label>
      <label class="cc-catalog-stock cc-xs-text" for="filter-in-stock"><input id="filter-in-stock" type="checkbox">In stock only</label>
      <label class="cc-catalog-sort cc-xs-text" for="product-sort">Sort by
        <select id="product-sort" class="cc-catalog-input">
          <option value="featured">Featured</option>
          <option value="price-asc">Price: Low to high</option>
          <option value="price-desc">Price: High to low</option>
        </select>
      </label>
    </div>
    <div class="cc-catalog-summary">
      <div id="catalog-results-status" class="cc-xs-text text-muted-cc" role="status" aria-live="polite" aria-atomic="true"></div>
      <button type="button" id="clear-filters-btn" class="cc-catalog-clear cc-underline-link" hidden>Clear filters</button>
    </div>`;
  const search = controls.querySelector('#product-search');
  const fields = {
    size: controls.querySelector('#filter-size'), colour: controls.querySelector('#filter-colour')
  };
  const inStock = controls.querySelector('#filter-in-stock');
  const sort = controls.querySelector('#product-sort');
  const clear = controls.querySelector('#clear-filters-btn');

  const empty = document.createElement('div');
  empty.className = 'cc-catalog-empty text-center py-5';
  empty.innerHTML = '<h2 class="cc-service-title">No products found</h2><p class="cc-small-text">Try another search or clear your filters.</p>';
  empty.hidden = true;
  grid.after(empty);
  const status = controls.querySelector('#catalog-results-status');
  grid.setAttribute('aria-describedby', status.id);
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'btn p-0 border-0 cc-underline-link';
  retry.textContent = 'Try again';
  retry.hidden = true;
  status.after(retry);

  function belongs(product) {
    const collection = grid.dataset.collection;
    return collection === 'shop-all' || (collection === 'new-arrivals' ? product.isNew : product.categorySlug === collection);
  }

  function setOptions(select, values, label, selected) {
    select.replaceChildren(new Option(label, ''));
    values.forEach(value => select.add(new Option(value, value)));
    // Keep active criteria on catalog refresh, including criteria with no matches.
    if (selected && !values.includes(selected)) select.add(new Option(selected, selected));
    select.value = selected;
  }

  function refreshCatalog() {
    const seen = new Set();
    records = [];
    grid.querySelectorAll('.product-item').forEach(element => {
      if (!element.dataset.catalogOrder) element.dataset.catalogOrder = String(nextOrder++);
      const id = element.dataset.productId || element.querySelector('[data-product-id]')?.dataset.productId;
      const product = CCStore.getProductById(id);
      const included = product && belongs(product) && !seen.has(id);
      element.hidden = !included;
      if (!included) return;
      seen.add(id);
      records.push({ element, product, index: Number(element.dataset.catalogOrder) });
    });
    const sizes = [...new Set(records.flatMap(({ product }) => CCStore.getSizes(product.id).map(size => size.code)))];
    const sizeOrder = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
    sizes.sort((a, b) => {
      const left = sizeOrder.indexOf(a), right = sizeOrder.indexOf(b);
      if (left >= 0 || right >= 0) return (left >= 0 ? left : sizeOrder.length) - (right >= 0 ? right : sizeOrder.length);
      return a.localeCompare(b, undefined, { numeric: true });
    });
    setOptions(fields.size, sizes, 'All sizes', state.size);
    const colours = [...new Set(records.map(({ product }) => product.color))].sort((a, b) => a.localeCompare(b));
    setOptions(fields.colour, colours, 'All colours', state.colour);
    grid.setAttribute('aria-busy', 'false');
    retry.hidden = CCStore.isCatalogLoaded();
    render(false);
  }

  function render(animate = true) {
    const tokens = state.search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const matches = records.filter(({ product }) => {
      const stock = state.size ? CCStore.getSizeStock(product.id, state.size) : CCStore.getVariantStock(product.id);
      const haystack = [product.name, product.color, product.sku, product.category, product.description].join(' ').toLocaleLowerCase();
      return (!state.category || state.category === 'all' || product.categorySlug === (categoryAliases[state.category] || state.category)) &&
        (!state.size || CCStore.getSizes(product.id).some(size => size.code === state.size)) &&
        (!state.colour || product.color === state.colour) &&
        (!state.inStock || stock > 0) &&
        tokens.every(token => haystack.includes(token));
    });
    matches.sort((a, b) => {
      switch (state.sort) {
        case 'price-asc': return a.product.price - b.product.price || a.index - b.index;
        case 'price-desc': return b.product.price - a.product.price || a.index - b.index;
        default: return a.index - b.index;
      }
    });
    const visible = new Set(matches.map(record => record.element));
    records.forEach(({ element }) => { element.hidden = !visible.has(element); });
    matches.forEach(({ element }) => grid.append(element));
    const count = matches.length;
    const loaded = CCStore.isCatalogLoaded();
    empty.hidden = count > 0 || !loaded;
    if (loaded) {
      status.innerHTML = `<span id="piece-count">${count}</span> ${count === 1 ? 'product' : 'products'}`;
    } else {
      status.textContent = grid.getAttribute('aria-busy') === 'true' ? 'Loading products…' : 'Unable to load products. Please try again.';
    }
    clear.hidden = !state.size && !state.colour && !state.inStock && !state.search && state.category === 'all';
    Object.entries(fields).forEach(([key, field]) => field.classList.toggle('is-active', Boolean(state[key])));
    const summary = section.querySelector('#viewed-summary-text');
    if (summary) summary.textContent = `You have viewed all ${count} pieces.`;
    section.querySelectorAll('.category-tab').forEach(tab => {
      const active = tab.dataset.category === state.category;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-pressed', String(active));
      tab.querySelector('.tab-label').classList.toggle('text-light-cc', active);
      tab.querySelector('.tab-label').classList.toggle('text-muted-cc', !active);
      tab.querySelector('.tab-indicator').style.backgroundColor = active ? 'var(--cc-accent)' : 'transparent';
    });
    if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      animation?.cancel();
      animation = grid.animate([{ opacity: 0.45, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 180, easing: 'ease-out' });
    }
  }

  function reset() {
    Object.assign(state, { size: '', colour: '', inStock: false, search: '', category: 'all' });
    Object.values(fields).forEach(field => { field.value = ''; });
    search.value = '';
    inStock.checked = false;
    render();
    search.focus({ preventScroll: true });
  }
  clear.addEventListener('click', reset);
  search.addEventListener('input', () => { state.search = search.value; render(); });
  sort.addEventListener('change', () => { state.sort = sort.value; render(); });
  inStock.addEventListener('change', () => { state.inStock = inStock.checked; render(); });
  Object.entries(fields).forEach(([key, field]) => {
    field.addEventListener('change', () => {
      state[key] = field.value;
      render();
    });
  });
  section.addEventListener('click', event => {
    const tab = event.target.closest('.category-tab');
    if (tab) { state.category = tab.dataset.category; render(); }
  });
  retry.addEventListener('click', async () => {
    retry.hidden = true;
    grid.setAttribute('aria-busy', 'true');
    render(false);
    await CCStore.syncCatalogFromApi();
    window.dispatchEvent(new CustomEvent('cc:catalogReady'));
  });
  grid.setAttribute('aria-busy', 'true');
  section.querySelectorAll('.product-item').forEach(element => { element.hidden = true; });
  render(false);
  window.addEventListener('cc:catalogReady', refreshCatalog);
  if (CCStore.isCatalogLoaded()) refreshCatalog();
});
