// Run with Playwright installed: node tests/checkout-summary.cjs
const { chromium } = require(process.env.CC_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const base = process.env.CC_TEST_URL || 'http://localhost/classic-club-ph/';

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function scroll(page, y) {
  await page.evaluate(y => window.scrollTo(0, y), y);
  await settle(page);
}

async function bounds(page) {
  return page.evaluate(() => {
    const rect = element => {
      const { top, bottom, height, left, width } = element.getBoundingClientRect();
      return { top, bottom, height, left, width };
    };
    return {
      y: scrollY,
      maxY: document.documentElement.scrollHeight - innerHeight,
      viewport: innerHeight,
      left: rect(document.querySelector('#checkout-form > div')),
      summary: rect(document.querySelector('.cc-checkout-summary'))
    };
  });
}

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1, `${message}: ${actual} vs ${expected}`);
}

async function cart(page, count) {
  await page.evaluate(count => {
    const product = Object.values(CCStore.getProducts())[0];
    localStorage.setItem('cc_cart_data', JSON.stringify(Array.from({ length: count }, (_, i) => ({
      ...product, name: `Checkout test item ${i + 1}`, color: 'Obsidian', size: 'M', quantity: 1, price: 1290
    }))));
    window.dispatchEvent(new CustomEvent('cc:cartUpdated'));
  }, count);
  await settle(page);
  assert.equal(await page.locator('#checkout-items-list > div').count(), count);
}

async function desktop(page, label) {
  await scroll(page, 0);
  const initial = await bounds(page);
  near(initial.summary.top, initial.left.top, `${label}: original column alignment`);
  const tall = initial.summary.height > initial.viewport;
  if (tall) {
    await scroll(page, 80);
    const entering = await bounds(page);
    near(entering.summary.top, initial.summary.top - 80, `${label}: tall card scrolls into view`);
  }

  // Go far enough for the complete card, or its totals on a short screen, to enter.
  await scroll(page, Math.max(initial.summary.top, initial.summary.bottom - initial.viewport + 24) + 100);
  const pinned = await bounds(page);
  assert.ok(pinned.summary.bottom <= pinned.viewport, `${label}: totals fit in the viewport`);
  if (tall) {
    near(pinned.summary.bottom, pinned.viewport - 24, `${label}: tall summary pins at its bottom`);
  } else {
    assert.ok(pinned.summary.top >= 0, `${label}: whole summary stays visible`);
    near(pinned.summary.top, pinned.viewport - pinned.summary.bottom, `${label}: equal top and bottom spacing`);
  }

  await scroll(page, pinned.y + 200);
  const continued = await bounds(page);
  near(continued.summary.top, pinned.summary.top, `${label}: summary stays in place`);
  near(continued.left.top, pinned.left.top - 200, `${label}: left column continues scrolling`);
  await page.mouse.move(continued.summary.left + 50, Math.max(50, continued.summary.top + 50));
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(y => scrollY > y + 100, continued.y);
  await settle(page);
  near((await bounds(page)).summary.top, pinned.summary.top, `${label}: wheel over summary scrolls the page`);
  await scroll(page, pinned.y + 100);
  near((await bounds(page)).summary.top, pinned.summary.top, `${label}: summary also stays pinned scrolling back`);

  const end = initial.left.bottom - pinned.summary.bottom;
  const exitStep = Math.min(80, (pinned.maxY - end) / 2);
  assert.ok(exitStep > 1, `${label}: footer leaves room to observe the synchronized exit`);
  await scroll(page, end + exitStep);
  const released = await bounds(page);
  near(released.summary.bottom, released.left.bottom, `${label}: both columns finish together`);
  assert.ok(released.summary.top < pinned.summary.top - exitStep + 1, `${label}: summary releases at the form bottom`);
  await scroll(page, end + exitStep * 2);
  const finished = await bounds(page);
  near(finished.summary.bottom, released.summary.bottom - exitStep, `${label}: both columns leave together`);
  near(finished.summary.bottom, finished.left.bottom, `${label}: bottom alignment persists`);
  await scroll(page, 0);
  near((await bounds(page)).summary.top, initial.summary.top, `${label}: scrolling back restores alignment`);
  console.log(`${label}: pinning, natural wheel scrolling and synchronized finish passed`);
}

(async () => {
  const browser = await chromium.launch(process.env.CC_BROWSER_PATH ? { executablePath: process.env.CC_BROWSER_PATH } : {});
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== new URL(base).origin) {
        const filename = path.basename(url.pathname);
        if (process.env.CC_TEST_ASSETS_DIR && ['bootstrap.min.css', 'bootstrap.bundle.min.js'].includes(filename)) {
          return route.fulfill({ path: path.join(process.env.CC_TEST_ASSETS_DIR, filename) });
        }
        return route.continue();
      }
      // Keep account and cart state inside this isolated browser context.
      if (/\/(auth\/me|cart\/view|wishlist\/view)\.php$/.test(url.pathname)) {
        return route.fulfill({ json: { success: true, data: { user: null, items: [] } } });
      }
      if (request.method() !== 'GET') return route.abort();
      return route.continue();
    });
    await page.goto(base + 'checkout.html', { waitUntil: 'load' });
    await page.waitForFunction(() => typeof CCStore !== 'undefined' && CCStore.isCatalogLoaded() &&
      document.querySelector('#header-partial header') && document.querySelector('#footer-partial footer') &&
      !document.querySelector('.cc-global-loader') &&
      document.querySelector('#checkout-subtotal-label').textContent.includes('pieces'));
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('.cc-checkout-summary > div').count(), 1, 'Right column contains only the summary card');

    await desktop(page, '1440 x 900, empty cart');
    await cart(page, 1);
    await desktop(page, '1440 x 900, one item');
    await cart(page, 2);
    await desktop(page, '1440 x 900, two items');
    await page.setViewportSize({ width: 1440, height: 600 });
    await cart(page, 1);
    await desktop(page, '1440 x 600, one item');
    await cart(page, 6);
    await desktop(page, '1440 x 600, six items');
    await page.setViewportSize({ width: 992, height: 720 });
    await settle(page);
    await desktop(page, '992 x 720, six items');

    // Resize the window and change cart height while the summary is already pinned.
    await page.setViewportSize({ width: 1440, height: 600 });
    await scroll(page, 1500);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await settle(page);
    near((await bounds(page)).summary.bottom, 976, 'Viewport resize updates the pinned position');
    await cart(page, 1);
    const shortened = await bounds(page);
    assert.ok(shortened.summary.top >= 0 && shortened.summary.bottom <= 976, 'Cart shrink keeps the whole summary visible');
    near(shortened.summary.top, shortened.viewport - shortened.summary.bottom, 'Cart shrink centers the summary');
    await page.setViewportSize({ width: 1440, height: 800 });
    await settle(page);
    const resized = await bounds(page);
    near(resized.summary.top, resized.viewport - resized.summary.bottom, 'Viewport resize keeps equal top and bottom spacing');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await cart(page, 6);
    near((await bounds(page)).summary.bottom, 976, 'Cart growth keeps the totals visible');
    console.log('Viewport resizing and live cart height changes passed');

    for (const width of [991, 768, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await cart(page, 1);
      await scroll(page, 0);
      const initial = await bounds(page);
      assert.ok(initial.summary.top >= initial.left.bottom, `${width}px: summary follows the five checkout sections`);
      await scroll(page, 200);
      near((await bounds(page)).summary.top, initial.summary.top - 200, `${width}px: mobile scrolls naturally`);
      assert.equal(await page.locator('.cc-checkout-summary').evaluate(el => getComputedStyle(el).position), 'static');
      assert.ok(initial.summary.left >= 0 && initial.summary.left + initial.summary.width <= width,
        `${width}px: summary stays within the viewport width`);
    }
    console.log('991px, 768px and 390px stacked mobile layouts passed');
    assert.deepEqual(errors, [], 'No browser JavaScript errors');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
