// Run with Playwright installed: node tests/logout-snackbar.cjs
// Exercise the dashboard logout flow with isolated authentication API fixtures.
const { chromium } = require(process.env.CC_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.CC_TEST_URL || 'http://localhost/classic-club-ph/';

(async () => {
  const browser = await chromium.launch();
  try {
    for (const role of ['customer', 'admin', 'super_admin', 'manager', 'staff', 'guest']) {
      const context = await browser.newContext({ viewport: { width: role === 'admin' ? 375 : 1440, height: 900 } });
      const page = await context.newPage();
      let loggedOut = false;
      let failLogout = true;
      let requests = 0;
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('dialog', d => d.accept());
      // Logout does not use Bootstrap modals; isolate this unrelated CDN dependency.
      await page.addInitScript(() => {
        window.bootstrap = { Modal: { getOrCreateInstance: () => ({ show() {}, hide() {} }) } };
      });
      await page.route(/^https:\/\//, route => route.abort());
      await page.route('**/public/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        let data = { items: [], orders: [], addresses: [] };
        if (path.endsWith('/auth/me.php')) {
          data = { user: loggedOut ? null : { id: 1, first_name: 'Test', last_name: 'User', email: 'test@example.com', roles: [role] } };
        }
        if (path.endsWith('/auth/csrf.php')) data = { token: 'logout-test' };
        if (path.endsWith('/auth/logout.php')) {
          requests++;
          assert.equal(route.request().method(), 'POST');
          assert.equal(route.request().headers()['x-csrf-token'], 'logout-test');
          if (failLogout) return route.fulfill({ status: 500, json: { success: false, error: { message: 'Test logout failure' } } });
          loggedOut = true;
        }
        await route.fulfill({ json: { success: true, data } });
      });
      await page.goto(base + 'account-dashboard.html');
      await page.locator('#account-main').waitFor({ state: 'visible' });
      await page.locator('#sign-out-btn').click();
      await page.waitForFunction(() => !document.getElementById('sign-out-btn').disabled);
      assert.equal(await page.evaluate(() => sessionStorage.getItem('cc_logout_success')), null);
      assert.equal(await page.locator('.cc-wishlist-snackbar.is-visible').count(), 0);
      assert.ok(page.url().endsWith('/account-dashboard.html'));
      failLogout = false;
      await page.evaluate(() => localStorage.setItem('cc_user_profile', 'test'));
      await page.locator('#sign-out-btn').click();
      await page.waitForURL('**/auth.html');
      const snackbar = page.locator('#cc-wishlist-snackbar');
      await page.waitForFunction(() => document.querySelector('#cc-wishlist-snackbar')?.classList.contains('is-visible'));
      assert.equal(await snackbar.textContent(), 'Logged out successfully');
      assert.equal(await page.locator('[role="status"].is-visible, [role="alert"].is-visible').count(), 1);
      assert.equal(await snackbar.getAttribute('aria-live'), 'polite');
      assert.equal(await page.evaluate(() => sessionStorage.getItem('cc_logout_success')), null);
      assert.equal(await page.evaluate(() => localStorage.getItem('cc_user_profile')), null);
      const rect = await snackbar.boundingBox();
      const width = page.viewportSize().width;
      assert.ok(rect.x >= 0 && rect.x + rect.width <= width);
      assert.ok(Math.abs(rect.x + rect.width / 2 - width / 2) < 1);
      assert.ok(rect.y > 800 && rect.y + rect.height <= 900);
      assert.equal(await snackbar.evaluate(el => getComputedStyle(el).zIndex), '2147483647');
      await page.waitForFunction(() => document.querySelector('#cc-wishlist-snackbar').textContent === '');
      await page.reload();
      assert.equal(await snackbar.textContent(), '');
      assert.equal(requests, 2);
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('Logout snackbar passed for all six roles, including failure, redirect, dismissal and reload.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
