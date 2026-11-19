// Run with CC_PLAYWRIGHT_PATH set to an external Playwright installation.
// All write endpoints are mocked: this test never creates orders or changes stock.
const { chromium } = require(process.env.CC_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const base = process.env.CC_TEST_URL || 'http://localhost/classic-club-ph/';
const valid = {
  email: 'Customer+demo@EXAMPLE.COM', first_name: '  José   María  ', last_name: 'Dela Cruz-O’Neil',
  mobile: '(0917) 123-4567', country: 'Philippines', region: 'National Capital Region',
  street_address: '  18   Test Street  ', apartment: '', barangay: 'Poblacion', city: 'Makati',
  province: 'Metro Manila', postal_code: '0400', instructions: ''
};
const saved = { ...valid, id: 17, label: 'Home', first_name: 'Saved', last_name: 'Customer',
  street_address: '40 Saved Street', postal_code: '1210', is_default_shipping: 1 };

(async () => {
  const browser = await chromium.launch(process.env.CC_BROWSER_PATH ? { executablePath: process.env.CC_BROWSER_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  let writes = [], addressWrites = [], mode = 'server-error', signedIn = false, profileDelay = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== new URL(base).origin) {
      const filename = path.basename(url.pathname);
      if (process.env.CC_TEST_ASSETS_DIR && ['bootstrap.min.css', 'bootstrap.bundle.min.js'].includes(filename)) {
        return route.fulfill({ path: path.join(process.env.CC_TEST_ASSETS_DIR, filename) });
      }
      return route.abort();
    }
    const reply = data => route.fulfill({ json: { success: true, data } });
    if (url.pathname.endsWith('/checkout.html')) {
      return route.fulfill({ path: path.join(__dirname, '..', 'checkout.html') });
    }
    if (url.pathname.endsWith('/auth/me.php')) {
      if (profileDelay) await new Promise(resolve => setTimeout(resolve, profileDelay));
      return reply({ user: signedIn ? { email: 'account@example.com', first_name: 'Account', last_name: 'Customer' } : null });
    }
    if (/\/(cart\/view|wishlist\/view)\.php$/.test(url.pathname)) return reply({ items: [] });
    if (url.pathname.endsWith('/auth/csrf.php')) return reply({ token: 'checkout-test-token' });
    if (url.pathname.endsWith('/auth/addresses.php')) {
      if (request.method() === 'POST') addressWrites.push(request.postDataJSON());
      return reply({ addresses: [saved], id: saved.id });
    }
    if (url.pathname.endsWith('/checkout/create-order.php')) {
      writes.push(request.postDataJSON());
      if (mode === 'network-error') return route.abort();
      await new Promise(resolve => setTimeout(resolve, 250));
      if (mode === 'success') return reply({ order_number: 'CC-DEMO-TEST', status: 'confirmed', placed_at: '2026-11-15T12:00:00+08:00' });
      return route.fulfill({ status: 422, json: { success: false, error: { message: 'Please correct the checkout fields.', fields: { postal_code: 'Check this postal code.' } } } });
    }
    if (url.pathname.endsWith('/order-confirmation.html')) return route.fulfill({ contentType: 'text/html', body: '<p>Test confirmation</p>' });
    if (request.method() !== 'GET') throw new Error('Unexpected write: ' + url);
    return route.continue();
  });
  const field = name => page.locator(`#checkout-form [name="${name}"]`);
  async function open() {
    await page.goto(base + 'checkout.html', { waitUntil: 'load' });
    await page.waitForFunction(() => document.getElementById('checkout-form').noValidate && !document.getElementById('place-order-btn').disabled && CCStore.isCatalogLoaded());
  }
  async function seedCart() {
    await page.evaluate(() => {
      const product = Object.values(CCStore.getProducts())[0];
      localStorage.setItem('cc_cart_data', JSON.stringify([{ ...product, color: 'Obsidian', size: 'M', quantity: 1, price: 1290 }]));
      window.dispatchEvent(new CustomEvent('cc:cartUpdated'));
    });
  }
  async function fillValid() {
    for (const [name, text] of Object.entries(valid)) {
      if (name === 'country') await field(name).selectOption(text);
      else await field(name).fill(text);
    }
    await field('demo_consent').check();
  }
  async function blur(name, text) {
    await field(name).fill(text);
    await field(name).blur();
  }
  try {
    await open();
    assert.equal(await page.locator('#checkout-errors').isVisible(), false, 'Pristine form has no errors');
    assert.equal(await field('demo_consent').isChecked(), false, 'Consent requires an explicit choice');
    assert.equal(await page.locator('#checkout-demo-card input').count(), 0, 'No card details can be entered');
    await page.locator('#place-order-btn').click();
    assert.equal(writes.length, 0, 'Empty form never posts');
    assert.equal(await page.locator('#checkout-error-list li').count(), 11, 'One error per empty required field, including consent');
    assert.equal(await field('email').evaluate(el => document.activeElement === el), true, 'First invalid field receives focus');
    await page.locator('#checkout-error-list a[href="#checkout-mobile"]').click();
    assert.equal(await field('mobile').evaluate(el => document.activeElement === el), true, 'Error summary links focus fields');
    await blur('first_name', '   ');
    assert.equal(await field('first_name').inputValue(), '', 'Whitespace-only input is normalized and rejected');
    for (const [name, text] of [['email', 'a..b@example.com'], ['mobile', '0917abc4567'], ['first_name', '<script>'], ['postal_code', '12x4'], ['city', '---']]) {
      await blur(name, text);
      assert.equal(await field(name).getAttribute('aria-invalid'), 'true', `${name}: invalid format is rejected on blur`);
      const id = (await field(name).getAttribute('aria-describedby')).split(' ').find(id => id.endsWith('-error'));
      assert.ok(await page.locator('#' + id).isVisible(), `${name}: associated error is visible`);
    }
    assert.equal(await page.locator('#checkout-city-error').textContent(), 'Enter an address detail containing letters or numbers.');
    await seedCart();
    await fillValid();
    await page.locator('#checkout-consent').focus();
    assert.equal(await page.evaluate(() => CCCheckoutValidation.validate()), true, 'Valid Unicode names and optional empty fields pass');
    assert.equal(await field('first_name').inputValue(), 'José María');
    assert.equal(await field('street_address').inputValue(), '18 Test Street');
    assert.equal(await field('email').inputValue(), 'Customer+demo@example.com');
    assert.equal(await field('postal_code').inputValue(), '0400', 'Postal code preserves its leading zero');
    assert.equal(await field('mobile').inputValue(), '+639171234567');
    assert.equal(await page.locator('#checkout-errors').isVisible(), false, 'Corrected errors are cleared');
    assert.ok((await page.locator('#billing-preview-line').textContent()).includes('18 Test Street'), 'Normalized address reaches billing preview');
    for (const phone of ['0917 123 4567', '+63 (917) 123-4567', '639171234567', '9171234567']) {
      await blur('mobile', phone);
      assert.equal(await field('mobile').inputValue(), '+639171234567');
      assert.equal(await field('mobile').getAttribute('aria-invalid'), 'false');
    }
    await field('first_name').evaluate(el => { el.value = 'A'.repeat(101); el.dispatchEvent(new Event('blur')); });
    assert.equal(await field('first_name').getAttribute('aria-invalid'), 'true', 'Programmatic overlength values fail');
    await blur('first_name', 'Jose\u200b');
    assert.equal(await field('first_name').inputValue(), 'Jose', 'Invisible control characters are removed');
    await field('payment_method').first().focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#checkout-payment-gcash').isChecked(), true, 'Native radio group supports arrow navigation');
    assert.equal(await page.locator('#checkout-demo-card').isVisible(), false);
    assert.ok((await page.locator('#checkout-demo-wallet').textContent()).includes('DEMO-GCASH'));
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#checkout-payment-maya').isChecked(), true);
    assert.ok((await page.locator('#checkout-demo-wallet').textContent()).includes('DEMO-MAYA'));

    await page.locator('#place-order-btn').click();
    await page.evaluate(() => document.getElementById('checkout-form').requestSubmit());
    await page.waitForFunction(() => !document.getElementById('place-order-btn').disabled);
    assert.equal(writes.length, 1, 'Repeated submissions make a single request');
    assert.equal(writes[0].mobile, '+639171234567');
    assert.deepEqual(Object.keys(writes[0]).sort(), [...Object.keys(valid), 'promotion_code'].sort(), 'Payload contains no card, wallet or unnecessary form data');
    assert.equal(await field('postal_code').getAttribute('aria-invalid'), 'true', 'Server errors map to fields');
    assert.equal(await page.locator('#checkout-postal-error').textContent(), 'Check this postal code.');
    assert.equal(await field('postal_code').isEnabled(), true, 'Failed request restores fields');

    mode = 'network-error';
    await blur('postal_code', '1210');
    await page.locator('#place-order-btn').click();
    await page.waitForFunction(() => !document.getElementById('place-order-btn').disabled);
    assert.ok((await page.locator('#checkout-errors-title').textContent()).includes('connection'), 'Network error offers a useful recovery message');
    assert.equal(await field('first_name').inputValue(), 'Jose', 'Failed request preserves entered values');
    mode = 'success';
    await page.locator('#place-order-btn').click();
    await page.waitForURL('**/order-confirmation.html?order_number=CC-DEMO-TEST');
    assert.equal(writes.length, 3, 'One request per explicit valid attempt');
    const order = await page.evaluate(() => JSON.parse(localStorage.getItem('cc_order_history')).at(-1));
    assert.equal(order.customer.paymentMethod, 'Maya (Illustrative)');
    console.log('PASS: blur/submit validation, normalization, Unicode, error summary, accessible keyboard choices, mock payload, server/network recovery and duplicate-submit prevention.');

    signedIn = true;
    await open();
    await page.waitForFunction(() => !document.getElementById('checkout-save-address').disabled);
    assert.equal(await field('street_address').inputValue(), saved.street_address, 'Saved address fills checkout');
    assert.ok((await page.locator('#billing-preview-line').textContent()).includes(saved.street_address));
    await blur('postal_code', 'bad');
    await page.locator('#checkout-save-address').click();
    assert.equal(addressWrites.length, 0, 'Invalid address cannot be saved');
    await blur('postal_code', '1210');
    await page.locator('#checkout-save-address').click();
    await page.locator('#checkout-address-status').filter({ hasText: 'Address saved to your account.' }).waitFor();
    assert.equal(addressWrites.length, 1, 'Valid address can be saved');
    assert.equal(addressWrites[0].mobile, '+639171234567', 'Address save shares checkout normalization');
    await page.locator('#checkout-saved-address').selectOption('');
    assert.equal(await field('street_address').inputValue(), '');
    assert.equal(await field('postal_code').getAttribute('aria-invalid'), 'false', 'Changing address resets stale errors');
    await page.locator('#checkout-saved-address').selectOption('17');
    await field('demo_consent').check();
    await page.locator('#place-order-btn').click();
    assert.ok((await page.locator('#checkout-errors-title').textContent()).includes('bag is empty'), 'Valid form still rejects an empty cart');

    profileDelay = 500;
    const loading = page.goto(base + 'checkout.html', { waitUntil: 'domcontentloaded' });
    await loading;
    await field('street_address').fill('My typed address');
    await page.waitForFunction(() => !document.getElementById('checkout-save-address').disabled);
    assert.equal(await field('street_address').inputValue(), 'My typed address', 'Slow account lookup cannot overwrite manual entry');
    console.log('PASS: saved-address validation, selection, billing preview, empty cart and slow autofill handling.');

    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const formBounds = await page.locator('#checkout-form').evaluate(el => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, viewport: innerWidth }));
      assert.ok(formBounds.left >= 0 && formBounds.right <= width + 1, `${width}px: form stays in viewport: ${JSON.stringify(formBounds)}`);
      assert.equal(await page.locator('#checkout-shipping input, #checkout-shipping select, #checkout-shipping textarea').evaluateAll(elements => elements.filter(el => el.getClientRects().length).every(el => {
        const rect = el.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth + 1;
      })), true, `${width}px: fields do not overflow the viewport`);
    }
    assert.deepEqual(await page.locator('#checkout-form input, #checkout-form select, #checkout-form textarea').evaluateAll(elements => elements.filter(el => !el.labels?.length).map(el => el.id)), [], 'Every form control has a label');
    assert.deepEqual(await page.locator('#checkout-form [aria-describedby]').evaluateAll(elements => elements.flatMap(el => el.getAttribute('aria-describedby').split(' ').filter(id => !document.getElementById(id)))), [], 'Every accessible description resolves');
    assert.deepEqual(errors, [], 'No browser JavaScript errors');
    console.log('PASS: 1440/768/390/320px layout, labels, accessible descriptions and browser error checks.');
    if (process.env.CC_TEST_SCREENSHOT_DIR) {
      await fillValid();
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.screenshot({ path: path.join(process.env.CC_TEST_SCREENSHOT_DIR, 'checkout-desktop.png'), fullPage: true });
      await page.locator('section[aria-labelledby="checkout-payment-heading"]').screenshot({ path: path.join(process.env.CC_TEST_SCREENSHOT_DIR, 'checkout-payment.png') });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(process.env.CC_TEST_SCREENSHOT_DIR, 'checkout-mobile.png'), fullPage: true });
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
