// Local XAMPP integration test. Uses an existing Super Admin and removes its temporary session.
// Run with CC_PLAYWRIGHT_PATH pointing to Playwright; CC_TEST_ASSETS_DIR may cache Bootstrap.
const { chromium } = require(process.env.CC_PLAYWRIGHT_PATH || 'playwright');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const base = (process.env.CC_TEST_URL || 'http://localhost/classic-club-ph/').replace(/\/?$/, '/');
const php = process.env.CC_PHP_PATH || 'C:/xampp/php/php.exe';
const phpRoot = root.replace(/\\/g, '/').replace(/'/g, "\\'");
const bootstrap = `require '${phpRoot}/app/Database/Connection.php'; require '${phpRoot}/app/Auth/SessionManager.php';`;
const runPhp = source => execFileSync(php, ['-r', bootstrap + source], { encoding: 'utf8' });
const session = JSON.parse(runPhp(`
  $id = $pdo->query("SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.name='super_admin' AND u.status='active' AND u.deleted_at IS NULL LIMIT 1")->fetchColumn();
  if (!$id) throw new RuntimeException('No active Super Admin for this local test.');
  \\ClassicClub\\Auth\\SessionManager::login((int)$id);
  echo json_encode(['id'=>session_id(), 'name'=>session_name(), 'csrf'=>$_SESSION['csrf_token']]);
  session_write_close();
`));

(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addCookies([{ name: session.name, value: session.id, url: base }]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    if (process.env.CC_TEST_ASSETS_DIR) await page.route(/^https:\/\//, route => {
      const filename = path.basename(new URL(route.request().url()).pathname);
      if (['bootstrap.min.css', 'bootstrap.bundle.min.js'].includes(filename)) return route.fulfill({ path: path.join(process.env.CC_TEST_ASSETS_DIR, filename) });
      return route.fulfill({ contentType: 'text/css', body: '' });
    });
    const monitoringResponse = () => page.waitForResponse(response => response.url().includes('/super-admin/monitoring.php'));
    const settled = () => page.waitForFunction(() => document.querySelector('#module-monitoring').getAttribute('aria-busy') === 'false');
    const first = monitoringResponse();
    const documentResponse = await page.goto(base + 'super-admin-dashboard.html#module-monitoring', { waitUntil: 'networkidle' });
    assert.equal(documentResponse.status(), 200);
    const firstResponse = await first;
    assert.equal(firstResponse.status(), 200);
    const initial = (await firstResponse.json()).data;
    await settled();
    assert.match(await page.locator('#monitorStatus').innerText(), /^Updated /);
    assert.equal(initial.services.length, 4);
    assert.equal(await page.locator('#monitorServices tr').count(), 4);
    assert.ok(initial.services.every(sample => new Date(initial.generated_at) - new Date(sample.checked_at.replace(' ', 'T') + '+08:00') < 180000));

    // Verify server aggregates independently against the same persisted rows and timestamp boundaries.
    const rows = JSON.parse(runPhp(`
      $end = new DateTimeImmutable('${initial.generated_at}');
      $q = $pdo->prepare('SELECT * FROM monitoring_samples WHERE checked_at >= ? AND checked_at <= ? ORDER BY checked_at, id');
      $q->execute([$end->modify('-7 days')->format('Y-m-d H:i:s'), $end->format('Y-m-d H:i:s')]);
      echo json_encode($q->fetchAll());
    `));
    const observed = rows.filter(row => ['application', 'api', 'database'].includes(row.service));
    const healthy = observed.filter(row => Number(row.healthy) === 1).length;
    assert.equal(initial.check_count, observed.length);
    assert.equal(initial.availability_percent, Math.round(healthy / observed.length * 10000) / 100);
    assert.equal(initial.history.reduce((sum, row) => sum + row.checks, 0), observed.length);
    const api = rows.filter(row => row.service === 'api').map(row => Number(row.latency_ms)).sort((a, b) => a - b);
    const middle = Math.floor(api.length / 2);
    const median = api.length % 2 ? api[middle] : (api[middle - 1] + api[middle]) / 2;
    assert.ok(Math.abs(initial.api_median_ms - median) <= .00051);
    assert.equal(initial.api_p95_ms, api[Math.ceil(api.length * .95) - 1]);
    const cutoff = new Date(initial.generated_at).getTime() - 86400000;
    const recent = observed.filter(row => Date.parse(row.checked_at.replace(' ', 'T') + '+08:00') >= cutoff);
    assert.equal(initial.checks_24h, recent.length);
    assert.equal(initial.failed_24h, recent.filter(row => Number(row.healthy) === 0).length);
    for (const bucket of initial.history) {
      const start = Date.parse(bucket.period);
      const memory = rows.filter(row => row.service === 'server' && row.resource_value !== null &&
        Date.parse(row.checked_at.replace(' ', 'T') + '+08:00') >= start && Date.parse(row.checked_at.replace(' ', 'T') + '+08:00') < start + 86400000
      ).map(row => Number(row.resource_value));
      assert.equal(bucket.memory_mib, memory.length ? Math.round(memory.reduce((sum, value) => sum + value, 0) / memory.length * 100) / 100 : null);
    }
    console.log('PASS live: authenticated role gate, real probes, availability, p95, median, last-24-hour failures and memory history match stored data.');

    const original = execFileSync('git', ['show', 'HEAD:super-admin-dashboard.html'], { cwd: root, encoding: 'utf8' }).replace(/\r\n/g, '\n');
    const updated = fs.readFileSync(path.join(root, 'super-admin-dashboard.html'), 'utf8').replace(/\r\n/g, '\n');
    const outside = content => content.replace(/<section id="module-monitoring"[\s\S]*?<\/section>/, '').replace(/    \/\* Monitoring only[\s\S]*?(?=    \.sa-ticket-subject)/, '');
    assert.equal(outside(original), outside(updated), 'Markup, scripts and styles outside Monitoring are unchanged.');
    for (const width of [1440, 768, 375, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(50);
      assert.equal(await page.locator('#module-monitoring').evaluate(section => section.scrollWidth > section.clientWidth), false);
      assert.equal(await page.locator('#monitorApiChart').evaluate(chart => chart.scrollWidth > chart.clientWidth), false);
      if (process.env.CC_TEST_SCREENSHOTS_DIR) await page.locator('#module-monitoring').screenshot({ path: path.join(process.env.CC_TEST_SCREENSHOTS_DIR, `monitoring-live-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const range of ['24h', '30d', '7d']) {
      const pending = monitoringResponse();
      await page.selectOption('#monitorRange', range);
      const response = await pending;
      assert.equal(response.status(), 200);
      const data = (await response.json()).data;
      await settled();
      assert.equal(data.range, range);
      assert.equal(data.history.length, { '24h': 25, '30d': 31, '7d': 8 }[range]);
    }
    for (const service of ['application', 'api', 'database', 'server', 'all']) {
      const pending = monitoringResponse();
      await page.selectOption('#monitorService', service);
      const response = await pending;
      assert.equal(response.status(), 200);
      const data = (await response.json()).data;
      await settled();
      assert.equal(data.service, service);
      assert.equal(await page.locator('#monitorServices tr').count(), service === 'all' ? 4 : 1);
      assert.ok(data.services.every(row => service === 'all' || row.service === service));
    }
    const refresh = monitoringResponse();
    await page.click('#btnRefreshMonitoring');
    const refreshed = await refresh;
    assert.equal(refreshed.request().method(), 'POST');
    assert.equal(refreshed.status(), 200);
    await settled();
    const downloading = page.waitForEvent('download');
    await page.click('#btnExportMonitoring');
    const download = await downloading;
    assert.equal(download.suggestedFilename(), 'monitoring-7d-all.csv');
    const csv = fs.readFileSync(await download.path(), 'utf8');
    assert.equal(csv.split('\r\n').length, 9);
    assert.match(csv, /\d{4}-\d{2}-\d{2}T00:00:00\+08:00/);
    assert.deepEqual(errors, []);
    console.log('PASS live: all filters, CSRF-backed refresh, complete CSV, desktop/mobile layouts and zero browser errors.');
    console.log('PASS scope: other modules, shared scripts and global styles are unchanged.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  runPhp(`session_id('${session.id}'); \\ClassicClub\\Auth\\SessionManager::logout();`);
});
