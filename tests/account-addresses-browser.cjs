// Invoke through account-addresses.php with CC_PLAYWRIGHT_PATH pointing to an external Playwright install.
const { chromium } = require(process.env.CC_PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs');
const assert = require('node:assert/strict');
const fixture = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
    const [name, value] = fixture.session.cookie.split('=');
    await context.addCookies([{ name, value, url: fixture.base, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.goto(fixture.base + '/account-dashboard.html');
    await page.locator('#account-main').waitFor({ state: 'visible' });
    await page.locator('#dashboard-shipping-address').filter({ hasText: '20 Work Street' }).waitFor();
    await page.locator('#manage-addresses-link').click();
    await page.locator('#manage-address-modal').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.getElementById('address-save').disabled);
    assert.equal(await page.locator('#account-main').evaluate(el => getComputedStyle(el).filter), 'blur(5px)');
    assert.equal(await page.locator('.modal-backdrop').evaluate(el => getComputedStyle(el).opacity), '0.5');
    await page.locator('#address-street_address').fill('30 Browser Street');
    await page.locator('#address-save').click();
    await page.locator('#address-status').filter({ hasText: 'Address saved.' }).waitFor();
    await page.locator('#dashboard-shipping-address').filter({ hasText: '30 Browser Street' }).waitFor();

    await page.locator('#address-add').click();
    const address = {
      first_name: 'Browser', last_name: 'Customer', mobile: '+63 918 123 4567', label: 'Browser Home',
      region: 'National Capital Region', province: 'Metro Manila', city: 'Makati', barangay: 'Poblacion',
      postal_code: '1210', street_address: '40 New Street', apartment: 'Unit 5', instructions: 'Ring the bell'
    };
    for (const [key, value] of Object.entries(address)) await page.locator('#address-' + key).fill(value);
    await page.locator('[name="is_default_shipping"]').check();
    await page.locator('#address-save').click();
    await page.locator('#address-status').filter({ hasText: 'Address saved.' }).waitFor();
    assert.equal(await page.locator('.cc-address-card').count(), 2);

    await page.setViewportSize({ width: 390, height: 844 });
    const modalBounds = await page.locator('#manage-address-modal .modal-content').boundingBox();
    assert(modalBounds.x >= 0 && modalBounds.x + modalBounds.width <= 390, 'Modal fits mobile viewport');
    assert(await page.locator('#manage-address-modal .modal-body').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'No horizontal modal overflow');
    await page.locator('#manage-address-modal [aria-label="Close manage addresses"]').click();
    await page.locator('#manage-address-modal').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !document.body.classList.contains('cc-address-modal-open'));
    assert.equal(await page.locator('#account-main').evaluate(el => getComputedStyle(el).filter), 'none');
    await page.reload();
    await page.locator('#dashboard-shipping-address').filter({ hasText: '40 New Street' }).waitFor();

    await page.goto(fixture.base + '/checkout.html');
    await page.waitForFunction(() => !document.getElementById('checkout-save-address').disabled);
    assert.equal(await page.locator('#checkout-street').inputValue(), '40 New Street');
    assert.equal(await page.locator('#checkout-fname').inputValue(), 'Browser');
    assert.equal(await page.locator('#checkout-instructions').inputValue(), 'Ring the bell');
    await page.locator('#billing-preview-line').filter({ hasText: '40 New Street' }).waitFor();
    await page.locator('#checkout-street').fill('50 Checkout Street');
    await page.locator('#checkout-save-address').click();
    await page.locator('#checkout-address-status').filter({ hasText: 'Address saved to your account.' }).waitFor();
    await page.reload();
    await page.waitForFunction(() => document.getElementById('checkout-street').value === '50 Checkout Street');
    await page.locator('#checkout-saved-address').selectOption({ label: 'Work — 30 Browser Street, Makati' });
    assert.equal(await page.locator('#checkout-street').inputValue(), '30 Browser Street');
    await page.locator('#billing-preview-line').filter({ hasText: '30 Browser Street' }).waitFor();

    await page.goto(fixture.base + '/account-dashboard.html');
    await page.locator('#manage-addresses-link').click();
    await page.waitForFunction(() => !document.getElementById('address-save').disabled);
    await page.locator('.cc-address-card').filter({ hasText: 'Browser Home' }).getByRole('button', { name: 'Remove', exact: true }).click();
    await page.locator('#address-status').filter({ hasText: 'Address removed.' }).waitFor();
    assert.equal(await page.locator('.cc-address-card').count(), 1);
    await page.keyboard.press('Escape');
    await page.locator('#manage-address-modal').waitFor({ state: 'hidden' });

    // A second authenticated account must never receive this account's address autofill.
    const other = await browser.newContext();
    const [otherName, otherValue] = fixture.other.cookie.split('=');
    await other.addCookies([{ name: otherName, value: otherValue, url: fixture.base, httpOnly: true, sameSite: 'Lax' }]);
    const otherPage = await other.newPage();
    await otherPage.goto(fixture.base + '/checkout.html');
    await otherPage.waitForFunction(() => !document.getElementById('checkout-save-address').disabled);
    assert.equal(await otherPage.locator('#checkout-street').inputValue(), '');
    assert.deepEqual(errors, []);
    console.log('PASS: desktop/mobile modal, blur/overlay, browser CRUD, reload persistence, checkout selection/autofill/save, billing preview, Escape and account isolation.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
