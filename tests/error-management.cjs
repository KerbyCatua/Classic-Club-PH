// Run via error-management.php; CC_PLAYWRIGHT_PATH may point to an existing Playwright installation.
const { chromium } = require(process.env.CC_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixture = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const base = fixture.base.replace(/\/?$/, '/');

(async () => {
  const browser = await chromium.launch();
  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const [name, value] = fixture.cookie.split('=');
    await context.addCookies([{ name, value, url: base, httpOnly: true, sameSite: 'Lax' }]);
    page = await context.newPage();
    const errors = [], writes = [], requests = [];
    let fault = null, hold = null, release;
    page.on('pageerror', error => errors.push(error.message));
    if (process.env.CC_TEST_ASSETS_DIR) await page.route(/^https:\/\//, route => {
      const filename = path.basename(new URL(route.request().url()).pathname);
      if (['bootstrap.min.css', 'bootstrap.bundle.min.js'].includes(filename)) return route.fulfill({ path: path.join(process.env.CC_TEST_ASSETS_DIR, filename) });
      return route.fulfill({ contentType: 'text/css', body: '' });
    });
    await page.route('**/public/api/super-admin/errors.php*', async route => {
      const request = route.request(), url = new URL(request.url());
      const kind = request.method() === 'POST' ? 'save' : url.searchParams.has('id') ? 'detail' : 'list';
      requests.push({ kind, params: Object.fromEntries(url.searchParams) });
      if (kind === 'save') writes.push(request.postDataJSON());
      if (hold === kind) {
        hold = null;
        const response = await route.fetch();
        await new Promise(resolve => { release = resolve; });
        return route.fulfill({ response });
      }
      if (fault?.kind === kind) {
        const current = fault; fault = null;
        if (current.transform) {
          const response = await route.fetch();
          const json = await response.json();
          current.transform(json.data);
          return route.fulfill({ json });
        }
        return route.fulfill({ status: current.status || 503, json: { success: false, error: { message: current.message || 'Test request failed.' } } });
      }
      return route.continue();
    });
    const settled = () => page.waitForFunction(() => document.getElementById('errorGroupsViewport').getAttribute('aria-busy') === 'false');
    const detailSettled = () => page.waitForFunction(() => document.getElementById('errorDetailPanel').getAttribute('aria-busy') === 'false');
    const responseFor = kind => page.waitForResponse(response => {
      if (!response.url().includes('/super-admin/errors.php')) return false;
      return kind === 'save' ? response.request().method() === 'POST' : response.request().method() === 'GET' && new URL(response.url()).searchParams.has('id') === (kind === 'detail');
    });
    async function act(kind, action) {
      const response = responseFor(kind);
      await action(); await response;
      await (kind === 'list' ? settled() : detailSettled());
    }
    const search = value => act('list', () => page.locator('#errorSearchInput').fill(value));
    const filter = (id, value) => act('list', () => page.locator('#' + id).selectOption(value));
    const openMain = () => act('detail', () => page.locator(`[data-error-id="${fixture.id}"]`).click());
    const save = () => act('save', () => page.locator('#errorTriageForm [type=submit]').click());
    async function checkViewport(id) {
      const locator = page.locator('#' + id);
      await locator.evaluate(el => { el.scrollTop = 0; });
      const geometry = await locator.evaluate(el => {
        const bounds = el.getBoundingClientRect(), header = el.querySelector('thead').getBoundingClientRect();
        const rows = [...el.querySelectorAll('tbody tr')].map(row => row.getBoundingClientRect());
        return { height: bounds.height, header: header.height, rows: rows.map(row => row.height),
          visible: rows.filter(row => row.top >= header.bottom - 0.5 && row.bottom <= bounds.top + el.clientHeight + 0.5).length,
          partial: rows.filter(row => row.top < bounds.top + el.clientHeight - 0.5 && row.bottom > bounds.top + el.clientHeight + 0.5).length,
          horizontal: el.scrollWidth > el.clientWidth,
          accent: getComputedStyle(el).getPropertyValue('--cc-accent').trim(), scrollbar: getComputedStyle(el).scrollbarColor };
      });
      assert.equal(geometry.height, 364, JSON.stringify(geometry));
      assert.equal(geometry.header, 44, JSON.stringify(geometry));
      assert(geometry.rows.every(value => value === 64), JSON.stringify(geometry));
      assert.equal(geometry.visible, 5, JSON.stringify(geometry));
      assert.equal(geometry.partial, 0, JSON.stringify(geometry));
      assert.equal(geometry.horizontal, false, 'Horizontal scrolling belongs to the outer container');
      assert.equal(geometry.scrollbar.split(')')[0] + ')', await locator.evaluate(el => {
        const test = document.createElement('span'); test.style.color = 'var(--cc-accent)'; el.append(test);
        const color = getComputedStyle(test).color; test.remove(); return color;
      }), 'Scrollbar uses the global accent');
      const sticky = await locator.evaluate(el => {
        el.scrollTop = 128;
        return Math.abs(el.querySelector('thead').getBoundingClientRect().top - el.getBoundingClientRect().top) < 1;
      });
      assert(sticky, 'Header stays visible while scrolling');
      await locator.evaluate(el => { el.scrollTop = 0; });
    }

    await page.goto(base + 'super-admin-dashboard.html#module-errors');
    await settled();
    assert.equal(await page.locator('#module-errors #btnMarkResolved, #module-errors #btnReopenError').count(), 0);
    await search(fixture.unique);
    assert.match(await page.locator('#errorTableNote').innerText(), /28 errors · Page 1 of 2/);
    assert.equal(await page.locator('#errorGroupsTableBody tr').count(), 25);
    await checkViewport('errorGroupsViewport');
    await act('list', () => page.locator('#errorNext').click());
    assert.equal(await page.locator('#errorGroupsTableBody tr').count(), 3);
    await act('list', () => page.locator('#errorPrev').click());
    for (const severity of ['Critical', 'High', 'Medium', 'Low', 'Informational']) {
      await filter('errorSeverityFilter', severity);
      const values = await page.locator('#errorGroupsTableBody td:nth-child(3)').allTextContents();
      assert(values.length && values.every(value => value === severity));
    }
    await filter('errorSeverityFilter', '');
    for (const status of ['Resolved', 'Unresolved']) {
      await filter('errorStateFilter', status);
      assert((await page.locator('#errorGroupsTableBody td:nth-child(6)').allTextContents()).every(value => value === status));
    }
    await filter('errorStateFilter', '');
    for (const recurring of ['Single', 'Recurring']) {
      await filter('errorRecurringFilter', recurring);
      const counts = (await page.locator('#errorGroupsTableBody td:nth-child(2)').allTextContents()).map(Number);
      assert(counts.length && counts.every(value => recurring === 'Single' ? value === 1 : value > 1));
    }
    await filter('errorRecurringFilter', '');
    await filter('errorModuleFilter', 'Alternate ' + fixture.unique);
    assert.match(await page.locator('#errorTableNote').innerText(), /^1 error/);
    await filter('errorModuleFilter', '');
    await act('list', () => page.locator('#errorDateFilter').fill(fixture.today));
    assert.match(await page.locator('#errorTableNote').innerText(), /^28 errors/);
    await act('list', () => page.locator('#errorDateFilter').fill('2000-01-01'));
    assert.match(await page.locator('#errorGroupsTableBody').innerText(), /No errors found/);
    await act('list', () => page.locator('#errorReset').click());
    for (const id of ['errorSearchInput', 'errorDateFilter', 'errorModuleFilter', 'errorStateFilter', 'errorSeverityFilter', 'errorRecurringFilter']) assert.equal(await page.locator('#' + id).inputValue(), '');
    await search('Primary ' + fixture.unique);
    await openMain();
    assert.equal(await page.locator('#errorDetailCode').innerText(), 'ERR-' + fixture.id);
    assert.match(await page.locator('#errorDetailMeta').innerText(), /27 occurrences/);
    const requestId = await page.locator('#errorRequestsBody tr:first-child td:first-child').innerText();
    await search(requestId);
    assert.match(await page.locator('#errorTableNote').innerText(), /^1 error/);
    await search(`public/api/test/error-${fixture.unique}.php`);
    assert.match(await page.locator('#errorTableNote').innerText(), /^1 error/);
    await search('tests/error-management.php:23');
    assert.match(await page.locator('#errorTableNote').innerText(), /^[1-9]/, 'Source search finds recorded errors');
    await search('%');
    assert.match(await page.locator('#errorGroupsTableBody').innerText(), /No errors found/);
    await search('  Primary ' + fixture.unique + '  ');
    assert.match(await page.locator('#errorTableNote').innerText(), /^1 error/);
    assert.equal(await page.locator('#errorTriageForm [type=submit]').isDisabled(), true);
    await page.locator('#errorSourceDetails summary').click();
    assert.match(await page.locator('#errorDetailStack').innerText(), /tests\/error-management.php/);
    for (const width of [1440, 768, 375, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(await page.locator('#module-errors').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Module fits width ' + width);
      await checkViewport('errorEventsViewport');
      await search(fixture.unique); await checkViewport('errorGroupsViewport');
      await search('Primary ' + fixture.unique);
      if (width === 320) await page.locator('#module-errors').screenshot({ path: path.join(process.env.TEMP, 'cc-error-module-mobile.png') });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('#module-errors').screenshot({ path: path.join(process.env.TEMP, 'cc-error-module-desktop.png') });

    await page.locator('#errorNote').fill('Keep this draft');
    const originalEndpoint = await page.locator('#errorDetailEndpoint').innerText();
    await act('detail', () => page.locator('#errorEventNext').click());
    assert.equal(await page.locator('#errorRequestsBody tr').count(), 2);
    assert.equal(await page.locator('#errorNote').inputValue(), 'Keep this draft');
    assert.equal(await page.locator('#errorDetailEndpoint').innerText(), originalEndpoint, 'Paging does not replace latest-event context');
    await act('detail', () => page.locator('#errorEventPrev').click());
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('#errorDetailClose').click();
    assert.equal(await page.locator('#errorDetailPanel').isVisible(), true, 'Cancel preserves draft');
    page.once('dialog', dialog => dialog.accept());
    await act('detail', () => page.locator('#errorDetailReload').click());
    assert.equal(await page.locator('#errorNote').inputValue(), '');

    await page.locator('#errorSeverity').selectOption('Low');
    await page.locator('#errorState').selectOption('Resolved');
    await page.locator('#errorReviewer').selectOption(String(fixture.actor));
    const incident = await page.locator('#errorIncident option').evaluateAll(options => options.find(option => option.value)?.value);
    if (incident) await page.locator('#errorIncident').selectOption(incident);
    await page.locator('#errorReviewedCheck').check();
    await page.locator('#errorNote').fill('Browser triage <img src=x onerror=alert(1)>');
    await save();
    assert.match(await page.locator('#errorDetailMeta').innerText(), /Low · Resolved/);
    assert.equal(await page.locator('#errorNote').inputValue(), '');
    assert.match(await page.locator('#errorHistory').innerText(), /Browser triage <img/);
    assert.equal(await page.locator('#errorHistory img').count(), 0, 'Notes render as text');
    await page.reload(); await settled();
    await search('Primary ' + fixture.unique); await openMain();
    assert.equal(await page.locator('#errorState').inputValue(), 'Resolved');
    assert.equal(await page.locator('#errorReviewer').inputValue(), String(fixture.actor));
    assert.equal(await page.locator('#errorReviewedCheck').isChecked(), true);
    if (incident) assert.equal(await page.locator('#errorIncident').inputValue(), incident);
    await page.locator('#errorState').selectOption('Unresolved');
    await page.locator('#errorReviewer').selectOption('');
    await page.locator('#errorIncident').selectOption('');
    await page.locator('#errorReviewedCheck').uncheck();
    await save();
    assert.match(await page.locator('#errorDetailMeta').innerText(), /Unresolved/);

    fault = { kind: 'save', message: 'Test save failure.' };
    await page.locator('#errorNote').fill('Preserved after failure'); await save();
    assert.match(await page.locator('#errorDetailStatus').innerText(), /Test save failure/);
    assert.equal(await page.locator('#errorNote').inputValue(), 'Preserved after failure');
    fault = { kind: 'save', status: 403, message: 'Expired CSRF token.' };
    const beforeRetry = writes.length; await save();
    assert.equal(writes.length, beforeRetry + 2, 'Expired CSRF retries once');
    await page.locator('#errorNote').fill('😀'.repeat(1001));
    const beforeLongNote = writes.length;
    await page.locator('#errorTriageForm [type=submit]').click();
    assert.equal(writes.length, beforeLongNote);
    assert.match(await page.locator('#errorDetailStatus').innerText(), /too long/);
    await page.locator('#errorNote').fill('Conflict draft');
    fault = { kind: 'detail', transform: data => { data.group.version += 10; } };
    await act('detail', () => page.locator('#errorEventNext').click());
    const version = writes.at(-1).version + 1;
    fault = { kind: 'save', status: 409, message: 'This group changed. Reload its details before saving.' };
    await save();
    assert.equal(writes.at(-1).version, version, 'Occurrence paging preserves the version associated with the draft');
    assert.equal(await page.locator('#errorNote').inputValue(), 'Conflict draft');
    assert.equal(await page.locator('#errorTriageForm [type=submit]').isDisabled(), true);
    page.once('dialog', dialog => dialog.accept());
    await act('detail', () => page.locator('#errorDetailReload').click());

    fault = { kind: 'detail', message: 'Test detail failure.' };
    await act('detail', () => page.locator('#errorDetailReload').click());
    assert.match(await page.locator('#errorDetailStatus').innerText(), /Test detail failure/);
    assert.equal(await page.locator('#errorDetailPanel').isVisible(), true);
    await act('detail', () => page.locator('#errorDetailReload').click());
    fault = { kind: 'detail', message: 'Test occurrence failure.' };
    await act('detail', () => page.locator('#errorEventNext').click());
    assert.match(await page.locator('#errorDetailStatus').innerText(), /Test occurrence failure/);
    assert.match(await page.locator('#errorEventNote').innerText(), /Page 1 of 2/);
    await page.locator('#errorDetailClose').click();
    fault = { kind: 'detail', message: 'Visible first-open failure.' };
    await openMain();
    assert.equal(await page.locator('#errorDetailPanel').isVisible(), false);
    assert.match(await page.locator('#errorDetailStatus').innerText(), /Visible first-open failure/);
    await openMain();
    hold = 'detail';
    const pendingDetail = act('detail', () => page.locator('#errorEventNext').click());
    await page.waitForFunction(() => document.getElementById('errorDetailPanel').getAttribute('aria-busy') === 'true');
    await page.locator('#errorDetailClose').click();
    while (!release) await new Promise(resolve => setTimeout(resolve, 20));
    release(); release = null; await pendingDetail;
    assert.equal(await page.locator('#errorDetailPanel').isVisible(), false, 'Late detail response cannot reopen a closed panel');

    fault = { kind: 'list', message: 'Test list failure.' };
    await act('list', () => page.locator('#errorRefresh').click());
    assert.match(await page.locator('#errorSummary').innerText(), /Test list failure/);
    await act('list', () => page.locator('#errorRefresh').click());
    hold = 'list';
    const pendingList = responseFor('list');
    await page.locator('#errorSearchInput').fill('No match ' + fixture.unique);
    while (!release) await new Promise(resolve => setTimeout(resolve, 20));
    await search('Primary ' + fixture.unique);
    release(); release = null; await pendingList; await settled();
    assert.match(await page.locator('#errorGroupsTableBody').innerText(), /Primary/);
    assert.equal(await page.locator('#errorGroupsTableBody tr').count(), 1, 'Stale search response is ignored');

    fault = { kind: 'detail', transform: data => {
      data.group.reviewer_id = 999999999; data.group.incident_id = 999999999;
      data.group.summary = '<img src=x onerror=alert(1)>'.repeat(100);
      data.events.forEach(event => { event.endpoint = 'long/'.repeat(200); event.source = 'source'.repeat(200); });
      data.history = Array.from({ length: 30 }, () => ({ actor: 'Actor'.repeat(100), created_at: fixture.today, metadata: { note: '<b>'.repeat(1000) } }));
    } };
    await openMain();
    assert.equal(await page.locator('#errorReviewer').inputValue(), '999999999');
    assert.equal(await page.locator('#errorIncident').inputValue(), '999999999');
    assert.equal(await page.locator('#errorDetailSummary img').count(), 0);
    await page.setViewportSize({ width: 320, height: 1000 });
    assert(await page.locator('#module-errors').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Long records fit mobile');
    await checkViewport('errorEventsViewport');
    await page.locator('#errorDetailClose').click();
    await openMain();
    await page.locator('#errorNote').fill('Auto refresh keeps this draft');
    await search(fixture.unique);
    await page.locator('#errorGroupsViewport').scrollIntoViewIfNeeded();
    await page.locator('#errorGroupsViewport').evaluate(el => { el.scrollTop = 128; });
    await page.clock.install();
    await act('list', () => page.clock.runFor(30000));
    assert.equal(await page.locator('#errorGroupsViewport').evaluate(el => el.scrollTop), 128, 'Auto refresh preserves table position');
    assert.equal(await page.locator('#errorNote').inputValue(), 'Auto refresh keeps this draft');
    await page.evaluate(() => Object.defineProperty(document, 'hidden', { value: true, configurable: true }));
    const beforeHidden = requests.filter(request => request.kind === 'list').length;
    await page.clock.runFor(30000);
    assert.equal(requests.filter(request => request.kind === 'list').length, beforeHidden, 'Hidden pages do not poll');
    await page.evaluate(() => { delete document.hidden; });
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#errorDetailClose').click();
    await page.locator('#module-errors a[href="#module-directory"]').click();
    assert.equal(new URL(page.url()).hash, '#module-directory');
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('PASS: all filters, search, reset, refresh, group/occurrence pagination, details, source, notes, severity/status/reviewer/review/check persistence, escaping, CSRF retry, conflict recovery, failed requests, stale responses, draft protection, and exactly five rows with sticky headers/accent scrollbars at 1440/768/375/320px.');
    if (!incident) console.log('No recorded failed health check available; linking tested through unavailable-link preservation only.');
  } catch (error) {
    if (page) {
      console.error(await page.locator('#module-errors').evaluate(root => {
        const bounds = root.getBoundingClientRect();
        return [...root.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > bounds.right + 1 && !el.closest('.admin-table-container')).map(el => ({ tag: el.tagName, id: el.id, class: el.className, width: el.getBoundingClientRect().width }));
      }).catch(() => []));
      await page.locator('#module-errors').screenshot({ path: path.join(process.env.TEMP, 'cc-error-module-failure.png') }).catch(() => {});
    }
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
