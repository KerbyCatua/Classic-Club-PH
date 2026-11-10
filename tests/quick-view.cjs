// Run with Playwright installed: node tests/quick-view.cjs
// Uses the live read-only catalog; cart writes are intercepted below.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.CC_TEST_URL || 'http://localhost/classic-club-ph/';
(async () => {
  const browser = await chromium.launch(process.env.CC_BROWSER_PATH ? { executablePath: process.env.CC_BROWSER_PATH } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    let tested = 0;
    for (const file of fs.readdirSync('.').filter(f => f.endsWith('.html'))) {
      assert.match(fs.readFileSync(file, 'utf8'), /assets\/js\/quick-view.js/, file);
    }
    const pages = ['index', 'shop-all', 'new-arrivals', 'tops-tees', 'bottoms-accessories', 'outerwear-hoodies', 'lookbook', 'cart', 'product-detail', 'wishlist'];
    for (const name of pages) {
      await page.goto(`${base}${name}.html`);
      await page.waitForFunction(() => typeof CCStore !== 'undefined' && Object.keys(CCStore.getProducts()).length > 0);
      if (name === 'wishlist') {
        await page.evaluate(() => {
          localStorage.setItem('cc_wishlist_data', JSON.stringify(Object.keys(CCStore.getProducts())));
          window.dispatchEvent(new CustomEvent('cc:wishlistUpdated'));
        });
      }
      const cards = page.locator('.cc-product-card:visible');
      await cards.first().waitFor();
      for (let i = 0; i < await cards.count(); i++) {
        const card = cards.nth(i);
        const title = await card.locator('.cc-product-title').textContent();
        await card.locator('.cc-qv-image-link').click();
        await page.locator('dialog[open]').waitFor();
        assert.equal((await page.locator('.cc-qv-title').textContent()).trim(), title.trim());
        assert.equal(await page.locator('.cc-qv').count(), 1);
        await page.waitForFunction(() => {
          const image = document.querySelector('.cc-qv-photo');
          return image.complete && image.naturalWidth > 0;
        });
        assert.match(decodeURI(await page.locator('.cc-qv-photo').getAttribute('src')), /CC-Products JPG HIGH QUALITY\/.*\.jpg$/);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('dialog[open]').count(), 0);
        tested++;
      }
      console.log(`${name}: ${await cards.count()} cards passed`);
    }
    await page.evaluate(() => CCQuickView.open('essential-hw-tee-obsidian'));
    await page.locator('.cc-qv-swatch[aria-label="Chalk"]').click();
    assert.match(await page.locator('.cc-qv-photo').getAttribute('src'), /05 ESSENTIAL/);
    await page.locator('.cc-qv-sizes button', { hasText: /^L$/ }).click();
    assert.equal(await page.locator('.cc-qv-size-label').textContent(), 'Size — L');
    await page.waitForFunction(() => document.querySelector('.cc-qv-photo').complete);
    const rect = await page.locator('.cc-qv-photo').boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    assert.equal(await page.locator('.cc-qv-zoom').isVisible(), true);
    const firstPosition = await page.locator('.cc-qv-zoom').evaluate(e => e.style.backgroundPosition);
    await page.mouse.move(rect.x + rect.width / 2 + 40, rect.y + rect.height / 2 + 30);
    assert.notEqual(await page.locator('.cc-qv-zoom').evaluate(e => e.style.backgroundPosition), firstPosition);
    const geometry = await page.evaluate(() => {
      const img = document.querySelector('.cc-qv-photo'), lens = document.querySelector('.cc-qv-lens'), zoom = document.querySelector('.cc-qv-zoom');
      const scale = Math.min(img.clientWidth / img.naturalWidth, img.clientHeight / img.naturalHeight);
      const left = (img.clientWidth - img.naturalWidth * scale) / 2;
      return { actual: parseFloat(zoom.style.backgroundPositionX), expected: -(parseFloat(lens.style.left) - left) * 2.5 };
    });
    assert.ok(Math.abs(geometry.actual - geometry.expected) < 1);
    await page.mouse.move(0, 0);
    assert.equal(await page.locator('.cc-qv-zoom').isVisible(), false);
    await page.locator('.cc-qv-close').focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.querySelector('.cc-qv').contains(document.activeElement)), true);
    let payload;
    await page.route('**/public/api/auth/me.php', r => r.fulfill({ json: { success: true, data: {} } }));
    await page.route('**/public/api/auth/csrf.php', r => r.fulfill({ json: { success: true, data: { token: 'test' } } }));
    await page.route('**/public/api/cart/add.php', r => {
      payload = r.request().postDataJSON();
      return r.fulfill({ json: { success: true, data: { items: [{ id: payload.catalog_key, size: payload.size, quantity: 1 }] } } });
    });
    await page.locator('.cc-qv-add').click();
    await page.waitForFunction(() => document.querySelector('.cc-qv-status').textContent === 'Added to your bag.');
    assert.equal(payload.catalog_key, 'essential-hw-tee-chalk');
    assert.equal(payload.size, 'L');
    await page.locator('.cc-qv-close').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => CCQuickView.open('textured-knit-polo-oat'));
    const mobile = await page.locator('.cc-qv').boundingBox();
    assert.ok(mobile.x >= 0 && mobile.x + mobile.width <= 390);
    await page.locator('.cc-qv-details').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('.cc-qv-details').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.body.style.overflow), '');
    console.log(`PASS: ${tested} product cards, variant/size switching, magnifier geometry, keyboard containment, mocked server cart integration, mobile layout.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
