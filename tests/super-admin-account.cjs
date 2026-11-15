// Run through super-admin-account.php with CC_PLAYWRIGHT_PATH pointing to Playwright.
const { chromium } = require(process.env.CC_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixture = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const base = fixture.base.replace(/\/?$/, '/');

(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const [name, value] = fixture.session.cookie.split('=');
    await context.addCookies([{ name, value, url: base, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
    const errors = [];
    const writes = [];
    let failProfile = false;
    let failRead = false;
    let failHistory = false;
    let emptyHistory = false;
    let longHistory = false;
    let holdHistory = false;
    let releaseHistory;
    page.on('pageerror', error => errors.push(error.message));
    if (process.env.CC_TEST_ASSETS_DIR) await page.route(/^https:\/\//, route => {
      const filename = path.basename(new URL(route.request().url()).pathname);
      if (['bootstrap.min.css', 'bootstrap.bundle.min.js'].includes(filename)) {
        return route.fulfill({ path: path.join(process.env.CC_TEST_ASSETS_DIR, filename) });
      }
      return route.fulfill({ contentType: 'text/css', body: '' });
    });
    await page.route('**/public/api/super-admin/account.php*', async route => {
      const request = route.request();
      const body = request.method() === 'POST' ? request.postDataJSON() : null;
      if (body) writes.push(body);
      if (failRead && request.method() === 'GET' && !request.url().includes('view=history')) {
        failRead = false;
        return route.fulfill({ status: 503, json: { success: false, error: { message: 'Test account failure.' } } });
      }
      if (failProfile && body?.action === 'update_profile') {
        failProfile = false;
        return route.fulfill({ status: 503, json: { success: false, error: { message: 'Test save failure.' } } });
      }
      if (request.url().includes('view=history')) {
        if (holdHistory) {
          holdHistory = false;
          await new Promise(resolve => { releaseHistory = resolve; });
        }
        if (failHistory) {
          failHistory = false;
          return route.fulfill({ status: 503, json: { success: false, error: { message: 'Test history failure.' } } });
        }
        if (emptyHistory) return route.fulfill({ json: { success: true, data: { items: [], next_before: null } } });
        if (longHistory) return route.fulfill({ json: { success: true, data: {
          items: Array.from({ length: 8 }, (_, id) => ({ id, timestamp: 1794729600, action: 'LongActivity'.repeat(50), description: '<img src=x onerror=alert(1)>'.repeat(20) })), next_before: null
        } } });
      }
      return route.continue();
    });
    const settled = () => page.waitForFunction(() => document.getElementById('module-account').getAttribute('aria-busy') === 'false');
    const historySettled = () => page.waitForFunction(() => document.getElementById('accountHistoryViewport').getAttribute('aria-busy') === 'false');
    const clickAndWait = async (selector, action) => {
      const response = page.waitForResponse(r => r.url().includes('/super-admin/account.php') && r.request().method() === 'POST' && r.request().postDataJSON().action === action);
      await page.locator(selector).click();
      await response;
      await settled();
    };
    await page.goto(base + 'super-admin-dashboard.html#module-account');
    await settled();
    assert.equal(await page.locator('#accountEmail').inputValue(), fixture.email);
    assert.equal(await page.locator('#accountNotifySignIns, #btnSignOutOthers, #accountRecoveryModal, #btnReviewRecovery').count(), 0);
    assert.match(await page.locator('#accountCurrentSession').innerText(), /PHT/);
    await page.locator('#accountFirstName').fill('Discarded');
    await page.locator('#btnCancelProfile').click();
    assert.equal(await page.locator('#accountFirstName').inputValue(), 'Updated');
    await page.locator('#accountFirstName').fill('Browser');
    await page.locator('#accountMobile').fill('+63 918 765 4321');
    await clickAndWait('#accountProfileForm [type=submit]', 'update_profile');
    assert.match(await page.locator('#headerUserName').innerText(), /Browser Administrator/);
    await page.reload();
    await settled();
    assert.equal(await page.locator('#accountFirstName').inputValue(), 'Browser');
    assert.equal(await page.locator('#accountMobile').inputValue(), '+63 918 765 4321');
    failProfile = true;
    await page.locator('#accountFirstName').fill('Unsaved');
    await clickAndWait('#accountProfileForm [type=submit]', 'update_profile');
    assert.match(await page.locator('#accountStatus').innerText(), /Test save failure/);
    assert.equal(await page.locator('#accountFirstName').inputValue(), 'Unsaved');
    await page.locator('#btnCancelProfile').click();
    assert.equal(await page.locator('#accountFirstName').inputValue(), 'Browser');

    const nextPassword = 'BrowserChanged789!';
    await page.locator('#credentialCurrent').fill(fixture.password);
    await page.locator('#credentialNew').fill(nextPassword);
    await page.locator('#credentialConfirm').fill('DifferentPassword123!');
    const beforeMismatch = writes.length;
    await page.locator('#credentialsForm [type=submit]').click();
    assert.equal(writes.length, beforeMismatch, 'Mismatched passwords never submit');
    await page.locator('#credentialConfirm').fill(nextPassword);
    await page.locator('#credentialCurrent').fill('WrongCurrent123!');
    await clickAndWait('#credentialsForm [type=submit]', 'update_password');
    assert.match(await page.locator('#accountStatus').innerText(), /Current password does not match/);
    await page.locator('#credentialCurrent').fill(fixture.password);
    await page.locator('#accountFirstName').fill('Keep draft');
    await clickAndWait('#credentialsForm [type=submit]', 'update_password');
    assert.equal(await page.locator('#credentialCurrent').inputValue(), '');
    assert.equal(await page.locator('#accountFirstName').inputValue(), 'Keep draft', 'Password save preserves profile draft');
    await page.locator('#btnCancelProfile').click();
    await page.locator('#credentialCurrent').fill('Discard');
    await page.locator('#btnCancelCredentials').click();
    assert.equal(await page.locator('#credentialCurrent').inputValue(), '');
    await page.reload();
    await settled();
    assert.equal(await page.locator('#accountFirstName').inputValue(), 'Browser', 'Session survives password change');

    for (const width of [1440, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert(await page.locator('#module-account').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Account fits viewport');
      await page.locator('#btnAccountHistory').click();
      await page.locator('#accountHistoryModal.show').waitFor();
      await historySettled();
      const measurements = await page.locator('#accountHistoryViewport').evaluate(viewport => {
        const bounds = viewport.getBoundingClientRect();
        const header = viewport.querySelector('thead').getBoundingClientRect();
        const rows = [...viewport.querySelectorAll('tbody tr')].map(row => row.getBoundingClientRect());
        return { height: bounds.height, scrollHeight: viewport.scrollHeight, clientHeight: viewport.clientHeight,
          header: header.height, rows: rows.map(row => row.height),
          visible: rows.filter(row => row.top >= header.bottom - 1 && row.bottom <= bounds.bottom + 1).length,
          partial: rows.filter(row => row.top < bounds.bottom - 1 && row.bottom > bounds.bottom + 1).length,
          scrollbar: getComputedStyle(viewport).scrollbarColor,
          accent: getComputedStyle(document.documentElement).getPropertyValue('--cc-accent').trim(),
          overflow: viewport.scrollWidth > viewport.clientWidth + 1 };
      });
      assert.equal(measurements.height, 445);
      assert.equal(measurements.header, 45);
      assert(measurements.rows.every(height => height === 80), JSON.stringify(measurements));
      assert.equal(measurements.visible, 5);
      assert.equal(measurements.partial, 0);
      assert(measurements.scrollHeight > measurements.clientHeight);
      assert.equal(measurements.overflow, false);
      assert.match(measurements.scrollbar, /rgb\(2, 128, 144\)/);
      assert.equal(await page.locator('#accountHistoryModal').evaluate(el => getComputedStyle(el).backdropFilter), 'blur(5px)');
      assert.equal(await page.locator('.modal-backdrop').evaluate(el => getComputedStyle(el).opacity), '0.5');
      assert.equal(await page.locator('.modal-backdrop').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 0, 0)');
      const modal = await page.locator('#accountHistoryModal .modal-content').boundingBox();
      assert(modal.x >= 0 && modal.x + modal.width <= width, 'Modal fits viewport');
      await page.locator('#accountHistoryViewport').evaluate(el => { el.scrollTop = el.scrollHeight; });
      assert(await page.locator('#accountHistoryViewport').evaluate(el => el.scrollTop > 0));
      failHistory = true;
      await page.locator('#btnAccountHistoryMore').click();
      await historySettled();
      assert.equal(await page.locator('#accountHistoryItems tr').count(), 20, 'Failed pagination preserves rows');
      assert.equal(await page.locator('#btnAccountHistoryMore').innerText(), 'Retry');
      await page.locator('#btnAccountHistoryMore').click();
      await historySettled();
      assert(await page.locator('#accountHistoryItems tr').count() > 20);
      assert.equal(await page.locator('#btnAccountHistoryMore').isVisible(), false);
      await page.keyboard.press('Escape');
      await page.locator('#accountHistoryModal').waitFor({ state: 'hidden' });
      await page.locator('.modal-backdrop').waitFor({ state: 'detached' });
      assert.equal(await page.locator('.modal-backdrop').count(), 0);
      assert.equal(await page.locator('#btnAccountHistory').evaluate(el => document.activeElement === el), true);
    }

    failHistory = true;
    await page.locator('#btnAccountHistory').click();
    await historySettled();
    assert.match(await page.locator('#accountHistoryItems').innerText(), /Unable to load/);
    await page.locator('#btnAccountHistoryMore').click();
    await historySettled();
    assert.equal(await page.locator('#accountHistoryItems tr').count(), 20);
    await page.locator('#accountHistoryModal .btn-close').click();
    await page.locator('#accountHistoryModal').waitFor({ state: 'hidden' });
    holdHistory = true;
    await page.locator('#btnAccountHistory').click();
    await page.waitForFunction(() => document.getElementById('accountHistoryViewport').getAttribute('aria-busy') === 'true');
    await page.locator('#accountHistoryModal .btn-close').click();
    await page.locator('#accountHistoryModal').waitFor({ state: 'hidden' });
    await page.locator('#btnAccountHistory').click();
    await historySettled();
    releaseHistory();
    assert.equal(await page.locator('#accountHistoryItems tr').count(), 20, 'Reopening replaces an aborted request');
    await page.keyboard.press('Escape');
    await page.locator('#accountHistoryModal').waitFor({ state: 'hidden' });

    emptyHistory = true;
    await page.locator('#btnAccountHistory').click();
    await historySettled();
    assert.match(await page.locator('#accountHistoryItems').innerText(), /No administrative activity/);
    assert.equal(await page.locator('#btnAccountHistoryMore').isVisible(), false);
    await page.keyboard.press('Escape');
    await page.locator('#accountHistoryModal').waitFor({ state: 'hidden' });
    emptyHistory = false;
    longHistory = true;
    await page.locator('#btnAccountHistory').click();
    await historySettled();
    assert(await page.locator('#accountHistoryItems tr').evaluateAll(rows => rows.every(row => row.getBoundingClientRect().height === 80)), 'Long activity keeps fixed row heights');
    assert.equal(await page.locator('#accountHistoryItems img').count(), 0, 'Audit descriptions render as text');
    assert(await page.locator('#accountHistoryItems .account-history-value').last().evaluate(el => el.scrollHeight > el.clientHeight), 'Long details remain scrollable');
    if (process.env.CC_ACCOUNT_SCREENSHOT) await page.screenshot({ path: process.env.CC_ACCOUNT_SCREENSHOT });
    await page.keyboard.press('Escape');
    await page.locator('#accountHistoryModal').waitFor({ state: 'hidden' });
    longHistory = false;
    failRead = true;
    await page.reload();
    await settled();
    assert.match(await page.locator('#accountStatus').innerText(), /Use Reload account to retry/);
    assert.equal(await page.locator('#accountFirstName').isDisabled(), true);
    assert.equal(await page.locator('#btnReloadAccount').isEnabled(), true);
    await page.locator('#btnReloadAccount').click();
    await settled();
    assert.equal(await page.locator('#accountFirstName').inputValue(), 'Browser');
    assert.equal(await page.locator('#accountFirstName').isEnabled(), true);
    assert.deepEqual(errors, []);
    assert(writes.every(body => ['update_profile', 'update_password'].includes(body.action)));
    console.log('PASS: live profile save/cancel/persistence, validation, password change/session/drafts, desktop/mobile five-row audit table, scrollbar, backdrop, pagination, errors/retries, empty/long/escaped content, close/reopen and focus.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
