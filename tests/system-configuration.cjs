// Run through system-configuration.php with CC_PLAYWRIGHT_PATH pointing to Playwright.
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
    let failRead = false;
    let failWrite = '';
    let failCsrf = false;
    let holdWrite = false;
    let releaseWrite;
    let writeStarted;
    const heldWrite = new Promise(resolve => { writeStarted = resolve; });
    page.on('pageerror', error => errors.push(error.message));
    if (process.env.CC_TEST_ASSETS_DIR) await page.route(/^https:\/\//, route => {
      const filename = path.basename(new URL(route.request().url()).pathname);
      return ['bootstrap.min.css', 'bootstrap.bundle.min.js'].includes(filename)
        ? route.fulfill({ path: path.join(process.env.CC_TEST_ASSETS_DIR, filename) })
        : route.fulfill({ contentType: 'text/css', body: '' });
    });
    await page.route('**/public/api/auth/csrf.php', route => {
      if (!failCsrf) return route.continue();
      failCsrf = false;
      return route.fulfill({ json: { success: true, data: {} } });
    });
    await page.route('**/public/api/super-admin/configuration.php', async route => {
      if (route.request().method() === 'GET') {
        if (!failRead) return route.continue();
        failRead = false;
        return route.fulfill({ status: 503, json: { success: false, error: { message: 'Test load failure.' } } });
      }
      writes.push(route.request().postDataJSON());
      if (holdWrite) {
        holdWrite = false;
        const wait = new Promise(resolve => { releaseWrite = resolve; });
        writeStarted();
        await wait;
      }
      const failure = failWrite;
      failWrite = '';
      if (failure === 'network') return route.abort('failed');
      if (failure === 'json') return route.fulfill({ contentType: 'text/plain', body: 'Invalid JSON' });
      if (failure) return route.fulfill({ status: 503, json: { success: false, error: { message: 'Test save failure.' } } });
      return route.continue();
    });
    const settled = () => page.waitForFunction(() => document.getElementById('module-config').getAttribute('aria-busy') === 'false');
    const settings = () => page.locator('#configForm [data-config-key]').evaluateAll(controls => Object.fromEntries(controls.map(el => [el.dataset.configKey,
      el.type === 'checkbox' ? el.checked : el.dataset.configKey === 'registration_enabled' ? el.value === 'true'
        : el.dataset.configKey === 'report_period' ? el.value : Number(el.value)])));
    const server = async () => (await (await context.request.get(base + 'public/api/super-admin/configuration.php')).json()).data;
    const review = async () => {
      await page.locator('#btnConfigReview').click();
      assert.equal(await page.locator('#configReview').isVisible(), true);
      assert.equal(await page.locator('#configReview').evaluate(el => document.activeElement === el), true);
      assert.equal(await page.locator('#btnConfigSave').isDisabled(), true);
      await page.locator('#configConfirm').check();
      assert.equal(await page.locator('#btnConfigSave').isEnabled(), true);
    };
    const save = async () => {
      await review();
      await page.locator('#btnConfigSave').click();
      await settled();
    };

    failRead = true;
    await page.goto(base + 'super-admin-dashboard.html#module-config');
    await settled();
    assert.match(await page.locator('#configStatus').innerText(), /Test load failure.*Reload/);
    assert.equal(await page.locator('#configRegistration').isDisabled(), true);
    await page.locator('#btnConfigReload').click();
    await settled();
    assert.equal(await page.locator('#configRegistration').isEnabled(), true);
    assert.equal(await page.locator('#configReview').isVisible(), false, 'Review stays hidden despite the card display style');
    assert.equal(await page.locator('#btnConfigSave').isVisible(), false);
    assert.equal(await page.locator('#btnConfigDiscard').isDisabled(), true);
    assert.equal(await page.locator('#btnConfigReview').isDisabled(), true);
    assert.doesNotMatch(await page.locator('#module-config').innerText(), /MFA|2FA|SMTP|email|SSO|experimental/i);
    assert.equal(await page.locator('#configForm [data-config-key]').count(), 10);
    const initial = await settings();
    await page.locator('#configReviewsReplies').setChecked(!initial.reviews_enabled);
    await review();
    assert.match(await page.locator('#configChanges').innerText(), /Product reviews and business replies: (Enabled|Disabled) → (Enabled|Disabled)/);
    await page.locator('#configStaffManagement').setChecked(!initial.staff_management_enabled);
    assert.equal(await page.locator('#configReview').isVisible(), false, 'Editing invalidates confirmation');
    assert.equal(await page.locator('#configConfirm').isChecked(), false);
    await page.locator('#configForm').evaluate(form => form.requestSubmit());
    assert.equal(writes.length, 0, 'Unreviewed changes cannot save');
    await page.locator('#btnConfigDiscard').click();
    assert.deepEqual(await settings(), initial);

    // Persist every supported choice and both states of every switch.
    const selects = await page.locator('#configForm select').evaluateAll(elements => elements.map(el => ({ id: el.id, options: Array.from(el.options, option => option.value) })));
    const checks = await page.locator('#configForm [data-config-key][type=checkbox]').evaluateAll(elements => elements.map(el => el.id));
    for (let round = 0; round < 4; round++) {
      for (const select of selects) await page.locator('#' + select.id).selectOption(select.options[round % select.options.length]);
      for (const id of checks) await page.locator('#' + id).setChecked(round % 2 === 0);
      const expected = await settings();
      await save();
      assert.deepEqual((await server()).settings, expected);
      assert.match(await page.locator('#configStatus').innerText(), /No unsaved changes/);
      assert.equal(await page.locator('#configReview').isVisible(), false);
    }
    await page.reload();
    await settled();
    assert.deepEqual(await settings(), (await server()).settings, 'Saved settings survive a page reload');

    const baseline = await settings();
    await page.locator('#configReviewsReplies').setChecked(!baseline.reviews_enabled);
    const draft = await settings();
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('#btnConfigReload').click();
    assert.deepEqual(await settings(), draft, 'Cancelling reload preserves the draft');
    failRead = true;
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#btnConfigReload').click();
    await settled();
    assert.deepEqual(await settings(), draft);
    assert.equal(await page.locator('#configReviewsReplies').isEnabled(), true, 'Failed reload leaves the draft editable');
    for (const failure of ['http', 'network', 'json', 'csrf']) {
      failWrite = failure === 'csrf' ? '' : failure;
      failCsrf = failure === 'csrf';
      await save();
      assert.deepEqual(await settings(), draft, failure + ' failure preserves changes');
      assert.match(await page.locator('#configStatus').innerText(), /Your changes are kept/);
      assert.equal(await page.locator('#configReviewsReplies').isEnabled(), true);
      assert.equal(await page.locator('#configReview').isVisible(), false);
    }
    holdWrite = true;
    await review();
    const priorWrites = writes.length;
    await page.locator('#btnConfigSave').click();
    await page.waitForFunction(() => document.getElementById('module-config').getAttribute('aria-busy') === 'true');
    assert.equal(await page.locator('#configReviewsReplies').isDisabled(), true);
    assert.equal(await page.locator('#btnConfigReload').isDisabled(), true);
    await page.locator('#configForm').evaluate(form => form.requestSubmit());
    await heldWrite;
    assert.equal(writes.length, priorWrites + 1, 'A repeated submit cannot duplicate a save');
    releaseWrite();
    await settled();
    assert.deepEqual((await server()).settings, draft);

    // A real concurrent save must reject the stale browser version.
    await page.locator('#configReviewsReplies').setChecked(!draft.reviews_enabled);
    const staleDraft = await settings();
    const latest = await server();
    latest.settings.report_period = latest.settings.report_period === 'daily' ? 'weekly' : 'daily';
    const concurrent = await context.request.post(base + 'public/api/super-admin/configuration.php', {
      headers: { 'X-CSRF-Token': fixture.session.token }, data: { settings: latest.settings, version: latest.version, confirmed: true }
    });
    assert.equal(concurrent.status(), 200);
    await save();
    assert.match(await page.locator('#configStatus').innerText(), /Configuration changed/);
    assert.deepEqual(await settings(), staleDraft);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#btnConfigReload').click();
    await settled();
    assert.deepEqual(await settings(), latest.settings);

    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator('#configReviewsReplies').setChecked(!latest.settings.reviews_enabled);
      await review();
      assert(await page.locator('#module-config').evaluate(module => {
        const bounds = module.getBoundingClientRect();
        return module.scrollWidth <= module.clientWidth && Array.from(module.querySelectorAll('input, select, button')).filter(el => el.getClientRects().length).every(el => {
          const rect = el.getBoundingClientRect();
          return rect.left >= bounds.left && rect.right <= bounds.right;
        });
      }), 'All controls fit at ' + width + 'px');
      if (process.env.CC_CONFIG_SCREENSHOT_DIR && [390, 1440].includes(width)) {
        await page.locator('#module-config').screenshot({ path: path.join(process.env.CC_CONFIG_SCREENSHOT_DIR, 'config-' + width + '.png') });
      }
      await page.locator('#btnConfigDiscard').click();
    }
    await page.locator('#module-config a[href="#module-directory"]').click();
    assert.equal(new URL(page.url()).hash, '#module-directory');
    assert.deepEqual(errors, []);
    assert(writes.every(body => body.confirmed === true && typeof body.version === 'string' && Object.keys(body.settings).length === 10));
    console.log('PASS: all setting choices persist; review/confirmation, discard, reload, HTTP/network/JSON/CSRF recovery, duplicate-submit prevention, real save conflicts, keyboard focus and desktop/mobile layout.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
