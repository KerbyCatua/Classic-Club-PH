// CC_PLAYWRIGHT_PATH and optional CC_TEST_ASSETS_DIR match the existing browser tests.
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
      const products = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: i === 0 ? 'Linen shirt' : 'A long product name '.repeat(8), sku: `SKU-${i}`, stock_qty: i === 0 ? '20' : '0', min_stock_threshold: 0, is_active: 1 }));
      const movements = Array.from({ length: 15 }, (_, i) => ({ id: i + 1, product_name: 'Linen shirt', created_at: '2026-11-14 09:30:00', previous_quantity: 10, new_quantity: 20, quantity_delta: 10, movement_type: i % 2 ? 'adjustment' : 'receipt', reason: 'Long reference to check fixed row height. '.repeat(10), admin_name: 'Test Administrator' }));
      const reads = new Set();
      const writes = [];
      let rejectWrite = false;
      let holdWrite = false;
      let releaseWrite;
      let slowSearch = null;
      let delayOldSearch = false;
      await page.route(/^https:\/\//, route => {
        const filename = path.basename(new URL(route.request().url()).pathname);
        if (['bootstrap.min.css', 'bootstrap.bundle.min.js'].includes(filename)) {
          return process.env.CC_TEST_ASSETS_DIR ? route.fulfill({ path: path.join(process.env.CC_TEST_ASSETS_DIR, filename) }) : route.continue();
        }
        return route.abort();
      });
      await page.route('**/public/api/**', async route => {
        const url = new URL(route.request().url());
        let data = {};
        if (url.pathname.endsWith('/auth-check.php')) data = { authenticated: true, user: { id: 7, first_name: 'Test', last_name: 'Admin' }, roles: ['admin'], business: { id: 1, name: 'Classic Club PH' }, permissions: { can_adjust_stock: true } };
        if (url.pathname.endsWith('/csrf.php')) data = { token: 'inventory-test-token' };
        if (/\/(inventory|movements)\.php$/.test(url.pathname)) {
          if (route.request().method() === 'POST') {
            assert.equal(route.request().headers()['x-csrf-token'], 'inventory-test-token');
            const body = route.request().postDataJSON();
            writes.push(body);
            if (holdWrite) await new Promise(resolve => { releaseWrite = resolve; });
            if (rejectWrite) return route.fulfill({ status: 500, json: { success: false, error: { message: 'Test save failure' } } });
            if (body.movement_id) reads.add(body.movement_id);
            else {
              const p = products.find(p => p.id === body.product_id);
              const previous = Number(p.stock_qty);
              const next = body.type === 'set' ? body.quantity : previous + (body.type === 'decrease' ? -body.quantity : body.quantity);
              p.stock_qty = next;
              movements.unshift({ id: 100 + writes.length, product_name: p.name, previous_quantity: previous, new_quantity: next, quantity_delta: next - previous, movement_type: body.action === 'restock' ? 'receipt' : 'adjustment', created_at: '2026-11-14 10:30:00', reason: body.reason, admin_name: 'Test Admin' });
            }
          } else if (url.pathname.endsWith('/inventory.php')) {
            data = { products, summary: { total_physical_stock: Number(products[0].stock_qty), total_available_stock: Number(products[0].stock_qty), low_stock_count: 0, out_of_stock_count: products.filter(p => Number(p.stock_qty) === 0).length } };
          } else {
            const search = url.searchParams.get('search') || '';
            const type = url.searchParams.get('movement');
            data = { movements: movements.filter(m => !reads.has(m.id) && m.product_name.includes(search) && (!type || m.movement_type === (type === 'restock' ? 'receipt' : type))) };
            if (delayOldSearch && search === 'Linen') {
              slowSearch = route;
              return;
            }
          }
        }
        await route.fulfill({ json: { success: true, data } });
      });
      await page.goto(base + 'admin-dashboard.html#module-inventory');
      await page.waitForFunction(() => document.querySelectorAll('#inventoryTableBody tr').length === 10 && document.querySelectorAll('.movement-read').length === 15);
      await page.locator('#module-inventory').evaluate(el => { el.classList.add('is-visible'); el.style.transform = 'none'; el.style.opacity = '1'; });
      for (const [selector, expected, height] of [['.inventory-products-viewport', 5, 410], ['.inventory-movements-viewport', 7, 556]]) {
        const viewport = page.locator(selector);
        const geometry = await viewport.evaluate(el => {
          const box = el.getBoundingClientRect();
          const rows = [...el.querySelectorAll('tbody tr')].map(row => row.getBoundingClientRect());
          return { height: el.clientHeight, total: el.scrollHeight, visible: rows.filter(row => row.top >= box.top && row.bottom <= box.bottom + .1).length, heights: rows.map(row => row.height), accent: getComputedStyle(el).scrollbarColor };
        });
        assert.equal(geometry.height, height);
        assert.equal(geometry.visible, expected, JSON.stringify(geometry));
        assert.ok(geometry.heights.every(h => h === 73), JSON.stringify(geometry));
        assert.ok(geometry.total > height);
        assert.ok(geometry.accent.includes('rgb(2, 128, 144)'));
        await viewport.evaluate(el => { el.scrollTop = 200; });
        assert.equal(await viewport.evaluate(el => Math.round(el.querySelector('th').getBoundingClientRect().top - el.getBoundingClientRect().top)), 0);
        await viewport.evaluate(el => { el.scrollTop = 0; });
      }
      assert.equal(await page.locator('#inventoryTableBody tr').first().locator('td').nth(2).innerText(), '0');
      assert.equal(await page.locator('#inventoryTableBody tr').nth(1).locator('td').nth(3).innerText(), 'Out of stock');

      async function open(selector, modalId) {
        await page.locator(selector).first().click();
        await page.locator(modalId).waitFor({ state: 'visible' });
        await page.waitForFunction(id => document.querySelector(id).contains(document.activeElement), modalId);
        const modal = page.locator(modalId);
        assert.equal(await page.locator('.modal-backdrop').evaluate(el => getComputedStyle(el).opacity), '0.5');
        assert.equal(await page.locator('.modal-backdrop').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 0, 0)');
        assert.equal(await page.locator('#adminMainContent').evaluate(el => getComputedStyle(el).filter), 'blur(5px)');
        assert.equal(await modal.evaluate(el => getComputedStyle(el).filter), 'none');
        const box = await modal.locator('.modal-content').boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= width);
        if (width === 1440) assert.equal(box.width, 1120);
        assert.equal(await modal.locator('.modal-content').evaluate(el => getComputedStyle(el).padding), width === 1440 ? '32px' : '20px');
        return modal;
      }
      async function closed(modal) {
        await modal.waitFor({ state: 'hidden' });
        await page.waitForFunction(() => !document.body.classList.contains('cc-inventory-modal-open'));
      }
      let modal = await open('.btn-restock', '#modalRestock');
      await page.locator('#restockQty').fill('3');
      assert.match(await page.locator('#restockPreview').innerText(), /20 → 23/);
      await page.locator('#restockReason').fill('Temporary reason');
      await modal.locator('.modal-footer [data-bs-dismiss]').click();
      await closed(modal);
      assert.equal(writes.length, 0);
      modal = await open('.btn-restock', '#modalRestock');
      assert.equal(await page.locator('#restockQty').inputValue(), '');
      assert.equal(await page.locator('#restockReason').inputValue(), 'Routine supplier restocking');
      await page.locator('#restockQty').fill('1.5');
      await modal.locator('.inventory-confirm').click();
      assert.equal(writes.length, 0, 'Fractional stock is rejected.');
      await page.locator('#restockQty').fill('5');
      holdWrite = rejectWrite = true;
      await modal.locator('.inventory-confirm').click();
      await page.waitForFunction(() => document.querySelector('#modalRestock').dataset.saving === 'true');
      await page.locator('#formRestock').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      await page.keyboard.press('Escape');
      assert.equal(await modal.isVisible(), true);
      assert.equal(await modal.locator('.modal-footer [data-bs-dismiss]').isDisabled(), true);
      await page.waitForTimeout(60);
      assert.equal(writes.length, 1, 'Duplicate submit is ignored.');
      releaseWrite();
      await modal.locator('.inventory-form-error').waitFor({ state: 'visible' });
      assert.equal(Number(products[0].stock_qty), 20);
      assert.equal(await page.locator('#restockQty').inputValue(), '5');
      holdWrite = rejectWrite = false;
      await modal.locator('.inventory-confirm').click();
      await closed(modal);
      await page.waitForFunction(() => document.querySelector('#invPhysicalStock').textContent === '25');
      assert.equal(Number(products[0].stock_qty), 25);

      for (const [type, quantity, expected] of [['set', 0, 0], ['increase', 8, 8], ['decrease', 3, 5]]) {
        modal = await open('.btn-adjust', '#modalAdjustStock');
        assert.equal(await page.locator('[name="adjustType"]:checked').inputValue(), 'set');
        await page.locator(`[name="adjustType"][value="${type}"]`).check();
        await page.locator('#adjustQty').fill(String(quantity));
        await page.locator('#adjustReason').fill('  ');
        await modal.locator('.inventory-confirm').click();
        await modal.locator('.inventory-form-error').waitFor({ state: 'visible' });
        await page.locator('#adjustReason').fill('Stock recount');
        await modal.locator('.inventory-confirm').click();
        await closed(modal);
        await page.waitForFunction(expected => Number(document.querySelector('#invPhysicalStock').textContent) === expected, expected);
        assert.equal(Number(products[0].stock_qty), expected);
      }
      modal = await open('.btn-adjust', '#modalAdjustStock');
      await page.locator('[name="adjustType"][value="decrease"]').check();
      await page.locator('#adjustQty').fill('6');
      await page.locator('#adjustReason').fill('Damage');
      const beforeInvalid = writes.length;
      await modal.locator('.inventory-confirm').click();
      await modal.locator('.inventory-form-error').waitFor({ state: 'visible' });
      assert.equal(writes.length, beforeInvalid, 'Negative resulting stock is rejected.');
      await page.keyboard.press('Escape');
      await closed(modal);

      const beforeRead = await page.locator('.movement-read').count();
      modal = await open('[data-movement-id="3"]', '#movementReadModal');
      await modal.locator('.modal-footer [data-bs-dismiss]').click();
      await closed(modal);
      assert.equal(await page.locator('.movement-read').count(), beforeRead);
      modal = await open('[data-movement-id="3"]', '#movementReadModal');
      holdWrite = rejectWrite = true;
      await page.locator('#confirmMovementRead').click();
      await page.waitForTimeout(60);
      assert.equal(await page.locator('.movement-read').count(), beforeRead, 'Pending confirmation preserves row.');
      await page.keyboard.press('Escape');
      assert.equal(await modal.isVisible(), true);
      releaseWrite();
      await modal.locator('.inventory-form-error').waitFor({ state: 'visible' });
      assert.equal(await page.locator('.movement-read').count(), beforeRead, 'Failed confirmation preserves row.');
      holdWrite = rejectWrite = false;
      await page.locator('#confirmMovementRead').click();
      await closed(modal);
      assert.equal(await page.locator('.movement-read').count(), beforeRead - 1);
      assert.equal(await page.locator('[data-movement-id="3"]').count(), 0);
      await page.reload();
      await page.waitForFunction(count => document.querySelectorAll('.movement-read').length === count, beforeRead - 1);
      assert.equal(await page.locator('[data-movement-id="3"]').count(), 0);
      await page.locator('#movementTypeFilter').selectOption('restock');
      await page.waitForFunction(() => document.querySelectorAll('.movement-read').length === 8);
      delayOldSearch = true;
      await page.locator('#movementSearchInput').fill('Linen');
      await page.waitForTimeout(350);
      await page.locator('#movementSearchInput').fill('No match');
      await page.waitForFunction(() => document.querySelector('#movementsTableBody').textContent.includes('No unread'));
      assert.ok(slowSearch);
      await slowSearch.fulfill({ json: { success: true, data: { movements } } });
      await page.waitForTimeout(100);
      assert.match(await page.locator('#movementsTableBody').innerText(), /No unread/, 'Older response cannot overwrite a newer filter.');
      assert.equal(await page.locator('.inventory-movements-viewport').evaluate(el => el.clientHeight), 556);
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS ${width}px: exact five/seven rows, sticky headers, accent scrollbars, reference modal styling, restock/adjust totals, validation, cancel/Escape, pending/error/retry, duplicate prevention, mark read, reload and stale filters.`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
