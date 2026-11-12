// Run with Playwright installed: node tests/scroll-reveal.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.CC_TEST_URL || 'http://localhost/classic-club-ph/';
const root = path.resolve(__dirname, '..');
const cardSelector = '.cc-product-card';
const productPages = fs.readdirSync(root).filter(file => file.endsWith('.html') &&
  fs.readFileSync(path.join(root, file), 'utf8').includes('cc-product-card'));

async function nextFrames(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function fixture(browser, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 500 }, ...options });
  await page.setContent(`<style>
    body { margin: 0; } .spacer { height: 700px; }
    .row { display: flex; gap: 20px; } .col { width: 200px; }
    .cc-product-card { height: 350px; background: silver; }
  </style><main><div class="spacer"></div><section><div class="row">
    ${Array.from({ length: 4 }, (_, i) => `<div class="col"><article class="cc-product-card"><h2>Product ${i + 1}</h2><a href="#">Details</a></article></div>`).join('')}
  </div></section><div class="spacer"></div></main>`);
  await page.addStyleTag({ path: path.join(root, 'assets/css/scroll-reveal.css') });
  await page.addScriptTag({ path: path.join(root, 'assets/js/scroll-reveal.js') });
  await page.evaluate(() => {
    window.starts = [];
    document.addEventListener('transitionstart', event => {
      if (event.propertyName === 'opacity' && event.target.matches('.cc-product-card')) {
        starts.push({ index: [...document.querySelectorAll('.cc-product-card')].indexOf(event.target), time: performance.now() });
      }
    }, true);
  });
  await nextFrames(page);
  return page;
}

async function expectSequence(page, top, label) {
  await page.evaluate(top => { starts.length = 0; window.scrollTo(0, top); }, top);
  await page.waitForFunction(() => starts.length === 4);
  const starts = await page.evaluate(() => window.starts);
  assert.deepEqual(starts.map(event => event.index), [0, 1, 2, 3], label);
  for (let i = 1; i < starts.length; i++) {
    assert.ok(starts[i].time - starts[i - 1].time >= 70, `${label}: distinct staggered starts`);
  }
  await page.waitForFunction(() => [...document.querySelectorAll('.cc-product-card')].every(card =>
    getComputedStyle(card).opacity === '1' && getComputedStyle(card).transform === 'matrix(1, 0, 0, 1, 0, 0)'));
}

(async () => {
  const browser = await chromium.launch(process.env.CC_BROWSER_PATH ? { executablePath: process.env.CC_BROWSER_PATH } : {});
  const errors = [];
  try {
    const page = await fixture(browser);
    page.on('pageerror', error => errors.push(error.message));
    await expectSequence(page, 500, 'scroll down');
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForFunction(() => [...document.querySelectorAll('.cc-product-card')].every(card => !card.classList.contains('is-visible')));
    assert.equal(await page.locator(cardSelector).first().evaluate(card => getComputedStyle(card).opacity), '0');
    await expectSequence(page, 800, 'scroll up');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => !document.querySelector('.cc-product-card.is-visible'));
    await expectSequence(page, 500, 'repeat scroll down');

    // Dynamic cards join the sequence automatically, without refresh calls.
    await page.evaluate(() => {
      const col = document.querySelector('.col').cloneNode(true);
      col.querySelector('.cc-product-card').className = 'cc-product-card';
      document.querySelector('.row').append(col);
    });
    await page.waitForFunction(() => document.querySelectorAll('.cc-product-reveal.is-visible').length === 5);
    assert.equal(await page.locator('.cc-product-card .cc-reveal').count(), 0);
    assert.equal(await page.locator('.row.cc-reveal, section.cc-reveal').count(), 0);
    await page.evaluate(() => { refreshScrollReveal(); refreshScrollReveal(); });
    assert.equal(await page.locator('.cc-product-reveal.is-visible').count(), 5);
    await page.close();
    console.log('Transitions: sequential starts, fade/slide, both directions, repeat visits, dynamic additions and refresh passed');

    const pointer = await fixture(browser);
    await pointer.evaluate(() => {
      window.clicked = false;
      document.querySelectorAll('.cc-product-card a')[3].addEventListener('click', event => {
        event.preventDefault();
        window.clicked = true;
      });
      scrollTo(0, 500);
    });
    await pointer.waitForFunction(() => document.querySelectorAll('.cc-product-card.is-visible').length === 4);
    await pointer.locator('.cc-product-card a').nth(3).click({ force: true });
    assert.equal(await pointer.evaluate(() => window.clicked), true, 'Pointer focus must not move a queued link away from the click');
    await pointer.evaluate(() => {
      scrollTo(0, 0);
      document.querySelector('.cc-product-card a').focus();
    });
    await pointer.keyboard.press('Tab');
    assert.equal(await pointer.evaluate(() => getComputedStyle(document.activeElement.closest('.cc-product-card')).transitionDelay), '0s');
    await pointer.waitForFunction(() => getComputedStyle(document.activeElement.closest('.cc-product-card')).opacity === '1');
    await pointer.close();
    console.log('Pointer clicks during stagger delays and keyboard focus passed');

    const reduced = await fixture(browser, { reducedMotion: 'reduce' });
    assert.deepEqual(await reduced.locator(cardSelector).first().evaluate(card => {
      const css = getComputedStyle(card);
      return [css.opacity, css.transform, css.transitionDuration];
    }), ['1', 'none', '0s']);
    await reduced.close();
    const fallback = await browser.newPage();
    await fallback.setContent('<main><article class="cc-product-card"><h2>Product</h2></article></main>');
    await fallback.evaluate(() => { delete window.IntersectionObserver; });
    await fallback.addStyleTag({ path: path.join(root, 'assets/css/scroll-reveal.css') });
    await fallback.addScriptTag({ path: path.join(root, 'assets/js/scroll-reveal.js') });
    assert.equal(await fallback.locator(cardSelector).evaluate(card => getComputedStyle(card).opacity), '1');
    await fallback.close();
    console.log('Reduced motion and unsupported-observer fallback passed');

    // Inspect every real HTML page with cards, including generated wishlist HTML.
    const context = await browser.newContext({ viewport: { width: 1440, height: 500 } });
    const realPage = await context.newPage();
    realPage.on('pageerror', error => errors.push(error.message));
    await realPage.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== new URL(base).origin) {
        const filename = path.basename(url.pathname);
        if (process.env.CC_TEST_ASSETS_DIR && ['bootstrap.min.css', 'bootstrap.bundle.min.js'].includes(filename)) {
          return route.fulfill({ path: path.join(process.env.CC_TEST_ASSETS_DIR, filename) });
        }
        return route.abort();
      }
      // Only the catalog is live. Session/cart/wishlist state stays in this test.
      const json = data => route.fulfill({ json: { success: true, data } });
      if (url.pathname.endsWith('/auth/me.php')) return json({ user: null });
      if (url.pathname.endsWith('/auth/csrf.php')) return json({ token: 'test' });
      if (/\/(cart|wishlist)\//.test(url.pathname)) return json({ items: [] });
      return route.continue();
    });

    let total = 0;
    for (const file of productPages) {
      const html = fs.readFileSync(path.join(root, file), 'utf8');
      assert.ok(html.includes('assets/css/scroll-reveal.css'), file);
      assert.ok(html.includes('assets/js/scroll-reveal.js'), file);
      await realPage.goto(base + file, { waitUntil: 'load' });
      await realPage.waitForFunction(() => CCStore.isCatalogLoaded());
      if (file === 'wishlist.html') {
        await realPage.evaluate(() => {
          localStorage.setItem('cc_wishlist_data', JSON.stringify(Object.keys(CCStore.getProducts())));
          dispatchEvent(new CustomEvent('cc:wishlistUpdated'));
        });
      }
      await realPage.waitForFunction(() => {
        const cards = [...document.querySelectorAll('.cc-product-card')];
        return cards.length > 0 && cards.every(card => card.classList.contains('cc-product-reveal'));
      });
      const cards = realPage.locator(cardSelector).filter({ visible: true });
      const count = await cards.count();
      assert.ok(count > 0, file);
      assert.equal(await cards.evaluateAll(cards => cards.filter(card =>
        card.parentElement.closest('.cc-reveal') || card.querySelector('.cc-reveal')).length), 0, `${file}: cards animate independently`);
      // Visit every card downwards, then upwards, using each stable cell.
      for (const indexes of [Array.from({ length: count }, (_, i) => i), Array.from({ length: count }, (_, i) => count - i - 1)]) {
        for (const index of indexes) {
          const card = cards.nth(index);
          await card.evaluate(card => card.parentElement.scrollIntoView({ block: 'center', behavior: 'instant' }));
          await realPage.waitForFunction(index => {
            const cards = [...document.querySelectorAll('.cc-product-card')].filter(card => card.checkVisibility());
            return cards[index]?.classList.contains('is-visible');
          }, index);
        }
      }
      total += count;
      console.log(`${file}: ${count} cards passed down/up viewport visits`);
    }

    // Narrow screens: a card taller than the viewport must still reveal.
    await realPage.setViewportSize({ width: 390, height: 320 });
    await realPage.goto(base + 'shop-all.html');
    await realPage.waitForFunction(() => document.querySelector('#product-grid')?.getAttribute('aria-busy') === 'false');
    const mobileCard = realPage.locator('.product-item:not([hidden]) .cc-product-card').first();
    await mobileCard.evaluate(card => card.parentElement.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await realPage.waitForFunction(() => document.querySelector('.product-item:not([hidden]) .cc-product-card.is-visible'));
    assert.ok(await mobileCard.evaluate(card => card.offsetHeight > innerHeight));
    await context.close();
    assert.deepEqual(errors, []);
    console.log(`PASS: ${productPages.length} HTML pages, ${total} cards, desktop/mobile and repeatable staggered transitions`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
