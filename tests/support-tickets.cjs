// Run through support-tickets-http.php; use CC_PLAYWRIGHT_PATH for an external Playwright install.
const { chromium } = require(process.env.CC_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixture = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const base = fixture.base.replace(/\/?$/, '/');

(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const [name, value] = fixture.session.cookie.split('=');
    await context.addCookies([{ name, value, url: base }]);
    const page = await context.newPage();
    const errors = [], writes = [];
    let failList = false, failDetail = false, failWrite = false, holdDetail = false, releaseDetail, holdList = false, releaseList;
    let expireUploadToken = false;
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.url().includes('/admin/tickets.php') && request.method() === 'POST') writes.push(request.postData());
    });
    if (process.env.CC_TEST_ASSETS_DIR) await page.route(/^https:\/\//, route => {
      const filename = path.basename(new URL(route.request().url()).pathname);
      return ['bootstrap.min.css', 'bootstrap.bundle.min.js'].includes(filename)
        ? route.fulfill({ path: path.join(process.env.CC_TEST_ASSETS_DIR, filename) })
        : route.fulfill({ body: '', contentType: filename.endsWith('.js') ? 'text/javascript' : 'text/css' });
    });
    await page.route('**/public/api/admin/tickets.php*', async route => {
      const request = route.request(), detail = new URL(request.url()).searchParams.has('id');
      if (expireUploadToken && request.method() === 'POST' && request.headers()['content-type']?.startsWith('multipart/form-data')) {
        expireUploadToken = false;
        return route.fulfill({ status: 403, json: { success: false, error: { message: 'Invalid or expired CSRF token. Please retry.' } } });
      }
      if ((failList && !detail && request.method() === 'GET') || (failDetail && detail) || (failWrite && request.method() === 'POST')) {
        return route.fulfill({ status: 503, json: { success: false, error: { message: 'Temporary ticket failure. Retry.' } } });
      }
      if (holdDetail && detail) {
        holdDetail = false;
        await new Promise(resolve => { releaseDetail = resolve; });
      }
      if (holdList && !detail && request.method() === 'GET') {
        holdList = false;
        const response = await route.fetch();
        await new Promise(resolve => { releaseList = resolve; });
        return route.fulfill({ response });
      }
      return route.continue();
    });
    const field = (form, name) => page.locator('#' + form + ' [name="' + name + '"]');
    const action = name => page.locator('#module-tickets [data-action="' + name + '"]');
    const idle = () => page.waitForFunction(() => {
      const root = document.getElementById('module-tickets');
      return root && root.querySelector('[role="region"]').getAttribute('aria-busy') === 'false' && root.querySelector('#supportDetail').getAttribute('aria-busy') === 'false';
    });
    const post = async callback => {
      const pending = page.waitForResponse(response => response.url().endsWith('/tickets.php') && response.request().method() === 'POST');
      await callback();
      const response = await pending, result = await response.json();
      assert.equal(result.success, true, JSON.stringify(result));
      await idle();
      return result.data;
    };
    const filter = async (name, value) => {
      const control = field('supportFilters', name);
      const pending = page.waitForResponse(response => {
        const url = new URL(response.url());
        return url.pathname.endsWith('/tickets.php') && response.request().method() === 'GET' && url.searchParams.get(name) === value;
      });
      if (name === 'search') await control.fill(value); else await control.selectOption(value);
      await pending;
      await idle();
    };
    await page.goto(base + 'admin-dashboard.html#module-tickets');
    await page.locator('#supportRows [data-ticket]').first().waitFor(); await idle();
    assert.equal(await page.locator('#supportDetail').isVisible(), false);
    await filter('search', fixture.marker);
    assert.match(await page.locator('#supportPage').innerText(), /22 tickets · Page 1 of 2/);
    await action('next').click(); await idle();
    assert.equal(await page.locator('#supportRows [data-ticket]').count(), 2);
    assert.equal(await action('next').isDisabled(), true);
    await action('previous').click(); await idle();
    assert.equal(await action('previous').isDisabled(), true);
    await page.locator('[data-ticket="' + fixture.id + '"]').click(); await idle();
    assert.equal(await page.locator('#supportDetail script').count(), 0);
    assert.match(await page.locator('#supportDetail').innerText(), /Original request <script>literal markup<\/script>/);
    assert.equal(await field('supportEdit', 'resolution_summary').isVisible(), false);

    // Paging, drafts and independent saves must retain all other unsaved work.
    await field('supportEdit', 'subject').fill(fixture.marker + ' unsaved');
    await field('supportReply', 'body').fill('Unsent reply <img src=x onerror=alert(1)>');
    await page.locator('#supportNotes > summary').click();
    await field('supportNote', 'body').fill('Unsent private note');
    await action('older').click(); await idle();
    assert.equal(await field('supportEdit', 'subject').inputValue(), fixture.marker + ' unsaved');
    assert.match(await field('supportReply', 'body').inputValue(), /^Unsent reply/);
    assert.equal(await field('supportNote', 'body').inputValue(), 'Unsent private note');
    await action('newer').click(); await idle();
    await post(() => action('draft').click());
    assert.equal(await field('supportEdit', 'subject').inputValue(), fixture.marker + ' unsaved');
    assert.equal(await field('supportNote', 'body').inputValue(), 'Unsent private note');
    await field('supportEdit', 'status').selectOption('resolved');
    assert.equal(await field('supportEdit', 'resolution_summary').isVisible(), true);
    const beforeInvalid = writes.length;
    await page.locator('#supportEdit [type=submit]').click();
    assert.equal(writes.length, beforeInvalid);
    await field('supportEdit', 'resolution_summary').fill('Resolved with customer.');
    await field('supportEdit', 'priority').selectOption('High');
    await field('supportEdit', 'category').selectOption('Returns');
    await field('supportEdit', 'assigned_to').selectOption(String(fixture.actor));
    await post(() => page.locator('#supportEdit [type=submit]').click());
    assert.match(await field('supportReply', 'body').inputValue(), /^Unsent reply/);
    assert.equal(await field('supportNote', 'body').inputValue(), 'Unsent private note');
    assert.equal(await page.locator('#supportDetail img').count(), 0);
    assert.equal(await page.locator('#supportDetail .support-entry').filter({ hasText: '"status"' }).count(), 0);
    await post(() => page.locator('#supportNote [type=submit]').click());
    assert.equal(await field('supportNote', 'body').inputValue(), '');
    await post(() => page.locator('#supportReply [type=submit]').click());
    assert.equal(await field('supportReply', 'body').inputValue(), '');
    assert.equal(await page.locator('#supportDetail img').count(), 0);
    const noReply = writes.length;
    await page.locator('#supportReply [type=submit]').click();
    assert.equal(writes.length, noReply);
    await field('supportReply', 'body').fill('0');
    await post(() => action('draft').click());
    await action('reload').click(); await idle();
    assert.equal(await field('supportReply', 'body').inputValue(), '0');
    await field('supportReply', 'body').fill('Persisted draft');
    await post(() => action('draft').click());
    await action('reload').click(); await idle();
    assert.equal(await field('supportReply', 'body').inputValue(), 'Persisted draft');
    await field('supportEdit', 'status').selectOption('closed');
    await post(() => page.locator('#supportEdit [type=submit]').click());
    await field('supportEdit', 'status').selectOption('open');
    await field('supportEdit', 'assigned_to').selectOption('');
    await post(() => page.locator('#supportEdit [type=submit]').click());
    await filter('status', 'open'); await filter('category', 'Returns'); await filter('priority', 'High'); await filter('assigned_to', 'unassigned');
    assert.match(await page.locator('#supportPage').innerText(), /^1 ticket ·/);
    await action('clear').click(); await idle();
    assert.equal(await field('supportFilters', 'search').inputValue(), '');
    await filter('search', 'no-match-' + fixture.marker);
    assert.match(await page.locator('#supportRows').innerText(), /No tickets found/);
    assert.equal(await action('next').isDisabled(), true);
    await filter('search', 'INQ-' + fixture.id);
    assert.equal(await page.locator('#supportRows [data-ticket]').count(), 1);
    holdList = true;
    await field('supportFilters', 'search').fill(fixture.marker);
    while (!releaseList) await new Promise(resolve => setTimeout(resolve, 10));
    await filter('search', 'no-match-' + fixture.marker);
    const stale = page.waitForResponse(response => response.url().includes('/tickets.php?') && new URL(response.url()).searchParams.get('search') === fixture.marker);
    releaseList(); await stale;
    assert.match(await page.locator('#supportRows').innerText(), /No tickets found/);
    await filter('search', 'INQ-' + fixture.id);

    // Failed list reads and writes recover without clearing editor text.
    failList = true; await action('refresh').click(); await idle();
    assert.match(await page.locator('#supportError').innerText(), /Temporary ticket failure/);
    assert.equal(await action('next').isDisabled(), true);
    failList = false; await action('refresh').click(); await idle();
    assert.equal(await page.locator('#supportError').isVisible(), false);
    failWrite = true;
    await field('supportReply', 'body').fill('Retry this reply');
    const failure = page.waitForResponse(response => response.url().endsWith('/tickets.php') && response.request().method() === 'POST');
    await page.locator('#supportReply [type=submit]').click(); await failure; await idle();
    assert.equal(await field('supportReply', 'body').inputValue(), 'Retry this reply');
    assert.match(await page.locator('#supportDetailMessage').innerText(), /Temporary ticket failure/);
    failWrite = false; await post(() => page.locator('#supportReply [type=submit]').click());

    // An actual concurrent write must not overwrite the current user's text.
    const latest = await (await context.request.get(base + 'public/api/admin/tickets.php?id=' + fixture.id)).json();
    const ticket = latest.data.ticket;
    const changed = await context.request.post(base + 'public/api/admin/tickets.php', {
      headers: { 'X-CSRF-Token': fixture.session.token },
      data: { action: 'note', id: ticket.id, version: ticket.version, updated_at: ticket.updated_at, body: 'Concurrent administrator note' }
    });
    assert.equal(changed.status(), 200);
    await field('supportReply', 'body').fill('Keep after conflict');
    const conflict = page.waitForResponse(response => response.status() === 409 && response.url().endsWith('/tickets.php'));
    await page.locator('#supportReply [type=submit]').click(); await conflict; await idle();
    assert.equal(await field('supportReply', 'body').inputValue(), 'Keep after conflict');
    assert.equal(await action('draft').isDisabled(), true);
    await action('reload').click(); await idle();
    assert.equal(await field('supportReply', 'body').inputValue(), 'Keep after conflict');
    assert.equal(await action('draft').isDisabled(), false);
    await post(() => action('draft').click());
    failDetail = true; await action('reload').click(); await idle();
    assert.match(await page.locator('#supportDetailMessage').innerText(), /Temporary ticket failure/);
    failDetail = false;
    holdDetail = true; await action('reload').click();
    await page.waitForFunction(() => document.getElementById('supportDetail').getAttribute('aria-busy') === 'true');
    assert.equal(await page.locator('#supportReply [type=submit]').isDisabled(), true);
    while (!releaseDetail) await new Promise(resolve => setTimeout(resolve, 10));
    releaseDetail(); await idle();

    // Real browser creation, assignment, upload and protected download.
    await action('close').click(); assert.equal(await page.locator('#supportDetail').isVisible(), false);
    await page.locator('#supportCreatePanel > summary').click();
    for (const [name, value] of Object.entries({ full_name: 'Browser ticket test', email: fixture.marker + '@example.com', subject: fixture.marker + ' created', message: 'Browser original request', order_number: 'TEST-123' })) await field('supportCreate', name).fill(value);
    await field('supportCreate', 'category').selectOption('Returns');
    await field('supportCreate', 'assigned_to').selectOption(String(fixture.actor));
    const created = await post(() => page.locator('#supportCreate [type=submit]').click());
    assert.equal(await field('supportCreate', 'priority').inputValue(), 'Medium');
    assert.equal(await page.locator('#supportCreatePanel').getAttribute('open'), null);
    assert.match(await page.locator('#supportDetailTitle').innerText(), new RegExp('INQ-' + created.ticket.id));
    await page.locator('#supportAttachments > summary').click();
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
    const beforeUpload = writes.length;
    await field('supportUpload', 'attachment').setInputFiles({ name: 'blocked.txt', mimeType: 'text/plain', buffer: Buffer.from('unsupported') });
    await page.locator('#supportUpload [type=submit]').click();
    assert.equal(writes.length, beforeUpload);
    await field('supportUpload', 'attachment').setInputFiles({ name: 'large.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(5242881) });
    await page.locator('#supportUpload [type=submit]').click();
    assert.equal(writes.length, beforeUpload);
    await field('supportUpload', 'attachment').setInputFiles({ name: 'ticket-proof.pdf', mimeType: 'application/pdf', buffer: pdf });
    await field('supportReply', 'body').fill('Keep while uploading');
    expireUploadToken = true;
    const tokenRefresh = page.waitForResponse(response => response.url().endsWith('/auth/csrf.php') && response.ok());
    const uploadRetry = page.waitForResponse(response => response.url().endsWith('/tickets.php') && response.request().method() === 'POST' && response.ok());
    await page.locator('#supportUpload [type=submit]').click();
    await tokenRefresh;
    const uploaded = (await (await uploadRetry).json()).data;
    await idle();
    assert.equal(writes.length, beforeUpload + 2);
    assert.equal(uploaded.attachments.length, 1);
    assert.equal(await field('supportReply', 'body').inputValue(), 'Keep while uploading');
    const download = await context.request.get(base + 'public/api/admin/ticket-attachment.php?id=' + uploaded.attachments[0].id);
    assert.deepEqual(await download.body(), pdf);
    await post(() => action('draft').click());

    // Module-only overflow checks and screenshots at desktop, tablet and mobile sizes.
    for (const width of [1440, 768, 375, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      const overflow = await page.locator('#module-tickets').evaluate(root => {
        const bounds = root.getBoundingClientRect();
        return Array.from(root.querySelectorAll('input, select, textarea, button, summary, .admin-card, .admin-table-container')).filter(el => el.getClientRects().length && !el.closest('table')).filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.left < bounds.left - 1 || rect.right > bounds.right + 1;
        }).map(el => el.outerHTML.slice(0, 120));
      });
      assert.deepEqual(overflow, [], 'Module fits viewport ' + width);
      if (process.env.CC_TEST_SCREENSHOTS_DIR) {
        await page.locator('#module-tickets').screenshot({ path: path.join(process.env.CC_TEST_SCREENSHOTS_DIR, 'tickets-' + width + '.png') });
      }
    }
    assert.deepEqual(errors, [], 'No page JavaScript errors');
    failList = true;
    await page.reload();
    await page.locator('#supportRows').filter({ hasText: 'Ticket list unavailable' }).waitFor();
    assert.equal(await field('supportCreate', 'full_name').isDisabled(), true);
    assert.equal(await action('next').isDisabled(), true);
    failList = false; await action('refresh').click(); await idle();
    assert.equal(await field('supportCreate', 'full_name').isDisabled(), false);
    console.log('PASS: browser creation, filters, assignments, all statuses, replies, drafts, notes, upload/download, both paginations, unsaved text, conflicts, CSRF retry, error recovery and responsive layouts');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
