// Run with the local catalog and Playwright: node tests/product-availability.cjs
const { chromium } = require(process.env.CC_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const base = process.env.CC_TEST_URL || 'http://localhost/classic-club-ph/';
const endpoint = new URL('public/api/catalog/products.php?per_page=50', base);
const key = item => item.catalog_key || `catalog-${item.id}-${item.variant_id}`;
const sizes = item => item.size_stock.split(',').filter(Boolean).map(entry => {
  const [code, stock] = entry.split(':');
  return [code, Number(stock)];
});

(async () => {
  const catalog = [];
  for (let page = 1; ; page++) {
    endpoint.searchParams.set('page', page);
    const { data } = await (await fetch(endpoint)).json();
    catalog.push(...data.items);
    if (data.items.length < 50) break;
  }
  assert.ok(catalog.length > 0);
  const browser = await chromium.launch(process.env.CC_BROWSER_PATH ? { executablePath: process.env.CC_BROWSER_PATH } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const errors = [];
    const wishlist = new Set();
    const cartAdds = [];
    let fixtures;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      const json = data => route.fulfill({ json: { success: true, data } });
      if (['image', 'font'].includes(request.resourceType())) return route.abort();
      if (url.origin !== endpoint.origin && process.env.CC_TEST_ASSETS_DIR) {
        const filename = path.basename(url.pathname);
        if (['bootstrap.min.css', 'bootstrap.bundle.min.js'].includes(filename)) {
          return route.fulfill({ path: path.join(process.env.CC_TEST_ASSETS_DIR, filename) });
        }
        return route.abort();
      }
      if (fixtures && url.pathname.endsWith('/catalog/products.php')) return json({ items: fixtures });
      if (url.pathname.endsWith('/auth/me.php')) return json({ user: { id: 1 } });
      if (url.pathname.endsWith('/auth/csrf.php')) return json({ token: 'browser-test' });
      if (url.pathname.endsWith('/cart/view.php')) return json({ items: [] });
      if (url.pathname.endsWith('/cart/add.php')) {
        cartAdds.push(request.postDataJSON());
        return json({ items: [] });
      }
      if (url.pathname.endsWith('/wishlist/toggle.php')) {
        const { catalog_key: id, saved } = request.postDataJSON();
        if (saved) wishlist.add(id);
        else wishlist.delete(id);
      }
      if (/\/wishlist\/(?:view|toggle)\.php$/.test(url.pathname)) {
        return json({ user_id: 1, items: [...wishlist].map(id => ({ id })) });
      }
      return route.continue();
    });

    const add = page.locator('#add-to-cart-btn');
    const wish = page.locator('.cc-main-wishlist-toggle');
    const total = page.locator('#total-stock-label');
    const status = page.locator('#stock-status-label');
    const options = page.locator('#size-button-row button');
    const open = async item => {
      const url = new URL('product-detail.html', base);
      if (item) url.searchParams.set('id', key(item));
      await page.goto(url.href, { waitUntil: 'domcontentloaded' });
      await total.filter({ hasText: 'total across all variants' }).waitFor();
    };
    const checkSize = async (code, stock) => {
      const option = page.locator(`#size-button-row [data-size="${code}"]`);
      await option.click();
      assert.equal(await option.getAttribute('aria-pressed'), 'true');
      assert.equal(await status.textContent(), `Size ${code} · ${stock} in stock / ${stock > 0 ? 'Ready to ship' : 'Sold out'}`);
      assert.equal(await add.isEnabled(), stock > 0);
      assert.equal(await wish.isEnabled(), true);
    };
    const save = async item => {
      await wish.click();
      await page.evaluate(() => CCStore.syncWishlistFromServer());
      assert.equal(await wish.getAttribute('aria-pressed'), 'true');
      assert.ok(wishlist.has(key(item)));
    };

    let selections = 0;
    for (const item of catalog) {
      await open(item);
      assert.equal(await total.textContent(), `${item.product_stock_qty} total across all variants`);
      const entries = sizes(item);
      assert.deepEqual(await options.evaluateAll(buttons => buttons.map(button => button.dataset.size)), entries.map(([code]) => code));
      for (const [code, stock] of entries) {
        await checkSize(code, stock);
        selections++;
      }
    }
    const defaultItem = catalog.find(item => key(item) === 'essential-hw-tee-obsidian');
    if (defaultItem) {
      await open();
      assert.equal(await total.textContent(), `${defaultItem.product_stock_qty} total across all variants`);
      assert.match(await add.textContent(), /₱/);
    }
    console.log(`Live catalog passed across ${catalog.length} colour variants and ${selections} size selections.`);

    const template = catalog[0];
    const mixed = { ...template, catalog_key: 'availability-mixed', stock_qty: 2, product_stock_qty: 2, size_stock: 'M:0,L:2' };
    const soldOut = { ...template, variant_id: Number(template.variant_id) + 100000, catalog_key: 'availability-sold-out', stock_qty: 0, product_stock_qty: 2, size_stock: 'M:0,L:0' };
    const noSizes = { ...soldOut, id: Number(template.id) + 100000, variant_id: Number(soldOut.variant_id) + 1, catalog_key: 'availability-no-sizes', product_stock_qty: 0, size_stock: '' };
    fixtures = [mixed, soldOut, noSizes];
    await open(mixed);
    assert.equal(await add.isDisabled(), true, 'Default sold-out size blocks the bag');
    await checkSize('L', 2);
    await save(mixed);
    await page.locator('#qty-plus').click();
    await page.locator('#qty-plus').click();
    assert.equal(await page.locator('#qty-value').textContent(), '2');
    await add.click();
    await add.getByText('Added to bag').waitFor();
    assert.deepEqual(cartAdds, [{ catalog_key: key(mixed), size: 'L', quantity: 2 }]);
    await checkSize('M', 0);
    assert.equal(await page.locator('#qty-plus').isDisabled(), true);
    assert.equal(await total.textContent(), '2 total across all variants');
    const rejection = await page.evaluate(async id => {
      let message;
      const added = await CCStore.addToCart({ id, size: 'M', quantity: 1 }, value => { message = value; });
      return { added, message };
    }, key(mixed));
    assert.deepEqual(rejection, { added: false, message: 'This item is out of stock.' });
    assert.equal(cartAdds.length, 1);

    await open(soldOut);
    await checkSize('L', 0);
    assert.equal(await total.textContent(), '2 total across all variants');
    await save(soldOut);
    await open(soldOut);
    assert.equal(await wish.getAttribute('aria-pressed'), 'true');
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      for (const label of [status, total]) {
        const bounds = await label.boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width);
      }
    }

    await open(noSizes);
    assert.equal(await options.count(), 0);
    assert.equal(await add.isDisabled(), true);
    await save(noSizes);
    assert.deepEqual(errors, []);
    console.log('Sold-out sizes, zero-stock variants, quantity limits, cart payload, Wishlist persistence, and responsive stock labels passed.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
