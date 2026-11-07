/**
 * Classic Club PH - Admin Business Owner Dashboard (admin.js)
 * Connects Page 20 to the business admin APIs.
 */

const CCAdmin = (function () {
  let adminContext = null;
  let csrfToken = '';
  let csrfRefreshPromise = null;

  /**
   * Ask the server for the token tied to the current session. The cookie is a
   * convenience mirror and is deliberately not trusted as a source of truth:
   * it can outlive a rotated PHP session in another tab.
   */
  async function refreshCsrfToken() {
    if (!csrfRefreshPromise) {
      csrfRefreshPromise = (async () => {
        const res = await fetch('public/api/auth/csrf.php', {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Accept': 'application/json' }
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok || !payload.success || !payload.data || !payload.data.token) {
          throw new Error('Unable to initialize the security token.');
        }
        csrfToken = payload.data.token;
        return csrfToken;
      })().finally(() => {
        csrfRefreshPromise = null;
      });
    }

    return csrfRefreshPromise;
  }

  function getCsrfToken() {
    return csrfToken;
  }

  async function apiRequest(url, options = {}, retried = false) {
    const opts = {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options
    };
    opts.headers = {
      'Accept': 'application/json',
      ...(opts.headers || {})
    };

    const isMutation = Boolean(opts.method && opts.method.toUpperCase() !== 'GET');
    if (isMutation) {
      opts.headers['Content-Type'] = 'application/json';
      let token = getCsrfToken();
      if (!token) {
        token = await refreshCsrfToken();
      }
      opts.headers['X-CSRF-Token'] = token;
    }

    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      const errMsg = (data.error && data.error.message) || data.message || `Request failed (${res.status})`;

      // The session secret can rotate (login, expiry, regeneration). Refresh
      // once and replay the same mutation instead of showing a false failure.
      if (isMutation && !retried && res.status === 403 && /csrf/i.test(errMsg)) {
        await refreshCsrfToken();
        return apiRequest(url, options, true);
      }

      throw new Error(errMsg);
    }
    return data.data;
  }

  function formatPhp(amount) {
    return '₱' + Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function showToast(message, type = 'success') {
    const toastEl = document.getElementById('adminToast');
    const toastBody = document.getElementById('adminToastBody');
    if (!toastEl || !toastBody) {
      alert(message);
      return;
    }
    toastBody.textContent = message;
    toastEl.className = `toast align-items-center text-white border-0 ${type === 'error' ? 'bg-danger' : 'bg-success'}`;
    const bsToast = bootstrap.Toast.getOrCreateInstance(toastEl);
    bsToast.show();
  }

  return {
    getCsrfToken,
    refreshCsrfToken,
    apiRequest,
    formatPhp,
    showToast,
    getContext: () => adminContext,
    setContext: (ctx) => { adminContext = ctx; }
  };
})();
