// Invoked by dashboard-navigation.php with isolated users and sessions.
const { chromium } = require(process.env.CC_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { base, sessions } = JSON.parse(fs.readFileSync(0, 'utf8'));

const business = 'admin-dashboard.html';
const system = 'super-admin-dashboard.html';
const account = 'account-dashboard.html';
const directory = '#module-directory';

async function checkModule(page, target) {
  try {
    await page.waitForFunction(target => {
      const toolbar = document.querySelector('.admin-sticky-nav');
      const section = document.querySelector(target);
      if (!toolbar || !section) return false;
      const top = section.getBoundingClientRect().top;
      const bottom = toolbar.getBoundingClientRect().bottom;
      const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1;
      return window.location.hash === target && top >= bottom && (top <= bottom + 20 || (atEnd && top < window.innerHeight))
        && document.querySelector('#module-directory a[aria-current="location"]')?.hash === target;
    }, target, { timeout: 8000 });
  } catch (error) {
    const position = await page.evaluate(target => ({
      top: document.querySelector(target)?.getBoundingClientRect().top,
      toolbarBottom: document.querySelector('.admin-sticky-nav')?.getBoundingClientRect().bottom,
      current: document.querySelector('#module-directory a[aria-current="location"]')?.hash,
      focus: document.activeElement?.id,
      scrollY: window.scrollY,
      maxScrollY: document.documentElement.scrollHeight - window.innerHeight
    }), target);
    throw new Error(`Could not reach ${target} on ${page.url()}: ${JSON.stringify(position)}`, { cause: error });
  }
}

async function checkAccountDropdown(page, settingsTarget) {
  const header = page.locator('.admin-header');
  const toggle = header.locator('.dropdown-toggle');
  const dropdown = header.locator('.dropdown-menu');
  await toggle.click();

  const menuBounds = await dropdown.boundingBox();
  const toolbarBounds = await page.locator('.admin-sticky-nav').boundingBox();
  assert.ok(menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= page.viewportSize().width);
  const overlapTop = Math.max(menuBounds.y, toolbarBounds.y);
  const overlapBottom = Math.min(menuBounds.y + menuBounds.height, toolbarBounds.y + toolbarBounds.height);
  assert.ok(overlapBottom > overlapTop, 'Account dropdown overlaps the Modules bar');
  const point = { x: menuBounds.x + menuBounds.width / 2, y: (overlapTop + overlapBottom) / 2 };
  assert.equal(await dropdown.evaluate((menu, { x, y }) => menu.contains(document.elementFromPoint(x, y)), point),
    true, 'Account dropdown renders in front of the Modules bar');

  await page.keyboard.press('Escape');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await toggle.click();
  await dropdown.getByRole('link', { name: 'Account settings' }).click();
  await checkModule(page, settingsTarget);
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
}

async function checkDirectory(page, route, modules) {
  await page.goto(base + route + modules.at(-1), { waitUntil: 'domcontentloaded' });
  await checkModule(page, modules.at(-1));
  await page.evaluate(() => { window.moduleNavigationTest = true; });

  const links = page.locator(directory + ' a');
  const shortcuts = page.getByRole('navigation', { name: 'Module shortcuts' });
  const menu = shortcuts.getByRole('button', { name: 'Modules' });
  const menuLinks = shortcuts.locator('.dropdown-item');
  assert.deepEqual(await links.evaluateAll(items => items.map(link => link.hash)), modules);
  assert.deepEqual(await menuLinks.evaluateAll(items => items.map(link => link.hash)), modules);

  for (const target of modules) {
    await page.locator(`${new URL(page.url()).hash} a[href="${directory}"]`).first().click();
    assert.equal(new URL(page.url()).hash, directory);
    await page.locator(`${directory} a[href="${target}"]`).click();
    await checkModule(page, target);
  }

  await menu.focus();
  await page.keyboard.press('ArrowDown');
  const firstModule = menuLinks.first();
  assert.equal(await firstModule.evaluate(link => link === document.activeElement), true);
  const bounds = await shortcuts.locator('.dropdown-menu').boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize().width);
  await page.keyboard.press('Escape');
  assert.equal(await menu.getAttribute('aria-expanded'), 'false');
  assert.equal(await menu.evaluate(el => el === document.activeElement), true);
  await menu.click();
  await firstModule.click();
  await checkModule(page, modules[0]);
  assert.equal(await menu.getAttribute('aria-expanded'), 'false');
  await page.goBack();
  await checkModule(page, modules.at(-1));
  await page.goForward();
  await checkModule(page, modules[0]);
  assert.equal(await page.evaluate(() => window.moduleNavigationTest), true);
}

async function checkDenied(context, route, location) {
  const response = await context.request.get(base + route, { maxRedirects: 0 });
  assert.equal(response.status(), 302, route);
  assert.equal(response.headers().location, location, route);
}

(async () => {
  const browser = await chromium.launch();
  try {
    async function browserContext(role, width) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      if (role) {
        const { name, value } = sessions[role];
        await context.addCookies([{ name, value, url: base, httpOnly: true, sameSite: 'Lax' }]);
      }
      if (process.env.CC_TEST_ASSETS_DIR) await context.route(/^https:\/\//, route => {
        const name = path.basename(new URL(route.request().url()).pathname);
        return ['bootstrap.min.css', 'bootstrap.bundle.min.js'].includes(name)
          ? route.fulfill({ path: path.join(process.env.CC_TEST_ASSETS_DIR, name) })
          : route.abort();
      });
      return context;
    }

    const guest = await browserContext(null, 390);
    await checkDenied(guest, business, 'auth.html?notice=admin_required');
    await checkDenied(guest, system, 'auth.html?notice=super_admin_required');
    await guest.close();

    for (const role of ['admin', 'customer', 'super_admin']) {
      const context = await browserContext(role, 390);
      await checkDenied(context, business, account);
      if (role !== 'super_admin') await checkDenied(context, system, 'auth.html?notice=super_admin_required');
      const page = await context.newPage();
      await page.goto(base + account, { waitUntil: 'domcontentloaded' });
      await page.getByRole('navigation', { name: 'Account', exact: true }).waitFor();
      const result = await context.request.get(base + 'public/api/admin/auth-check.php');
      if (role !== 'customer') assert.equal((await result.json()).data.can_access_owner_workspace, false);
      assert.equal(await page.locator('#business-workspace-link').isVisible(), false);
      await context.close();
    }

    for (const width of [1440, 390]) {
      const owner = await browserContext('owner', width);
      await checkDenied(owner, system, 'auth.html?notice=super_admin_required');
      const ownerPage = await owner.newPage();
      await ownerPage.goto(base + account, { waitUntil: 'domcontentloaded' });
      const businessLink = ownerPage.getByRole('link', { name: 'Business Workspace' });
      assert.equal(await businessLink.getAttribute('href'), business);
      await businessLink.click();
      await ownerPage.locator('#adminMainContent').waitFor();
      assert.equal(ownerPage.url(), base + business);
      assert.equal(Number((await (await owner.request.get(base + 'public/api/auth/me.php')).json()).data.user.id), sessions.owner.userId);
      await checkAccountDropdown(ownerPage, '#module-settings');
      await checkDirectory(ownerPage, business, ['overview', 'products', 'inventory', 'sales', 'reviews', 'notifications', 'staff', 'logs', 'settings', 'tickets'].map(name => '#module-' + name));
      await owner.close();

      const admin = await browserContext('super_admin', width);
      const adminPage = await admin.newPage();
      await adminPage.goto(base + system, { waitUntil: 'domcontentloaded' });
      await checkAccountDropdown(adminPage, '#module-account');
      const tabs = adminPage.getByRole('navigation', { name: 'Account', exact: true });
      const workspace = tabs.getByRole('link', { name: 'System Workspace' });
      assert.equal(await workspace.getAttribute('href'), system + '#module-overview');
      assert.equal(await tabs.getByRole('link', { name: 'Business Workspace' }).count(), 0);
      await adminPage.evaluate(() => { window.accountNavigationTest = true; });
      await workspace.click();
      await checkModule(adminPage, '#module-overview');
      assert.equal(await adminPage.evaluate(() => window.accountNavigationTest), true);
      assert.equal(Number((await (await admin.request.get(base + 'public/api/auth/me.php')).json()).data.user.id), sessions.super_admin.userId);
      await checkDirectory(adminPage, system, ['overview', 'users', 'maintenance', 'monitoring', 'errors', 'config', 'account'].map(name => '#module-' + name));
      await admin.close();
      console.log(`PASS ${width}px: all module links and returns, keyboard shortcuts, browser history, workspace routes and session continuity.`);
    }
    console.log('PASS role checks: guest, customer, Business Owner, non-owner Admin and dual-role Super Admin.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
