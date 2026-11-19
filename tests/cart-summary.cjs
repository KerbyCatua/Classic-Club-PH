// Run with Playwright installed: node tests/cart-summary.cjs
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

async function action(page, button, endpoint) {
  const [response] = await Promise.all([
    page.waitForResponse(response => response.url().includes(endpoint)),
    button.click()
  ]);
  assert.ok(response.ok(), `${endpoint}: existing action succeeds`);
  await settle(page);
}

async function bounds(page) {
  return page.evaluate(() => {
    const rect = selector => {
      const { top, bottom, height, left, width } = document.querySelector(selector).getBoundingClientRect();
      return { top, bottom, height, left, width };
    };
    return {
      y: scrollY,
      viewport: innerHeight,
      left: rect('.cc-cart-items-column'),
      summary: rect('.cc-cart-summary'),
      column: rect('.cc-cart-summary-column'),
      row: rect('.cc-cart-layout')
    };
  });
}

function near(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1, `${message}: ${actual} vs ${expected}`);
}

async function cart(page, count) {
  await scroll(page, 0);
  await page.evaluate(count => {
    const products = Object.values(CCStore.getProducts());
    localStorage.setItem('cc_cart_data', JSON.stringify(Array.from({ length: count }, (_, i) => ({
      ...products[i % products.length], size: `Test ${i + 1}`, quantity: 1, price: 1290
    }))));
    window.dispatchEvent(new CustomEvent('cc:cartUpdated'));
  }, count);
  await settle(page);
  assert.equal(await page.locator('.cart-item-row').count(), count);
}

async function desktop(page, label) {
  await scroll(page, 0);
  const initial = await bounds(page);
  const tall = initial.summary.height > initial.viewport;
  near(initial.summary.top, initial.left.top, `${label}: original column alignment`);
  if (tall) {
    await scroll(page, 80);
    near((await bounds(page)).summary.top, initial.summary.top - 80, `${label}: tall stack enters naturally`);
  }

  const targetTop = tall ? initial.viewport - initial.summary.height - 24 :
    (initial.viewport - initial.summary.height) / 2;
  await scroll(page, initial.summary.top - targetTop + 100);
  const pinned = await bounds(page);
  near(pinned.summary.top, targetTop, `${label}: stack pins at the expected offset`);
  if (tall) {
    near(pinned.summary.bottom, pinned.viewport - 24, `${label}: promo and cart advice remain reachable`);
  } else {
    near(pinned.summary.top, pinned.viewport - pinned.summary.bottom, `${label}: balanced top and bottom spacing`);
  }
  await scroll(page, pinned.y + 200);
  const continued = await bounds(page);
  near(continued.summary.top, pinned.summary.top, `${label}: right column stays pinned`);
  near(continued.left.top, pinned.left.top - 200, `${label}: products scroll normally`);

  await page.mouse.move(continued.summary.left + 50, Math.max(50, continued.summary.top + 50));
  await page.mouse.wheel(0, 120);
  await page.waitForFunction(y => scrollY > y + 100, continued.y);
  await settle(page);
  near((await bounds(page)).summary.top, pinned.summary.top, `${label}: wheel over summary scrolls the document`);
  await scroll(page, pinned.y + 100);
  near((await bounds(page)).summary.top, pinned.summary.top, `${label}: scrolling back preserves pinning`);

  const end = initial.left.bottom - pinned.summary.bottom;
  await scroll(page, end - 10);
  near((await bounds(page)).summary.top, pinned.summary.top, `${label}: pins until the product list ends`);
  await scroll(page, end + 80);
  const released = await bounds(page);
  near(released.summary.bottom, released.left.bottom, `${label}: both columns finish together`);
  near(released.summary.top, pinned.summary.top - 80, `${label}: releases at the product list bottom`);
  near(released.row.bottom, released.summary.bottom, `${label}: no extra space below the cart columns`);
  await scroll(page, end + 160);
  const finished = await bounds(page);
  near(finished.summary.bottom, released.summary.bottom - 80, `${label}: both columns leave naturally`);
  near(finished.summary.bottom, finished.left.bottom, `${label}: bottom alignment persists`);
  await scroll(page, 0);
  near((await bounds(page)).summary.top, initial.summary.top, `${label}: scrolling back restores alignment`);
  console.log(`${label}: centering, pinning, wheel scrolling and synchronized finish passed`);
}

(async () => {
  const browser = await chromium.launch(process.env.CC_BROWSER_PATH ? { executablePath: process.env.CC_BROWSER_PATH } : {});
  const errors = [];
  let mutations = 0;
  let serverCart = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== new URL(base).origin) {
        const filename = path.basename(url.pathname);
        if (process.env.CC_TEST_ASSETS_DIR && ['bootstrap.min.css', 'bootstrap.bundle.min.js'].includes(filename)) {
          return route.fulfill({ path: path.join(process.env.CC_TEST_ASSETS_DIR, filename) });
        }
        return route.continue();
      }
      // Exercise the real store and controls without changing server cart/account data.
      if (/\/(cart|checkout)\.html$/.test(url.pathname)) {
        return route.fulfill({ path: path.join(__dirname, '..', path.basename(url.pathname)) });
      }
      if (/\/(auth\/me|cart\/view|wishlist\/view)\.php$/.test(url.pathname)) {
        return route.fulfill({ json: { success: true, data: {
          user: null, items: url.pathname.endsWith('/cart/view.php') ? serverCart : []
        } } });
      }
      if (request.method() !== 'GET') {
        mutations++;
        if (/\/(cart\/(update|remove)|wishlist\/toggle)\.php$/.test(url.pathname)) {
          const items = await page.evaluate(() => CCStore.getCart());
          if (url.pathname.includes('/cart/')) serverCart = items;
          return route.fulfill({ json: { success: true, data: { items } } });
        }
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(base + 'cart.html', { waitUntil: 'load' });
    await page.waitForFunction(() => typeof CCStore !== 'undefined' && CCStore.isCatalogLoaded() &&
      document.querySelector('#header-partial header') && document.querySelector('#footer-partial footer') &&
      !document.querySelector('.cc-global-loader'));
    await page.evaluate(() => document.fonts.ready);

    await page.locator('#checkout-btn').click();
    await page.locator('#cc-wishlist-snackbar.is-visible').filter({ hasText: 'Your bag is empty.' }).waitFor();
    assert.ok(page.url().endsWith('/cart.html'));

    for (const count of [0, 1, 2]) {
      await cart(page, count);
      const initial = await bounds(page);
      near(initial.column.height, Math.max(initial.left.height, initial.summary.height), `${count} items: natural row height`);
      near(initial.summary.top, initial.left.top, `${count} items: original top alignment`);
      await scroll(page, initial.row.bottom + 50);
      const finished = await bounds(page);
      near(finished.summary.bottom, finished.column.bottom, `${count} items: no empty scrolling track`);
    }
    assert.equal(await page.locator('.cart-item-row').count(), 2);
    console.log('Empty, one-item and two-item carts preserve natural height and spacing');

    await cart(page, 8);
    await desktop(page, '1440 x 900');
    await page.setViewportSize({ width: 1440, height: 600 });
    await desktop(page, '1440 x 600, tall summary');
    await page.setViewportSize({ width: 992, height: 720 });
    await desktop(page, '992 x 720, desktop breakpoint');
    await page.setViewportSize({ width: 1440, height: 900 });
    await cart(page, 50);
    await scroll(page, 2000);
    assert.equal(await page.locator('.cc-cart-section').evaluate(el => getComputedStyle(el).opacity), '1',
      'Very long carts remain visible with normal scroll-reveal animations enabled');
    await desktop(page, '50-item cart');

    // Live promotion messages resize the entire stack while it is pinned.
    await cart(page, 8);
    await scroll(page, 800);
    await page.locator('#promo-code-input').fill('THIS-INVALID-CODE-ADDS-AN-EXTRA-LINE-TO-THE-PROMOTION-MESSAGE');
    await page.locator('#apply-promo-btn').click();
    await settle(page);
    const changed = await bounds(page);
    near(changed.summary.top, changed.viewport - changed.summary.bottom, 'Promotion feedback re-centers the full stack');
    await page.setViewportSize({ width: 1440, height: 600 });
    await settle(page);
    near((await bounds(page)).summary.bottom, 576, 'Window resize pins the taller stack at its bottom');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await settle(page);
    const resized = await bounds(page);
    near(resized.summary.top, resized.viewport - resized.summary.bottom, 'Window resize restores centering');
    await page.evaluate(() => {
      localStorage.setItem('cc_cart_data', JSON.stringify(CCStore.getCart().slice(0, 1)));
      window.dispatchEvent(new CustomEvent('cc:cartUpdated'));
    });
    await settle(page);
    const shortened = await bounds(page);
    near(shortened.summary.bottom, shortened.column.bottom, 'Removing items releases a pinned summary immediately');
    console.log('Live promotion feedback, viewport resizing and cart shrink passed');

    for (const width of [991, 768, 576, 390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await cart(page, 2);
      const initial = await bounds(page);
      assert.ok(initial.summary.top >= initial.left.bottom, `${width}px: summary follows the products`);
      await scroll(page, 200);
      near((await bounds(page)).summary.top, initial.summary.top - 200, `${width}px: normal vertical scrolling`);
      assert.equal(await page.locator('.cc-cart-summary').evaluate(el => getComputedStyle(el).position), 'static');
      assert.ok(initial.summary.left >= 0 && initial.summary.left + initial.summary.width <= width,
        `${width}px: summary fits within the viewport`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth),
        `${width}px: no horizontal overflow`);
    }
    console.log('991px, 768px, 576px, 390px and 320px mobile layouts passed');

    await page.setViewportSize({ width: 1440, height: 900 });
    await cart(page, 3);
    await page.evaluate(() => CCStore.applyPromoCode(''));
    const first = page.locator('.cart-item-row').first();
    await action(page, first.locator('.qty-plus-btn'), 'cart/update.php');
    await page.waitForFunction(() => CCStore.getCart()[0].quantity === 2);
    await action(page, first.locator('.qty-minus-btn'), 'cart/update.php');
    await page.waitForFunction(() => CCStore.getCart()[0].quantity === 1);
    await page.locator('#promo-code-input').fill('CLASSIC10');
    await page.locator('#apply-promo-btn').click();
    assert.match(await page.locator('#promo-status-msg').textContent(), /10% off/);
    assert.equal(await page.locator('#summary-total-value').textContent(), await page.evaluate(() => CCStore.formatPHP(3663)));
    await page.locator('#promo-code-input').fill('FREESHIP');
    await page.locator('#apply-promo-btn').click();
    assert.equal(await page.locator('#summary-total-value').textContent(), await page.evaluate(() => CCStore.formatPHP(3870)));
    await page.locator('#promo-code-input').fill('INVALID');
    await page.locator('#apply-promo-btn').click();
    assert.match(await page.locator('#promo-status-msg').textContent(), /not valid/);
    assert.equal(await page.locator('#summary-total-value').textContent(), await page.evaluate(() => CCStore.formatPHP(4050)));

    const movedId = await first.getAttribute('data-id');
    await action(page, first.locator('.move-wishlist-btn'), 'cart/remove.php');
    await page.waitForFunction(id => CCStore.isInWishlist(id) && CCStore.getCart().length === 2, movedId);
    await action(page, page.locator('.cart-item-row').first().locator('.remove-item-btn'), 'cart/remove.php');
    await page.waitForFunction(() => CCStore.getCart().length === 1);
    const storedCart = await page.evaluate(() => localStorage.getItem('cc_cart_data'));
    await page.locator('#checkout-btn').click();
    await page.waitForURL('**/checkout.html');
    assert.equal(await page.evaluate(() => localStorage.getItem('cc_cart_data')), storedCart, 'Checkout keeps cart data intact');
    assert.ok(mutations >= 4, 'Existing cart and wishlist actions reach their original API endpoints');
    assert.deepEqual(errors, [], 'No browser JavaScript errors');
    console.log('Quantity, wishlist, removal, valid/invalid promotions, calculations and checkout navigation passed');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
