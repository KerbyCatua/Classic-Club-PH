// Live login + wishlist integration. Requires local PHP/database and Playwright.
// Creates an isolated customer and removes its data in finally.
const { chromium } = require(process.env.CC_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const base = process.env.CC_TEST_URL || 'http://localhost/classic-club-ph/';
const email = `quick-view-${randomUUID()}@example.test`;
const password = `Qv!${randomUUID()}`;
const php = source => execFileSync(process.env.CC_PHP_PATH || 'C:/xampp/php/php.exe', [], {
  cwd: path.resolve(__dirname, '..'), encoding: 'utf8',
  input: `<?php require 'app/Database/Connection.php'; ${source}`,
  env: { ...process.env, CC_QV_EMAIL: email, CC_QV_PASSWORD: password }
}).trim();

(async () => {
  let browser;
  try {
    php(`require 'app/Repositories/UserRepository.php';
      $users = new ClassicClub\\Repositories\\UserRepository($pdo);
      $id = $users->create(getenv('CC_QV_EMAIL'), password_hash(getenv('CC_QV_PASSWORD'), PASSWORD_DEFAULT), 'Quick View', 'Test');
      $users->assignRole($id, 'customer');`);
    browser = await chromium.launch(process.env.CC_BROWSER_PATH ? { executablePath: process.env.CC_BROWSER_PATH } : {});
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(base + 'auth.html');
    await page.locator('#signin-email').fill(email);
    await page.locator('#signin-password').fill(password);
    await page.locator('#signin-form button[type="submit"]').click();
    await page.waitForURL('**/account-dashboard.html');
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    let cartWrites = 0;
    page.on('request', request => {
      if (request.method() === 'POST' && request.url().includes('/cart/')) cartWrites++;
    });
    const settle = () => page.evaluate(async () => {
      await CCStore.whenCatalogReady();
      await CCStore.syncWishlistFromServer();
    });
    const visit = async file => { await page.goto(base + file); await settle(); };
    const add = page.locator('.cc-qv-add');
    const snackbar = page.locator('#cc-wishlist-snackbar');
    const expectSnackbar = async message => {
      await page.waitForFunction(message => {
        const bar = document.getElementById('cc-wishlist-snackbar');
        return bar.textContent === message && getComputedStyle(bar).opacity === '1';
      }, message);
      assert.equal(await snackbar.count(), 1);
      assert.equal(await snackbar.getAttribute('role'), 'status');
      assert.equal(await snackbar.getAttribute('aria-live'), 'polite');
      const bounds = await snackbar.boundingBox(), viewport = page.viewportSize();
      assert.ok(Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2) < 1, 'Bottom-center horizontally');
      assert.ok(Math.abs(viewport.height - bounds.y - bounds.height - 24) < 1, '24px above viewport bottom');
      // Hit testing proves it paints above the modal/backdrop, including outside its bounds.
      assert.equal(await snackbar.evaluate(bar => {
        bar.style.pointerEvents = 'auto';
        const rect = bar.getBoundingClientRect();
        const visible = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === bar;
        bar.style.removeProperty('pointer-events');
        return visible;
      }), true);
    };
    const expectIds = async ids => {
      await settle();
      assert.deepEqual((await page.evaluate(() => CCStore.getWishlist())).sort(), [...ids].sort());
      const response = await page.request.get(base + 'public/api/wishlist/view.php');
      assert.equal(response.status(), 200);
      assert.deepEqual((await response.json()).data.items.map(item => item.id).sort(), [...ids].sort());
    };

    await visit('shop-all.html');
    const ids = await page.evaluate(() => Object.values(CCStore.getProducts()).filter(p => p.stockQty > 0).map(p => p.id));
    assert.ok(ids.length >= 3);
    const target = await page.evaluate(() => Object.values(CCStore.getProducts()).find(p => p.price === 4890 && p.stockQty > 0)?.id);
    const first = target || ids[0], second = ids.find(id => id !== first), third = ids.find(id => id !== first && id !== second);
    await page.locator('.cc-product-card').filter({ has: page.locator(`.cc-wishlist-btn[data-product-id="${first}"]`) }).first().locator('.cc-qv-image-link').click();
    await page.locator('dialog[open]').waitFor();
    await add.click();
    assert.equal(await page.evaluate(id => CCStore.isInWishlist(id), first), true);
    assert.equal(await page.locator(`.cc-wishlist-btn[data-product-id="${first}"]`).first().getAttribute('aria-pressed'), 'true');
    await expectSnackbar('Added to wishlist');
    await expectIds([first]);
    // Same-task clicks hit the pending guard; subsequent clicks remain additive.
    await add.evaluate(button => { button.click(); button.click(); button.click(); });
    await expectSnackbar('Already in wishlist');
    await expectIds([first]);
    await page.waitForTimeout(2000);
    await add.press('Enter');
    await page.waitForTimeout(1800);
    await expectSnackbar('Already in wishlist');
    await page.waitForFunction(() => !document.getElementById('cc-wishlist-snackbar').classList.contains('is-visible'));
    await page.waitForFunction(() => document.getElementById('cc-wishlist-snackbar').textContent === '');
    console.log('PASS: real UI login, selected product, immediate heart state, repeated clicks, unique database row, snackbar layering/position and 3.5s timer restart');

    await page.evaluate(id => CCQuickView.open(id), second);
    await add.click();
    await expectSnackbar('Added to wishlist');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('cc-wishlist-snackbar').parentElement === document.body);
    await expectSnackbar('Added to wishlist');
    // Navigate immediately, allowing the existing durable queue to finish/replay.
    await visit('wishlist.html');
    await expectIds([first, second]);
    for (const id of [first, second]) assert.equal(await page.locator(`.js-remove-wishlist[data-id="${id}"]`).count(), 1);
    await page.reload(); await settle(); await expectIds([first, second]);
    assert.equal(await page.locator('.js-remove-wishlist').count(), 2);
    console.log('PASS: different products, immediate navigation to wishlist.html, exact product cards and reload persistence');

    await page.evaluate(id => CCQuickView.open(id), first);
    await add.click(); await expectSnackbar('Already in wishlist');
    await page.keyboard.press('Escape');
    await page.locator(`.js-remove-wishlist[data-id="${first}"]`).click();
    await expectIds([second]);
    await expectSnackbar('Removed from wishlist');
    console.log('PASS: adding from wishlist never removes a saved product; existing removal and shared snackbar still work');

    await visit('shop-all.html');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(id => CCQuickView.open(id), third);
    // Simulate unavailable local storage without altering other store methods.
    await page.evaluate(() => {
      window.originalStorageSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'cc_wishlist_pending') throw new DOMException('Test storage full', 'QuotaExceededError');
        return window.originalStorageSet.call(this, key, value);
      };
    });
    await add.click();
    await expectSnackbar('Unable to save to your wishlist. Please try again.');
    assert.equal(await add.isEnabled(), true);
    assert.equal(await page.evaluate(id => CCStore.isInWishlist(id), third), false);
    await page.evaluate(() => { Storage.prototype.setItem = window.originalStorageSet; delete window.originalStorageSet; });
    // The store retains failed network writes and retries on online/navigation.
    await page.route('**/public/api/wishlist/toggle.php', route => route.fulfill({
      json: { success: false, error: { message: 'Simulated network failure' } }
    }));
    await add.click(); await expectSnackbar('Added to wishlist'); await settle();
    assert.equal(await page.evaluate(id => CCStore.isInWishlist(id), third), true);
    assert.equal(await page.evaluate(id => JSON.parse(localStorage.getItem('cc_wishlist_pending'))[id].saved, third), true);
    await page.reload(); await settle();
    assert.equal(await page.evaluate(id => CCStore.isInWishlist(id), third), true);
    await page.unroute('**/public/api/wishlist/toggle.php');
    await page.evaluate(() => dispatchEvent(new Event('online')));
    await expectIds([second, third]);
    assert.equal(cartWrites, 0, 'Quick View must only save to wishlist');
    assert.deepEqual(errors, [], 'No browser runtime/console errors after login');
    console.log('PASS: mobile/reduced motion, storage error feedback and retry, failed sync survives reload and reconnects, no cart writes or browser errors');
  } finally {
    if (browser) await browser.close();
    php(`$query = $pdo->prepare('SELECT id FROM users WHERE email = ?');
      $query->execute([getenv('CC_QV_EMAIL')]); $id = $query->fetchColumn();
      if ($id) {
        $pdo->prepare('DELETE FROM audit_logs WHERE user_id = ?')->execute([$id]);
        $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
      }`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
