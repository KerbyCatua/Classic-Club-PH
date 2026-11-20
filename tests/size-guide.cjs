// Run against the local catalog with Playwright installed: node tests/size-guide.cjs
const { chromium } = require(process.env.CC_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');

const base = process.env.CC_TEST_URL || 'http://localhost/classic-club-ph/';
const homeUrl = new URL('index.html', base).href;
const guideUrl = new URL('size-guide.html', base).href;
const productUrl = new URL('product-detail.html?id=structured-overshirt-graphite', base).href;
const breadcrumb = page => page.getByRole('navigation', { name: 'breadcrumb' });
const breadcrumbText = async page => (await breadcrumb(page).innerText()).replace(/\s+/g, ' ').trim();

(async () => {
  const browser = await chromium.launch(process.env.CC_BROWSER_PATH ? { executablePath: process.env.CC_BROWSER_PATH } : {});
  try {
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    await page.goto(productUrl, { waitUntil: 'domcontentloaded' });
    const guideLink = page.locator('main').getByRole('link', { name: 'Size & fit guide' });
    await guideLink.click();
    await page.waitForURL(`${guideUrl}?id=structured-overshirt-graphite`);
    const productLink = breadcrumb(page).getByRole('link', { name: 'Structured Overshirt' });
    await productLink.waitFor();
    assert.equal(await breadcrumbText(page), 'Home / Structured Overshirt / Size & Fit Guide');
    await productLink.click();
    await page.waitForURL(productUrl);
    await page.getByRole('heading', { name: 'Structured Overshirt', exact: true }).waitFor();
    await breadcrumb(page).getByRole('link', { name: 'Home' }).click();
    await page.waitForURL(homeUrl);

    await page.goto(productUrl, { waitUntil: 'domcontentloaded' });
    await guideLink.click();
    await productLink.waitFor();
    await breadcrumb(page).getByRole('link', { name: 'Home' }).click();
    await page.waitForURL(homeUrl);

    for (const url of [guideUrl, `${guideUrl}?id=missing-product`]) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => CCStore.whenCatalogReady());
      assert.equal(await breadcrumbText(page), 'Home / Size & Fit Guide');
      assert.equal(await breadcrumb(page).getByRole('link').count(), 1);
    }

    await page.getByRole('button', { name: 'Inches (in)' }).click();
    assert.equal(await page.locator('[data-size-unit]').first().textContent(), 'IN');
    await page.getByRole('button', { name: 'Centimeters (cm)' }).click();
    assert.equal(await page.locator('[data-size-unit]').first().textContent(), 'CM');

    await page.goto(new URL('about.html', base).href, { waitUntil: 'domcontentloaded' });
    await page.getByRole('link', { name: 'Explore fit & care' }).click();
    await page.waitForURL(guideUrl);
    assert.equal(await breadcrumbText(page), 'Home / Size & Fit Guide');

    await page.goto(new URL('shop-all.html', base).href, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => CCQuickView.open('essential-hw-tee-obsidian'));
    await page.getByRole('button', { name: 'Chalk', exact: true }).click();
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByRole('dialog').getByRole('link', { name: 'Size & fit guide' }).click(),
    ]);
    await popup.waitForURL(`${guideUrl}?id=essential-hw-tee-chalk`);
    await breadcrumb(popup).getByRole('link', { name: 'Essential Heavyweight Tee' }).click();
    await popup.waitForURL(new URL('product-detail.html?id=essential-hw-tee-chalk', base).href);
    assert.equal(await page.getByRole('dialog').isVisible(), true);

    console.log('Size guide: product round trip, Home, direct and unknown IDs, chart units, About, and Quick View passed.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
