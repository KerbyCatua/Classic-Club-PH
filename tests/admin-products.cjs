// Isolated API fixtures; run with CC_PLAYWRIGHT_PATH and optional CC_TEST_ASSETS_DIR.
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
      const errors = [], dialogs = [], writes = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', dialog => { dialogs.push(dialog.message()); dialog.dismiss(); });
      let failure = false, releaseWrite, failRead = false, releaseSearch, readOnly = false;
      const products = Array.from({ length: 12 }, (_, index) => ({
        id: index + 1, name: index === 0 ? 'A long product name <img src=x onerror=alert(1)> '.repeat(3) : `Product ${index + 1}`,
        sku: `CC-${index + 1}`, category_id: 1, category_name: 'Tops & tees', price: 1200,
        is_active: index === 1 ? 0 : 1, availability_status: index === 1 ? 'draft' : 'active',
        stock_qty: 20, min_stock_threshold: index === 0 ? 0 : 10, description: 'Cotton'
      }));
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
        if (url.pathname.endsWith('/auth-check.php')) data = {
          authenticated: true, user: { id: 7, first_name: 'Test', last_name: 'Admin' }, roles: ['admin'],
          business: { id: 1, name: 'Classic Club PH' }, permissions: { can_manage_products: !readOnly }
        };
        if (url.pathname.endsWith('/csrf.php')) data = { token: 'products-test' };
        if (url.pathname.endsWith('/products.php')) {
          if (route.request().method() === 'POST') {
            assert.equal(route.request().headers()['x-csrf-token'], 'products-test');
            const payload = route.request().postDataJSON();
            writes.push(payload);
            await new Promise(resolve => { releaseWrite = resolve; });
            if (failure) return route.fulfill({ status: 400, json: { success: false, error: { message: 'Test save failure. Please retry.' } } });
            if (['create', 'update'].includes(payload.action)) {
              assert.match(payload.image, /^data:image\/png;base64,/);
              assert.ok(payload.price > 0);
            }
            if (payload.action === 'create') products.push({ ...payload, id: 20, stock_qty: payload.initial_stock, availability_status: payload.is_active ? 'active' : 'draft', category_name: 'Tops & tees' });
            else {
              const product = products.find(p => p.id === payload.product_id);
              if (payload.action === 'update') Object.assign(product, payload);
              else {
                product.is_active = payload.action === 'activate' ? 1 : 0;
                product.availability_status = { activate: 'active', deactivate: 'draft', archive: 'archived' }[payload.action];
              }
            }
          } else {
            if (failRead) return route.fulfill({ status: 500, json: { success: false } });
            const search = url.searchParams.get('search') || '';
            let matches = products.filter(p => p.name.includes(search) || p.sku.includes(search));
            if (search === 'slow') {
              await new Promise(resolve => { releaseSearch = resolve; });
              matches = [];
            }
            const availability = url.searchParams.get('availability');
            if (availability === 'inactive') matches = matches.filter(p => !p.is_active);
            if (url.searchParams.get('category') === 'Outerwear & hoodies') matches = [];
            if (url.searchParams.get('sort') === 'name_desc') matches.sort((a, b) => b.name.localeCompare(a.name));
            data = { products: matches };
          }
        }
        await route.fulfill({ json: { success: true, data } });
      });
      await page.goto(base + 'admin-dashboard.html#module-products');
      await page.waitForFunction(() => document.querySelectorAll('#productsTableBody tr').length === 12);
      const viewport = page.locator('#module-products .products-table-viewport');
      const geometry = await viewport.evaluate(el => {
        const box = el.getBoundingClientRect();
        const rows = [...el.querySelectorAll('tbody tr')].map(row => row.getBoundingClientRect());
        return { height: el.clientHeight, visible: rows.filter(row => row.top >= box.top && row.bottom <= box.bottom + 0.1).length,
          nextTop: rows[6].top - box.top, scrollHeight: el.scrollHeight };
      });
      assert.equal(geometry.height, 483);
      assert.equal(geometry.visible, 6, JSON.stringify(geometry));
      assert.equal(geometry.nextTop, 483);
      assert.ok(geometry.scrollHeight > geometry.height);
      assert.equal(await page.locator('#productsTableBody img').count(), 0, 'Product values are escaped.');
      await viewport.evaluate(el => { el.scrollTop = 200; });
      assert.equal(await viewport.evaluate(el => Math.round(el.querySelector('th').getBoundingClientRect().top - el.getBoundingClientRect().top)), 0);
      await viewport.evaluate(el => { el.scrollTop = 0; });

      async function design(modal) {
        await page.waitForFunction(() => document.querySelector('.cc-product-modal.show')?.getAttribute('aria-modal') === 'true');
        assert.equal(await page.locator('#adminMainContent').evaluate(el => getComputedStyle(el).filter), 'blur(5px)');
        assert.equal(await modal.evaluate(el => getComputedStyle(el).filter), 'none');
        assert.equal(await page.locator('.modal-backdrop').evaluate(el => getComputedStyle(el).opacity), '0.5');
        assert.equal(await page.locator('.modal-backdrop').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 0, 0)');
        assert.equal(await modal.locator('.modal-content').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(24, 26, 27)');
        assert.equal(await modal.locator('h2').evaluate(el => getComputedStyle(el).fontSize), '32px');
        assert.equal(await modal.locator('.modal-body').evaluate(el => getComputedStyle(el).padding), '32px');
        const bounds = await modal.locator('.modal-content').boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
        if (width === 1440) assert.equal(bounds.width, 520);
        assert.equal(await modal.locator('.modal-content').evaluate(el => el.scrollWidth <= el.clientWidth), true);
        const buttons = modal.locator('.cc-sign-out-actions .btn');
        const first = await buttons.nth(0).boundingBox(), second = await buttons.nth(1).boundingBox();
        assert.ok(Math.abs(first.height - 50) < 0.1 && Math.abs(second.height - 50) < 0.1);
        assert.ok(Math.abs(first.width - second.width) < 1);
        assert.equal(second.x - first.x - first.width, 12);
      }
      async function closed(modal) {
        await modal.waitFor({ state: 'hidden' });
        await page.waitForFunction(() => !document.body.classList.contains('cc-product-modal-open'));
        assert.equal(await page.locator('.modal-backdrop').count(), 0);
        assert.equal(await page.locator('#adminMainContent').evaluate(el => getComputedStyle(el).filter), 'none');
      }
      async function snackbar(message) {
        const bar = page.locator('#productsSnackbar');
        await page.waitForFunction(text => document.querySelector('#productsSnackbar.is-visible')?.textContent === text, message);
        assert.equal(await bar.getAttribute('role'), 'status');
        const box = await bar.boundingBox();
        assert.ok(Math.abs(box.x + box.width / 2 - width / 2) < 1);
        assert.ok(box.y > 850 && box.y + box.height <= 1000);
        assert.equal(await bar.evaluate(el => getComputedStyle(el).borderLeftColor), 'rgb(2, 128, 144)');
        assert.equal(await page.locator('#adminToast.show').count(), 0);
      }
      async function save(modal, button, action, fail = false) {
        failure = fail;
        const count = writes.length;
        releaseWrite = undefined;
        await button.click();
        await page.waitForFunction(id => document.getElementById(id).dataset.saving === 'true', await modal.getAttribute('id'));
        while (!releaseWrite) await new Promise(resolve => setTimeout(resolve, 10));
        assert.equal(writes.length, count + 1);
        assert.equal(writes.at(-1).action, action);
        assert.equal(await button.isDisabled(), true);
        await button.dispatchEvent('click');
        if (await modal.locator('form').count()) await modal.locator('form').dispatchEvent('submit');
        await page.keyboard.press('Escape');
        assert.equal(await modal.isVisible(), true);
        assert.equal(writes.length, count + 1, 'No duplicate write while pending.');
        releaseWrite();
        if (fail) {
          await modal.locator('.product-form-error').waitFor({ state: 'visible' });
          assert.equal(await button.isEnabled(), true);
          assert.equal(await modal.isVisible(), true);
        } else {
          await closed(modal);
          await button.dispatchEvent('click');
          assert.equal(writes.length, count + 1, 'Closed dialogs cannot resubmit a completed action.');
        }
      }
      const status = page.locator('#modalProductStatus');
      const rowAction = (id, action) => page.locator(`[data-product-id="${id}"] [data-product-action="${action}"]`);
      async function openStatus(id, action) {
        await rowAction(id, action).click();
        await page.waitForFunction(() => document.activeElement.id === 'cancelProductStatus');
      }
      for (const [id, action, expected] of [[1, 'deactivate', 'deactivated'], [2, 'activate', 'activated'], [3, 'archive', 'archived']]) {
        await openStatus(id, action);
        await design(status);
        assert.equal(await page.locator('#cancelProductStatus').evaluate(el => el === document.activeElement), true);
        const count = writes.length;
        await page.locator('#cancelProductStatus').click();
        await closed(status);
        assert.equal(writes.length, count);
        assert.equal(await rowAction(id, action).evaluate(el => el === document.activeElement), true);
        await openStatus(id, action);
        await page.keyboard.press('Escape');
        await closed(status);
        await openStatus(id, action);
        await status.click({ position: { x: 2, y: 2 } });
        await closed(status);
        await openStatus(id, action);
        await save(status, page.locator('#confirmProductStatus'), action, true);
        assert.equal(await rowAction(id, action).count(), 1, 'Failed action keeps prior row state.');
        await save(status, page.locator('#confirmProductStatus'), action);
        await snackbar(`Product ${expected} successfully.`);
      }
      await page.waitForFunction(() => document.querySelector('[data-product-id="3"] .admin-badge')?.textContent === 'Archived');
      assert.equal(await rowAction(3, 'archive').count(), 0);
      assert.equal(await rowAction(3, 'edit').count(), 0);
      assert.equal(await rowAction(3, 'activate').count(), 1);

      const image = async (w, h) => Buffer.from(await page.evaluate(([w, h]) => {
        const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
        return canvas.toDataURL('image/png').split(',')[1];
      }, [w, h]), 'base64');
      const square = { name: 'square.png', mimeType: 'image/png', buffer: await image(8, 8) };
      const edit = page.locator('#modalEditProduct');
      await rowAction(1, 'edit').click();
      await design(edit);
      assert.equal(await page.locator('#editProdThreshold').inputValue(), '0');
      assert.equal(await page.locator('#editProdSku').isDisabled(), true);
      await page.locator('#editProdName').fill('Edited product');
      await page.locator('#editProdPrice').fill('-1');
      await page.locator('#editProdImage').setInputFiles(square);
      const count = writes.length;
      await edit.locator('[type="submit"]').click();
      assert.equal(writes.length, count, 'Negative price is rejected before submission.');
      await page.locator('#editProdPrice').fill('1890.50');
      await save(edit, edit.locator('[type="submit"]'), 'update', true);
      assert.equal(await page.locator('#editProdName').inputValue(), 'Edited product');
      await save(edit, edit.locator('[type="submit"]'), 'update');
      await snackbar('Product updated successfully.');
      await page.waitForFunction(() => document.querySelector('[data-product-id="1"]').textContent.includes('Edited product'));
      await rowAction(1, 'edit').click();
      await page.waitForFunction(() => document.activeElement.id === 'editProdName');
      assert.equal(await page.locator('#editProdImage').inputValue(), '');
      await page.keyboard.press('Escape');
      await closed(edit);

      const add = page.locator('#modalAddProduct');
      await page.locator('#btnAddProduct').click();
      await design(add);
      await page.locator('#newProdName').fill('New product');
      await page.locator('#newProdSku').fill('CC-NEW');
      await page.locator('#newProdPrice').fill('1500');
      await page.locator('#newProdStatus').selectOption('0');
      const beforeInvalid = writes.length;
      for (const [file, message] of [
        [{ name: 'wide.png', mimeType: 'image/png', buffer: await image(8, 4) }, 'exactly 1:1'],
        [{ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('invalid image') }, 'Unable to read'],
        [{ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) }, '5 MB']
      ]) {
        await page.locator('#newProdImage').setInputFiles(file);
        await add.locator('[type="submit"]').click();
        await page.waitForFunction(message => document.querySelector('#modalAddProduct .product-form-error:not([hidden])')?.textContent.includes(message), message);
        assert.equal(writes.length, beforeInvalid);
      }
      await page.locator('#newProdImage').setInputFiles(square);
      await save(add, add.locator('[type="submit"]'), 'create', true);
      await save(add, add.locator('[type="submit"]'), 'create');
      await snackbar('Product created successfully.');
      assert.equal(writes.at(-1).is_active, 0);
      assert.equal(await page.locator('#newProdName').inputValue(), '');
      await page.waitForFunction(() => document.querySelectorAll('#productsTableBody tr').length === 13);

      if (process.env.CC_TEST_SCREENSHOT_DIR) {
        await page.locator('#module-products').screenshot({ path: path.join(process.env.CC_TEST_SCREENSHOT_DIR, `products-${width}.png`) });
        await openStatus(3, 'activate');
        await page.screenshot({ path: path.join(process.env.CC_TEST_SCREENSHOT_DIR, `product-modal-${width}.png`) });
        await page.locator('#cancelProductStatus').click();
        await closed(status);
        await page.locator('#btnAddProduct').click();
        await page.waitForFunction(() => document.activeElement.id === 'newProdName');
        await page.screenshot({ path: path.join(process.env.CC_TEST_SCREENSHOT_DIR, `product-add-${width}.png`) });
        await page.keyboard.press('Escape');
        await closed(add);
      }

      // Search races cannot replace newer results, including a pending debounce.
      await page.locator('#prodSearchInput').fill('slow');
      while (!releaseSearch) await new Promise(resolve => setTimeout(resolve, 10));
      await page.locator('#prodSearchInput').fill('Edited');
      await page.waitForFunction(() => document.querySelector('#productsResultCount').textContent === '1 product');
      releaseSearch();
      await page.waitForTimeout(100);
      assert.ok((await page.locator('#productsTableBody').textContent()).includes('Edited product'));
      await page.locator('#prodSearchInput').fill('no matches');
      await page.waitForFunction(() => document.querySelector('#productsResultCount').textContent === '0 products');
      assert.equal(await viewport.evaluate(el => el.clientHeight), 483);
      await page.locator('#prodSearchInput').fill('');
      await page.waitForFunction(() => document.querySelector('#productsResultCount').textContent === '13 products');
      failRead = true;
      await page.locator('#prodSortFilter').selectOption('name_desc');
      await page.locator('#productsLoadError').waitFor({ state: 'visible' });
      failRead = false;
      await page.locator('#productsRetry').click();
      await page.waitForFunction(() => document.querySelector('#productsResultCount').textContent === '13 products');
      await page.locator('#prodAvailabilityFilter').selectOption('inactive');
      await page.waitForFunction(() => document.querySelector('#productsResultCount').textContent === '3 products');
      await page.locator('#prodCategoryFilter').selectOption('Outerwear & hoodies');
      await page.waitForFunction(() => document.querySelector('#productsResultCount').textContent === '0 products');
      await page.reload();
      await page.waitForFunction(() => document.querySelectorAll('#productsTableBody tr').length === 13);
      assert.equal(await page.locator('[data-product-id="3"] .admin-badge').textContent(), 'Archived');

      // Product-specific styling does not change another module's modal.
      await page.evaluate(() => bootstrap.Modal.getOrCreateInstance(document.getElementById('modalRestock')).show());
      assert.equal(await page.locator('#adminMainContent').evaluate(el => getComputedStyle(el).filter), 'none');
      await page.keyboard.press('Escape');
      readOnly = true;
      await page.reload();
      await page.waitForFunction(() => document.querySelectorAll('#productsTableBody tr').length === 13);
      assert.equal(await page.locator('#btnAddProduct').isVisible(), false);
      assert.equal(await page.locator('#productsTableBody button').count(), 0);
      assert.deepEqual(errors, []);
      assert.deepEqual(dialogs, []);
      await context.close();
      console.log(`PASS ${width}px: six rows, scrolling, five actions, modal design, focus, cancel/Escape/backdrop, validation, duplicate protection, retry, snackbar, search races and module isolation.`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
