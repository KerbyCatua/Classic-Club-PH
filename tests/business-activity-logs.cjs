// Run with CC_PLAYWRIGHT_PATH pointing to Playwright; optional CC_TEST_ASSETS_DIR caches Bootstrap.
const { chromium } = require(process.env.CC_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const base = process.env.CC_TEST_URL || 'http://localhost/classic-club-ph/';

(async () => {
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 375]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const read = new Set();
      const writes = [];
      let rejectWrite = false;
      let releaseWrite;
      const logs = Array.from({ length: 12 }, (_, index) => ({
        id: index + 1, created_at: '2026-11-14 09:30:00', responsible_person: 'Test Administrator',
        role: 'Business Admin', action: index === 0 ? 'Product activated' : 'Restock',
        affected_resource: `Product ${index + 1}`, change_details: 'Long change details to verify that wrapping does not expand the six-row viewport. '.repeat(4)
      }));
      await page.route(/^https:\/\//, route => {
        const filename = path.basename(new URL(route.request().url()).pathname);
        if (['bootstrap.min.css', 'bootstrap.bundle.min.js'].includes(filename)) {
          return process.env.CC_TEST_ASSETS_DIR
            ? route.fulfill({ path: path.join(process.env.CC_TEST_ASSETS_DIR, filename) }) : route.continue();
        }
        return route.abort();
      });
      await page.route('**/public/api/**', async route => {
        const url = new URL(route.request().url());
        let data = {};
        if (url.pathname.endsWith('/auth-check.php')) data = {
          authenticated: true, user: { id: 7, first_name: 'Test', last_name: 'Admin' }, roles: ['admin'],
          business: { id: 1, name: 'Classic Club PH' }, permissions: {}
        };
        if (url.pathname.endsWith('/csrf.php')) data = { token: 'logs-test-token' };
        if (url.pathname.endsWith('/activity-logs.php')) {
          if (route.request().method() === 'POST') {
            assert.equal(route.request().headers()['x-csrf-token'], 'logs-test-token');
            const id = Number(route.request().postDataJSON().log_id);
            writes.push(id);
            await new Promise(resolve => { releaseWrite = resolve; });
            if (rejectWrite) return route.fulfill({ status: 500, json: { success: false, error: { message: 'Test save failure' } } });
            read.add(id);
          } else {
            const search = url.searchParams.get('search') || '';
            const action = url.searchParams.get('activity') || '';
            data = { logs: logs.filter(log => !read.has(log.id) && log.affected_resource.includes(search) && log.action.includes(action)) };
          }
        }
        await route.fulfill({ json: { success: true, data } });
      });
      const buttons = page.locator('#module-logs .activity-log-read');
      const modal = page.locator('#activityLogReadModal');
      const confirm = page.locator('#confirmActivityLogRead');
      const cancel = page.locator('#cancelActivityLogRead');
      await page.goto(base + 'admin-dashboard.html#module-logs');
      await page.waitForFunction(() => document.querySelectorAll('#module-logs .activity-log-read').length === 12);
      const geometry = await page.locator('#module-logs .activity-logs-scroll').evaluate(el => {
        const box = el.getBoundingClientRect();
        const rows = [...el.querySelectorAll('tbody tr')].map(row => row.getBoundingClientRect());
        return { height: el.clientHeight, scrollHeight: el.scrollHeight,
          visible: rows.filter(row => row.top >= box.top && row.bottom <= box.bottom + 0.1).length,
          nextTop: rows[6].top - box.top, rowHeights: rows.map(row => row.height),
          accent: getComputedStyle(el).scrollbarColor,
          overflow: el.parentElement.scrollWidth > el.parentElement.clientWidth };
      });
      assert.equal(geometry.height, 483);
      assert.equal(geometry.visible, 6, JSON.stringify(geometry));
      assert.equal(geometry.nextTop, 483);
      assert.ok(geometry.scrollHeight > geometry.height);
      assert.ok(geometry.accent.includes('rgb(2, 128, 144)'));
      assert.equal(geometry.overflow, width < 1120);
      await page.locator('#module-logs .activity-logs-scroll').evaluate(el => { el.scrollTop = 200; });
      assert.equal(await page.locator('#module-logs .activity-logs-scroll').evaluate(el => Math.round(el.querySelector('th').getBoundingClientRect().top - el.getBoundingClientRect().top)), 0);
      await page.locator('#module-logs .activity-logs-scroll').evaluate(el => { el.scrollTop = 0; });

      async function open(id) {
        await page.locator(`#module-logs [data-log-id="${id}"]`).click();
        await page.waitForFunction(() => document.activeElement.id === 'cancelActivityLogRead');
      }
      async function closed() {
        await modal.waitFor({ state: 'hidden' });
        await page.waitForFunction(() => !document.body.classList.contains('cc-log-read-modal-open'));
      }
      await open(3);
      assert.equal(writes.length, 0);
      assert.equal(await page.locator('.modal-backdrop').evaluate(el => getComputedStyle(el).opacity), '0.5');
      assert.equal(await page.locator('.modal-backdrop').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 0, 0)');
      assert.equal(await page.locator('#adminMainContent').evaluate(el => getComputedStyle(el).filter), 'blur(5px)');
      assert.equal(await modal.evaluate(el => getComputedStyle(el).filter), 'none');
      const box = await modal.locator('.modal-content').boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width);
      if (width === 1440) assert.equal(box.width, 520);
      assert.equal(await modal.locator('.modal-body').evaluate(el => getComputedStyle(el).padding), '32px');
      await cancel.click();
      await closed();
      assert.equal(await buttons.count(), 12);
      assert.equal(writes.length, 0);
      await open(4);
      await page.keyboard.press('Escape');
      await closed();
      assert.equal(writes.length, 0);

      await open(3);
      rejectWrite = true;
      await confirm.click();
      await page.waitForFunction(() => document.getElementById('confirmActivityLogRead').disabled);
      assert.equal(await buttons.count(), 12, 'Record retained while save is pending.');
      assert.equal(await cancel.isDisabled(), true);
      await page.keyboard.press('Escape');
      assert.equal(await modal.isVisible(), true);
      await page.waitForTimeout(50);
      releaseWrite();
      await page.locator('#activityLogReadError').waitFor({ state: 'visible' });
      assert.equal(await buttons.count(), 12, 'Failed save retains record.');
      rejectWrite = false;
      await confirm.click();
      await page.waitForTimeout(50);
      releaseWrite();
      await closed();
      assert.deepEqual(writes, [3, 3]);
      assert.equal(await buttons.count(), 11);
      assert.equal(await page.locator('[data-log-id="3"]').count(), 0);
      assert.equal(await page.locator('[data-log-id="4"]').count(), 1);
      await page.reload();
      await page.waitForFunction(() => document.querySelectorAll('#module-logs .activity-log-read').length === 11);
      assert.equal(await page.locator('[data-log-id="3"]').count(), 0);
      await page.locator('#logSearchInput').fill('no matching resource');
      await page.waitForFunction(() => document.getElementById('activityLogsTableBody').textContent.includes('No unread'));
      assert.equal(await page.locator('#activityLogsTableBody td').getAttribute('colspan'), '7');
      assert.equal(await page.locator('#module-logs .activity-logs-scroll').evaluate(el => el.clientHeight), 483);
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS ${width}px: six rows, scrolling, modal styling, cancel/Escape, failure/retry, individual removal, refresh and empty state.`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
