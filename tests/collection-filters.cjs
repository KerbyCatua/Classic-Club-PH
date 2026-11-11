// Run with Playwright installed: node tests/collection-filters.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const base = process.env.CC_TEST_URL || 'http://localhost/classic-club-ph/';
const pages = ['shop-all', 'tops-tees', 'outerwear-hoodies', 'bottoms-accessories', 'new-arrivals'];
const visible = '#product-grid > .product-item:not([hidden])';
const aliases = { outerwear: 'outerwear-hoodies', bottoms: 'bottoms-accessories' };
const key = item => item.catalog_key || `catalog-${item.id}-${item.variant_id}`;
const sizes = item => Object.fromEntries(item.size_stock.split(',').filter(Boolean).map(pair => {
  const [size, stock] = pair.split(':');
  return [size, Number(stock)];
}));
const belongs = (item, collection) => collection === 'shop-all' || (collection === 'new-arrivals' ? Number(item.is_new) === 1 : item.category_slug === collection);

async function expectProducts(page, expected, ordered = false) {
  const actual = await page.locator(visible).evaluateAll(elements => elements.map(element => element.dataset.productId || element.querySelector('[data-product-id]').dataset.productId));
  const wanted = expected.map(key);
  assert.deepEqual(ordered ? actual : [...actual].sort(), ordered ? wanted : [...wanted].sort());
  assert.equal(Number(await page.locator('#piece-count').textContent()), expected.length);
  assert.equal(await page.locator('.cc-catalog-empty').isVisible(), expected.length === 0);
  assert.equal(await page.locator('#product-search').count(), 1);
}

(async () => {
  const catalog = (await (await fetch(base + 'public/api/catalog/products.php?per_page=50')).json()).data.items;
  const browser = await chromium.launch();
  const errors = [];
  try {
    async function makePage(items) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      let wishlist = [], toggles = 0, cartAdds = 0, navigations = 0;
      page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
      await page.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        const json = data => route.fulfill({ json: { success: true, data } });
        if (['image', 'font'].includes(request.resourceType())) return route.abort();
        if (url.origin !== new URL(base).origin) {
          // Optional cached vendor assets keep the suite usable when CDNs time out.
          if (process.env.CC_TEST_ASSETS_DIR) {
            const filename = path.basename(url.pathname);
            if (['bootstrap.min.css', 'bootstrap.bundle.min.js'].includes(filename)) {
              return route.fulfill({ path: path.join(process.env.CC_TEST_ASSETS_DIR, filename) });
            }
            return route.abort();
          }
          return route.continue();
        }
        if (items && url.pathname.endsWith('/catalog/products.php')) {
          const offset = (Number(url.searchParams.get('page') || 1) - 1) * 50;
          return json({ items: items.slice(offset, offset + 50), pagination: { total: items.length } });
        }
        if (url.pathname.endsWith('/wishlist/view.php')) return json({ items: wishlist.map(id => ({ id })) });
        if (url.pathname.endsWith('/wishlist/toggle.php')) {
          toggles++;
          const id = request.postDataJSON().catalog_key;
          wishlist = wishlist.includes(id) ? wishlist.filter(value => value !== id) : [...wishlist, id];
          return json({ items: wishlist.map(id => ({ id })) });
        }
        if (url.pathname.endsWith('/auth/csrf.php')) return json({ token: 'browser-test' });
        if (url.pathname.endsWith('/auth/me.php')) return json({ user: { id: 1 } });
        if (url.pathname.endsWith('/cart/view.php')) return json({ items: [] });
        if (url.pathname.endsWith('/cart/add.php')) { cartAdds++; return json({ items: [] }); }
        return route.continue();
      });
      return { context, page, counts: () => ({ toggles, cartAdds, navigations }) };
    }

    async function exercise(items, collection, label) {
      const { context, page, counts } = await makePage(items === catalog ? undefined : items);
      try {
        await page.goto(base + collection + '.html', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('#product-grid')?.getAttribute('aria-busy') === 'false');
        const collectionItems = items.filter(item => belongs(item, collection));
        await expectProducts(page, collectionItems);
        const baseline = await page.locator(visible).evaluateAll(elements => elements.map(element => element.dataset.productId || element.querySelector('[data-product-id]').dataset.productId));
        const featured = baseline.map(id => collectionItems.find(item => key(item) === id));
        await page.locator('[data-filter-toggle="all"]').click();
        assert.equal(await page.locator('#catalog-filter-panel').isVisible(), true);
        await page.locator('#filter-size').press('Escape');
        assert.equal(await page.locator('#catalog-filter-panel').isVisible(), false);
        for (const [button, control] of [['size', 'size'], ['colour', 'colour'], ['price', 'min-price'], ['availability', 'availability']]) {
          await page.locator(`[data-filter-toggle="${button}"]`).click();
          assert.equal(await page.locator('#filter-' + control).evaluate(element => element === document.activeElement), true);
        }
        const sizeValues = [...new Set(collectionItems.flatMap(item => Object.keys(sizes(item))))];
        assert.deepEqual((await page.locator('#filter-size option').evaluateAll(options => options.map(option => option.value).filter(Boolean))).sort(), [...sizeValues].sort());
        for (const size of sizeValues) {
          await page.selectOption('#filter-size', size);
          await expectProducts(page, collectionItems.filter(item => size in sizes(item)));
          if (collection === 'shop-all') {
            await page.locator('#size-filter-group [data-size="All"]').click();
            await expectProducts(page, collectionItems);
            await page.locator(`#size-filter-group [data-size="${size}"]`).click();
            assert.equal(await page.locator('#filter-size').inputValue(), size);
            await expectProducts(page, collectionItems.filter(item => size in sizes(item)));
          }
        }
        await page.locator('#clear-filters-btn').click();
        const colours = [...new Set(collectionItems.map(item => item.color_name))];
        assert.deepEqual((await page.locator('#filter-colour option').evaluateAll(options => options.map(option => option.value).filter(Boolean))).sort(), [...colours].sort());
        for (const colour of colours) {
          await page.selectOption('#filter-colour', colour);
          await expectProducts(page, collectionItems.filter(item => item.color_name === colour));
        }
        await page.locator('#clear-filters-btn').click();
        const prices = [...new Set(collectionItems.map(item => Number(item.price)))].sort((a, b) => a - b);
        for (const price of prices) {
          await page.fill('#filter-min-price', String(price));
          await expectProducts(page, collectionItems.filter(item => Number(item.price) >= price));
          await page.fill('#filter-min-price', '');
          await page.fill('#filter-max-price', String(price));
          await expectProducts(page, collectionItems.filter(item => Number(item.price) <= price));
          await page.fill('#filter-min-price', String(price));
          await expectProducts(page, collectionItems.filter(item => Number(item.price) === price));
          await page.fill('#filter-min-price', '');
          await page.fill('#filter-max-price', '');
        }
        for (const availability of ['in-stock', 'out-of-stock', '']) {
          await page.selectOption('#filter-availability', availability);
          await expectProducts(page, collectionItems.filter(item => !availability || (availability === 'in-stock' ? Number(item.stock_qty) > 0 : Number(item.stock_qty) <= 0)));
        }
        for (const size of sizeValues) {
          await page.selectOption('#filter-size', size);
          for (const availability of ['in-stock', 'out-of-stock']) {
            await page.selectOption('#filter-availability', availability);
            await expectProducts(page, collectionItems.filter(item => size in sizes(item) && (availability === 'in-stock' ? sizes(item)[size] > 0 : sizes(item)[size] <= 0)));
          }
        }
        await page.locator('#clear-filters-btn').click();
        for (const term of ['  ', collectionItems[0].name.toUpperCase(), collectionItems[0].sku, collectionItems[0].color_name.toLowerCase(), 'no-such-product-<>&']) {
          await page.fill('#product-search', term);
          const tokens = term.trim().toLowerCase().split(/\s+/).filter(Boolean);
          await expectProducts(page, collectionItems.filter(item => tokens.every(token => [item.name, item.color_name, item.sku, item.category_name, item.description].join(' ').toLowerCase().includes(token))));
        }
        await page.locator('.cc-catalog-empty button').click();
        await expectProducts(page, collectionItems);
        const candidate = collectionItems.find(item => Number(item.stock_qty) > 0);
        const size = Object.keys(sizes(candidate)).find(size => sizes(candidate)[size] > 0);
        await page.selectOption('#filter-size', size);
        await page.selectOption('#filter-colour', candidate.color_name);
        await page.fill('#filter-min-price', candidate.price);
        await page.fill('#filter-max-price', candidate.price);
        await page.selectOption('#filter-availability', 'in-stock');
        await page.fill('#product-search', candidate.name.toUpperCase());
        const combined = collectionItems.filter(item => sizes(item)[size] > 0 && item.color_name === candidate.color_name && Number(item.price) === Number(candidate.price) && item.name === candidate.name);
        await expectProducts(page, combined);
        for (const mode of ['featured', 'price-asc', 'price-desc', 'name-asc', 'name-desc', 'newest']) {
          await page.selectOption('#product-sort', mode);
          await expectProducts(page, combined);
        }
        await page.locator('#clear-filters-btn').click();
        assert.equal(await page.locator('#product-sort').inputValue(), 'featured');
        assert.equal(await page.locator('#product-search').inputValue(), '');
        await expectProducts(page, featured, true);
        const sorters = {
          'price-asc': (a, b) => Number(a.price) - Number(b.price),
          'price-desc': (a, b) => Number(b.price) - Number(a.price),
          'name-asc': (a, b) => a.name.localeCompare(b.name),
          'name-desc': (a, b) => b.name.localeCompare(a.name),
          newest: (a, b) => Number(b.is_new) - Number(a.is_new) || Number(b.id) - Number(a.id)
        };
        for (const [mode, compare] of Object.entries(sorters)) {
          await page.selectOption('#product-sort', mode);
          await expectProducts(page, [...featured].sort(compare), true);
        }
        // Catalog refresh must preserve both active criteria and original featured order.
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('cc:catalogReady')));
        await expectProducts(page, [...featured].sort(sorters.newest), true);
        await page.locator('#clear-filters-btn').click();
        await expectProducts(page, featured, true);
        if (collection === 'new-arrivals') {
          for (const category of ['tops-tees', 'outerwear', 'bottoms', 'all']) {
            await page.locator(`.category-tab[data-category="${category}"]`).click();
            await expectProducts(page, collectionItems.filter(item => category === 'all' || item.category_slug === (aliases[category] || category)));
            await page.fill('#product-search', 'impossible-search');
            await expectProducts(page, []);
            await page.locator('#clear-filters-btn').click();
          }
        }
        const first = page.locator(visible).first();
        const id = await first.evaluate(element => element.dataset.productId || element.querySelector('[data-product-id]').dataset.productId);
        const item = collectionItems.find(item => key(item) === id);
        const links = await first.locator('a[href*="product-detail.html"]').evaluateAll(links => links.map(link => link.getAttribute('href')));
        assert.ok(links.length >= 2 && links.every(link => new URL(link, base).searchParams.get('id') === id));
        const togglesBefore = counts().toggles;
        await Promise.all([page.waitForResponse(response => response.url().includes('/wishlist/toggle.php')), first.locator('.cc-wishlist-btn').click()]);
        await page.waitForFunction(id => CCStore.isInWishlist(id), id);
        await page.locator('#cc-wishlist-snackbar.is-visible').waitFor();
        assert.equal(counts().toggles, togglesBefore + 1);
        assert.equal(await first.locator('.cc-wishlist-btn').getAttribute('aria-pressed'), 'true');
        assert.equal(await first.locator('.cc-wishlist-btn i').count(), 1);
        await page.fill('#product-search', 'impossible-search');
        await page.locator('#clear-filters-btn').click();
        await Promise.all([page.waitForResponse(response => response.url().includes('/wishlist/toggle.php')), first.locator('.cc-wishlist-btn').click()]);
        await page.waitForFunction(id => !CCStore.isInWishlist(id), id);
        assert.equal(counts().toggles, togglesBefore + 2);
        await first.locator('.cc-product-title').click();
        await page.locator('dialog.cc-qv[open]').waitFor();
        assert.equal(new URL(await page.locator('.cc-qv-details').getAttribute('href'), base).searchParams.get('id'), id);
        const availableSize = Object.keys(sizes(item)).find(size => sizes(item)[size] > 0);
        if (availableSize) {
          await page.locator('.cc-qv-sizes button').filter({ hasText: new RegExp('^' + availableSize + '$') }).click();
          await page.locator('.cc-qv-add').click();
          await page.waitForFunction(() => document.querySelector('.cc-qv-status').textContent.includes('Added'));
          assert.equal(counts().cartAdds, 1);
        }
        await page.locator('.cc-qv-close').click();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('[data-filter-toggle="colour"]').click();
        await page.selectOption('#filter-colour', colours[0]);
        await expectProducts(page, collectionItems.filter(item => item.color_name === colours[0]));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.equal(await page.locator('#catalog-filter-panel').evaluate(element => element.scrollWidth <= element.clientWidth), true);
        await page.locator('#clear-filters-btn').click();
        await expectProducts(page, featured, true);
        assert.equal(counts().navigations, 1, 'Filtering and sorting must not navigate');
        console.log(`${label} ${collection}: sizes, colours, price boundaries, availability, search, combinations, all sorting, reset, links, wishlist, cart and mobile passed (${collectionItems.length} products)`);
      } finally { await context.close(); }
    }
    for (const collection of pages) await exercise(catalog, collection, 'Live API');
    // Additional variants include zero stock, sold-out sizes, new colours, new
    // sizes, duplicate names/SKUs and enough records to require multiple API pages.
    const dynamic = Array.from({ length: 57 }, (_, index) => {
      const original = catalog[index % catalog.length];
      return { ...original, id: 1000 + index, variant_id: 1000 + index, catalog_key: `dynamic-${index}`,
        name: `Dynamic ${index} ${original.name}`, color_name: index % 3 ? 'Custom blue' : 'Custom red',
        price: String(index * 100 + 0.5), is_new: index % 2, stock_qty: index % 3 ? 5 : 0,
        product_stock_qty: 99, size_stock: `4XL:${index % 3 ? 5 : 0},M:0` };
    });
    for (const collection of pages) await exercise([...catalog, ...dynamic], collection, 'Dynamic paginated API');
    for (const collection of pages) {
      const { context, page, counts } = await makePage(catalog);
      try {
        await page.goto(base + collection + '.html', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('#product-grid')?.getAttribute('aria-busy') === 'false');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.fill('#product-search', 'runtime-added-product');
        await expectProducts(page, []);
        await page.evaluate(() => {
          const collection = document.querySelector('[data-collection]').dataset.collection;
          const seed = Object.values(CCStore.getProducts()).find(product => collection === 'shop-all' || (collection === 'new-arrivals' ? product.isNew : product.categorySlug === collection));
          const product = { ...seed, id: 'runtime-added-product', sku: '', name: 'runtime-added-product', color: 'Runtime green', price: 42, sizeStock: 'Custom fit:2', stockQty: 2 };
          CCStore.getProducts()[product.id] = product;
          const originals = CCStore.getLiveCatalogItems();
          CCStore.getLiveCatalogItems = () => [...originals, { catalog_key: product.id }];
          window.dispatchEvent(new CustomEvent('cc:catalogReady'));
          window.dispatchEvent(new CustomEvent('cc:catalogReady'));
        });
        await expectProducts(page, [{ catalog_key: 'runtime-added-product' }]);
        await page.locator('[data-filter-toggle="size"]').click();
        await page.selectOption('#filter-size', 'Custom fit');
        await page.selectOption('#filter-colour', 'Runtime green');
        await page.fill('#filter-min-price', '42');
        await page.fill('#filter-max-price', '42');
        await page.selectOption('#filter-availability', 'in-stock');
        await expectProducts(page, [{ catalog_key: 'runtime-added-product' }]);
        for (const query of ['nothing-matches', 'runtime', 'nothing-matches', 'runtime-added-product']) await page.fill('#product-search', query);
        await expectProducts(page, [{ catalog_key: 'runtime-added-product' }]);
        await page.evaluate(() => Promise.all(document.querySelector('#product-grid').getAnimations().map(animation => animation.finished.catch(() => {}))));
        const wishlist = page.locator(visible + ' .cc-wishlist-btn');
        await Promise.all([page.waitForResponse(response => response.url().includes('/wishlist/toggle.php')), wishlist.click()]);
        assert.equal(counts().toggles, 1);
        assert.equal(await wishlist.getAttribute('aria-pressed'), 'true');
        assert.equal(await wishlist.locator('i.bi-heart-fill').count(), 1);
        await page.locator('#clear-filters-btn').click();
        assert.equal(Number(await page.locator('#piece-count').textContent()), catalog.filter(item => belongs(item, collection)).length + 1);
        console.log(`Runtime update ${collection}: new card without SKU, new size/colour, retained search, combined filters, deduplication, wishlist and filtering transitions passed`);
      } finally { await context.close(); }
    }
    for (const collection of pages) {
      const { context, page } = await makePage([]);
      try {
        await page.goto(base + collection + '.html', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('#product-grid')?.getAttribute('aria-busy') === 'false');
        await expectProducts(page, []);
        await page.locator('.cc-catalog-empty button').click();
        await expectProducts(page, []);
        console.log(`Empty catalog ${collection}: empty state and reset passed`);
      } finally { await context.close(); }
    }
    const { context, page } = await makePage(catalog);
    try {
      let requests = 0;
      await page.route('**/api/catalog/products.php?*', route => {
        requests++;
        return requests === 1 ? route.fulfill({ status: 503, json: { success: false } }) : route.fulfill({ json: { success: true, data: { items: catalog } } });
      });
      await page.goto(base + 'shop-all.html', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('#product-grid')?.getAttribute('aria-busy') === 'false');
      assert.match(await page.locator('#catalog-results-status').textContent(), /Unable to load products/);
      assert.equal(await page.locator('.cc-catalog-empty').isVisible(), false);
      await page.fill('#product-search', catalog[0].name);
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#product-grid')?.getAttribute('aria-busy') === 'false');
      await expectProducts(page, catalog.filter(item => item.name === catalog[0].name));
      assert.equal(requests, 2);
      console.log('Catalog failure: error state, retry and retained search passed');
    } finally { await context.close(); }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
