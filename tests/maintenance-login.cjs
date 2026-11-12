// Invoked by maintenance-login.php with temporary accounts over stdin.
const { chromium } = require(process.env.CC_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const fixture = JSON.parse(fs.readFileSync(0, 'utf8'));
const base = fixture.base.replace(/\/?$/, '/');
const contexts = [];

async function csrf(context) {
  const response = await context.request.get(base + 'public/api/auth/csrf.php');
  assert.equal(response.status(), 200);
  return (await response.json()).data.token;
}
async function login(context, user, extra = {}) {
  return context.request.post(base + 'public/api/auth/login.php', {
    headers: { 'X-CSRF-Token': await csrf(context) },
    data: { email: user.email, password: fixture.password, context: 'maintenance', ...extra }
  });
}
async function expectDashboardDenied(context) {
  for (const route of ['super-admin-dashboard.html', 'super-admin-gate.php', 'maintenance-gate.php?resource=super-admin-dashboard.html']) {
    const response = await context.request.get(base + route, { maxRedirects: 0 });
    assert.equal(response.status(), 302, route);
    assert.equal(response.headers().location, 'auth.html?notice=super_admin_required');
    assert.ok(!(await response.text()).includes('id="adminMainContent"'));
  }
}

(async () => {
  const browser = await chromium.launch();
  async function context(options = {}) {
    const ctx = await browser.newContext(options);
    contexts.push(ctx);
    return ctx;
  }
  try {
    const anonymous = await context();
    await expectDashboardDenied(anonymous);
    assert.equal((await anonymous.request.get(base + 'public/api/super-admin/account.php')).status(), 401);

    for (const [role, user] of Object.entries(fixture.users)) {
      if (role === 'super_admin') continue;
      const ctx = await context();
      // A forged role in the payload cannot override the database role.
      const response = await login(ctx, user, { roles: ['super_admin'] });
      assert.equal(response.status(), role === 'inactive_super_admin' ? 401 : 403, role);
      if (role !== 'inactive_super_admin') assert.match((await response.json()).error.message, /Only Super Admin/);
      assert.equal((await ctx.request.get(base + 'public/api/auth/me.php')).status(), 401, 'Denied login must not create an authenticated session');
      await expectDashboardDenied(ctx);
      if (role !== 'inactive_super_admin') {
        // Ordinary sign-in remains supported, but cannot enter the Super Admin area.
        assert.equal((await login(ctx, user, { context: undefined })).status(), 200, role);
        await expectDashboardDenied(ctx);
        assert.equal((await ctx.request.get(base + 'public/api/super-admin/account.php')).status(), 403);
      }
    }
    console.log('PASS: backend rejects every non-Super-Admin role before login; normal login, dashboard gates and API authorization remain protected.');

    const admin = fixture.users.super_admin;
    const secure = await context();
    assert.equal((await secure.request.post(base + 'public/api/auth/login.php', { data: { ...admin, password: fixture.password, context: 'maintenance' } })).status(), 403);
    const invalid = await login(secure, admin, { password: 'wrong-password' });
    assert.equal(invalid.status(), 401);
    assert.equal((await invalid.json()).error.message, 'Invalid email or password.');
    assert.equal((await login(secure, admin, { email: 'invalid' })).status(), 422);
    const before = (await secure.cookies()).find(cookie => cookie.name === 'PHPSESSID').value;
    const success = await login(secure, admin);
    assert.equal(success.status(), 200);
    assert.ok((await success.json()).data.user.roles.includes('super_admin'));
    assert.notEqual((await secure.cookies()).find(cookie => cookie.name === 'PHPSESSID').value, before);
    assert.equal((await secure.request.get(base + 'public/api/auth/me.php')).status(), 200);
    assert.equal((await secure.request.get(base + 'super-admin-dashboard.html', { maxRedirects: 0 })).status(), 200);
    assert.equal((await secure.request.get(base + 'public/api/super-admin/account.php')).status(), 200);
    console.log('PASS: real CSRF, credential validation, session rotation, persisted Super Admin session and dashboard/API access.');

    for (const [width, height, reducedMotion] of [[1440, 900, 'no-preference'], [768, 1024, 'no-preference'], [375, 812, 'no-preference'], [320, 568, 'reduce']]) {
      const ctx = await context({ viewport: { width, height }, reducedMotion });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route(/^https:\/\//, route => {
        const filename = path.basename(new URL(route.request().url()).pathname);
        if (['bootstrap.min.css', 'bootstrap.bundle.min.js'].includes(filename)) {
          return process.env.CC_TEST_ASSETS_DIR
            ? route.fulfill({ path: path.join(process.env.CC_TEST_ASSETS_DIR, filename) })
            : route.continue();
        }
        return route.abort();
      });
      const response = await page.goto(base + 'auth.html');
      assert.equal(response.status(), 503, 'Run this suite with maintenance currently active.');
      await page.waitForFunction(() => document.activeElement.id === 'cc-maintenance-toggle');
      const modal = page.locator('#cc-maintenance-overlay');
      const content = modal.locator('.modal-content');
      const panel = page.locator('#cc-maintenance-admin');
      const toggle = page.locator('#cc-maintenance-toggle');
      const feedback = page.locator('#cc-maintenance-feedback');
      assert.equal(await modal.count(), 1);
      assert.equal(await modal.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0.5)');
      assert.equal(await modal.evaluate(el => getComputedStyle(el).backdropFilter), 'blur(5px)');
      assert.equal(await content.evaluate(el => getComputedStyle(el).filter), 'none');
      assert.equal(await panel.isVisible(), false);
      await toggle.click();
      await page.waitForFunction(() => document.getElementById('cc-maintenance-admin').classList.contains('show'));
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      assert.equal(await modal.evaluate(el => el.scrollWidth <= el.clientWidth), true);
      const bounds = await content.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
      await toggle.click();
      await page.waitForFunction(() => !document.getElementById('cc-maintenance-admin').classList.contains('collapsing'));
      assert.equal(await panel.isVisible(), false);
      await toggle.click();
      await page.waitForFunction(() => document.getElementById('cc-maintenance-admin').classList.contains('show'));

      if (width === 1440) {
        const email = page.locator('#cc-maintenance-email');
        const password = page.locator('#cc-maintenance-password');
        const submit = panel.getByRole('button', { name: 'Sign In', exact: true });
        await email.fill(admin.email);
        await password.fill('wrong-password');
        await submit.click();
        await feedback.waitFor({ state: 'visible' });
        assert.equal(await feedback.textContent(), 'Invalid email or password.');
        assert.equal(await password.inputValue(), '');
        const ordinary = fixture.users.customer || fixture.users.no_role;
        await email.fill(ordinary.email);
        await password.fill(fixture.password);
        const rejected = page.waitForResponse(r => r.url().endsWith('/auth/login.php'));
        await submit.click();
        assert.equal((await rejected).status(), 403);
        await page.waitForFunction(() => document.getElementById('cc-maintenance-feedback').textContent.includes('Only Super Admin'));
        assert.equal((await ctx.request.get(base + 'public/api/auth/me.php')).status(), 401);
        await expectDashboardDenied(ctx);
        await email.fill(admin.email);
        await password.fill(fixture.password);
        await Promise.all([page.waitForURL(base + 'super-admin-dashboard.html'), submit.click()]);
        await page.locator('#adminMainContent').waitFor({ state: 'visible' });
        const identity = await (await ctx.request.get(base + 'public/api/admin/auth-check.php')).json();
        assert.equal(identity.data.authenticated, true);
        assert.equal(Number(identity.data.user.id), admin.id);
        assert.ok(identity.data.roles.includes('super_admin'));
      }
      assert.deepEqual(errors, []);
      console.log(`PASS: ${width}x${height}, blur/overlay, sharp content, responsive layout, collapse${width === 1440 ? ', real login errors and successful dashboard redirect' : ''}.`);
    }
  } finally {
    for (const ctx of contexts) {
      try {
        await ctx.request.post(base + 'public/api/auth/logout.php', { headers: { 'X-CSRF-Token': await csrf(ctx) } });
      } catch (_) { /* Cleanup continues if a browser request has already closed. */ }
    }
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
