// Run with Playwright installed: node tests/wishlist-snackbar.cjs
// Catalog reads are live; wishlist and cart writes are intercepted.
const { chromium } = require(process.env.CC_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.CC_TEST_URL || 'http://localhost/classic-club-ph/';

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.wishlistActions = [];
      window.catalogReady = false;
      window.addEventListener('cc:wishlistChanged', e => window.wishlistActions.push(e.detail));
      window.addEventListener('cc:catalogReady', () => { window.catalogReady = true; });
    });
    await page.route('**/public/api/auth/csrf.php', r => r.fulfill({ json: { success: true, data: { token: 'test' } } }));
    await page.route('**/public/api/wishlist/*.php', async r => {
      const ids = await page.evaluate(() => JSON.parse(localStorage.getItem('cc_wishlist_data') || '[]'));
      await r.fulfill({ json: { success: true, data: { items: ids.map(id => ({ id })) } } });
    });
    await page.route('**/public/api/cart/*.php', r => r.fulfill({ json: { success: true, data: { items: [] } } }));
    // Add a new catalog item to exercise asynchronously inserted wishlist buttons.
    await page.route('**/public/api/catalog/products.php*', async r => {
      const response = await r.fetch();
      const json = await response.json();
      const source = json.data.items[0];
      for (const category of ['tops-tees', 'bottoms-accessories', 'outerwear-hoodies']) {
        json.data.items.push({ ...source, id: 900, variant_id: category,
          catalog_key: `test-${category}`, sku: `TEST-${category}`, category_slug: category, is_new: 1 });
      }
      await r.fulfill({ json });
    });

    // Scan every HTML file and exercise every static and generated wishlist control.
    const pages = fs.readdirSync('.').filter(file => file.endsWith('.html') &&
      /cc-wishlist-btn|cc-main-wishlist-toggle/.test(fs.readFileSync(file, 'utf8')));
    let toggles = 0;
    for (const file of pages) {
      await page.goto(`${base}${file}`);
      await page.waitForFunction(() => window.catalogReady);
      assert.equal(await page.locator('#cc-wishlist-snackbar').textContent(), '');
      if (file === 'wishlist.html') {
        await page.evaluate(() => {
          localStorage.setItem('cc_wishlist_data', JSON.stringify(Object.keys(CCStore.getProducts())));
          window.dispatchEvent(new CustomEvent('cc:wishlistUpdated'));
        });
        const ids = await page.locator('.js-remove-wishlist').evaluateAll(buttons => buttons.map(b => b.dataset.id));
        for (const id of ids) {
          await page.locator(`.js-remove-wishlist[data-id="${id}"]`).click();
          assert.equal(await page.locator('#cc-wishlist-snackbar').textContent(), 'Removed from wishlist');
          assert.equal(await page.evaluate(id => CCStore.isInWishlist(id), id), false);
          toggles++;
        }
      } else {
        const buttons = page.locator('.cc-wishlist-btn, .cc-main-wishlist-toggle');
        for (let i = 0; i < await buttons.count(); i++) {
          const button = buttons.nth(i);
          const id = await button.evaluate(b => b.dataset.productId || b.closest('[data-product-id]').dataset.productId);
          for (let j = 0; j < 2; j++) {
            const before = await page.evaluate(id => ({ saved: CCStore.isInWishlist(id), count: window.wishlistActions.length }), id);
            const response = page.waitForResponse('**/public/api/wishlist/toggle.php');
            // Also covers cards hidden by catalog availability or collection filters.
            await button.evaluate(b => b.click());
            await response;
            await page.waitForFunction(({ id, saved }) => CCStore.isInWishlist(id) !== saved, { id, saved: before.saved });
            assert.equal(await page.locator('#cc-wishlist-snackbar').textContent(), before.saved ? 'Removed from wishlist' : 'Added to wishlist');
            assert.equal(await button.getAttribute('aria-pressed'), String(!before.saved));
            assert.equal(await page.evaluate(() => window.wishlistActions.length), before.count + 1);
          }
          toggles++;
        }
      }
      assert.equal(await page.locator('#cc-wishlist-snackbar').count(), 1);
      console.log(`${file}: wishlist controls passed`);
    }

    await page.goto(`${base}shop-all.html`);
    await page.waitForFunction(() => window.catalogReady);
    const button = page.locator('.cc-wishlist-btn').first();
    await button.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('#cc-wishlist-snackbar').classList.contains('is-visible'));
    assert.equal(await button.evaluate(b => b === document.activeElement), true);
    const snackbar = page.locator('#cc-wishlist-snackbar');
    assert.equal(await snackbar.getAttribute('role'), 'status');
    assert.equal(await snackbar.getAttribute('aria-live'), 'polite');
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      const rect = await snackbar.boundingBox();
      assert.ok(rect.x >= 0 && rect.x + rect.width <= width);
      assert.ok(Math.abs(rect.x + rect.width / 2 - width / 2) < 1);
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await snackbar.evaluate(e => getComputedStyle(e).transitionDuration), '0s');
    await page.waitForFunction(() => !document.querySelector('#cc-wishlist-snackbar').classList.contains('is-visible'));
    await page.waitForFunction(() => document.querySelector('#cc-wishlist-snackbar').textContent === '');

    // Rapid alternating actions replace the notification and restart its timer.
    await button.evaluate(b => { b.click(); b.click(); b.click(); });
    await page.waitForFunction(() => document.querySelector('#cc-wishlist-snackbar').classList.contains('is-visible'));
    assert.equal(await snackbar.count(), 1);
    await page.waitForTimeout(2000);
    await button.evaluate(b => b.click());
    await page.waitForTimeout(1800);
    assert.equal(await snackbar.evaluate(e => e.classList.contains('is-visible')), true);
    await page.waitForFunction(() => !document.querySelector('#cc-wishlist-snackbar').classList.contains('is-visible'));
    assert.deepEqual(errors, []);
    console.log(`PASS: ${pages.length} pages, ${toggles} wishlist controls, keyboard, responsive layout, reduced motion, dismissal and deduplication.`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
