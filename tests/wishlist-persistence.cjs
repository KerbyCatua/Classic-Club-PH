// node tests/wishlist-persistence.cjs (Playwright required).
// Live pages/catalog; independent server state so local-only writes cannot pass.
const { chromium } = require(process.env.CC_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.CC_TEST_URL || 'http://localhost/classic-club-ph/';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

(async () => {
  const catalog = (await (await fetch(base + 'public/api/catalog/products.php?per_page=50')).json()).data.items;
  const ids = [...new Set(catalog.map(p => p.catalog_key))].slice(0, 8);
  assert.equal(ids.length, 8);
  let server = new Set(ids), writes = [], holdRead, holdWrite, failWrites = false;
  const browser = await chromium.launch();
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const errors = [];
  context.on('page', page => {
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  });
  await context.route('**/public/api/**', async route => {
    const url = new URL(route.request().url());
    const json = data => route.fulfill({ json: { success: true, data } });
    if (url.pathname.endsWith('/wishlist/view.php')) {
      const items = [...server].map(id => ({ id }));
      if (holdRead) { const gate = holdRead; holdRead = null; gate.started.resolve(); await gate.release.promise; }
      return json({ items });
    }
    if (url.pathname.endsWith('/wishlist/toggle.php')) {
      const { catalog_key: id, saved } = route.request().postDataJSON();
      assert.equal(typeof saved, 'boolean', 'writes must specify the desired state');
      writes.push({ id, saved });
      if (failWrites) return route.fulfill({ json: { success: false, error: { message: 'Simulated connection failure' } } });
      saved ? server.add(id) : server.delete(id);
      const items = [...server].map(id => ({ id }));
      if (holdWrite) { const gate = holdWrite; holdWrite = null; gate.started.resolve(); await gate.release.promise; }
      return json({ items });
    }
    if (url.pathname.endsWith('/auth/csrf.php')) return json({ token: 'test' });
    if (url.pathname.endsWith('/auth/me.php')) return json({ user: { id: 1 } });
    if (url.pathname.includes('/cart/')) return json({ items: [] });
    return route.continue();
  });
  const page = await context.newPage();
  async function settle(target = page) {
    await target.evaluate(async () => { await CCStore.whenCatalogReady(); await CCStore.syncWishlistFromServer(); });
  }
  async function visit(file, target = page) {
    await target.goto(base + file);
    await settle(target);
  }
  async function expectIds(expected, target = page) {
    assert.deepEqual((await target.evaluate(() => CCStore.getWishlist())).sort(), [...expected].sort());
    assert.deepEqual((await target.evaluate(() => JSON.parse(localStorage.getItem('cc_wishlist_data')))).sort(), [...expected].sort());
    assert.deepEqual([...server].sort(), [...expected].sort());
  }
  async function expectEmpty() {
    await expectIds([]);
    assert.equal(await page.locator('.js-remove-wishlist').count(), 0);
    assert.match(await page.locator('#wishlist-grid').textContent(), /haven't saved any pieces/);
    assert.match(await page.locator('#wishlist-count-label').textContent(), /^0 SAVED PIECES/);
    assert.equal(await page.locator('#wishlist-bottom-note').evaluate(el => el.classList.contains('d-none')), true);
  }
  try {
    await visit('wishlist.html');
    assert.equal(await page.locator('.js-remove-wishlist').count(), 8);
    await page.locator(`.js-remove-wishlist[data-id="${ids[0]}"]`).click();
    await visit('shop-all.html');
    await visit('wishlist.html');
    await expectIds(ids.slice(1));
    assert.equal(await page.locator('.js-remove-wishlist').count(), 7);
    while (await page.locator('.js-remove-wishlist').count()) await page.locator('.js-remove-wishlist').first().click();
    await visit('shop-all.html');
    await visit('wishlist.html');
    await expectEmpty();
    await page.reload(); await settle(); await expectEmpty();
    console.log('PASS: remove one/all, immediate navigation, reload and empty-state UI');

    await visit('shop-all.html');
    const heart = page.locator(`.cc-wishlist-btn[data-product-id="${ids[0]}"]`);
    await heart.click(); await settle(); await expectIds([ids[0]]);
    await visit(`product-detail.html?id=${ids[0]}`);
    assert.equal(await page.locator('.cc-main-wishlist-toggle').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.wishlist-btn-text').textContent(), 'Saved to wishlist');
    await page.locator('.cc-main-wishlist-toggle').click(); await settle(); await expectIds([]);
    const collection = catalog.find(p => p.catalog_key === ids[0]).category_slug;
    await visit(collection + '.html');
    await page.locator(`.cc-wishlist-btn[data-product-id="${ids[0]}"]`).click(); await settle();
    await visit('wishlist.html'); await expectIds([ids[0]]);
    await page.reload(); await settle(); await expectIds([ids[0]]);
    console.log('PASS: add again, product/collection synchronization and reload');

    // Existing product page reacts to another tab, including its text and icon.
    const other = await context.newPage();
    await visit(`product-detail.html?id=${ids[0]}`, other);
    await page.locator('.js-remove-wishlist').click(); await settle();
    await other.waitForFunction(() => document.querySelector('.cc-main-wishlist-toggle').getAttribute('aria-pressed') === 'false');
    assert.equal(await other.locator('.wishlist-btn-text').textContent(), 'Save to wishlist');
    assert.equal(await other.locator('.cc-main-wishlist-toggle .bi-heart').count(), 1);
    await other.close();
    console.log('PASS: cross-tab product heart, accessibility and label synchronization');

    await page.evaluate(id => { CCStore.addToWishlist(id); CCStore.addToWishlist(id); }, ids[0]);
    await settle(); await expectIds([ids[0]]);
    await page.evaluate(id => {
      localStorage.setItem('cc_wishlist_data', JSON.stringify([id, id, null, 42]));
      dispatchEvent(new CustomEvent('cc:wishlistUpdated'));
    }, ids[0]);
    assert.equal(await page.locator('.js-remove-wishlist').count(), 1);
    await page.locator('.js-remove-wishlist').click(); await settle(); await expectEmpty();
    console.log('PASS: repeated adds and legacy duplicate/invalid stored entries');

    await page.evaluate(id => CCStore.addToWishlist(id), ids[0]); await settle();
    holdRead = { started: deferred(), release: deferred() };
    const reading = holdRead;
    const refresh = page.evaluate(() => CCStore.syncWishlistFromServer());
    await reading.started.promise;
    await page.locator('.js-remove-wishlist').click();
    reading.release.resolve(); await refresh; await settle(); await expectEmpty();
    console.log('PASS: stale page-load response cannot restore a newer deletion');

    holdWrite = { started: deferred(), release: deferred() };
    const writing = holdWrite;
    await page.evaluate(id => CCStore.addToWishlist(id), ids[0]);
    await writing.started.promise;
    await page.evaluate(id => { CCStore.removeFromWishlist(id); CCStore.addToWishlist(id); CCStore.removeFromWishlist(id); }, ids[0]);
    writing.release.resolve(); await settle(); await expectEmpty();
    console.log('PASS: rapid clicks and stale mutation response preserve latest intent');

    await page.evaluate(id => CCStore.addToWishlist(id), ids[0]); await settle();
    failWrites = true;
    await page.locator('.js-remove-wishlist').click(); await settle();
    assert.equal(server.has(ids[0]), true);
    assert.deepEqual(await page.evaluate(() => CCStore.getWishlist()), []);
    await visit('shop-all.html'); await visit('wishlist.html');
    assert.equal(await page.locator('.js-remove-wishlist').count(), 0);
    assert.ok(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('cc_wishlist_pending'))).length));
    failWrites = false;
    await page.evaluate(() => dispatchEvent(new Event('online'))); await settle(); await expectEmpty();
    console.log('PASS: failed deletion survives navigation and retries on reconnect');

    // Server commits but the response is interrupted by navigation; replay is safe.
    holdWrite = { started: deferred(), release: deferred() };
    const interrupted = holdWrite;
    await page.evaluate(id => CCStore.addToWishlist(id), ids[0]); await interrupted.started.promise;
    await page.goto(base + 'shop-all.html');
    interrupted.release.resolve(); await settle(); await expectIds([ids[0]]);
    assert.ok(writes.filter(write => write.id === ids[0] && write.saved).length > 1);
    console.log('PASS: committed request with lost response replays without toggling');

    await visit('wishlist.html');
    await page.locator('.js-move-to-bag').click();
    await page.waitForFunction(() => CCStore.getWishlist().length === 0);
    await settle(); await expectEmpty();
    await page.evaluate(id => CCStore.moveToWishlist(id, 'Obsidian', 'M'), ids[0]);
    await settle(); await visit('shop-all.html'); await visit('wishlist.html'); await expectIds([ids[0]]);
    console.log('PASS: move to bag removes persistently; move to wishlist persists');
    assert.deepEqual(errors, [], 'browser console and runtime errors');
    console.log('PASS: no browser console or runtime errors');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
