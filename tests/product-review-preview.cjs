// Run with Playwright installed: node tests/product-review-preview.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.CC_TEST_URL || 'http://localhost/classic-club-ph/';
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
    await page.route('**/*', route => route.request().resourceType() === 'image' ? route.abort() : route.continue());
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const catalog = await (await fetch(base + 'public/api/catalog/products.php')).json();
    let emptyTested = false;
    for (const item of catalog.data.items.slice(0, 4)) {
      const key = item.catalog_key;
      const data = (await (await fetch(base + 'public/api/reviews/eligibility.php?variant=' + encodeURIComponent(key))).json()).data;
      assert.equal(data.variant.catalog_key, key);
      assert.ok(data.reviews.every(r => Number(r.variant_id) === Number(item.variant_id)));
      await page.goto(base + 'product-detail.html?id=' + encodeURIComponent(key), {waitUntil: 'domcontentloaded'});
      await page.waitForFunction(() => document.querySelector('[data-review-count]')?.textContent !== 'Loading reviews' + String.fromCharCode(8230));
      const count = data.reviews.length;
      assert.equal(await page.locator('#product-review-preview .review-item-row').count(), Math.min(3, count));
      assert.equal(await page.locator('[data-review-average]').textContent(), count ? (data.reviews.reduce((s,r) => s + Number(r.rating), 0) / count).toFixed(1) : String.fromCharCode(8212));
      const url = new URL(await page.locator('[data-review-link]').getAttribute('href'), base);
      assert.equal(url.pathname, new URL('review-product.html', base).pathname);
      assert.equal(url.searchParams.get('id'), key);
      assert.equal(url.searchParams.get('variant'), key);
      assert.equal(url.searchParams.get('variant_id'), String(item.variant_id));
      assert.equal(url.searchParams.get('product_id'), String(item.id));
      assert.equal(url.searchParams.has('order_number'), false);
      for (let i = 0; i < Math.min(3, count); i++) assert.equal(await page.locator('#product-review-preview h4').nth(i).textContent(), data.reviews[i].title);
      await page.locator('[data-review-link]').click();
      await page.waitForFunction(() => document.querySelector('[data-review-count]')?.textContent !== 'Loading reviews' + String.fromCharCode(8230));
      assert.equal(await page.locator('#review-product-title').textContent(), item.name);
      assert.equal(await page.locator('#reviews-list-container .review-item-row').count(), count);
      assert.equal(await page.locator('#form-variant-id').inputValue(), String(item.variant_id));
      if (!count) { emptyTested = true; assert.match(await page.locator('#reviews-list-container').textContent(), /No reviews yet/); }
      await page.setViewportSize({width: 390, height: 844});
      assert.ok(await page.locator('#reviews-list-container').evaluate(el => el.scrollWidth <= el.clientWidth));
      await page.goto(base + 'product-detail.html?id=' + encodeURIComponent(key), {waitUntil: 'domcontentloaded'});
      await page.locator('[data-review-link][href]').waitFor();
      assert.ok(await page.locator('#product-review-preview').evaluate(el => el.scrollWidth <= el.clientWidth));
      await page.setViewportSize({width: 1440, height: 1000});
      console.log(key + ': preview, redirect, review page and mobile passed (' + count + ' reviews)');
    }
    assert.ok(emptyTested, 'Expected a product without reviews in the tested catalog');
    const invalid = await (await fetch(base + 'public/api/reviews/eligibility.php?variant=missing-product')).json();
    assert.equal(invalid.data.variant, null);
    assert.deepEqual(invalid.data.reviews, []);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
