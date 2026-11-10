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
      loadProducts(),
      loadInventory(),
      loadMovements(),
      loadReports(),
      loadReviews(),
      loadNotifications(),
      loadStaff(),
      loadActivityLogs(),
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
  async function loadProducts() {
    const search = document.getElementById('prodSearchInput').value;
    const category = document.getElementById('prodCategoryFilter').value;
    const availability = document.getElementById('prodAvailabilityFilter').value;
    const sort = document.getElementById('prodSortFilter').value;

    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (category) params.append('category', category);
    if (availability) params.append('availability', availability);
    if (sort) params.append('sort', sort);

    try {
      const data = await CCAdmin.apiRequest(`public/api/admin/products.php?${params.toString()}`);
      currentProducts = data.products || [];
      renderProductsTable(currentProducts);
    } catch (e) {
      console.warn('Load products error:', e);
    }
  }

  function renderProductsTable(products) {
    const tbody = document.getElementById('productsTableBody');
    if (!products.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted-cc">No products match your filter criteria.</td></tr>`;
      return;
    }

    tbody.innerHTML = products.map(p => {
      const isActive = Number(p.is_active) === 1;
      const stock = Number(p.stock_qty ?? p.stock ?? 0);
      const min = Number(p.min_stock_threshold ?? 10);
      let statusClass = 'admin-badge-active';
      if (!isActive) {
        statusClass = 'admin-badge-inactive';
      } else if (stock === 0) {
        statusClass = 'admin-badge-out';
      } else if (stock <= min) {
        statusClass = 'admin-badge-low';
      }
      const statusLabel = p.stock_status || (isActive ? 'Active · Available' : 'Inactive · Unavailable');

      return `
        <tr>
          <td>
            <div class="fw-medium text-light-cc">${escapeHtml(p.name)}</div>
            <div class="text-muted-cc font-monospace" style="font-size: 11px;">${escapeHtml(p.sku || '')}</div>
          </td>
          <td class="text-light-cc">${escapeHtml(p.category_name || 'Tops & tees')}</td>
          <td class="text-light-cc fw-medium">${CCAdmin.formatPhp(p.price)}</td>
          <td class="text-light-cc">${p.stock_qty ?? p.stock ?? 0}</td>
          <td><span class="badge ${statusClass}">${statusLabel}</span></td>
          <td class="text-end">
            ${can('can_manage_products') ? `
              <div class="d-inline-flex flex-wrap gap-2 justify-content-end">
                <a href="javascript:void(0)" class="admin-action-link btn-edit-prod" data-id="${p.id}">Edit</a>
                ${isActive ? `
                  <a href="javascript:void(0)" class="admin-action-link text-warning btn-toggle-prod" data-id="${p.id}" data-action="deactivate">Deactivate</a>
                ` : `
                  <a href="javascript:void(0)" class="admin-action-link text-success btn-toggle-prod" data-id="${p.id}" data-action="activate">Activate</a>
                `}
                <a href="javascript:void(0)" class="admin-action-link text-danger btn-toggle-prod" data-id="${p.id}" data-action="archive">Archive</a>
              </div>
            ` : `
              <span class="text-muted-cc" style="font-size: 12px;">View only</span>
            `}
          </td>
        </tr>
      `;
    }).join('');

    // Attach row events
    tbody.querySelectorAll('.btn-edit-prod').forEach(btn => {
      btn.addEventListener('click', () => openEditProductModal(btn.dataset.id));
    });

    tbody.querySelectorAll('.btn-toggle-prod').forEach(btn => {
      btn.addEventListener('click', () => handleProductStatusChange(btn.dataset.id, btn.dataset.action));
    });
  }

  // Filter triggers
  document.getElementById('prodSearchInput').addEventListener('input', debounce(loadProducts, 250));
  ['prodCategoryFilter', 'prodAvailabilityFilter', 'prodSortFilter'].forEach(id => {
    document.getElementById(id).addEventListener('change', loadProducts);
  });

  async function readProductImage(input) {
    const file = input.files[0];
    if (!file) {
      CCAdmin.showToast('A square product image is required.', 'error');
      return null;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      CCAdmin.showToast('Use a JPG, PNG, or WebP image.', 'error');
      return null;
    }
    const dimensions = await new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => resolve(null);
      image.src = URL.createObjectURL(file);
    });
    if (!dimensions || dimensions.width !== dimensions.height) {
      CCAdmin.showToast('Product images must be exactly 1:1 square.', 'error');
      return null;
    }
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => {
        CCAdmin.showToast('Unable to read the selected image.', 'error');
        resolve(null);
      };
      reader.readAsDataURL(file);
    });
  }

  // Modal: Create Product Form
  document.getElementById('formAddProduct').addEventListener('submit', async (e) => {
    e.preventDefault();
    const image = await readProductImage(document.getElementById('newProdImage'));
    if (!image) return;
    const payload = {
      action: 'create',
      name: document.getElementById('newProdName').value,
      sku: document.getElementById('newProdSku').value,
      category_id: parseInt(document.getElementById('newProdCategory').value, 10) || 1,
      price: parseFloat(document.getElementById('newProdPrice').value),
      initial_stock: parseInt(document.getElementById('newProdStock').value || '0', 10),
      min_stock_threshold: parseInt(document.getElementById('newProdThreshold').value || '10', 10),
      is_active: parseInt(document.getElementById('newProdStatus').value || '1', 10),
      description: document.getElementById('newProdDescription').value,
      image
    };

    try {
      await CCAdmin.apiRequest('public/api/admin/products.php', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      bootstrap.Modal.getInstance(document.getElementById('modalAddProduct')).hide();
      document.getElementById('formAddProduct').reset();
      CCAdmin.showToast('Product created successfully.');
      await loadProducts();
      await loadInventory();
      await loadMovements();
      await loadOverview();
      await loadReports(currentReportPeriod);
    } catch (err) {
      CCAdmin.showToast(err.message, 'error');
    }
  });

  // Open Edit Product Modal
  function openEditProductModal(productId) {
    const p = currentProducts.find(item => String(item.id) === String(productId));
    if (!p) return;

    document.getElementById('editProdId').value = p.id;
    document.getElementById('editProdName').value = p.name;
    document.getElementById('editProdSku').value = p.sku;
    document.getElementById('editProdCategory').value = p.category_id || 1;
    document.getElementById('editProdPrice').value = p.price;
    document.getElementById('editProdThreshold').value = p.min_stock_threshold || 10;
    document.getElementById('editProdDesc').value = p.description || '';
    document.getElementById('editProdImage').value = '';

    const modal = new bootstrap.Modal(document.getElementById('modalEditProduct'));
    modal.show();
  }

  // Modal: Save Edit Product
  document.getElementById('formEditProduct').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('editProdId').value;
    const image = await readProductImage(document.getElementById('editProdImage'));
    if (!image) return;
    const payload = {
      action: 'update',
      product_id: parseInt(id, 10),
      name: document.getElementById('editProdName').value,
      category_id: parseInt(document.getElementById('editProdCategory').value, 10) || 1,
      price: parseFloat(document.getElementById('editProdPrice').value),
      min_stock_threshold: parseInt(document.getElementById('editProdThreshold').value, 10),
      description: document.getElementById('editProdDesc').value,
      image
    };

    try {
      await CCAdmin.apiRequest('public/api/admin/products.php', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      bootstrap.Modal.getInstance(document.getElementById('modalEditProduct')).hide();
      CCAdmin.showToast('Product updated successfully.');
      await loadProducts();
      await loadInventory();
      await loadOverview();
      await loadReports(currentReportPeriod);
    } catch (err) {
      CCAdmin.showToast(err.message, 'error');
    }
  });

  async function handleProductStatusChange(productId, action) {
    if (!confirm(`Are you sure you want to ${action} this product?`)) return;
    try {
      await CCAdmin.apiRequest('public/api/admin/products.php', {
        method: 'POST',
        body: JSON.stringify({ action, product_id: parseInt(productId, 10) })
      });
      CCAdmin.showToast(`Product ${action}d successfully.`);
      await loadProducts();
      await loadInventory();
      await loadMovements();
      await loadOverview();
      await loadReports(currentReportPeriod);
    } catch (err) {
      CCAdmin.showToast(err.message, 'error');
    }
  }

  // ==========================================
  // SECTION 20.3: INVENTORY & STOCK
  // ==========================================
  async function loadInventory() {
    try {
      const data = await CCAdmin.apiRequest('public/api/admin/inventory.php');
      currentInventory = data.products || [];

      const summary = data.summary || {};
      document.getElementById('invPhysicalStock').textContent = summary.total_physical_stock ?? 0;
      document.getElementById('invAvailableStock').textContent = summary.total_available_stock ?? 0;
      document.getElementById('invLowStock').textContent = summary.low_stock_count ?? 0;
      document.getElementById('invOutStock').textContent = summary.out_of_stock_count ?? 0;

      renderInventoryTable(currentInventory);
    } catch (e) {
      console.warn('Load inventory error:', e);
    }
  }

  function renderInventoryTable(items) {
    const tbody = document.getElementById('inventoryTableBody');
    tbody.innerHTML = items.map(p => {
      const stock = p.stock_qty ?? p.stock ?? 0;
      const min = p.min_stock_threshold || 10;
      const isActive = Number(p.is_active) === 1;

      let stateBadge = `<span class="badge admin-badge-active">Above minimum</span>`;
      if (stock === 0) {
        stateBadge = `<span class="badge admin-badge-out">Out of stock</span>`;
      } else if (stock <= min) {
        stateBadge = `<span class="badge admin-badge-low">Low stock</span>`;
      }

      return `
        <tr>
          <td>
            <div class="fw-medium text-light-cc">${escapeHtml(p.name)}</div>
            <div class="text-muted-cc font-monospace" style="font-size: 11px;">${escapeHtml(p.sku || '')}</div>
          </td>
          <td class="text-light-cc fw-medium">${stock}</td>
          <td class="text-muted-cc">${min}</td>
          <td>${stateBadge}</td>
          <td><span class="badge ${isActive ? 'admin-badge-active' : 'admin-badge-inactive'}">${isActive ? 'Active' : 'Inactive'}</span></td>
          <td class="text-end">
            ${can('can_adjust_stock') ? `
              <div class="d-inline-flex gap-2">
                <a href="javascript:void(0)" class="admin-action-link btn-restock" data-id="${p.id}" data-name="${escapeHtml(p.name)}" data-stock="${stock}">Restock</a>
                <span class="text-muted-cc">·</span>
                <a href="javascript:void(0)" class="admin-action-link btn-adjust" data-id="${p.id}" data-name="${escapeHtml(p.name)}" data-stock="${stock}">Adjust</a>
              </div>
            ` : `
              <span class="text-muted-cc" style="font-size: 12px;">View only</span>
            `}
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.btn-restock').forEach(b => {
      b.addEventListener('click', () => openRestockModal(b.dataset.id, b.dataset.name, b.dataset.stock));
    });

    tbody.querySelectorAll('.btn-adjust').forEach(b => {
      b.addEventListener('click', () => openAdjustModal(b.dataset.id, b.dataset.name, b.dataset.stock));
    });
  }

  function openRestockModal(id, name, currentStock) {
    document.getElementById('restockProdId').value = id;
    document.getElementById('restockProdName').textContent = name;
    document.getElementById('restockCurrentStock').textContent = `Current physical units: ${currentStock}`;
    document.getElementById('restockQty').value = '';
    new bootstrap.Modal(document.getElementById('modalRestock')).show();
  }

  document.getElementById('formRestock').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('restockProdId').value;
    const qty = parseInt(document.getElementById('restockQty').value, 10);
    const reason = document.getElementById('restockReason').value;

    try {
      await CCAdmin.apiRequest('public/api/admin/inventory.php', {
        method: 'POST',
        body: JSON.stringify({
          action: 'restock',
          product_id: parseInt(id, 10),
          quantity: qty,
          reason
        })
      });
      bootstrap.Modal.getInstance(document.getElementById('modalRestock')).hide();
      CCAdmin.showToast('Restocked successfully.');
      await loadInventory();
      await loadMovements();
      await loadOverview();
    } catch (err) {
      CCAdmin.showToast(err.message, 'error');
    }
  });

  function openAdjustModal(id, name, currentStock) {
    document.getElementById('adjustProdId').value = id;
    document.getElementById('adjustProdName').textContent = name;
    document.getElementById('adjustCurrentStock').textContent = `Current units: ${currentStock}`;
    document.getElementById('adjustQty').value = '';
    document.getElementById('adjustReason').value = '';
    new bootstrap.Modal(document.getElementById('modalAdjustStock')).show();
  }

  document.getElementById('formAdjustStock').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('adjustProdId').value;
    const type = document.querySelector('input[name="adjustType"]:checked').value;
    const qty = parseInt(document.getElementById('adjustQty').value, 10);
    const reason = document.getElementById('adjustReason').value;

    if (!Number.isInteger(qty) || qty < 0 || (type !== 'set' && qty < 1)) {
      CCAdmin.showToast('Enter a valid stock quantity.', 'error');
      return;
    }

    try {
      await CCAdmin.apiRequest('public/api/admin/inventory.php', {
        method: 'POST',
        body: JSON.stringify({
          action: 'adjust',
          product_id: parseInt(id, 10),
          type,
          quantity: qty,
          reason
        })
      });
      bootstrap.Modal.getInstance(document.getElementById('modalAdjustStock')).hide();
      CCAdmin.showToast('Stock adjusted successfully.');
      await loadInventory();
      await loadMovements();
      await loadOverview();
    } catch (err) {
      CCAdmin.showToast(err.message, 'error');
    }
  });

  // Movements Table
  async function loadMovements() {
    const search = document.getElementById('movementSearchInput').value;
    const type = document.getElementById('movementTypeFilter').value;
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (type) params.append('movement', type);

    try {
      const data = await CCAdmin.apiRequest(`public/api/admin/movements.php?${params.toString()}`);
      const tbody = document.getElementById('movementsTableBody');
      const items = data.movements || [];

      if (!items.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted-cc">No stock movements found.</td></tr>`;
        return;
      }

      tbody.innerHTML = items.map(m => {
        const delta = Number(m.quantity_delta ?? 0);
        return `
          <tr>
            <td class="text-muted-cc" style="font-size: 12px;">${escapeHtml(m.created_at)}</td>
            <td class="fw-medium text-light-cc">${escapeHtml(m.product_name || m.reference_id || 'Product')}</td>
            <td>
              <span class="text-muted-cc">${m.previous_quantity ?? '—'}</span>
              <span class="${delta >= 0 ? 'text-accent' : 'text-danger'} fw-medium mx-1">
                ${delta >= 0 ? `+${delta}` : delta}
              </span>
              <span class="text-light-cc">→ ${m.new_quantity ?? '—'}</span>
            </td>
            <td class="text-light-cc" style="font-size: 12px;">${escapeHtml(m.reason || m.notes || 'Standard movement')}</td>
            <td class="text-muted-cc" style="font-size: 12px;">${escapeHtml(m.admin_name || 'Admin')}</td>
          </tr>
        `;
      }).join('');
    } catch (e) {
      console.warn('Load movements error:', e);
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
  async function loadNotifications() {
    const status = document.getElementById('notifStatusFilter').value;
    const type = document.getElementById('notifTypeFilter').value;
    const params = new URLSearchParams();
    if (status) params.append('read_status', status);
    if (type) params.append('type', type);

    try {
      const data = await CCAdmin.apiRequest(`public/api/admin/notifications.php?${params.toString()}`);
      const tbody = document.getElementById('notificationsTableBody');
      const items = data.notifications || [];

      if (!items.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted-cc">No notifications found.</td></tr>`;
        return;
      }

      tbody.innerHTML = items.map(n => {
        const isRead = Number(n.is_read) === 1;
        return `
          <tr>
            <td>
              <span class="badge ${isRead ? 'admin-badge-inactive' : 'admin-badge-unread'}">
                ${isRead ? 'Read' : 'Unread'}
              </span>
            </td>
            <td>
              <div class="fw-medium text-light-cc">${escapeHtml(n.title)}</div>
              <div class="text-muted-cc" style="font-size: 11px;">Type: ${escapeHtml(n.type)}</div>
            </td>
            <td class="text-light-cc" style="font-size: 13px;">${escapeHtml(n.message)}</td>
            <td class="text-muted-cc" style="font-size: 12px;">${escapeHtml(n.created_at)}</td>
            <td class="text-end">
              ${!can('can_view_notifications') ? `
                <span class="text-muted-cc" style="font-size: 12px;">View only</span>
              ` : (!isRead ? `
                <a href="javascript:void(0)" class="admin-action-link btn-read-notif" data-id="${n.id}">Mark read</a>
              ` : `
                <span class="text-muted-cc" style="font-size: 12px;">Archived</span>
              `)}
            </td>
          </tr>
        `;
      }).join('');

      tbody.querySelectorAll('.btn-read-notif').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await CCAdmin.apiRequest('public/api/admin/notifications.php', {
              method: 'POST',
              body: JSON.stringify({ action: 'mark_read', notification_id: parseInt(btn.dataset.id, 10) })
            });
            await loadNotifications();
            await loadOverview();
          } catch (err) {
            CCAdmin.showToast(err.message, 'error');
          }
        });
      });

    } catch (e) {
      console.warn('Load notifications error:', e);
    }
  }

  ['notifStatusFilter', 'notifTypeFilter'].forEach(id => {
    document.getElementById(id).addEventListener('change', loadNotifications);
  });

  document.getElementById('markAllNotifsBtn').addEventListener('click', async () => {
    try {
      await CCAdmin.apiRequest('public/api/admin/notifications.php', {
        method: 'POST',
        body: JSON.stringify({ action: 'mark_all_read' })
      });
      CCAdmin.showToast('All notifications marked as read.');
      await loadNotifications();
      await loadOverview();
    } catch (err) {
      CCAdmin.showToast(err.message, 'error');
    }
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
  async function loadActivityLogs() {
    const search = document.getElementById('logSearchInput').value;
    const action = document.getElementById('logActionFilter').value;
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (action) params.append('activity', action);

    try {
      const data = await CCAdmin.apiRequest(`public/api/admin/activity-logs.php?${params.toString()}`);
      const tbody = document.getElementById('activityLogsTableBody');
      const items = data.logs || [];

      if (!items.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted-cc">No activity logs recorded.</td></tr>`;
        return;
      }

      tbody.innerHTML = items.map(l => `
        <tr>
          <td class="text-muted-cc" style="font-size: 12px;">${escapeHtml(l.created_at)}</td>
          <td class="fw-medium text-light-cc">${escapeHtml(l.responsible_person || 'Administrator')}</td>
          <td class="text-muted-cc" style="font-size: 12px;">${escapeHtml(l.role || 'Business Admin')}</td>
          <td class="text-light-cc fw-medium">${escapeHtml(l.action)}</td>
          <td class="text-light-cc">${escapeHtml(l.affected_resource)}</td>
          <td class="text-muted-cc" style="font-size: 12px;">${escapeHtml(l.change_details || '—')}</td>
        </tr>
      `).join('');
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
