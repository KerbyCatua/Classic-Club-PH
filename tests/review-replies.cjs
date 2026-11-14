// Live XAMPP end-to-end test. Temporary reviews, orders and session are cleaned up.
// CC_PHP_PATH / CC_PLAYWRIGHT_PATH / CC_TEST_URL can override local tool locations.
const { chromium } = require(process.env.CC_PLAYWRIGHT_PATH || 'playwright');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const base = process.env.CC_TEST_URL || 'http://localhost/classic-club-ph/';
const php = process.env.CC_PHP_PATH || 'C:/xampp/php/php.exe';
const helper = path.join(__dirname, 'review-replies-fixture.php');
const fixture = (mode, state) => execFileSync(php, [helper, mode], {input: state ? JSON.stringify(state) : '', encoding: 'utf8'});
const detailUrl = base + 'product-detail.html?id=structured-overshirt-graphite';
const reviewUrl = base + 'review-product.html?id=structured-overshirt-graphite&variant=structured-overshirt-graphite&variant_id=2&product_id=2#customer-reviews';

(async () => {
  const state = JSON.parse(fixture('setup'));
  let browser;
  try {
    browser = await chromium.launch();
    // Cache the project's exact Bootstrap assets in memory for deterministic browser QA.
    const assets = new Map(await Promise.all(['css/bootstrap.min.css', 'js/bootstrap.bundle.min.js'].map(async file => {
      const response = await fetch('https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/' + file);
      assert.ok(response.ok, 'Bootstrap fixture loads');
      return [path.basename(file), await response.text()];
    })));
    for (const width of [1440, 390]) {
      const admin = await browser.newContext({viewport: {width, height: 1000}, reducedMotion: 'reduce'});
      const guest = await browser.newContext({viewport: {width, height: 1000}, reducedMotion: 'reduce'});
      const errors = [];
      for (const context of [admin, guest]) {
        await context.route(/^https:\/\//, route => {
          const name = path.basename(new URL(route.request().url()).pathname);
          return assets.has(name) ? route.fulfill({body: assets.get(name), contentType: name.endsWith('.css') ? 'text/css' : 'text/javascript'}) : route.abort();
        });
        context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
      }
      await admin.addCookies([{name: state.session_name, value: state.session_id, url: base}]);
      const page = await admin.newPage();
      const frontend = await guest.newPage();
      await page.goto(base + 'admin-dashboard.html#module-reviews');
      await page.locator('.btn-reply-rev').first().waitFor();
      await page.locator('#reviewSearchInput').fill(state.marker);
      await page.waitForFunction(() => document.querySelectorAll('#reviewsTableBody tr[data-review-id]').length === 7);
      const viewport = page.locator('#module-reviews .reviews-viewport');
      const geometry = await viewport.evaluate(el => {
        const box = el.getBoundingClientRect();
        const rows = [...el.querySelectorAll('tbody tr')].map(row => row.getBoundingClientRect());
        return {height: el.clientHeight, scrollHeight: el.scrollHeight,
          visible: rows.filter(row => row.top >= box.top && row.bottom <= box.bottom + .1).length,
          rowHeights: rows.map(row => row.height), nextTop: rows[4].top - box.top};
      });
      assert.equal(geometry.height, 621);
      assert.equal(geometry.visible, 4, JSON.stringify(geometry));
      assert.ok(geometry.rowHeights.every(height => height === 144), JSON.stringify(geometry));
      assert.equal(geometry.nextTop, 621);
      assert.ok(geometry.scrollHeight > geometry.height);
      await viewport.evaluate(el => { el.scrollTop = 200; });
      assert.equal(await viewport.evaluate(el => Math.round(el.querySelector('th').getBoundingClientRect().top - el.getBoundingClientRect().top)), 0);
      await viewport.evaluate(el => { el.scrollTop = 0; });
      const filters = await page.locator('.review-filters').evaluate(el => {
        const search = el.querySelector('input').getBoundingClientRect(), rating = el.querySelector('select').getBoundingClientRect();
        return {searchTop: search.top, searchBottom: search.bottom, ratingTop: rating.top, ratingBottom: rating.bottom, searchRight: search.right, ratingLeft: rating.left, fits: el.scrollWidth <= el.clientWidth};
      });
      assert.ok(filters.fits);
      if (width > 767) { assert.equal(filters.searchBottom, filters.ratingBottom); assert.ok(filters.ratingLeft - filters.searchRight >= 15); }
      else assert.ok(filters.ratingTop - filters.searchBottom >= 15);
      if (process.env.CC_TEST_SCREENSHOTS_DIR) await page.locator('#module-reviews').screenshot({path: path.join(process.env.CC_TEST_SCREENSHOTS_DIR, `admin-reviews-${width}.png`)});
      await page.locator('#reviewRatingFilter').selectOption('4');
      await page.waitForFunction(id => document.querySelector('#reviewsTableBody tr[data-review-id]')?.dataset.reviewId === String(id), state.reviews['2']);
      assert.equal(await page.locator('#reviewsTableBody tr[data-review-id]').count(), 1);
      await page.locator('#reviewRatingFilter').selectOption('');
      await page.waitForFunction(() => document.querySelectorAll('#reviewsTableBody tr[data-review-id]').length === 7);

      const row = page.locator(`#reviewsTableBody tr[data-review-id="${state.reviews['1']}"]`);
      const modal = page.locator('#modalReplyReview');
      await row.locator('.btn-reply-rev').click();
      await page.waitForFunction(() => document.activeElement.id === 'replyText');
      async function checkOverlay(dialog) {
        assert.equal(await page.locator('#adminMainContent').evaluate(el => getComputedStyle(el).filter), 'blur(5px)');
        assert.equal(await page.locator('.modal-backdrop').evaluate(el => getComputedStyle(el).opacity), '0.5');
        assert.equal(await page.locator('.modal-backdrop').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 0, 0)');
        assert.equal(await dialog.evaluate(el => getComputedStyle(el).filter), 'none');
        assert.equal(await dialog.evaluate(el => el.parentElement === document.body), true);
      }
      await checkOverlay(modal);
      if (process.env.CC_TEST_SCREENSHOTS_DIR) await page.screenshot({path: path.join(process.env.CC_TEST_SCREENSHOTS_DIR, `reply-modal-${width}.png`)});
      await page.locator('#replyText').fill('   ');
      await modal.locator('[type="submit"]').click();
      assert.equal(await page.locator('#replyText').evaluate(el => el.checkValidity()), false);
      const reply = `Thanks for your feedback (${width}px).\nOur team appreciates it. <img src=x onerror=alert(1)> & care.`;
      await page.locator('#replyText').fill(reply);
      let releaseSave, writes = 0;
      await page.route('**/public/api/admin/reviews.php', async route => {
        if (route.request().method() !== 'POST') return route.continue();
        writes++;
        await new Promise(resolve => { releaseSave = resolve; });
        await route.continue();
      });
      await modal.locator('[type="submit"]').click();
      await page.waitForFunction(() => document.querySelector('#formReplyReview [type="submit"]').disabled);
      await page.locator('#formReplyReview').evaluate(el => el.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true})));
      await page.keyboard.press('Escape');
      assert.equal(await modal.isVisible(), true, 'Cannot dismiss a pending save');
      assert.equal(writes, 1, 'Repeated submit is ignored');
      releaseSave();
      await modal.waitFor({state: 'hidden'});
      await page.unroute('**/public/api/admin/reviews.php');
      await row.locator('.review-response').waitFor();
      assert.equal(await row.locator('.review-response-text').textContent(), reply);
      assert.equal(await page.locator('body').evaluate(el => el.classList.contains('cc-review-modal-open')), false);
      const saved = JSON.parse(fixture('inspect', state));
      assert.equal(saved.find(r => Number(r.id) === state.reviews['1']).business_reply, reply);
      assert.ok(saved.find(r => Number(r.id) === state.reviews['1']).business_replied_at);
      assert.ok(saved.filter(r => Number(r.id) !== state.reviews['1']).every(r => r.business_reply === null));

      async function checkFrontend(url) {
        await frontend.goto(url);
        const target = frontend.locator(`.review-item-row[data-review-id="db-${state.reviews['1']}"]`);
        await target.waitFor();
        assert.equal(await target.locator('.review-owner-reply').count(), 1);
        assert.equal(await target.locator('.review-owner-text').textContent(), reply);
        assert.match(await target.locator('.review-owner-reply').textContent(), /Classic Club PH.*Owner response/s);
        assert.equal(await target.locator('.review-owner-reply img').count(), 0, 'Reply content is escaped');
        const original = frontend.locator(`.review-item-row[data-review-id="db-${state.reviews['2']}"]`);
        assert.equal(await original.locator('.review-owner-reply').count(), 0, 'Unanswered review stays unchanged');
        assert.equal(await frontend.locator(`.review-item-row[data-review-id="db-${state.reviews['6']}"]`).count(), 0, 'Other product stays isolated');
        for (const index of ['7', '8']) assert.equal(await frontend.locator(`.review-item-row[data-review-id="db-${state.reviews[index]}"]`).count(), 0, 'Unpublished review stays private');
        assert.ok(await target.evaluate(el => el.scrollWidth <= el.clientWidth), 'Reply fits viewport');
        assert.equal(await target.evaluate(el => el.querySelector('.review-owner-reply').getBoundingClientRect().top >= el.querySelector('.review-content > p').getBoundingClientRect().bottom), true);
        await frontend.reload();
        await frontend.locator(`.review-item-row[data-review-id="db-${state.reviews['1']}"] .review-owner-reply`).waitFor();
        assert.equal(await frontend.locator(`.review-item-row[data-review-id="db-${state.reviews['1']}"] .review-owner-text`).textContent(), reply);
      }
      await checkFrontend(detailUrl);
      await checkFrontend(reviewUrl);
      if (process.env.CC_TEST_SCREENSHOTS_DIR) await frontend.locator(`.review-item-row[data-review-id="db-${state.reviews['1']}"]`).screenshot({path: path.join(process.env.CC_TEST_SCREENSHOTS_DIR, `owner-reply-${width}.png`)});
      await frontend.locator('#filter-rating').selectOption('4');
      assert.equal(await frontend.locator('.review-owner-reply').count(), 0, 'Filtering cannot move a reply to another review');
      await page.reload();
      await row.locator('.review-response').waitFor();
      assert.equal(await row.locator('.review-response-text').textContent(), reply);
      await row.locator('.btn-reply-rev').click();
      await page.waitForFunction(() => document.activeElement.id === 'replyText');
      assert.equal(await page.locator('#replyText').inputValue(), reply, 'Existing reply is editable');
      await modal.locator('[data-bs-dismiss="modal"]').first().click();
      await modal.waitFor({state: 'hidden'});
      await row.locator('.btn-flag-rev').click();
      const flag = page.locator('#modalFlagReview');
      await page.waitForFunction(() => document.activeElement.id === 'flagReason');
      await checkOverlay(flag);
      await flag.locator('[type="submit"]').click();
      await flag.waitFor({state: 'hidden'});
      await row.locator('.admin-badge-out').waitFor();
      assert.equal(await row.locator('.review-response-text').textContent(), reply, 'Flagging preserves reply');
      assert.deepEqual(errors, []);
      await admin.close();
      await guest.close();
      console.log(`PASS ${width}px: four rows, scrolling, filters, both overlays, live reply save, duplicate prevention, correct frontend placement, escaping, refresh, editing and flagging.`);
    }
    const unauthenticated = await fetch(base + 'public/api/admin/reviews.php', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action: 'reply', review_id: state.reviews['1'], reply_text: 'Rejected'})});
    assert.equal(unauthenticated.status, 401);
    console.log('PASS: cross-business and unauthenticated reply rejection.');
  } finally {
    if (browser) await browser.close();
    process.stdout.write(fixture('cleanup', state));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
