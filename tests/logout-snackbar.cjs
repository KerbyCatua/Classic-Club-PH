// Run with Playwright installed: node tests/logout-snackbar.cjs
// Exercise Bootstrap confirmation and the existing logout flow with isolated API fixtures.
const { chromium } = require(process.env.CC_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
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
      let releaseLogout;
      const errors = [];
      const alerts = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('dialog', d => { alerts.push(d.message()); return d.accept(); });
      // Use real Bootstrap; optional cached vendor assets allow offline runs.
      await page.route(/^https:\/\//, route => {
        const filename = path.basename(new URL(route.request().url()).pathname);
        if (['bootstrap.min.css', 'bootstrap.bundle.min.js'].includes(filename)) {
          if (process.env.CC_TEST_ASSETS_DIR) {
            return route.fulfill({ path: path.join(process.env.CC_TEST_ASSETS_DIR, filename) });
          }
          return route.continue();
        }
        return route.abort();
      });
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
          if (failLogout) {
            await new Promise(resolve => { releaseLogout = resolve; });
            return route.fulfill({ status: 500, json: { success: false, error: { message: 'Test logout failure' } } });
          }
          loggedOut = true;
        }
        await route.fulfill({ json: { success: true, data } });
      });
      await page.goto(base + 'account-dashboard.html');
      await page.locator('#account-main').waitFor({ state: 'visible' });
      await page.evaluate(() => localStorage.setItem('cc_user_profile', 'test'));
      const modal = page.locator('#sign-out-modal');
      const cancel = page.locator('#cancel-sign-out-btn');
      const confirm = page.locator('#confirm-sign-out-btn');
      async function openModal() {
        await page.locator('#sign-out-btn').click();
        await page.waitForFunction(() => document.activeElement.id === 'cancel-sign-out-btn');
        assert.equal(await modal.getAttribute('aria-modal'), 'true');
        assert.equal(await page.locator('#account-main').evaluate(el => getComputedStyle(el).filter), 'blur(5px)');
        assert.equal(await modal.evaluate(el => getComputedStyle(el).filter), 'none');
        assert.equal(await page.locator('.modal-backdrop').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 0, 0)');
        assert.equal(await page.locator('.modal-backdrop').evaluate(el => getComputedStyle(el).opacity), '0.5');
      }
      async function expectClosed() {
        await modal.waitFor({ state: 'hidden' });
        await page.waitForFunction(() => document.activeElement.id === 'sign-out-btn');
        assert.equal(await page.locator('.modal-backdrop').count(), 0);
        assert.equal(await page.locator('#account-main').evaluate(el => getComputedStyle(el).filter), 'none');
        assert.equal(requests, 0);
        assert.equal(await page.evaluate(() => localStorage.getItem('cc_user_profile')), 'test');
        assert.ok(page.url().endsWith('/account-dashboard.html'));
      }

      await openModal();
      const bounds = await modal.locator('.modal-content').boundingBox();
      const viewport = page.viewportSize();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width);
      assert.ok(Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2) < 1);
      if (viewport.width >= 576) assert.equal(bounds.width, 520);
      assert.equal(await modal.locator('.modal-content').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(24, 26, 27)');
      assert.equal(await modal.locator('h2').evaluate(el => getComputedStyle(el).fontSize), '32px');
      const cancelBounds = await cancel.boundingBox(), confirmBounds = await confirm.boundingBox();
      assert.ok(Math.abs(cancelBounds.height - 50) < 0.1);
      assert.ok(Math.abs(confirmBounds.height - 50) < 0.1);
      assert.ok(Math.abs(cancelBounds.width - confirmBounds.width) < 1);
      assert.equal(confirmBounds.x - (cancelBounds.x + cancelBounds.width), 12);
      assert.equal(await modal.locator('.modal-body').evaluate(el => el.scrollWidth <= el.clientWidth), true);
      await page.keyboard.press('Tab');
      assert.equal(await confirm.evaluate(el => el === document.activeElement), true);
      assert.equal(await confirm.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
      await page.keyboard.press('Tab');
      assert.equal(await cancel.evaluate(el => el === document.activeElement), true);
      await cancel.click();
      await expectClosed();
      await openModal();
      await page.keyboard.press('Escape');
      await expectClosed();
      await openModal();
      await modal.click({ position: { x: 2, y: 2 } });
      await expectClosed();

      await openModal();
      await Promise.all([
        page.waitForRequest('**/public/api/auth/logout.php'),
        confirm.click()
      ]);
      assert.equal(await confirm.isDisabled(), true);
      assert.equal(await cancel.isDisabled(), true);
      // Even programmatic repeat clicks must not submit a second request.
      await confirm.dispatchEvent('click');
      await page.keyboard.press('Escape');
      assert.equal(await modal.isVisible(), true);
      assert.equal(requests, 1);
      releaseLogout();
      await page.waitForFunction(() => !document.getElementById('confirm-sign-out-btn').disabled);
      assert.equal(await cancel.isEnabled(), true);
      assert.equal(await modal.isVisible(), true);
      assert.deepEqual(alerts, ['Test logout failure']);
      assert.equal(await page.evaluate(() => localStorage.getItem('cc_user_profile')), 'test');
      assert.equal(await page.evaluate(() => sessionStorage.getItem('cc_logout_success')), null);
      assert.equal(await page.locator('.cc-wishlist-snackbar.is-visible').count(), 0);
      assert.ok(page.url().endsWith('/account-dashboard.html'));
      failLogout = false;
      await confirm.click();
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
    console.log('PASS: Bootstrap confirmation, Cancel/Escape/backdrop, focus, desktop/mobile design, duplicate-submit protection, failure/retry, existing redirect and snackbar across all six roles.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
