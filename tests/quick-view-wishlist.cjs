// Run with Playwright installed: node tests/quick-view-wishlist.cjs
// Catalog reads are live; wishlist/cart requests are intercepted.
const { chromium } = require(process.env.CC_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const base = process.env.CC_TEST_URL || 'http://localhost/classic-club-ph/';
const pages = fs.readdirSync(root, { recursive: true }).filter(file => file.endsWith('.html') &&
  fs.readFileSync(path.join(root, file), 'utf8').includes('cc-product-card'));

async function expectOverlay(card, opacity) {
  await card.locator('.cc-qv-overlay').evaluate((overlay, expected) => new Promise((resolve, reject) => {
    const deadline = performance.now() + 2000;
    function check() {
      if (getComputedStyle(overlay).opacity === expected) return resolve();
      if (performance.now() > deadline) return reject(new Error(`Expected Quick View opacity ${expected}, got ${getComputedStyle(overlay).opacity}`));
      requestAnimationFrame(check);
    }
    check();
  }), opacity);
}

async function prepare(page) {
  // Keep server state outside the page: writes may finish during navigation.
  page.wishlistServer = new Set();
  await page.addInitScript(() => {
    window.catalogReady = false;
    window.wishlistActions = [];
    window.addEventListener('cc:catalogReady', () => { window.catalogReady = true; });
    window.addEventListener('cc:wishlistChanged', event => window.wishlistActions.push(event.detail));
  });
  await page.route('**/public/api/auth/csrf.php', route => route.fulfill({ json: { success: true, data: { token: 'test' } } }));
  await page.route('**/public/api/wishlist/*.php', async route => {
    if (route.request().method() === 'POST') {
      const { catalog_key: id, saved } = route.request().postDataJSON();
      saved ? page.wishlistServer.add(id) : page.wishlistServer.delete(id);
    }
    const ids = [...page.wishlistServer];
    await route.fulfill({ json: { success: true, data: { items: ids.map(id => ({ id })) } } });
  });
  await page.route('**/public/api/cart/*.php', route => route.fulfill({ json: { success: true, data: { items: [] } } }));
}

async function visit(page, file) {
  await page.goto(new URL(file.replaceAll('\\', '/'), base).href);
  await page.waitForFunction(() => window.catalogReady);
  if (file === 'wishlist.html') {
    const ids = await page.evaluate(() => {
      const ids = Object.keys(CCStore.getProducts());
      localStorage.setItem('cc_wishlist_data', JSON.stringify(ids));
      window.dispatchEvent(new CustomEvent('cc:wishlistUpdated'));
      return ids;
    });
    page.wishlistServer = new Set(ids);
  }
  await page.locator('.cc-product-card .cc-qv-overlay').first().waitFor({ state: 'attached' });
}

async function expectAction(page, button, action) {
  const before = await page.evaluate(() => window.wishlistActions.length);
  await action();
  await page.waitForFunction(count => window.wishlistActions.length === count + 1, before);
  const result = await page.evaluate(() => window.wishlistActions.at(-1));
  assert.equal(await page.evaluate(id => CCStore.isInWishlist(id), result.productId), result.saved);
  if (await button.count() && await button.evaluate(button => button.dataset.productId || button.dataset.id || button.closest('[data-product-id]')?.dataset.productId) === result.productId) {
    assert.equal(await button.getAttribute('aria-pressed'), String(result.saved));
  }
  assert.equal(await page.locator('dialog[open]').count(), 0, 'Wishlist must not open Quick View');
}

(async () => {
  const browser = await chromium.launch(process.env.CC_BROWSER_PATH ? { executablePath: process.env.CC_BROWSER_PATH } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await prepare(page);
    let tested = 0;
    for (const file of pages) {
      assert.match(fs.readFileSync(path.join(root, file), 'utf8'), /assets\/css\/quick-view\.css/, file);
      await visit(page, file);
      const url = page.url();
      const cards = page.locator('.cc-product-card:visible');
      const count = await cards.count();
      for (let i = 0; i < count; i++) {
        // Wishlist removal replaces the grid, so always use its first remaining card.
        const card = cards.nth(file === 'wishlist.html' ? 0 : i);
        const button = card.locator('.cc-wishlist-btn');
        await card.scrollIntoViewIfNeeded();
        await page.mouse.move(0, 0);
        await expectOverlay(card, '0');
        await card.locator('.cc-product-title').hover();
        await expectOverlay(card, '1');
        await button.hover();
        await expectOverlay(card, '0');
        await page.mouse.move(0, 0);
        await button.focus();
        await expectOverlay(card, '0');
        if (file === 'wishlist.html') {
          await expectAction(page, button, () => button.press('Enter'));
          assert.equal(await cards.count(), count - i - 1);
        } else {
          await expectAction(page, button, async () => {
            const response = page.waitForResponse('**/public/api/wishlist/toggle.php');
            await button.press(i % 2 ? 'Space' : 'Enter');
            await response;
          });
          await expectOverlay(card, '0');
          await expectAction(page, button, async () => {
            const response = page.waitForResponse('**/public/api/wishlist/toggle.php');
            await button.click();
            await response;
          });
          await expectOverlay(card, '0');
          await page.mouse.move(0, 0);
          await expectOverlay(card, '0');
          // Retained button focus must not prevent a fresh card hover.
          await card.locator('.cc-product-title').hover();
          await expectOverlay(card, '1');
          await card.locator('.cc-qv-image-link').click();
          await page.locator('dialog[open]').waitFor();
          await page.keyboard.press('Escape');
        }
        assert.equal(page.url(), url, 'Wishlist and Quick View must not navigate');
        tested++;
      }
      console.log(`${file}: ${count} cards passed hover, wishlist isolation and keyboard checks`);
    }

    // Verify the animated path as well as reduced motion.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await visit(page, 'shop-all.html');
    const card = page.locator('.cc-product-card:visible').first();
    await card.locator('.cc-qv-image-link').hover();
    await expectOverlay(card, '1');
    await card.locator('.cc-wishlist-btn').hover();
    await expectOverlay(card, '0');
    await page.mouse.move(0, 0);
    await card.locator('.cc-wishlist-btn').focus();
    await expectOverlay(card, '0');

    const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    await prepare(touch);
    for (const file of pages) {
      await visit(touch, file);
      assert.equal(await touch.evaluate(() => matchMedia('(hover: none)').matches), true);
      const card = touch.locator('.cc-product-card:visible').first();
      const button = card.locator('.cc-wishlist-btn');
      await expectOverlay(card, '0');
      await expectAction(touch, button, async () => {
        const response = file === 'wishlist.html' ? null : touch.waitForResponse('**/public/api/wishlist/toggle.php');
        await button.tap();
        if (response) await response;
      });
      if (file !== 'wishlist.html') await expectOverlay(card, '0');
      await card.locator('.cc-qv-image-link').tap();
      await touch.locator('dialog[open]').waitFor();
      await touch.locator('.cc-qv-close').click();
    }
    console.log(`PASS: ${pages.length} pages, ${tested} desktop cards, touch wishlist isolation and Quick View, animated and reduced-motion labels.`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
