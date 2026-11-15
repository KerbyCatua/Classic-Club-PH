document.addEventListener('DOMContentLoaded', () => {
  'use strict';
  if (typeof CCStore === 'undefined' || !window.CCCheckoutValidation) return;

  const form = document.getElementById('checkout-form');
  const validation = window.CCCheckoutValidation;
  const button = document.getElementById('place-order-btn');
  const buttonText = document.getElementById('place-order-btn-text');
  const status = document.getElementById('checkout-submit-status');
  const billing = document.getElementById('billing-preview-line');
  const value = name => form.elements.namedItem(name).value;
  const paymentLabels = {
    'demo-card': 'Illustrative card ending 4242.',
    'demo-gcash': 'GCash (Illustrative)',
    'demo-maya': 'Maya (Illustrative)'
  };
  let submitting = false;

  function updateBilling() {
    const parts = [
      [value('first_name'), value('last_name')].filter(Boolean).join(' '),
      value('street_address'), value('apartment'), value('barangay'), value('city'),
      [value('province'), value('postal_code')].filter(Boolean).join(' ')
    ].map(part => part.trim()).filter(Boolean);
    billing.textContent = parts.length ? parts.join(', ') + ', Philippines.' : 'Your shipping address will appear here.';
  }

  function updatePayment() {
    const method = value('payment_method');
    document.getElementById('checkout-demo-card').hidden = method !== 'demo-card';
    const wallet = document.getElementById('checkout-demo-wallet');
    wallet.hidden = !['demo-gcash', 'demo-maya'].includes(method);
    wallet.textContent = method === 'demo-gcash'
      ? 'GCash demo account: DEMO-GCASH. Payment will be simulated; no account number, PIN or verification code is needed.'
      : 'Maya demo account: DEMO-MAYA. Payment will be simulated; no account number, PIN or verification code is needed.';
  }

  const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  function renderCheckoutSummary() {
    const cart = CCStore.getCart();
    const totals = CCStore.getCartTotals();
    document.getElementById('checkout-subtotal-label').textContent = `Subtotal · ${totals.totalItems} ${totals.totalItems === 1 ? 'piece' : 'pieces'}`;
    document.getElementById('checkout-subtotal-value').textContent = CCStore.formatPHP(totals.subtotal);
    document.getElementById('checkout-shipping-value').textContent = CCStore.formatPHP(totals.shipping);
    document.getElementById('checkout-discount-value').textContent = totals.discount > 0 ? `−${CCStore.formatPHP(totals.discount)}` : '₱0.00';
    document.getElementById('checkout-total-value').textContent = CCStore.formatPHP(totals.total);
    const deliveryPrice = document.querySelector('label[for="checkout-delivery"] [data-product-price]');
    deliveryPrice.textContent = CCStore.formatPHP(totals.shipping);
    if (!submitting) buttonText.textContent = `Place demo order — ${CCStore.formatPHP(totals.total)}`;

    document.getElementById('checkout-items-list').innerHTML = cart.map(item => `
      <div class="d-flex align-items-center gap-3">
        <img src="${escapeHtml(CCStore.resolveCartImage(item))}" alt="${escapeHtml(item.name)} / ${escapeHtml(item.color)}"
          class="img-fluid object-fit-cover border border-cc flex-shrink-0" style="width: 88px; height: 106px; padding: 10px;">
        <div class="d-flex flex-column gap-1 flex-grow-1">
          <span class="cc-xs-text text-light-cc">${escapeHtml(item.name)}</span>
          <span class="cc-eyebrow text-transform-none" style="text-transform: none;">${escapeHtml(item.color)} / ${escapeHtml(item.size)} / Qty ${escapeHtml(item.quantity)}</span>
          <span class="cc-xs-text text-light-cc">${CCStore.formatPHP(item.price * item.quantity)}</span>
        </div>
      </div>`).join('');
  }

  async function loadProfile() {
    try {
      const response = await fetch('public/api/auth/me.php', {
        credentials: 'same-origin', headers: { Accept: 'application/json' }
      });
      const result = await response.json();
      const user = response.ok && result.success ? result.data?.user : null;
      if (!user || submitting) return;
      for (const name of ['email', 'first_name', 'last_name', 'mobile']) {
        const field = form.elements.namedItem(name);
        if (!field.value && !field.dataset.edited && user[name]) field.value = user[name];
      }
      updateBilling();
      await CCCheckoutAddresses.init(user);
    } catch {
      // Guest entry remains available when profile or address lookup is unavailable.
    }
  }

  form.addEventListener('input', updateBilling);
  form.addEventListener('cc:checkoutNormalized', updateBilling);
  form.addEventListener('change', event => {
    if (event.target.name === 'payment_method') updatePayment();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting) return;
    status.textContent = '';
    if (!validation.validate()) return;
    const currentCart = CCStore.getCart();
    if (!currentCart.length) {
      validation.showServerErrors({}, 'Your bag is empty. Add an item to your bag before placing a demo order.');
      return;
    }

    const currentTotals = CCStore.getCartTotals();
    // Only contact and delivery details go to the order API. No card or wallet details exist.
    const data = Object.fromEntries([
      'email', 'first_name', 'last_name', 'mobile', 'country', 'region', 'street_address',
      'apartment', 'barangay', 'city', 'province', 'postal_code', 'instructions'
    ].map(name => [name, value(name)]));
    data.promotion_code = CCStore.getPromo().code || '';
    const paymentMethod = paymentLabels[value('payment_method')];
    const customerInfo = {
      email: data.email, firstName: data.first_name, lastName: data.last_name, mobile: data.mobile,
      country: data.country, region: data.region, street: data.street_address, apartment: data.apartment,
      barangay: data.barangay, city: data.city, province: data.province, postalCode: data.postal_code,
      instructions: data.instructions, paymentMethod
    };
    submitting = true;
    validation.clearSummary();
    button.disabled = true;
    form.setAttribute('aria-busy', 'true');
    buttonText.textContent = 'Creating demo order…';
    status.textContent = 'Simulating payment and creating your demo order. No charge will be made.';
    // Lock the submitted values while the server responds, including saved-address actions.
    const controls = [...form.querySelectorAll('input, select, textarea, button')].filter(control => !control.disabled);
    controls.forEach(control => { control.disabled = true; });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let orderCreated = false;
    try {
      const csrfResponse = await fetch('public/api/auth/csrf.php', {
        credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: controller.signal
      });
      const csrf = await csrfResponse.json();
      if (!csrfResponse.ok || !csrf.success || !csrf.data?.token) throw new Error('Your session could not be verified. Refresh this page and try again.');
      const response = await fetch('public/api/checkout/create-order.php', {
        method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf.data.token },
        body: JSON.stringify(data)
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        const error = new Error(result.error?.message || 'Unable to create your demo order. Please try again.');
        error.fields = result.error?.fields || {};
        throw error;
      }
      const order = result.data;
      if (!order?.order_number) throw new Error('The server response was incomplete. Check your order history before trying again.');
      orderCreated = true;
      // A browser-storage problem must never turn a created order into a retry.
      try {
        CCStore.appendOrder({
          orderNumber: order.order_number,
          placedOn: new Date(order.placed_at || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Manila' }),
          status: order.status || 'Confirmed',
          items: order.items?.length ? order.items : currentCart,
          totals: {
            totalItems: order.total_items || currentTotals.totalItems,
            subtotal: Number(order.subtotal ?? currentTotals.subtotal), shipping: Number(order.shipping ?? currentTotals.shipping),
            discount: Number(order.discount ?? currentTotals.discount), total: Number(order.total ?? currentTotals.total)
          },
          customer: customerInfo
        });
        CCStore.clearCart();
      } catch { /* The confirmation page can load the order from the server. */ }
      window.location.href = 'order-confirmation.html?order_number=' + encodeURIComponent(order.order_number);
    } catch (error) {
      controls.forEach(control => { control.disabled = false; });
      status.textContent = '';
      const text = error.name === 'AbortError'
        ? 'The request took too long. Check your order history before trying again.'
        : error instanceof TypeError || error instanceof SyntaxError
          ? 'We could not confirm your order with the server. Check your connection and order history before trying again.'
          : error.message;
      validation.showServerErrors(error.fields, text);
    } finally {
      clearTimeout(timeout);
      if (!orderCreated) {
        submitting = false;
        button.disabled = false;
        form.removeAttribute('aria-busy');
        renderCheckoutSummary();
      }
    }
  });

  // Attach validation before enabling submission or starting asynchronous lookups.
  form.noValidate = true;
  button.disabled = false;
  updatePayment();
  updateBilling();
  renderCheckoutSummary();
  loadProfile();
  if (typeof CCStore.whenCatalogReady === 'function') {
    CCStore.whenCatalogReady().then(() => { CCStore.hydrateCartImages(); renderCheckoutSummary(); });
  }
  window.addEventListener('cc:cartUpdated', () => { CCStore.hydrateCartImages(); renderCheckoutSummary(); });
  window.addEventListener('cc:catalogReady', () => { CCStore.hydrateCartImages(); renderCheckoutSummary(); });
});
