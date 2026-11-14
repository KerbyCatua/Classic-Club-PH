/**
 * Classic Club PH - Admin Business Owner Dashboard Controller (admin-page.js)
 * Implements interactive dynamic data loading, filtering, modals, and actions.
 */

async function initDashboard() {
  const loadingOverlay = document.getElementById('adminLoadingOverlay');
  const mainContent = document.getElementById('adminMainContent');

  let currentProducts = [];
  let currentInventory = [];
  let currentReports = null;
  let currentReportPeriod = null;
  let adminPermissions = {};
  const can = (permission) => adminPermissions[permission] === true;

  function hideLoader() {
    if (loadingOverlay) {
      // Immediately disable pointer events so clicks are never intercepted
      loadingOverlay.style.pointerEvents = 'none';
      loadingOverlay.style.opacity = '0';
      loadingOverlay.classList.remove('d-flex');
      loadingOverlay.classList.add('is-hidden');
      loadingOverlay.style.setProperty('display', 'none', 'important');
      setTimeout(() => {
        if (loadingOverlay.parentNode) {
          loadingOverlay.remove();
        }
      }, 200);
    }
    if (mainContent) {
      mainContent.removeAttribute('hidden');
    }
    // Refresh scroll-reveal animations now that content is visible
    setTimeout(() => {
      if (typeof window.refreshScrollReveal === 'function') {
        window.refreshScrollReveal();
      }
    }, 50);
  }

  // Safety watchdog: redirect to login if auth check does not resolve
  const watchdog = setTimeout(() => {
    window.location.replace('auth.html?notice=admin_required');
  }, 2500);

  // 1. Authenticate & Verify Business Admin
  try {
    const authRes = await CCAdmin.apiRequest('public/api/admin/auth-check.php');
    if (!authRes || !authRes.authenticated || !authRes.user) {
      clearTimeout(watchdog);
      window.location.replace('auth.html?notice=admin_required');
      return;
    }

    const roles = authRes.roles || authRes.user.roles || [];
    if (!roles.includes('admin') && !roles.includes('super_admin')) {
      clearTimeout(watchdog);
      alert('Access restricted. This workspace is available to authorized business administrators only.');
      window.location.replace('auth.html?notice=admin_required');
      return;
    }

    clearTimeout(watchdog);
    CCAdmin.setContext(authRes);
    adminPermissions = authRes.permissions || {};
    // Bind a CSRF token to the authenticated session immediately after login.
    try {
      await CCAdmin.refreshCsrfToken();
    } catch (csrfErr) {
      console.warn('CSRF token initialization deferred:', csrfErr);
    }
    initAdminHeader(authRes);

    // Unhide the dashboard now that access is strictly verified
    hideLoader();

    // Hydrate all module data smoothly in the background
    loadAllDashboardData();
  } catch (err) {
    clearTimeout(watchdog);
    console.warn('Admin Auth Check Failed:', err);
    window.location.replace('auth.html?notice=admin_required');
    return;
  }

  // 2. Setup Header & User Info
  function initAdminHeader(data) {
    const user = data.user || {};
    const business = data.business || {};
    const roles = data.roles || user.roles || [];

    const fullName = (user.first_name || 'Admin') + ' ' + (user.last_name || '');
    const initials = ((user.first_name || 'A')[0] + (user.last_name || 'D')[0]).toUpperCase();

    document.getElementById('adminUserName').textContent = fullName.trim();
    document.getElementById('adminUserInitials').textContent = initials;

    const roleLabel = document.getElementById('adminUserRoleLabel');
    if (roleLabel) {
      const roleTitle = data.staff_role
        ? data.staff_role
        : (roles.includes('super_admin') ? 'Super Admin' : 'Business Owner');
      roleLabel.textContent = `Assigned: ${roleTitle}`;
    }

    const accessLabel = document.getElementById('heroAccessLabel');
    if (accessLabel) {
      accessLabel.textContent = data.staff_role
        ? data.staff_role
        : (roles.includes('super_admin') ? 'Super Admin / Administrator' : 'Business Owner / Administrator');
    }

    if (business.name) {
      document.getElementById('heroBusinessName').textContent = business.name;
    }

    const scopeEl = document.getElementById('securityBusinessScope');
    if (scopeEl) {
      const businessName = business.name || 'the assigned business';
      const businessId = business.id ? ` (Business ID ${business.id})` : '';
      scopeEl.textContent = `This account has permissions strictly limited to ${businessName}${businessId}. Global platform controls are disabled.`;
    }

    // Hide mutation entry points the account cannot use. The server still
    // enforces every permission independently of this presentation logic.
    const toggle = (id, allowed) => {
      const el = document.getElementById(id);
      if (el) el.style.display = allowed ? '' : 'none';
    };
    toggle('btnAddProduct', can('can_manage_products'));
    toggle('btnInviteStaff', can('can_manage_staff'));
    toggle('markAllNotifsBtn', can('can_view_notifications'));
    toggle('exportCsvBtn', can('can_view_reports'));

    const businessForm = document.getElementById('businessProfileForm');
    if (businessForm && !can('can_manage_staff')) {
      businessForm.querySelectorAll('input, textarea, button').forEach((el) => {
        el.disabled = true;
      });
    }

    // Secure Logout Handler
    document.getElementById('adminLogoutBtn').addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await CCAdmin.apiRequest('public/api/auth/logout.php', { method: 'POST' });
      } catch (err) {
        console.warn('Logout API warning:', err);
      } finally {
        if (typeof CCStore !== 'undefined' && typeof CCStore.clearAllUserData === 'function') {
          CCStore.clearAllUserData();
        }
        localStorage.clear();
        sessionStorage.clear();
        document.cookie = 'PHPSESSID=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
        document.cookie = 'cc_csrf_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
        window.location.replace('auth.html?notice=logged_out');
      }
    });

    // Directory Module Smooth Scroll & Active Indicator
    document.querySelectorAll('.admin-module-link').forEach(link => {
      link.addEventListener('click', (e) => {
        document.querySelectorAll('.admin-module-link').forEach(l => l.classList.remove('active'));
        link.classList.add('active');
      });
    });
  }

  // 3. Load All Data In Parallel
  async function loadAllDashboardData() {
    await Promise.allSettled([
      loadOverview(),
      // Product request state is initialized later in this synchronous setup.
      Promise.resolve().then(() => loadProducts()),
      Promise.resolve().then(loadInventory), // Wait for Inventory controls and request state.
      Promise.resolve().then(loadMovements),
      loadReports(),
      loadReviews(),
      loadNotifications(),
      loadStaff(),
      Promise.resolve().then(loadActivityLogs), // Let the logs module finish binding its controls first.
      loadBusinessProfile()
    ]);
    if (typeof window.refreshScrollReveal === 'function') {
      window.refreshScrollReveal();
    }
  }

  // ==========================================
  // SECTION 20.1: DASHBOARD OVERVIEW
  // ==========================================
  async function loadOverview() {
    try {
      const data = await CCAdmin.apiRequest('public/api/admin/dashboard.php');
      if (!data) return;

      document.getElementById('statTotalProducts').textContent = data.total_products ?? 0;
      document.getElementById('statProductsSub').textContent = `${data.active_products ?? 0} active · ${data.inactive_products ?? 0} inactive`;
      document.getElementById('statAvailableStock').textContent = data.total_available_stock ?? 0;
      document.getElementById('statPhysicalStockSub').textContent = `Purchasable · ${data.total_physical_stock ?? 0} physical`;
      document.getElementById('statProductsSold').textContent = data.total_products_sold ?? 0;
      document.getElementById('statTotalRevenue').textContent = CCAdmin.formatPhp(data.total_revenue ?? 0);
      document.getElementById('statLowStock').textContent = data.low_stock_count ?? 0;
      document.getElementById('statOutStock').textContent = data.out_of_stock_count ?? 0;

      const changeEl = document.getElementById('statRevenueChange');
      if (changeEl) {
        if (data.revenue_change_pct === null || data.revenue_change_pct === undefined) {
          changeEl.textContent = 'No prior-month sales';
          changeEl.classList.remove('text-danger');
          changeEl.classList.add('text-muted-cc');
        } else {
          const pct = Number(data.revenue_change_pct);
          changeEl.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% vs last month`;
          changeEl.classList.toggle('text-danger', pct < 0);
          changeEl.classList.toggle('text-accent', pct >= 0);
        }
      }

      const snapshotEl = document.getElementById('snapshotTimestamp');
      if (snapshotEl) {
        snapshotEl.textContent = new Date().toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short' });
      }

      renderOverviewChart(data.weekly_revenue || [], data.total_revenue ?? 0, data.total_products_sold ?? 0);
      renderSellingPatterns(data.best_sellers || [], data.least_sellers || [], data.low_stock_items || [], data.out_of_stock_items || []);

      // Populate Recent Inventory
      const recActEl = document.getElementById('overviewRecentActivities');
      recActEl.innerHTML = (data.recent_activities || []).map(item => `
        <div class="border-bottom border-cc pb-2">
          <div class="text-light-cc" style="font-size: 13px;">${escapeHtml(item.summary || item.title)}</div>
          <div class="text-muted-cc" style="font-size: 11px;">${escapeHtml(item.meta || '')}</div>
        </div>
      `).join('') || '<div class="text-muted-cc" style="font-size: 12px;">No recent inventory events.</div>';

      // Populate Recent Reviews
      const recRevEl = document.getElementById('overviewRecentReviews');
      recRevEl.innerHTML = (data.recent_reviews || []).map(item => `
        <div class="border-bottom border-cc pb-2">
          <div class="text-light-cc" style="font-size: 13px;">${escapeHtml(item.author)} · ${escapeHtml(item.product)} · ${item.rating}/5 ★</div>
          <div class="text-muted-cc" style="font-size: 11px;">${escapeHtml(item.meta || '')}</div>
        </div>
      `).join('') || '<div class="text-muted-cc" style="font-size: 12px;">No recent reviews.</div>';

      // Populate Recent Notifications
      const recNotifEl = document.getElementById('overviewRecentNotifications');
      recNotifEl.innerHTML = (data.recent_notifications || []).map(item => `
        <div class="border-bottom border-cc pb-2">
          <div class="text-light-cc" style="font-size: 13px;">${escapeHtml(item.title)}</div>
          <div class="text-muted-cc" style="font-size: 11px;">${escapeHtml(item.meta || '')}</div>
        </div>
      `).join('') || '<div class="text-muted-cc" style="font-size: 12px;">No new alerts.</div>';

    } catch (e) {
      console.warn('Overview load error:', e);
    }
  }

  function renderOverviewChart(series, totalRevenue, totalUnits) {
    const container = document.getElementById('salesBarChartContainer');
    if (!container) return;

    if (!series.length) {
      container.innerHTML = '<div class="text-muted-cc py-3" style="font-size: 12px;">No completed sales recorded yet.</div>';
    } else {
      const maxRevenue = Math.max(...series.map(item => Number(item.revenue) || 0), 1);
      container.innerHTML = series.map(item => {
        const width = Math.max(4, Math.round((Number(item.revenue) / maxRevenue) * 100));
        return `
          <div class="d-flex align-items-center gap-3">
            <span class="text-muted-cc" style="width: 100px; font-size: 12px;">${escapeHtml(item.period)}</span>
            <div class="flex-grow-1 bg-cc-bg" style="height: 28px; border: 1px solid var(--cc-border);">
              <div class="bg-accent h-100" style="width: ${width}%;"></div>
            </div>
            <span class="text-light-cc fw-medium" style="width: 90px; font-size: 12px; text-align: right;">${CCAdmin.formatPhp(item.revenue)}</span>
          </div>
        `;
      }).join('');
    }

    const totalEl = document.getElementById('salesChartTotal');
    const unitsEl = document.getElementById('salesChartUnits');
    if (totalEl) totalEl.textContent = `Total merchandise sales: ${CCAdmin.formatPhp(totalRevenue)}`;
    if (unitsEl) unitsEl.textContent = `${totalUnits} units sold · completed orders`;
  }

  function renderSellingPatterns(bestSellers, leastSellers, lowStockItems, outOfStockItems) {
    const bestEl = document.getElementById('bestSellersList');
    const leastEl = document.getElementById('leastSellersList');
    const actionEl = document.getElementById('overviewActionRequired');

    const describe = (items) => items.length
      ? items.map((item, index) => `
          <div class="${index === 0 ? 'text-light-cc' : 'text-muted-cc'}" style="font-size: ${index === 0 ? '13px' : '12px'};">
            ${index + 1}. ${escapeHtml(item.name)} (${item.units} units · ${CCAdmin.formatPhp(item.revenue)})
          </div>
        `).join('')
      : '<div class="text-muted-cc" style="font-size: 12px;">No sales recorded.</div>';

    if (bestEl) bestEl.innerHTML = describe(bestSellers);
    if (leastEl) leastEl.innerHTML = describe(leastSellers);

    if (actionEl) {
      const outNames = outOfStockItems.map(item => item.name);
      const lowNames = lowStockItems.map(item => item.name);
      const parts = [];
      if (outNames.length) parts.push(`${outNames.length} product${outNames.length === 1 ? '' : 's'} out of stock (${outNames.join(', ')})`);
      if (lowNames.length) parts.push(`${lowNames.length} near threshold (${lowNames.join(', ')})`);
      actionEl.textContent = parts.length ? parts.join(' and ') + '.' : 'All active products are above their minimum thresholds.';
    }
  }

  // ==========================================
  // SECTION 20.2: PRODUCT MANAGEMENT
  // ==========================================
  let productsRequest = 0;
  const productsModule = document.getElementById('module-products');
  const productsBody = document.getElementById('productsTableBody');
  const statusModal = document.getElementById('modalProductStatus');
  const snackbar = document.getElementById('productsSnackbar');
  let snackbarTimer, snackbarClearTimer, snackbarFrame;
  let pendingStatus = null;

  function showProductSnackbar(message) {
    clearTimeout(snackbarTimer);
    clearTimeout(snackbarClearTimer);
    cancelAnimationFrame(snackbarFrame);
    snackbar.textContent = message;
    snackbarFrame = requestAnimationFrame(() => snackbar.classList.add('is-visible'));
    snackbarTimer = setTimeout(() => {
      snackbar.classList.remove('is-visible');
      snackbarClearTimer = setTimeout(() => { snackbar.textContent = ''; }, 250);
    }, 3500);
  }

  // Only product-owned dialogs use this backdrop and submission lifecycle.
  document.querySelectorAll('.cc-product-modal').forEach(modal => {
    let trigger;
    modal.addEventListener('show.bs.modal', event => {
      trigger = event.relatedTarget || document.activeElement;
      modal.querySelector('.product-form-error').hidden = true;
      document.body.classList.add('cc-product-modal-open');
    });
    modal.addEventListener('shown.bs.modal', () => {
      modal.querySelector('input:not([type="hidden"]), #cancelProductStatus')?.focus();
    });
    modal.addEventListener('hide.bs.modal', event => {
      if (modal.dataset.saving === 'true') event.preventDefault();
    });
    modal.addEventListener('hidden.bs.modal', () => {
      document.body.classList.remove('cc-product-modal-open');
      const target = trigger?.isConnected ? trigger : productsModule.querySelector('#prodSearchInput');
      target?.focus({ preventScroll: true });
    });
  });

  async function loadProducts() {
    const request = ++productsRequest;
    const params = new URLSearchParams();
    for (const [key, id] of [['search', 'prodSearchInput'], ['category', 'prodCategoryFilter'], ['availability', 'prodAvailabilityFilter'], ['sort', 'prodSortFilter']]) {
      const value = document.getElementById(id).value.trim();
      if (value) params.set(key, value);
    }
    productsModule.querySelector('.products-table-viewport').setAttribute('aria-busy', 'true');
    document.getElementById('productsLoadError').hidden = true;
    try {
      const data = await CCAdmin.apiRequest('public/api/admin/products.php?' + params);
      if (request !== productsRequest) return;
      currentProducts = data.products || [];
      renderProductsTable(currentProducts);
      document.getElementById('productsResultCount').textContent = currentProducts.length + (currentProducts.length === 1 ? ' product' : ' products');
    } catch (error) {
      if (request !== productsRequest) return;
      document.getElementById('productsLoadError').hidden = false;
      document.getElementById('productsResultCount').textContent = 'Products could not be refreshed';
    } finally {
      if (request === productsRequest) productsModule.querySelector('.products-table-viewport').setAttribute('aria-busy', 'false');
    }
  }

  function renderProductsTable(products) {
    if (!products.length) {
      productsBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted-cc">No products match your filters. Try a different search or category.</td></tr>';
      return;
    }
    const value = text => '<span class="product-cell-value" title="' + escapeHtml(text) + '">' + escapeHtml(text) + '</span>';
    productsBody.innerHTML = products.map(p => {
      const id = escapeHtml(String(p.id));
      const active = Number(p.is_active) === 1;
      const archived = p.availability_status === 'archived';
      const stock = Number(p.stock_qty ?? p.stock ?? 0);
      const min = Number(p.min_stock_threshold ?? 10);
      const statusClass = archived || !active ? 'admin-badge-inactive' : stock === 0 ? 'admin-badge-out' : stock <= min ? 'admin-badge-low' : 'admin-badge-active';
      const status = archived ? 'Archived' : !active ? 'Inactive' : stock === 0 ? 'Out of stock' : stock <= min ? 'Low stock' : 'Active';
      const actionButton = (action, label, color = '') => '<button type="button" class="admin-action-link ' + color + '" data-product-action="' + action + '" data-id="' + id + '" aria-haspopup="dialog" aria-label="' + label + ' ' + escapeHtml(p.name) + '">' + label + '</button>';
      const actions = can('can_manage_products') ? '<div class="d-inline-flex gap-2 justify-content-end">' +
        (archived ? '' : actionButton('edit', 'Edit')) +
        actionButton(active ? 'deactivate' : 'activate', active ? 'Deactivate' : 'Activate', active ? 'text-warning' : 'text-success') +
        (archived ? '' : actionButton('archive', 'Archive', 'text-danger')) + '</div>' : '<span class="text-muted-cc">View only</span>';
      return '<tr data-product-id="' + id + '"><td><div class="fw-medium text-light-cc">' + value(p.name) + '</div><div class="text-muted-cc font-monospace small">' + value(p.sku || '') + '</div></td>' +
        '<td>' + value(p.category_name || 'Uncategorized') + '</td><td class="fw-medium">' + CCAdmin.formatPhp(p.price) + '</td><td>' + stock + '</td>' +
        '<td><span class="admin-badge ' + statusClass + '">' + status + '</span></td><td class="text-end">' + actions + '</td></tr>';
    }).join('');
  }

  productsBody.addEventListener('click', event => {
    const button = event.target.closest('[data-product-action]');
    if (!button || !can('can_manage_products')) return;
    if (button.dataset.productAction === 'edit') openEditProductModal(button.dataset.id, button);
    else openProductStatusModal(button.dataset.id, button.dataset.productAction, button);
  });
  document.getElementById('productsRetry').addEventListener('click', loadProducts);
  // Invalidate pending responses immediately, including the search debounce interval.
  const searchProducts = debounce(loadProducts, 250);
  document.getElementById('prodSearchInput').addEventListener('input', () => { productsRequest++; searchProducts(); });
  ['prodCategoryFilter', 'prodAvailabilityFilter', 'prodSortFilter'].forEach(id => {
    document.getElementById(id).addEventListener('change', loadProducts);
  });

  async function readProductImage(input) {
    const file = input.files[0];
    if (!file) throw new Error('A square product image is required.');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Use a JPG, PNG, or WebP image.');
    if (file.size > 5 * 1024 * 1024) throw new Error('Product image must be no larger than 5 MB.');
    const url = URL.createObjectURL(file);
    try {
      const dimensions = await new Promise(resolve => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => resolve(null);
        image.src = url;
      });
      if (!dimensions) throw new Error('Unable to read the selected image. Choose a valid JPG, PNG, or WebP image.');
      if (dimensions.width !== dimensions.height) throw new Error('Product images must be exactly 1:1 square.');
    } finally { URL.revokeObjectURL(url); }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Unable to read the selected image.'));
      reader.readAsDataURL(file);
    });
  }

  async function saveProductAction(modal, buildPayload, successMessage) {
    if (!modal.classList.contains('show') || modal.dataset.saving === 'true' || !can('can_manage_products')) return;
    const error = modal.querySelector('.product-form-error');
    const submit = modal.querySelector('[type="submit"], #confirmProductStatus');
    const label = submit.textContent;
    const controls = [...modal.querySelectorAll('button, input, select, textarea')].map(control => [control, control.disabled]);
    const restore = () => {
      modal.dataset.saving = 'false';
      modal.removeAttribute('aria-busy');
      controls.forEach(([control, disabled]) => { control.disabled = disabled; });
      submit.textContent = label;
    };
    modal.dataset.saving = 'true';
    modal.setAttribute('aria-busy', 'true');
    error.hidden = true;
    controls.forEach(([control]) => { control.disabled = true; });
    submit.textContent = 'Saving…';
    try {
      const payload = await buildPayload();
      await CCAdmin.apiRequest('public/api/admin/products.php', { method: 'POST', body: JSON.stringify(payload) });
    } catch (failure) {
      restore();
      error.textContent = failure.message || 'Unable to save this product. Please try again.';
      error.hidden = false;
      error.scrollIntoView({ block: 'nearest' });
      return;
    }
    restore();
    bootstrap.Modal.getOrCreateInstance(modal).hide();
    if (modal.id === 'modalAddProduct') modal.querySelector('form').reset();
    showProductSnackbar(successMessage);
    // Preserve the dashboard's existing dependent refreshes after a product mutation.
    await Promise.allSettled([loadProducts(), loadInventory(), loadMovements(), loadOverview(), loadReports(currentReportPeriod)]);
  }

  function productFormValues(prefix) {
    const get = suffix => document.getElementById(prefix + suffix).value.trim();
    const name = get('Name');
    if (!name) throw new Error('Product name is required.');
    return { name, category_id: Number(get('Category')), price: Number(get('Price')), min_stock_threshold: Number(get('Threshold') || '10') };
  }

  document.getElementById('formAddProduct').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.closest('.modal').dataset.saving === 'true' || !form.reportValidity()) return;
    saveProductAction(form.closest('.modal'), async () => {
      const values = productFormValues('newProd');
      const sku = document.getElementById('newProdSku').value.trim();
      if (!sku) throw new Error('SKU is required.');
      return { action: 'create', ...values, sku,
        initial_stock: Number(document.getElementById('newProdStock').value || '0'),
        is_active: Number(document.getElementById('newProdStatus').value),
        description: document.getElementById('newProdDescription').value.trim(),
        image: await readProductImage(document.getElementById('newProdImage')) };
    }, 'Product created successfully.');
  });

  function openEditProductModal(productId, trigger) {
    const p = currentProducts.find(item => String(item.id) === String(productId));
    if (!p) return;
    const modal = document.getElementById('modalEditProduct');
    modal.querySelector('form').reset();
    for (const [suffix, val] of Object.entries({ Id: p.id, Name: p.name, Sku: p.sku, Category: p.category_id || 1, Price: p.price, Threshold: p.min_stock_threshold ?? 10, Desc: p.description || '' })) {
      document.getElementById('editProd' + suffix).value = val;
    }
    bootstrap.Modal.getOrCreateInstance(modal).show(trigger);
  }

  document.getElementById('formEditProduct').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.closest('.modal').dataset.saving === 'true' || !form.reportValidity()) return;
    saveProductAction(form.closest('.modal'), async () => ({ action: 'update', ...productFormValues('editProd'),
      product_id: Number(document.getElementById('editProdId').value),
      description: document.getElementById('editProdDesc').value.trim(),
      image: await readProductImage(document.getElementById('editProdImage'))
    }), 'Product updated successfully.');
  });

  function openProductStatusModal(productId, action, trigger) {
    const product = currentProducts.find(item => String(item.id) === String(productId));
    const labels = { activate: 'Activate', deactivate: 'Deactivate', archive: 'Archive' };
    if (!product || !labels[action]) return;
    pendingStatus = { action, product_id: Number(productId) };
    document.getElementById('productStatusTitle').textContent = labels[action] + ' product?';
    const details = {
      activate: 'The listing will be active in the catalog. Purchase availability depends on stock.',
      deactivate: 'The listing will be unavailable to customers. You can activate it again anytime.',
      archive: 'The listing will be unavailable to customers. Its record and stock will be retained; you can activate it again later.'
    };
    document.getElementById('productStatusDescription').textContent = labels[action] + ' “' + product.name + '”? ' + details[action];
    document.getElementById('confirmProductStatus').textContent = labels[action];
    bootstrap.Modal.getOrCreateInstance(statusModal).show(trigger);
  }

  document.getElementById('confirmProductStatus').addEventListener('click', () => {
    if (!pendingStatus) return;
    const payload = { ...pendingStatus };
    const result = { activate: 'activated', deactivate: 'deactivated', archive: 'archived' };
    saveProductAction(statusModal, () => payload, 'Product ' + result[payload.action] + ' successfully.');
  });

  // ==========================================
  // SECTION 20.3: INVENTORY & STOCK
  // ==========================================
  const inventoryModule = document.getElementById('module-inventory');
  const inventoryModals = [...inventoryModule.querySelectorAll('.cc-inventory-modal')];
  const inventoryTriggers = new WeakMap();
  let inventoryRequest = 0;
  let movementRequest = 0;
  let movements = [];
  let pendingMovement = null;
  const confirmedMovementIds = new Set();
  const movementBody = inventoryModule.querySelector('#movementsTableBody');
  const movementReadModal = inventoryModule.querySelector('#movementReadModal');

  // Escape the section's scroll-reveal transform; retain Inventory-only styling.
  inventoryModals.forEach(modal => {
    document.body.appendChild(modal);
    modal.addEventListener('show.bs.modal', () => {
      inventoryTriggers.set(modal, document.activeElement);
      document.body.classList.add('cc-inventory-modal-open');
    });
    modal.addEventListener('shown.bs.modal', () => {
      const target = modal.querySelector('input[type="number"]') || modal.querySelector('.modal-footer [data-bs-dismiss]');
      target?.focus();
    });
    modal.addEventListener('hide.bs.modal', event => {
      if (modal.dataset.saving === 'true') event.preventDefault();
    });
    modal.addEventListener('hidden.bs.modal', () => {
      document.body.classList.remove('cc-inventory-modal-open');
      if (modal === movementReadModal) pendingMovement = null;
      const trigger = inventoryTriggers.get(modal);
      const fallback = inventoryModule.querySelector(modal === movementReadModal ? '.movement-read, #movementSearchInput' : '.btn-restock, .inventory-products-viewport');
      (trigger?.isConnected ? trigger : fallback)?.focus({ preventScroll: true });
    });
  });

  function inventoryError(modal, message = '') {
    const error = modal.querySelector('.inventory-form-error');
    error.textContent = message;
    error.hidden = !message;
  }

  async function saveInventoryAction(modal, payload, message, onSuccess) {
    if (modal.dataset.saving === 'true') return;
    const controls = [...modal.querySelectorAll('button, input')];
    const disabled = controls.map(control => control.disabled);
    const confirm = modal.querySelector('.inventory-confirm');
    const label = confirm.textContent;
    modal.dataset.saving = 'true';
    modal.setAttribute('aria-busy', 'true');
    controls.forEach(control => { control.disabled = true; });
    confirm.textContent = 'Saving…';
    inventoryError(modal);
    let saved = false;
    try {
      await CCAdmin.apiRequest(payload.movement_id ? 'public/api/admin/movements.php' : 'public/api/admin/inventory.php', {
        method: 'POST', body: JSON.stringify(payload)
      });
      saved = true;
      onSuccess?.();
    } catch (error) {
      inventoryError(modal, error.message || 'Unable to save. Please try again.');
    } finally {
      modal.dataset.saving = 'false';
      modal.removeAttribute('aria-busy');
      controls.forEach((control, i) => { control.disabled = disabled[i]; });
      confirm.textContent = label;
    }
    if (saved) {
      bootstrap.Modal.getOrCreateInstance(modal).hide();
      CCAdmin.showToast(message);
      if (!payload.movement_id) await Promise.all([loadInventory(), loadMovements(), loadOverview()]);
    }
  }

  async function loadInventory() {
    const request = ++inventoryRequest;
    try {
      const data = await CCAdmin.apiRequest('public/api/admin/inventory.php');
      if (request !== inventoryRequest) return;
      currentInventory = data.products || [];

      const summary = data.summary || {};
      document.getElementById('invPhysicalStock').textContent = summary.total_physical_stock ?? 0;
      document.getElementById('invAvailableStock').textContent = summary.total_available_stock ?? 0;
      document.getElementById('invLowStock').textContent = summary.low_stock_count ?? 0;
      document.getElementById('invOutStock').textContent = summary.out_of_stock_count ?? 0;

      renderInventoryTable(currentInventory);
    } catch (e) {
      if (request !== inventoryRequest) return;
      inventoryModule.querySelector('#inventoryTableBody').innerHTML = '<tr><td colspan="6" class="text-muted-cc">Unable to load inventory. <button type="button" class="inventory-action cc-underline-link text-accent inventory-retry">Try again</button></td></tr>';
      inventoryModule.querySelector('.inventory-retry').addEventListener('click', loadInventory);
      console.warn('Load inventory error:', e);
    }
  }

  function renderInventoryTable(items) {
    const tbody = document.getElementById('inventoryTableBody');
    tbody.innerHTML = items.map(p => {
      const stock = Number(p.stock_qty ?? p.stock ?? 0);
      const min = Number(p.min_stock_threshold ?? 10);
      const isActive = Number(p.is_active) === 1;

      let stateBadge = '<span class="cc-xs-text text-accent">Above minimum</span>';
      if (stock === 0) {
        stateBadge = '<span class="cc-xs-text text-danger">Out of stock</span>';
      } else if (stock <= min) {
        stateBadge = '<span class="cc-xs-text text-warning">Low stock</span>';
      }

      return `
        <tr>
          <td>
            <div class="fw-medium text-light-cc inventory-product-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
            <div class="cc-xs-text inventory-product-name">${escapeHtml(p.sku || '')}</div>
          </td>
          <td class="text-light-cc fw-medium">${stock}</td>
          <td class="text-muted-cc">${min}</td>
          <td>${stateBadge}</td>
          <td><span class="cc-xs-text ${isActive ? 'text-accent' : 'text-muted-cc'}">${isActive ? 'Active' : 'Inactive'}</span></td>
          <td class="text-end">
            ${can('can_adjust_stock') ? `
              <div class="d-inline-flex gap-2">
                <button type="button" class="inventory-action cc-underline-link text-accent btn-restock" data-id="${p.id}" data-name="${escapeHtml(p.name)}" data-stock="${stock}" aria-haspopup="dialog">Restock</button>
                <span class="text-muted-cc">·</span>
                <button type="button" class="inventory-action cc-underline-link text-accent btn-adjust" data-id="${p.id}" data-name="${escapeHtml(p.name)}" data-stock="${stock}" aria-haspopup="dialog">Adjust</button>
              </div>
            ` : `
              <span class="text-muted-cc" style="font-size: 12px;">View only</span>
            `}
          </td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="6" class="text-muted-cc text-center">No inventory products found.</td></tr>';

    tbody.querySelectorAll('.btn-restock').forEach(b => {
      b.addEventListener('click', () => openRestockModal(b.dataset.id, b.dataset.name, b.dataset.stock));
    });

    tbody.querySelectorAll('.btn-adjust').forEach(b => {
      b.addEventListener('click', () => openAdjustModal(b.dataset.id, b.dataset.name, b.dataset.stock));
    });
  }

  function stockPreview(prefix, type = 'increase') {
    const form = document.getElementById(prefix === 'restock' ? 'formRestock' : 'formAdjustStock');
    const input = document.getElementById(`${prefix}Qty`);
    input.min = type === 'set' ? '0' : '1';
    const quantity = input.valueAsNumber;
    const current = Number(form.dataset.currentStock);
    const next = type === 'set' ? quantity : current + (type === 'decrease' ? -quantity : quantity);
    document.getElementById(`${prefix}Preview`).textContent = Number.isInteger(quantity) && quantity >= Number(input.min)
      ? (next >= 0 ? `Stock after confirmation: ${current} → ${next} units` : 'This adjustment would reduce stock below zero.')
      : 'Enter a whole number of units to preview the stock total.';
    return { quantity, next };
  }

  function openRestockModal(id, name, currentStock) {
    const modal = document.getElementById('modalRestock');
    const form = document.getElementById('formRestock');
    form.reset();
    form.dataset.currentStock = currentStock;
    document.getElementById('restockProdId').value = id;
    document.getElementById('restockProdName').textContent = name;
    document.getElementById('restockCurrentStock').textContent = `Current physical units: ${currentStock}`;
    inventoryError(modal);
    stockPreview('restock');
    bootstrap.Modal.getOrCreateInstance(modal).show();
  }

  document.getElementById('restockQty').addEventListener('input', () => stockPreview('restock'));
  document.getElementById('formRestock').addEventListener('submit', e => {
    e.preventDefault();
    const modal = document.getElementById('modalRestock');
    if (modal.dataset.saving === 'true' || !e.currentTarget.reportValidity()) return;
    const { quantity, next } = stockPreview('restock');
    if (!Number.isSafeInteger(quantity) || quantity < 1 || next > 2147483647) {
      inventoryError(modal, 'Enter a whole quantity that keeps total stock at or below 2147483647.');
      return;
    }
    saveInventoryAction(modal, {
      action: 'restock', product_id: Number(document.getElementById('restockProdId').value), quantity,
      reason: document.getElementById('restockReason').value.trim()
    }, 'Restocked successfully.');
  });

  function openAdjustModal(id, name, currentStock) {
    const modal = document.getElementById('modalAdjustStock');
    const form = document.getElementById('formAdjustStock');
    form.reset();
    form.dataset.currentStock = currentStock;
    document.getElementById('adjustProdId').value = id;
    document.getElementById('adjustProdName').textContent = name;
    document.getElementById('adjustCurrentStock').textContent = `Current physical units: ${currentStock}`;
    inventoryError(modal);
    stockPreview('adjust', 'set');
    bootstrap.Modal.getOrCreateInstance(modal).show();
  }

  const adjustmentForm = document.getElementById('formAdjustStock');
  adjustmentForm.addEventListener('input', () => stockPreview('adjust', adjustmentForm.querySelector('[name="adjustType"]:checked').value));
  adjustmentForm.addEventListener('submit', e => {
    e.preventDefault();
    const modal = document.getElementById('modalAdjustStock');
    if (modal.dataset.saving === 'true' || !adjustmentForm.reportValidity()) return;
    const type = adjustmentForm.querySelector('[name="adjustType"]:checked').value;
    const { quantity, next } = stockPreview('adjust', type);
    const reason = document.getElementById('adjustReason').value.trim();
    if (!Number.isSafeInteger(quantity) || quantity < (type === 'set' ? 0 : 1) || next < 0 || next > 2147483647) {
      inventoryError(modal, 'Enter a whole quantity that keeps total stock between 0 and 2147483647.');
      return;
    }
    if (!reason) {
      inventoryError(modal, 'A reason is required for manual stock adjustments.');
      document.getElementById('adjustReason').focus();
      return;
    }
    saveInventoryAction(modal, {
      action: 'adjust', product_id: Number(document.getElementById('adjustProdId').value), type, quantity, reason
    }, 'Stock adjusted successfully.');
  });

  function renderMovements() {
    const value = text => `<span class="inventory-cell-value" title="${escapeHtml(text)}">${escapeHtml(text)}</span>`;
    movementBody.innerHTML = movements.map(m => {
      const delta = Number(m.quantity_delta ?? 0);
      return `
        <tr>
          <td class="text-muted-cc">${value(m.created_at)}</td>
          <td class="fw-medium text-light-cc">${value(m.product_name || 'Product')}</td>
          <td><span class="inventory-cell-value">
            <span class="text-muted-cc">${escapeHtml(m.previous_quantity ?? '—')}</span>
            <span class="${delta >= 0 ? 'text-accent' : 'text-danger'} fw-medium mx-1">${delta >= 0 ? '+' : ''}${delta}</span>
            <span class="text-light-cc">→ ${escapeHtml(m.new_quantity ?? '—')}</span>
          </span></td>
          <td class="text-light-cc">${value(m.reason || m.notes || 'Standard movement')}</td>
          <td class="text-muted-cc">${value(m.admin_name || 'Admin')}</td>
          <td><button type="button" class="inventory-action movement-read cc-underline-link text-accent" data-movement-id="${escapeHtml(m.id)}" aria-haspopup="dialog">Mark as Read</button></td>
        </tr>`;
    }).join('') || '<tr><td colspan="6" class="text-center text-muted-cc">No unread stock movements found.</td></tr>';
  }

  movementBody.addEventListener('click', event => {
    const button = event.target.closest('.movement-read');
    if (!button) return;
    pendingMovement = movements.find(m => String(m.id) === button.dataset.movementId);
    if (!pendingMovement) return;
    inventoryError(movementReadModal);
    movementReadModal.querySelector('#movementReadSummary').textContent = `${pendingMovement.product_name || 'Product'} · ${pendingMovement.created_at} · ${pendingMovement.reason || pendingMovement.notes || 'Standard movement'}`;
    bootstrap.Modal.getOrCreateInstance(movementReadModal).show();
  });

  document.getElementById('confirmMovementRead').addEventListener('click', () => {
    if (!pendingMovement || movementReadModal.dataset.saving === 'true') return;
    const id = String(pendingMovement.id);
    saveInventoryAction(movementReadModal, { movement_id: Number(id) }, 'Stock movement marked as read.', () => {
      confirmedMovementIds.add(id);
      movements = movements.filter(m => String(m.id) !== id);
      renderMovements();
    });
  });

  async function loadMovements() {
    const request = ++movementRequest;
    const params = new URLSearchParams();
    const search = document.getElementById('movementSearchInput').value;
    const type = document.getElementById('movementTypeFilter').value;
    if (search) params.append('search', search);
    if (type) params.append('movement', type);
    try {
      const data = await CCAdmin.apiRequest(`public/api/admin/movements.php?${params.toString()}`);
      if (request !== movementRequest) return;
      movements = (data.movements || []).filter(m => !confirmedMovementIds.has(String(m.id)));
      renderMovements();
    } catch (error) {
      if (request !== movementRequest) return;
      movementBody.innerHTML = '<tr><td colspan="6" class="text-muted-cc">Unable to load stock movements. <button type="button" class="inventory-action cc-underline-link text-accent movements-retry">Try again</button></td></tr>';
      movementBody.querySelector('.movements-retry').addEventListener('click', loadMovements);
      console.warn('Load movements error:', error);
    }
  }

  document.getElementById('movementSearchInput').addEventListener('input', debounce(loadMovements, 250));
  document.getElementById('movementTypeFilter').addEventListener('change', loadMovements);

  // ==========================================
  // SECTION 20.4: SALES REPORTS & ANALYTICS
  // ==========================================
  async function loadReports(period = currentReportPeriod) {
    try {
      const data = await CCAdmin.apiRequest('public/api/admin/reports.php' + (period ? `?period=${encodeURIComponent(period)}` : ''));
      currentReports = data;
      period = currentReportPeriod = data.period;
      document.querySelectorAll('.report-period-btn').forEach(btn => {
        const active = btn.dataset.period === period;
        btn.classList.toggle('btn-admin-primary', active);
        btn.classList.toggle('active', active);
        btn.classList.toggle('btn-admin-outline', !active);
      });

      // Render Summary Table
      const reportViews = data.report_views || [];
      const summaryTbody = document.getElementById('salesSummaryTableBody');
      summaryTbody.innerHTML = reportViews.length ? reportViews.map(rv => `
        <tr>
          <td class="fw-medium text-light-cc">${escapeHtml(rv.view)}</td>
          <td class="text-muted-cc">${escapeHtml(rv.period)}</td>
          <td class="text-light-cc fw-medium">${CCAdmin.formatPhp(rv.revenue)}</td>
          <td class="text-light-cc">${rv.units}</td>
          <td class="text-muted-cc" style="font-size: 12px;">${escapeHtml(rv.context)}</td>
        </tr>
      `).join('') : '<tr><td colspan="5" class="text-center py-4 text-muted-cc">No sales data for this period.</td></tr>';

      // Render Detailed Product Sales Body
      const detailedProducts = data.detailed_products || [];
      const detailedTbody = document.getElementById('detailedProductSalesBody');
      detailedTbody.innerHTML = detailedProducts.length ? detailedProducts.map(dp => `
        <tr>
          <td>
            <div class="fw-medium text-light-cc">${escapeHtml(dp.name)}</div>
            <div class="text-muted-cc font-monospace" style="font-size: 11px;">${escapeHtml(dp.sku)}</div>
          </td>
          <td class="text-light-cc">${CCAdmin.formatPhp(dp.unit_price)}</td>
          <td class="text-light-cc fw-medium">${dp.sold}</td>
          <td class="text-light-cc fw-medium">${CCAdmin.formatPhp(dp.revenue)}</td>
          <td class="text-accent">${dp.revenue_share}</td>
          <td class="text-muted-cc">${dp.turnover_rate}</td>
        </tr>
      `).join('') : '<tr><td colspan="6" class="text-center py-4 text-muted-cc">No product sales for this period.</td></tr>';

      // Render Reconciliation Table
      const reconciliation = data.reconciliation || [];
      const reconTbody = document.getElementById('reconciliationTableBody');
      reconTbody.innerHTML = reconciliation.length ? reconciliation.map(rc => `
        <tr>
          <td class="fw-medium text-light-cc">${escapeHtml(rc.period)}</td>
          <td class="text-muted-cc">${rc.tops_tees}</td>
          <td class="text-muted-cc">${rc.outerwear_hoodies}</td>
          <td class="text-muted-cc">${rc.bottoms_accessories}</td>
          <td class="text-light-cc fw-medium">${rc.total_units}</td>
          <td class="text-accent fw-medium">${CCAdmin.formatPhp(rc.revenue)}</td>
        </tr>
      `).join('') : '<tr><td colspan="6" class="text-center py-4 text-muted-cc">No reconciled movements for this period.</td></tr>';

      const exportBtn = document.getElementById('exportCsvBtn');
      if (exportBtn) {
        exportBtn.href = `public/api/admin/reports.php?format=csv&period=${encodeURIComponent(period)}`;
      }

    } catch (e) {
      console.warn('Load reports error:', e);
    }
  }

  document.querySelectorAll('.report-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.report-period-btn').forEach(b => {
        b.classList.remove('btn-admin-primary', 'active');
        b.classList.add('btn-admin-outline');
      });
      btn.classList.remove('btn-admin-outline');
      btn.classList.add('btn-admin-primary', 'active');
      currentReportPeriod = btn.dataset.period;
      loadReports(currentReportPeriod);
    });
  });

  // ==========================================
  // SECTION 20.5: CUSTOMER REVIEWS
  // ==========================================
  async function loadReviews() {
    const search = document.getElementById('reviewSearchInput').value;
    const rating = document.getElementById('reviewRatingFilter').value;
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (rating) params.append('rating', rating);

    try {
      const data = await CCAdmin.apiRequest(`public/api/admin/reviews.php?${params.toString()}`);
      if (data.summary) {
        document.getElementById('revHighestRated').textContent = data.summary.highest_rated || '—';
        document.getElementById('revLowestRated').textContent = data.summary.lowest_rated || '—';
        document.getElementById('revTeeRating').textContent = data.summary.tee_rating || 'No reviews yet';
        document.getElementById('revHighestProduct').textContent = data.summary.highest_product || 'No reviews yet';
        document.getElementById('revLowestProduct').textContent = data.summary.lowest_product || 'No reviews yet';
        document.getElementById('revTeeProduct').textContent = data.summary.tee_product || 'No reviews yet';
      }

      const tbody = document.getElementById('reviewsTableBody');
      const items = data.reviews || [];

      if (!items.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted-cc">No reviews match your filters.</td></tr>`;
        return;
      }

      tbody.innerHTML = items.map(r => `
        <tr>
          <td class="fw-medium text-light-cc">${escapeHtml(r.author_name || 'Customer')}</td>
          <td class="text-muted-cc">${escapeHtml(r.product_name || 'Product')}</td>
          <td><span class="text-accent">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span> <small class="text-muted-cc">(${r.rating}/5)</small></td>
          <td>
            <div class="text-light-cc" style="font-size: 13px;">${escapeHtml(r.comment || '')}</div>
            ${r.business_reply ? `
              <div class="admin-callout mt-2 py-1 px-2" style="font-size: 11px;">
                <span class="text-accent fw-medium">Business response:</span> ${escapeHtml(r.business_reply)}
              </div>
            ` : ''}
            ${r.is_flagged ? `
              <div class="badge admin-badge-out mt-1">Flagged: ${escapeHtml(r.flag_reason || 'Under review')}</div>
            ` : ''}
          </td>
          <td class="text-muted-cc" style="font-size: 12px;">${escapeHtml(r.created_at)}</td>
          <td class="text-end">
            ${can('can_reply_reviews') ? `
              <div class="d-inline-flex gap-2">
                <a href="javascript:void(0)" class="admin-action-link btn-reply-rev" 
                  data-id="${r.id}" 
                  data-author="${escapeHtml(r.author_name || 'Customer')}"
                  data-rating="${r.rating}"
                  data-comment="${escapeHtml(r.comment || '')}">Reply</a>
                <span class="text-muted-cc">·</span>
                <a href="javascript:void(0)" class="admin-action-link text-warning btn-flag-rev" data-id="${r.id}">Flag</a>
              </div>
            ` : `
              <span class="text-muted-cc" style="font-size: 12px;">View only</span>
            `}
          </td>
        </tr>
      `).join('');

      tbody.querySelectorAll('.btn-reply-rev').forEach(btn => {
        btn.addEventListener('click', () => {
          document.getElementById('replyReviewId').value = btn.dataset.id;
          document.getElementById('replyCustomerName').textContent = btn.dataset.author;
          document.getElementById('replyProductRating').textContent = `${btn.dataset.rating} / 5 ★`;
          document.getElementById('replyCustomerComment').textContent = `"${btn.dataset.comment}"`;
          document.getElementById('replyText').value = '';
          new bootstrap.Modal(document.getElementById('modalReplyReview')).show();
        });
      });

      tbody.querySelectorAll('.btn-flag-rev').forEach(btn => {
        btn.addEventListener('click', () => {
          document.getElementById('flagReviewId').value = btn.dataset.id;
          new bootstrap.Modal(document.getElementById('modalFlagReview')).show();
        });
      });

    } catch (e) {
      console.warn('Load reviews error:', e);
    }
  }

  document.getElementById('reviewSearchInput').addEventListener('input', debounce(loadReviews, 250));
  document.getElementById('reviewRatingFilter').addEventListener('change', loadReviews);

  // Reply Review Submission
  document.getElementById('formReplyReview').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('replyReviewId').value;
    const replyText = document.getElementById('replyText').value;

    try {
      await CCAdmin.apiRequest('public/api/admin/reviews.php', {
        method: 'POST',
        body: JSON.stringify({
          action: 'reply',
          review_id: parseInt(id, 10),
          reply_text: replyText
        })
      });
      bootstrap.Modal.getInstance(document.getElementById('modalReplyReview')).hide();
      CCAdmin.showToast('Reply published successfully.');
      await loadReviews();
      await loadOverview();
    } catch (err) {
      CCAdmin.showToast(err.message, 'error');
    }
  });

  // Flag Review Submission
  document.getElementById('formFlagReview').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('flagReviewId').value;
    const reason = document.getElementById('flagReason').value;

    try {
      await CCAdmin.apiRequest('public/api/admin/reviews.php', {
        method: 'POST',
        body: JSON.stringify({
          action: 'flag',
          review_id: parseInt(id, 10),
          reason
        })
      });
      bootstrap.Modal.getInstance(document.getElementById('modalFlagReview')).hide();
      CCAdmin.showToast('Review submitted for moderation review.');
      await loadReviews();
    } catch (err) {
      CCAdmin.showToast(err.message, 'error');
    }
  });

  // ==========================================
  // SECTION 20.6: BUSINESS NOTIFICATIONS
  // ==========================================
  const notificationsModule = document.getElementById('module-notifications');
  const notificationsBody = notificationsModule.querySelector('#notificationsTableBody');
  const notificationReadModal = notificationsModule.querySelector('#notificationReadModal');
  const confirmNotificationRead = notificationReadModal.querySelector('#confirmNotificationRead');
  const cancelNotificationRead = notificationReadModal.querySelector('#cancelNotificationRead');
  const notificationReadError = notificationReadModal.querySelector('#notificationReadError');
  let notificationItems = [];
  let notificationsRequest = 0;
  let pendingNotificationAction = null;
  let notificationReadTrigger = null;

  // Escape the section's scroll-reveal transform so the overlay matches account sign-out.
  document.body.appendChild(notificationReadModal);
  notificationReadModal.addEventListener('show.bs.modal', () => document.body.classList.add('cc-notification-read-modal-open'));
  notificationReadModal.addEventListener('shown.bs.modal', () => cancelNotificationRead.focus());
  notificationReadModal.addEventListener('hide.bs.modal', event => {
    if (confirmNotificationRead.disabled) event.preventDefault();
  });
  notificationReadModal.addEventListener('hidden.bs.modal', () => {
    document.body.classList.remove('cc-notification-read-modal-open');
    pendingNotificationAction = null;
    const target = notificationReadTrigger?.isConnected ? notificationReadTrigger : notificationsModule.querySelector('.btn-read-notif, #notifStatusFilter');
    target?.focus({ preventScroll: true });
  });

  function requestNotificationRead(trigger, notification = null) {
    if (!can('can_view_notifications') || notificationReadModal.classList.contains('show')) return;
    notificationReadTrigger = trigger;
    pendingNotificationAction = notification
      ? { action: 'mark_read', notification_id: Number(notification.id) }
      : { action: 'mark_all_read' };
    notificationReadModal.querySelector('#notificationReadTitle').textContent = notification ? 'Mark as read?' : 'Mark all as read?';
    notificationReadModal.querySelector('#notificationReadDescription').textContent = notification
      ? 'Mark this notification as read? It will no longer appear when filtering by unread notifications.'
      : 'This will mark all notifications for your business as read, including those hidden by the current filters. They will remain available under All or Read only.';
    const summary = notificationReadModal.querySelector('#notificationReadSummary');
    summary.hidden = !notification;
    summary.textContent = notification ? `${notification.title}\n${notification.message}` : '';
    notificationReadError.hidden = true;
    confirmNotificationRead.textContent = notification ? 'Mark as Read' : 'Mark All as Read';
    bootstrap.Modal.getOrCreateInstance(notificationReadModal).show();
  }

  notificationsBody.addEventListener('click', event => {
    const button = event.target.closest('.btn-read-notif');
    if (!button) return;
    const notification = notificationItems.find(item => String(item.id) === button.dataset.id);
    if (notification && Number(notification.is_read) !== 1) requestNotificationRead(button, notification);
  });

  confirmNotificationRead.addEventListener('click', async () => {
    if (!pendingNotificationAction || confirmNotificationRead.disabled || !can('can_view_notifications')) return;
    const payload = { ...pendingNotificationAction };
    const label = confirmNotificationRead.textContent;
    confirmNotificationRead.disabled = cancelNotificationRead.disabled = true;
    confirmNotificationRead.textContent = 'Saving...';
    notificationReadModal.setAttribute('aria-busy', 'true');
    notificationReadError.hidden = true;
    let saved = false;
    try {
      const result = await CCAdmin.apiRequest('public/api/admin/notifications.php', {
        method: 'POST', body: JSON.stringify(payload)
      });
      if (result.success === false) throw new Error('Unable to mark notifications as read. Please try again.');
      saved = true;
    } catch (error) {
      notificationReadError.textContent = error.message || 'Unable to mark notifications as read. Please try again.';
      notificationReadError.hidden = false;
    } finally {
      confirmNotificationRead.disabled = cancelNotificationRead.disabled = false;
      confirmNotificationRead.textContent = label;
      notificationReadModal.removeAttribute('aria-busy');
    }
    if (!saved) return;
    pendingNotificationAction = null;
    bootstrap.Modal.getOrCreateInstance(notificationReadModal).hide();
    CCAdmin.showToast(payload.action === 'mark_all_read' ? 'All notifications marked as read.' : 'Notification marked as read.');
    await loadNotifications();
    await loadOverview();
  });

  async function loadNotifications() {
    // Initial hydration starts before the module's controls and state are bound.
    await Promise.resolve();
    const requestId = ++notificationsRequest;
    const status = document.getElementById('notifStatusFilter').value;
    const type = document.getElementById('notifTypeFilter').value;
    const params = new URLSearchParams();
    if (status) params.append('read_status', status);
    if (type) params.append('type', type);

    try {
      const data = await CCAdmin.apiRequest(`public/api/admin/notifications.php?${params.toString()}`);
      if (requestId !== notificationsRequest) return;
      const tbody = notificationsBody;
      const items = data.notifications || [];
      notificationItems = items;

      if (!items.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted-cc">No notifications found.</td></tr>`;
        return;
      }

      tbody.innerHTML = items.map(n => {
        const isRead = Number(n.is_read) === 1;
        return `
          <tr class="${isRead ? 'notification-read' : 'notification-unread'}">
            <td>
              <span class="badge ${isRead ? 'admin-badge-inactive' : 'admin-badge-unread'}">
                ${isRead ? 'Read' : 'Unread'}
              </span>
            </td>
            <td>
              <div class="notification-title fw-medium text-light-cc" title="${escapeHtml(n.title)}">${escapeHtml(n.title)}</div>
              <div class="notification-title notification-type text-muted-cc">${escapeHtml(String(n.type || '').replace(/_/g, ' '))}</div>
            </td>
            <td class="text-light-cc"><span class="notification-value" title="${escapeHtml(n.message)}">${escapeHtml(n.message)}</span></td>
            <td><span class="notification-value notification-time text-muted-cc">${escapeHtml(n.created_at)}</span></td>
            <td class="text-end">
              ${!can('can_view_notifications') ? `
                <span class="text-muted-cc" style="font-size: 12px;">View only</span>
              ` : (!isRead ? `
                <button type="button" class="btn-read-notif cc-underline-link text-accent" data-id="${escapeHtml(n.id)}" aria-haspopup="dialog" aria-label="Mark as read: ${escapeHtml(n.title)}">Mark as Read</button>
              ` : `
                <span class="text-muted-cc" style="font-size: 12px;">Archived</span>
              `)}
            </td>
          </tr>
        `;
      }).join('');

    } catch (e) {
      console.warn('Load notifications error:', e);
    }
  }

  ['notifStatusFilter', 'notifTypeFilter'].forEach(id => {
    document.getElementById(id).addEventListener('change', loadNotifications);
  });

  document.getElementById('markAllNotifsBtn').addEventListener('click', event => {
    requestNotificationRead(event.currentTarget);
  });

  // ==========================================
  // SECTION 20.7: BUSINESS STAFF
  // ==========================================
  async function loadStaff() {
    const search = document.getElementById('staffSearchInput').value;
    const params = new URLSearchParams();
    if (search) params.append('search', search);

    try {
      const data = await CCAdmin.apiRequest(`public/api/admin/staff.php?${params.toString()}`);
      const tbody = document.getElementById('staffTableBody');
      const items = data.staff || [];

      tbody.innerHTML = items.map(s => {
        const isOwner = s.role_title === 'Business owner';
        const isActive = s.status === 'active';

        return `
          <tr>
            <td class="fw-medium text-light-cc">${escapeHtml(s.name)}</td>
            <td>
              <div class="text-light-cc" style="font-size: 12px;">${escapeHtml(s.email)}</div>
              <div class="text-muted-cc" style="font-size: 11px;">Joined ${escapeHtml(s.joined_date || 'Oct 2026')}</div>
            </td>
            <td class="text-light-cc">${escapeHtml(s.role_title)}</td>
            <td class="text-muted-cc" style="font-size: 12px;">${escapeHtml(s.permission_set)}</td>
            <td>
              <span class="badge ${isActive ? 'admin-badge-active' : 'admin-badge-inactive'}">
                ${isActive ? 'Active' : 'Inactive'}
              </span>
            </td>
            <td class="text-end">
              ${isOwner ? `
                <span class="text-muted-cc" style="font-size: 12px;">Owner (Protected)</span>
              ` : (can('can_manage_staff') ? `
                <a href="javascript:void(0)" class="admin-action-link ${isActive ? 'text-warning' : 'text-success'} btn-toggle-staff"
                  data-id="${s.id}" data-action="${isActive ? 'deactivate' : 'activate'}">
                  ${isActive ? 'Deactivate' : 'Activate'}
                </a>
              ` : `
                <span class="text-muted-cc" style="font-size: 12px;">View only</span>
              `)}
            </td>
          </tr>
        `;
      }).join('');

      tbody.querySelectorAll('.btn-toggle-staff').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm(`Are you sure you want to ${btn.dataset.action} this staff member?`)) return;
          try {
            await CCAdmin.apiRequest('public/api/admin/staff.php', {
              method: 'POST',
              body: JSON.stringify({
                action: btn.dataset.action,
                staff_id: parseInt(btn.dataset.id, 10)
              })
            });
            CCAdmin.showToast(`Staff member ${btn.dataset.action}d.`);
            await loadStaff();
            await loadActivityLogs();
          } catch (err) {
            CCAdmin.showToast(err.message, 'error');
          }
        });
      });

    } catch (e) {
      console.warn('Load staff error:', e);
    }
  }

  document.getElementById('staffSearchInput').addEventListener('input', debounce(loadStaff, 250));

  // Keep the custom permission toggles aligned with the chosen preset.
  const staffPresetSelect = document.getElementById('newStaffPreset');
  function applyStaffPreset() {
    if (!staffPresetSelect) return;
    const preset = staffPresetSelect.value;
    const set = (id, checked) => {
      const el = document.getElementById(id);
      if (el) el.checked = checked;
    };
    if (preset === 'Inventory manager') {
      set('permManageProducts', true);
      set('permAdjustStock', true);
      set('permViewReports', false);
      set('permReplyReviews', false);
    } else if (preset === 'Review & reports staff') {
      set('permManageProducts', false);
      set('permAdjustStock', false);
      set('permViewReports', true);
      set('permReplyReviews', true);
    } else {
      set('permManageProducts', false);
      set('permAdjustStock', false);
      set('permViewReports', false);
      set('permReplyReviews', false);
    }
  }
  if (staffPresetSelect) {
    staffPresetSelect.addEventListener('change', applyStaffPreset);
    applyStaffPreset();
  }

  // Invite Staff Form
  document.getElementById('formInviteStaff').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      action: 'invite',
      name: document.getElementById('newStaffName').value,
      email: document.getElementById('newStaffEmail').value,
      role_title: document.getElementById('newStaffRoleTitle').value,
      permission_set: document.getElementById('newStaffPreset').value,
      can_manage_products: document.getElementById('permManageProducts').checked ? 1 : 0,
      can_adjust_stock: document.getElementById('permAdjustStock').checked ? 1 : 0,
      can_view_reports: document.getElementById('permViewReports').checked ? 1 : 0,
      can_reply_reviews: document.getElementById('permReplyReviews').checked ? 1 : 0,
    };

    try {
      await CCAdmin.apiRequest('public/api/admin/staff.php', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      bootstrap.Modal.getInstance(document.getElementById('modalInviteStaff')).hide();
      document.getElementById('formInviteStaff').reset();
      applyStaffPreset();
      CCAdmin.showToast('Staff member invited successfully.');
      await loadStaff();
      await loadActivityLogs();
    } catch (err) {
      CCAdmin.showToast(err.message, 'error');
    }
  });

  // ==========================================
  // SECTION 20.8: ACTIVITY LOGS
  // ==========================================
  const logsModule = document.getElementById('module-logs');
  const logsBody = logsModule.querySelector('#activityLogsTableBody');
  const logReadModal = logsModule.querySelector('#activityLogReadModal');
  const confirmLogRead = logReadModal.querySelector('#confirmActivityLogRead');
  const cancelLogRead = logReadModal.querySelector('#cancelActivityLogRead');
  const logReadError = logReadModal.querySelector('#activityLogReadError');
  let activityLogs = [];
  let logsRequest = 0;
  let pendingLog = null;
  let logReadTrigger = null;
  const confirmedLogIds = new Set();

  // Keep the modal outside the section's scroll-reveal transform and background blur.
  document.body.appendChild(logReadModal);
  logReadModal.addEventListener('show.bs.modal', () => document.body.classList.add('cc-log-read-modal-open'));
  logReadModal.addEventListener('shown.bs.modal', () => cancelLogRead.focus());
  logReadModal.addEventListener('hide.bs.modal', event => {
    if (confirmLogRead.disabled) event.preventDefault();
  });
  logReadModal.addEventListener('hidden.bs.modal', () => {
    document.body.classList.remove('cc-log-read-modal-open');
    pendingLog = null;
    const focusTarget = logReadTrigger?.isConnected ? logReadTrigger : logsModule.querySelector('.activity-log-read, #logSearchInput');
    focusTarget?.focus({ preventScroll: true });
  });

  logsBody.addEventListener('click', event => {
    const button = event.target.closest('.activity-log-read');
    if (!button) return;
    pendingLog = activityLogs.find(log => String(log.id) === button.dataset.logId);
    if (!pendingLog) return;
    logReadTrigger = button;
    logReadError.hidden = true;
    logReadModal.querySelector('#activityLogReadSummary').textContent = `${pendingLog.action} · ${pendingLog.affected_resource} · ${pendingLog.created_at}`;
    bootstrap.Modal.getOrCreateInstance(logReadModal).show();
  });

  confirmLogRead.addEventListener('click', async () => {
    if (!pendingLog || confirmLogRead.disabled) return;
    const logId = String(pendingLog.id);
    confirmLogRead.disabled = cancelLogRead.disabled = true;
    confirmLogRead.textContent = 'Saving…';
    logReadError.hidden = true;
    try {
      await CCAdmin.apiRequest('public/api/admin/activity-logs.php', {
        method: 'POST', body: JSON.stringify({ log_id: logId })
      });
      confirmedLogIds.add(logId);
      activityLogs = activityLogs.filter(log => String(log.id) !== logId);
      renderActivityLogs();
      confirmLogRead.disabled = cancelLogRead.disabled = false;
      bootstrap.Modal.getOrCreateInstance(logReadModal).hide();
      CCAdmin.showToast('Activity marked as read.');
    } catch (error) {
      logReadError.textContent = error.message || 'Unable to mark this activity as read. Please try again.';
      logReadError.hidden = false;
    } finally {
      confirmLogRead.disabled = cancelLogRead.disabled = false;
      confirmLogRead.textContent = 'Mark as Read';
    }
  });

  function renderActivityLogs() {
    if (!activityLogs.length) {
      logsBody.innerHTML = '<tr><td colspan="7" class="text-center text-muted-cc">No unread activity logs found.</td></tr>';
      return;
    }
    const value = text => `<span class="activity-log-value" title="${escapeHtml(text)}">${escapeHtml(text)}</span>`;
    logsBody.innerHTML = activityLogs.map(log => `
      <tr>
        <td class="text-muted-cc" style="font-size: 12px;">${value(log.created_at)}</td>
        <td class="fw-medium text-light-cc">${value(log.responsible_person || 'Administrator')}</td>
        <td class="text-muted-cc" style="font-size: 12px;">${value(log.role || 'Business Admin')}</td>
        <td class="text-light-cc fw-medium">${value(log.action)}</td>
        <td class="text-light-cc">${value(log.affected_resource)}</td>
        <td class="text-muted-cc" style="font-size: 12px;">${value(log.change_details || '—')}</td>
        <td><button type="button" class="activity-log-read cc-underline-link text-accent" data-log-id="${escapeHtml(log.id)}" aria-haspopup="dialog">Mark as Read</button></td>
      </tr>
    `).join('');
  }

  async function loadActivityLogs() {
    const requestId = ++logsRequest;
    const search = document.getElementById('logSearchInput').value;
    const action = document.getElementById('logActionFilter').value;
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (action) params.append('activity', action);

    try {
      const data = await CCAdmin.apiRequest(`public/api/admin/activity-logs.php?${params.toString()}`);
      if (requestId !== logsRequest) return;
      activityLogs = (data.logs || []).filter(log => !confirmedLogIds.has(String(log.id)));
      renderActivityLogs();
    } catch (e) {
      console.warn('Load activity logs error:', e);
    }
  }

  document.getElementById('logSearchInput').addEventListener('input', debounce(loadActivityLogs, 250));
  document.getElementById('logActionFilter').addEventListener('change', loadActivityLogs);

  // ==========================================
  // SECTION 20.9: ACCOUNT & BUSINESS SETTINGS
  // ==========================================
  async function loadBusinessProfile() {
    try {
      const data = await CCAdmin.apiRequest('public/api/admin/account.php');
      const biz = data.business || {};
      const adm = data.admin || {};

      document.getElementById('bizName').value = biz.name || '';
      document.getElementById('bizEmail').value = biz.email || '';
      document.getElementById('bizPhone').value = biz.phone || '';
      document.getElementById('bizLocation').value = biz.location || '';
      document.getElementById('bizAddress').value = biz.address || '';
      document.getElementById('bizDescription').value = biz.description || '';

      document.getElementById('adminFirstName').value = adm.first_name || '';
      document.getElementById('adminLastName').value = adm.last_name || '';
      document.getElementById('adminEmail').value = adm.email || '';
      document.getElementById('adminMobile').value = adm.mobile || '';

      const heroBusiness = document.getElementById('heroBusinessName');
      if (heroBusiness && biz.name) {
        heroBusiness.textContent = biz.name;
      }
    } catch (e) {
      console.warn('Load business profile error:', e);
    }
  }

  // Update Business Profile Form
  document.getElementById('businessProfileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      action: 'update_business',
      business: {
        name: document.getElementById('bizName').value,
        email: document.getElementById('bizEmail').value,
        phone: document.getElementById('bizPhone').value,
        location: document.getElementById('bizLocation').value,
        address: document.getElementById('bizAddress').value,
        description: document.getElementById('bizDescription').value,
      }
    };

    try {
      await CCAdmin.apiRequest('public/api/admin/account.php', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      CCAdmin.showToast('Business profile updated successfully.');
      const heroBusiness = document.getElementById('heroBusinessName');
      if (heroBusiness) heroBusiness.textContent = payload.business.name;
      const scopeEl = document.getElementById('securityBusinessScope');
      if (scopeEl) {
        const businessId = CCAdmin.getContext()?.business?.id;
        scopeEl.textContent = `This account has permissions strictly limited to ${payload.business.name}${businessId ? ` (Business ID ${businessId})` : ''}. Global platform controls are disabled.`;
      }
      await loadActivityLogs();
      await loadOverview();
    } catch (err) {
      CCAdmin.showToast(err.message, 'error');
    }
  });

  // Update Admin Profile Form
  document.getElementById('adminPersonalForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      action: 'update_admin_profile',
      admin: {
        first_name: document.getElementById('adminFirstName').value,
        last_name: document.getElementById('adminLastName').value,
        mobile: document.getElementById('adminMobile').value,
      }
    };

    try {
      await CCAdmin.apiRequest('public/api/admin/account.php', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      CCAdmin.showToast('Personal administrator profile updated.');
      const fullName = `${payload.admin.first_name} ${payload.admin.last_name}`.trim();
      document.getElementById('adminUserName').textContent = fullName;
      document.getElementById('adminUserInitials').textContent =
        ((payload.admin.first_name || 'A')[0] + (payload.admin.last_name || 'D')[0]).toUpperCase();
      await loadActivityLogs();
    } catch (err) {
      CCAdmin.showToast(err.message, 'error');
    }
  });

  // Change Password Form
  document.getElementById('adminPasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const current = document.getElementById('currentPassword').value;
    const newPwd = document.getElementById('newPassword').value;
    const confirmPwd = document.getElementById('confirmNewPassword').value;

    if (newPwd !== confirmPwd) {
      CCAdmin.showToast('New passwords do not match.', 'error');
      return;
    }

    try {
      await CCAdmin.apiRequest('public/api/admin/account.php', {
        method: 'POST',
        body: JSON.stringify({
          action: 'update_password',
          current_password: current,
          new_password: newPwd
        })
      });
      document.getElementById('adminPasswordForm').reset();
      CCAdmin.showToast('Password changed successfully.');
      await loadActivityLogs();
    } catch (err) {
      CCAdmin.showToast(err.message, 'error');
    }
  });

  // Utility helpers
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDashboard);
} else {
  initDashboard();
}
