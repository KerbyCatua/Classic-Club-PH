// Run with CC_PLAYWRIGHT_PATH pointing to Playwright; CC_TEST_ASSETS_DIR can cache Bootstrap CSS.
const { chromium } = require(process.env.CC_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.CC_TEST_URL || 'http://localhost/classic-club-ph/';
const source = fs.readFileSync(path.join(__dirname, '../super-admin-dashboard.html'), 'utf8');
// Keep the actual page markup and styles, initializing only Monitoring to isolate these checks.
const html = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

function snapshot(range, service, empty = false) {
  const services = ['application', 'api', 'database', 'server'];
  const history = Array.from({ length: { '7d': 8, '24h': 25, '30d': 31 }[range] }, (_, index) => ({
    label: '14 Nov ' + String(index).padStart(2, '0') + ':00', checks: 120, failed: index % 3,
    p95_ms: service === 'all' || service === 'api' ? index + 10 : null,
    memory_mib: service === 'all' || service === 'server' ? 2 : null
  }));
  return {
    generated_at: '2026-11-14T09:30:00+08:00', last_sample: empty ? null : '2026-11-14 09:30:00',
    range, service, availability_percent: empty ? null : 99, check_count: empty ? 0 : 120,
    api_p95_ms: empty || !['all', 'api'].includes(service) ? null : 17,
    api_median_ms: empty || !['all', 'api'].includes(service) ? null : 12,
    failed_24h: empty ? 0 : 1, checks_24h: empty ? 0 : 120,
    maintenance: { active: false, manual_mode: false, server_time: '2026-11-14 09:30:00', window: { status: 'Inactive' } },
    services: empty ? [] : services.filter(value => service === 'all' || service === value).map(value => ({
      service: value, healthy: ['api', 'database'].includes(value) ? 0 : 1, status: ['api', 'database'].includes(value) ? 'Unavailable' : 'Available',
      checked_at: value === 'database' ? '2026-11-14 08:30:00' : '2026-11-14 09:30:00', latency_ms: 12, resource_value: value === 'server' ? 2 : null,
      resource_label: 'PHP request peak memory (MiB)', context: 'Measured context with <literal markup>. '.repeat(20)
    })),
    history: empty ? [] : history,
    incidents: empty ? [] : Array.from({ length: 15 }, (_, index) => ({
      service: service === 'all' ? 'api' : service, status: 'Unavailable', checked_at: '2026-11-14 09:30:00',
      context: index === 0 ? 'Long failure detail. '.repeat(30) : 'Failed check ' + index
    })),
    events: empty ? [] : Array.from({ length: 15 }, (_, index) => ({
      action: index === 0 ? 'maintenance.failure.' + 'long-action-'.repeat(30) : 'maintenance.updated.' + index,
      created_at: '2026-11-14 09:30:00'
    }))
  };
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 768, 375, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      const requests = [];
      let failure = width === 320;
      let empty = false;
      let holdNext = false;
      let release;
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {
        if (message.type() === 'error' && !message.location().url.includes('/monitoring.php')) errors.push(message.text());
      });
      await page.route(/^https:\/\//, route => {
        if (path.basename(new URL(route.request().url()).pathname) === 'bootstrap.min.css') {
          return process.env.CC_TEST_ASSETS_DIR
            ? route.fulfill({ path: path.join(process.env.CC_TEST_ASSETS_DIR, 'bootstrap.min.css') }) : route.continue();
        }
        return route.fulfill({ contentType: 'text/css', body: '' });
      });
      await page.route('**/super-admin-dashboard.html', route => route.fulfill({ contentType: 'text/html', body: html }));
      await page.route('**/public/api/super-admin/monitoring.php?*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        requests.push({ method: request.method(), range: url.searchParams.get('range'), service: url.searchParams.get('service') });
        if (request.method() === 'POST') assert.equal(request.headers()['x-csrf-token'], 'monitoring-test-token');
        const fail = failure;
        const data = snapshot(url.searchParams.get('range'), url.searchParams.get('service'), empty);
        if (holdNext) {
          holdNext = false;
          await new Promise(resolve => { release = resolve; });
        }
        return route.fulfill(fail
          ? { status: 503, json: { success: false, error: { message: 'Test monitoring unavailable.' } } }
          : { json: { success: true, data } });
      });
      await page.goto(base + 'super-admin-dashboard.html#module-monitoring');
      await page.evaluate(() => {
        document.getElementById('adminMainContent').hidden = false;
        document.getElementById('adminLoadingOverlay').remove();
        document.documentElement.style.scrollBehavior = 'auto';
      });
      await page.clock.install();
      await page.addScriptTag({ url: base + 'assets/js/monitoring.js' });
      const initialize = () => page.evaluate(() => window.initLiveMonitoring({
        byId: id => document.getElementById(id), getCsrfToken: async () => 'monitoring-test-token',
        escapeHtml: value => { const el = document.createElement('span'); el.textContent = value; return el.innerHTML; }
      }));
      async function settled() {
        await page.waitForFunction(() => document.getElementById('module-monitoring').getAttribute('aria-busy') === 'false');
      }
      await initialize();
      await settled();
      if (failure) {
        assert.match(await page.locator('#monitorSnapshot').innerText(), /could not be loaded/);
        assert.match(await page.locator('#monitorStatus').innerText(), /Test monitoring unavailable/);
        assert.match(await page.locator('#monitorServices').innerText(), /No health checks loaded/);
        assert.match(await page.locator('#monitorFailureHistory').innerText(), /No history loaded/);
        assert.equal(await page.locator('#btnRefreshMonitoring').isDisabled(), false);
        assert.equal(await page.locator('#btnExportMonitoring').isDisabled(), true);
        failure = false;
        await page.click('#btnRefreshMonitoring');
        await settled();
      }
      assert.deepEqual(requests[0], { method: 'POST', range: '7d', service: 'all' });
      assert.match(await page.locator('#monitorStatus').innerText(), /^Updated /);
      assert.equal(await page.locator('#module-monitoring select').count(), 2);
      assert.equal(await page.locator('#module-monitoring button').count(), 2);
      assert.equal(await page.locator('#monitorServices tr').count(), 4);
      assert.equal(await page.locator('#monitorServices .sa-badge-danger').count(), 1);
      assert.equal(await page.locator('#monitorServices .sa-badge-warning').count(), 1);
      assert.equal(await page.locator('#monitorServices .sa-badge-success').count(), 2);
      assert.equal(await page.locator('#monitorServices td script, #monitorServices td literal').count(), 0);

      const geometry = await page.locator('#module-monitoring').evaluate(section => {
        const tables = [...section.querySelectorAll('.monitor-table-viewport')].map(viewport => {
          const box = viewport.getBoundingClientRect();
          const rows = [...viewport.querySelectorAll('tbody tr')];
          return {
            height: viewport.clientHeight, scrollHeight: viewport.scrollHeight,
            visible: rows.filter(row => row.getBoundingClientRect().bottom <= box.top + viewport.clientHeight + .1).length,
            rowHeights: rows.map(row => row.getBoundingClientRect().height),
            accent: getComputedStyle(viewport).scrollbarColor
          };
        });
        const lists = [...section.querySelectorAll('.monitor-list-viewport')].map(viewport => ({
          visible: [...viewport.children].filter(row => row.getBoundingClientRect().bottom <= viewport.getBoundingClientRect().bottom + .1).length,
          height: viewport.clientHeight, scrollHeight: viewport.scrollHeight
        }));
        return { width: innerWidth, height: section.offsetHeight, overflow: section.scrollWidth > section.clientWidth, tables, lists };
      });
      assert.equal(geometry.overflow, false, JSON.stringify(geometry));
      for (const table of geometry.tables) {
        assert.equal(table.height, 301);
        assert.equal(table.visible, 4, JSON.stringify(geometry));
        assert.ok(table.rowHeights.every(height => height === 64));
        assert.ok(table.accent.includes('rgb(2, 128, 144)'));
      }
      for (const list of geometry.lists) {
        assert.equal(list.height, 301);
        assert.equal(list.visible, 4);
        assert.ok(list.scrollHeight > list.height);
      }
      const failureViewport = page.locator('.monitor-failures-viewport');
      await failureViewport.evaluate(el => { el.scrollTop = el.scrollHeight; });
      assert.ok(await failureViewport.evaluate(el => Math.abs(el.querySelector('th').getBoundingClientRect().top - el.getBoundingClientRect().top) < .1));
      assert.ok(await failureViewport.evaluate(el => el.querySelector('tbody tr:last-child').getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom + .1));
      await failureViewport.evaluate(el => { el.scrollTop = 0; });
      for (const id of ['monitorIncidents', 'monitorEvents']) {
        assert.ok(await page.locator('#' + id).evaluate(el => {
          el.scrollTop = el.scrollHeight;
          return el.lastElementChild.getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom + .1;
        }));
      }
      assert.ok(await page.locator('#monitorServices .monitor-cell-value').last().evaluate(el => el.scrollHeight > el.clientHeight));
      assert.ok(await page.locator('.monitor-services-viewport').evaluate(el => {
        const container = el.parentElement;
        container.scrollLeft = container.scrollWidth;
        return el.querySelector('th:last-child').getBoundingClientRect().right <= container.getBoundingClientRect().right + .1;
      }), 'The last service column remains reachable on narrow screens.');
      await page.locator('.monitor-services-viewport').evaluate(el => { el.parentElement.scrollLeft = 0; });

      for (const range of ['24h', '30d', '7d']) {
        await page.selectOption('#monitorRange', range);
        await settled();
        assert.equal(requests.at(-1).range, range);
        assert.equal(requests.at(-1).method, 'GET');
        assert.equal(await page.locator('#monitorFailureHistory tr').count(), { '24h': 25, '30d': 31, '7d': 8 }[range]);
      }
      for (const service of ['application', 'api', 'database', 'server', 'all']) {
        await page.selectOption('#monitorService', service);
        await settled();
        assert.equal(requests.at(-1).service, service);
        assert.equal(await page.locator('#monitorServices tr').count(), service === 'all' ? 4 : 1);
        if (!['all', 'api'].includes(service)) assert.match(await page.locator('#monitorApiChart').innerText(), /No measured samples/);
        if (!['all', 'server'].includes(service)) assert.match(await page.locator('#monitorResourceChart').innerText(), /No measured samples/);
      }
      await page.selectOption('#monitorRange', '30d');
      await settled();
      const downloadPromise = page.waitForEvent('download');
      await page.click('#btnExportMonitoring');
      const download = await downloadPromise;
      assert.equal(download.suggestedFilename(), 'monitoring-30d-all.csv');
      const csv = fs.readFileSync(await download.path(), 'utf8');
      assert.equal(csv.split('\r\n').length, 32, 'Export contains all history, including scrolled records.');

      holdNext = true;
      await page.selectOption('#monitorRange', '24h');
      await page.waitForFunction(() => document.getElementById('module-monitoring').getAttribute('aria-busy') === 'true');
      assert.equal(await page.locator('#btnExportMonitoring').isDisabled(), true);
      assert.equal(await page.locator('#btnRefreshMonitoring').isDisabled(), true);
      await page.selectOption('#monitorRange', '7d');
      await page.selectOption('#monitorService', 'database');
      assert.equal(requests.at(-1).range, '24h');
      assert.equal(await page.locator('#monitorFailureHistory tr').count(), 31);
      release();
      await settled();
      assert.deepEqual(requests.at(-1), { method: 'GET', range: '7d', service: 'database' });
      assert.equal(await page.locator('#monitorFailureHistory tr').count(), 8);
      assert.equal(await page.locator('#btnExportMonitoring').isDisabled(), false);

      failure = true;
      await page.click('#btnRefreshMonitoring');
      await settled();
      assert.match(await page.locator('#monitorStatus').innerText(), /Displayed data is stale.*Test monitoring unavailable/);
      assert.equal(await page.locator('#monitorFailureHistory tr').count(), 8);
      assert.equal(await page.locator('#btnExportMonitoring').isDisabled(), true);
      failure = false;
      await page.click('#btnRefreshMonitoring');
      await settled();
      assert.equal(requests.at(-1).method, 'POST');
      assert.equal(await page.locator('#monitorStatus').evaluate(el => el.classList.contains('text-warning')), false);

      let requestCount = requests.length;
      await page.clock.fastForward(60000);
      await page.waitForFunction(() => document.getElementById('module-monitoring').getAttribute('aria-busy') === 'false');
      assert.equal(requests.length, requestCount + 1, 'Visible dashboard collects checks every minute.');
      assert.equal(requests.at(-1).method, 'POST');
      await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, value: true }));
      requestCount = requests.length;
      await page.clock.fastForward(60000);
      assert.equal(requests.length, requestCount, 'Background dashboard does not collect checks.');
      await page.evaluate(() => {
        delete document.hidden;
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await settled();
      assert.equal(requests.length, requestCount + 1, 'Returning to the dashboard refreshes checks.');

      empty = true;
      await page.click('#btnRefreshMonitoring');
      await settled();
      assert.match(await page.locator('#monitorServices').innerText(), /No stored checks/);
      assert.match(await page.locator('#monitorFailureHistory').innerText(), /No history/);
      assert.match(await page.locator('#monitorIncidents').innerText(), /No failed checks/);
      assert.match(await page.locator('#monitorEvents').innerText(), /No maintenance/);
      assert.match(await page.locator('#monitorAvailability').innerText(), /No samples/);
      assert.equal(await page.locator('#monitorApiChart .sa-chart-bar').count(), 0);
      if (process.env.CC_TEST_SCREENSHOTS_DIR) {
        empty = false;
        await page.selectOption('#monitorService', 'all');
        await settled();
        for (const id of ['monitorIncidents', 'monitorEvents']) await page.locator('#' + id).evaluate(el => { el.scrollTop = 0; });
        await page.locator('#module-monitoring').screenshot({ path: path.join(process.env.CC_TEST_SCREENSHOTS_DIR, `monitoring-${width}.png`) });
      }
      assert.deepEqual(errors, [], 'No unexpected console or JavaScript errors.');
      console.log(`PASS ${width}px: four rows, scrolling, long records, filters, refresh, full CSV, request races, failure recovery and empty states; module height ${geometry.height}px.`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
