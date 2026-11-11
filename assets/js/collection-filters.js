/** Shared live filtering for the five catalog collections. */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';
  const grid = document.querySelector('#product-grid[data-collection]');
  if (!grid || typeof CCStore === 'undefined') return;
  const section = grid.closest('section');
  const state = { size: '', colour: '', min: '', max: '', availability: '', search: '', category: 'all', sort: 'featured' };
  const categoryAliases = { outerwear: 'outerwear-hoodies', bottoms: 'bottoms-accessories' };
  let records = [];
  let nextOrder = 1;
  let animation;

  const controls = document.createElement('div');
  controls.className = 'cc-collection-controls';
  controls.innerHTML = `
    <div class="cc-catalog-search-row">
      <label class="cc-catalog-search cc-xs-text" for="product-search">Search products
        <input id="product-search" type="search" class="cc-catalog-input" placeholder="Search this collection" autocomplete="off">
      </label>
      ${section.querySelector('#clear-filters-btn') ? '' : '<button type="button" id="clear-filters-btn" class="btn p-0 border-0 cc-underline-link">Clear all</button>'}
    </div>
    <div id="catalog-filter-panel" class="cc-catalog-filter-panel" hidden>
      <label class="cc-xs-text" for="filter-size">Size<select id="filter-size" class="cc-catalog-input"><option value="">All sizes</option></select></label>
      <label class="cc-xs-text" for="filter-colour">Colour<select id="filter-colour" class="cc-catalog-input"><option value="">All colours</option></select></label>
      <fieldset class="cc-catalog-price"><legend class="cc-xs-text">Price (PHP)</legend><div class="cc-catalog-price-inputs">
        <label class="cc-xs-text" for="filter-min-price">Min<input id="filter-min-price" class="cc-catalog-input" type="number" min="0" step="0.01" placeholder="No minimum" inputmode="decimal"></label>
        <label class="cc-xs-text" for="filter-max-price">Max<input id="filter-max-price" class="cc-catalog-input" type="number" min="0" step="0.01" placeholder="No maximum" inputmode="decimal"></label>
      </div></fieldset>
      <label class="cc-xs-text" for="filter-availability">Availability<select id="filter-availability" class="cc-catalog-input">
        <option value="">All products</option><option value="in-stock">In stock</option><option value="out-of-stock">Out of stock</option>
      </select></label>
    </div>`;
  const toolbar = section.querySelector('[data-filter-toggle="all"]').closest('.justify-content-between');
  toolbar.after(controls);
  const panel = controls.querySelector('#catalog-filter-panel');
  const search = controls.querySelector('#product-search');
  const fields = {
    size: controls.querySelector('#filter-size'), colour: controls.querySelector('#filter-colour'),
    min: controls.querySelector('#filter-min-price'), max: controls.querySelector('#filter-max-price'),
    availability: controls.querySelector('#filter-availability')
  };
  const sortButton = section.querySelector('[data-sort-toggle]');
  const sortLabel = document.createElement('label');
  sortLabel.className = 'cc-catalog-sort cc-xs-text text-muted-cc';
  sortLabel.textContent = 'Sort: ';
  const sort = document.createElement('select');
  sort.id = 'product-sort';
  sort.className = 'cc-catalog-sort-select';
  sort.setAttribute('aria-label', 'Sort products');
  const sortOptions = [
    ['featured', 'Featured'], ['price-asc', 'Price: Low to high'], ['price-desc', 'Price: High to low'],
    ['name-asc', 'Name: A to Z'], ['name-desc', 'Name: Z to A'], ['newest', 'Newest']
  ];
  sortOptions.forEach(([value, label]) => sort.add(new Option(label, value)));
  sortLabel.append(sort);
  sortButton.replaceWith(sortLabel);

  const empty = document.createElement('div');
  empty.className = 'cc-catalog-empty text-center py-5';
  empty.innerHTML = '<h2 class="cc-service-title">No products found</h2><p class="cc-small-text">Try another search or clear your filters.</p><button type="button" class="btn-cc-outline">Clear filters</button>';
  empty.hidden = true;
  grid.after(empty);
  const status = document.createElement('div');
  status.id = 'catalog-results-status';
  status.className = 'cc-xs-text text-muted-cc';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  grid.before(status);
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
    const quickSizes = section.querySelector('#size-filter-group');
    if (quickSizes) {
      const template = quickSizes.querySelector('button');
      quickSizes.replaceChildren(...['All', ...sizes].map(size => {
        const button = template.cloneNode(false);
        button.dataset.size = size;
        button.textContent = size;
        button.style.minWidth = '42px';
        button.style.width = 'auto';
        return button;
      }));
    }
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
        (state.min === '' || product.price >= Number(state.min)) &&
        (state.max === '' || product.price <= Number(state.max)) &&
        (!state.availability || (state.availability === 'in-stock' ? stock > 0 : stock <= 0)) &&
        tokens.every(token => haystack.includes(token));
    });
    matches.sort((a, b) => {
      switch (state.sort) {
        case 'price-asc': return a.product.price - b.product.price || a.index - b.index;
        case 'price-desc': return b.product.price - a.product.price || a.index - b.index;
        case 'name-asc': return a.product.name.localeCompare(b.product.name) || a.index - b.index;
        case 'name-desc': return b.product.name.localeCompare(a.product.name) || a.index - b.index;
        case 'newest': return Number(b.product.isNew) - Number(a.product.isNew) || Number(b.product.productGroup) - Number(a.product.productGroup) || a.index - b.index;
        default: return a.index - b.index;
      }
    });
    const visible = new Set(matches.map(record => record.element));
    records.forEach(({ element }) => { element.hidden = !visible.has(element); });
    matches.forEach(({ element }) => grid.append(element));
    const count = matches.length;
    section.querySelector('#piece-count').textContent = count;
    const loaded = CCStore.isCatalogLoaded();
    empty.hidden = count > 0 || !loaded;
    status.textContent = loaded ? `${count} ${count === 1 ? 'product' : 'products'} found` :
      (grid.getAttribute('aria-busy') === 'true' ? 'Loading products…' : 'Unable to load products. Please try again.');
    const sizeStatus = section.querySelector('#size-status-text');
    if (sizeStatus) sizeStatus.textContent = `${state.size ? 'Size ' + state.size : 'All sizes'} · ${count} pieces in the collection`;
    const summary = section.querySelector('#viewed-summary-text');
    if (summary) summary.textContent = `You have viewed all ${count} pieces.`;
    section.querySelectorAll('[data-size]').forEach(button => {
      const active = button.dataset.size === (state.size || 'All');
      button.classList.toggle('active', active);
      button.classList.toggle('bg-cc-dark', !active);
      button.setAttribute('aria-pressed', String(active));
    });
    section.querySelectorAll('.category-tab').forEach(tab => {
      const active = tab.dataset.category === state.category;
      tab.classList.toggle('active', active);
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(active));
      tab.querySelector('.tab-label').classList.toggle('text-light-cc', active);
      tab.querySelector('.tab-label').classList.toggle('text-muted-cc', !active);
      tab.querySelector('.tab-indicator').style.backgroundColor = active ? 'var(--cc-accent)' : 'transparent';
    });
    section.querySelectorAll('[data-filter-toggle]').forEach(button => {
      const key = button.dataset.filterToggle;
      const active = key === 'all' ? ['size', 'colour', 'min', 'max', 'availability', 'search'].some(field => state[field] !== '') || state.category !== 'all' :
        key === 'price' ? state.min !== '' || state.max !== '' : state[key] !== '';
      button.classList.toggle('text-accent', active);
    });
    if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      animation?.cancel();
      animation = grid.animate([{ opacity: 0.45, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 180, easing: 'ease-out' });
    }
  }

  function reset() {
    Object.assign(state, { size: '', colour: '', min: '', max: '', availability: '', search: '', category: 'all', sort: 'featured' });
    Object.values(fields).forEach(field => { field.value = ''; });
    search.value = '';
    sort.value = 'featured';
    render();
  }
  section.querySelector('#clear-filters-btn').addEventListener('click', reset);
  empty.querySelector('button').addEventListener('click', reset);
  search.addEventListener('input', () => { state.search = search.value; render(); });
  sort.addEventListener('change', () => { state.sort = sort.value; render(); });
  Object.entries(fields).forEach(([key, field]) => {
    field.addEventListener(field.tagName === 'SELECT' ? 'change' : 'input', () => {
      state[key] = field.value;
      render();
    });
  });
  section.addEventListener('click', event => {
    const size = event.target.closest('#size-filter-group [data-size]');
    if (size) {
      state.size = size.dataset.size === 'All' ? '' : size.dataset.size;
      fields.size.value = state.size;
      render();
    }
    const tab = event.target.closest('.category-tab');
    if (tab) { state.category = tab.dataset.category; render(); }
  });
  section.querySelectorAll('[data-filter-toggle]').forEach(button => {
    button.setAttribute('aria-controls', panel.id);
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', () => {
      const key = button.dataset.filterToggle;
      panel.hidden = key === 'all' ? !panel.hidden : false;
      section.querySelectorAll('[data-filter-toggle]').forEach(toggle => toggle.setAttribute('aria-expanded', String(!panel.hidden)));
      if (!panel.hidden) (key === 'price' ? fields.min : fields[key] || fields.size).focus();
    });
  });
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      panel.hidden = true;
      section.querySelectorAll('[data-filter-toggle]').forEach(button => button.setAttribute('aria-expanded', 'false'));
      section.querySelector('[data-filter-toggle="all"]').focus();
    }
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
