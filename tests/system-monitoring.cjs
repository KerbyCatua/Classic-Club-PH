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
    period: new Date(Date.UTC(2026, 10, index + 1)).toISOString(),
    label: range === '24h' ? '14 Nov ' + String(index % 24).padStart(2, '0') + ':00' : String(index + 1).padStart(2, '0') + ' Nov',
    checks: service === 'server' || index === 0 ? 0 : 120, failed: service === 'server' || index === 0 ? 0 : index % 3,
    p95_ms: index !== 0 && (service === 'all' || service === 'api') ? index + 10 : null,
    memory_mib: index !== 0 && (service === 'all' || service === 'server') ? 2 : null
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
      let malformed = false;
      let incomplete = false;
      let maintenance = null;
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
        if (maintenance) data.maintenance = maintenance;
        if (malformed) return route.fulfill({ contentType: 'text/html', body: '<h1>Unavailable</h1>' });
        if (incomplete) delete data.history;
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
        assert.match(await page.locator('#monitorFailureHistory').textContent(), /No history loaded/);
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

      async function layout() {
        const geometry = await page.locator('#module-monitoring').evaluate(section => ({
          width: innerWidth, height: section.offsetHeight, overflow: section.scrollWidth > section.clientWidth,
          charts: [...section.querySelectorAll('.monitor-chart')].map(chart => ({
            overflow: chart.scrollWidth > chart.clientWidth,
            labels: [...chart.querySelectorAll('.sa-chart-labels > div')].filter(label => label.textContent).length
          }))
        }));
        assert.equal(geometry.overflow, false, JSON.stringify(geometry));
        for (const chart of geometry.charts) {
          assert.equal(chart.overflow, false, 'The whole range fits without chart scrolling: ' + JSON.stringify(geometry));
          assert.ok(chart.labels <= 6);
        }
      }
      await layout();
      await page.locator('#monitorServices details summary').first().click();
      assert.match(await page.locator('#monitorServices details').first().innerText(), /<literal markup>/);
      assert.equal(await page.locator('#monitorServices details[open]').count(), 1);
      await page.clock.fastForward(15000);
      assert.equal(await page.locator('#monitorServices details[open]').count(), 1, 'Freshness updates preserve expanded details.');
      await page.locator('#monitorServices details summary').first().click();
      await page.locator('#monitorFailuresTitle').click();
      await page.locator('#monitorEventsTitle').click();
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
      assert.ok(await page.locator('.monitor-services-viewport').evaluate(el => {
        el.scrollLeft = el.scrollWidth;
        return el.querySelector('th:last-child').getBoundingClientRect().right <= el.getBoundingClientRect().right + .1;
      }), 'The last service column remains reachable on narrow screens.');
      await page.locator('.monitor-services-viewport').evaluate(el => { el.scrollLeft = 0; });
      await page.locator('#monitorFailuresTitle').click();
      await page.locator('#monitorEventsTitle').click();

      const point = page.locator('#monitorApiChart .monitor-chart-point').nth(1);
      await point.focus();
      assert.match(await point.getAttribute('aria-label'), /11 ms/);
      assert.equal(await point.locator('.monitor-chart-tooltip').isVisible(), true);
      assert.equal(await page.locator('#monitorApiChart .monitor-chart-gap').count(), 1, 'Missing samples remain gaps.');

      for (const range of ['24h', '30d', '7d']) {
        await page.selectOption('#monitorRange', range);
        await settled();
        assert.equal(requests.at(-1).range, range);
        assert.equal(requests.at(-1).method, 'GET');
        assert.equal(await page.locator('#monitorFailureHistory tr').count(), { '24h': 25, '30d': 31, '7d': 8 }[range]);
        await layout();
      }
      for (const service of ['application', 'api', 'database', 'server', 'all']) {
        await page.selectOption('#monitorService', service);
        await settled();
        assert.equal(requests.at(-1).service, service);
        assert.equal(await page.locator('#monitorServices tr').count(), service === 'all' ? 4 : 1);
        assert.equal(await page.locator('#monitorApiPanel').isVisible(), ['all', 'api'].includes(service));
        assert.equal(await page.locator('#monitorResourcePanel').isVisible(), ['all', 'server'].includes(service));
        assert.equal(await page.locator('#monitorAvailabilityCard').isVisible(), service !== 'server');
        assert.equal(await page.locator('#monitorLatencyCard').isVisible(), ['all', 'api'].includes(service));
      }
      await page.selectOption('#monitorRange', '30d');
      await settled();
      const downloadPromise = page.waitForEvent('download');
      await page.click('#btnExportMonitoring');
      const download = await downloadPromise;
      assert.equal(download.suggestedFilename(), 'monitoring-30d-all.csv');
      const csv = fs.readFileSync(await download.path(), 'utf8');
      assert.equal(csv.split('\r\n').length, 32, 'Export contains all history, including scrolled records.');
      assert.match(csv, /2026-11-01T00:00:00.000Z/, 'Export includes unambiguous period dates.');

      holdNext = true;
      await page.selectOption('#monitorRange', '24h');
      await page.waitForFunction(() => document.getElementById('module-monitoring').getAttribute('aria-busy') === 'true');
      assert.equal(await page.locator('#btnExportMonitoring').isDisabled(), true);
      assert.equal(await page.locator('#btnRefreshMonitoring').isDisabled(), true);
      await page.selectOption('#monitorRange', '7d');
      await page.selectOption('#monitorService', 'database');
      assert.equal(requests.at(-1).range, '24h');
      assert.match(await page.locator('#monitorFailureHistory').textContent(), /No history loaded/, 'Old filters never remain on screen.');
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

      failure = true;
      await page.selectOption('#monitorService', 'api');
      await settled();
      assert.equal(await page.locator('#monitorAvailability').innerText(), '—', 'A failed new filter clears previous metrics.');
      assert.match(await page.locator('#monitorServices').innerText(), /No health checks loaded/);
      failure = false;
      malformed = true;
      await page.click('#btnRefreshMonitoring');
      await settled();
      assert.match(await page.locator('#monitorStatus').innerText(), /invalid response/);
      malformed = false;
      incomplete = true;
      await page.click('#btnRefreshMonitoring');
      await settled();
      assert.match(await page.locator('#monitorStatus').innerText(), /incomplete data/);
      incomplete = false;
      await page.click('#btnRefreshMonitoring');
      await settled();

      holdNext = true;
      await page.click('#btnRefreshMonitoring');
      await page.waitForTimeout(30);
      await page.clock.fastForward(21000);
      await settled();
      assert.match(await page.locator('#monitorStatus').innerText(), /timed out/);
      assert.equal(await page.locator('#btnRefreshMonitoring').isDisabled(), false);
      release();
      await page.click('#btnRefreshMonitoring');
      await settled();

      for (const state of [
        { active: true, manual_mode: true, window: { status: 'Inactive' } },
        { active: true, manual_mode: false, window: { status: 'Scheduled' } },
        { active: false, manual_mode: false, server_time: '2026-11-14 09:30:00', window: { status: 'Scheduled', start_at: '2026-11-15 10:00:00' } }
      ]) {
        maintenance = state;
        await page.click('#btnRefreshMonitoring');
        await settled();
        assert.equal(await page.locator('#monitorMaintenanceValue').innerText(), state.active ? 'Active' : 'Off');
        assert.match(await page.locator('#monitorMaintenanceSub').innerText(), state.active ? state.manual_mode ? /Manual/ : /Scheduled/ : /Next:/);
      }
      maintenance = null;

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

      requestCount = requests.length;
      await initialize();
      assert.equal(requests.length, requestCount, 'Repeated initialization does not duplicate polling.');
      failure = true;
      await page.clock.fastForward(181000);
      await settled();
      assert.equal(await page.locator('#monitorServices .sa-badge-warning').count(), 1, 'Previously fresh checks become stale during an outage.');
      failure = false;

      empty = true;
      await page.click('#btnRefreshMonitoring');
      await settled();
      assert.match(await page.locator('#monitorServices').innerText(), /No samples/i);
      assert.match(await page.locator('#monitorFailureHistory').textContent(), /No measured checks/);
      assert.match(await page.locator('#monitorIncidents').innerText(), /No failed checks/);
      assert.match(await page.locator('#monitorEvents').textContent(), /No maintenance/);
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
      console.log(`PASS ${width}px: responsive charts, details, filters, refresh, CSV, request races, errors, timeout recovery, freshness, maintenance and empty states.`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
