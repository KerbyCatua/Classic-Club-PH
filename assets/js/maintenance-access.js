(function () {
  'use strict';

  const overlay = document.getElementById('cc-maintenance-overlay');
  const form = document.getElementById('cc-maintenance-login');
  if (!overlay || !form) return;

  document.body.style.overflow = 'hidden';
  Array.from(document.body.children).forEach(child => {
    if (child !== overlay) child.inert = true;
  });

  const error = document.getElementById('cc-maintenance-error');
  const button = form.querySelector('button[type="submit"]');

  async function csrf() {
    const response = await fetch('public/api/auth/csrf.php', {
      credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }
    });
    const result = await response.json();
    if (!response.ok || !result.success || !result.data?.token) throw new Error('Unable to start a secure sign in. Please retry.');
    return result.data.token;
  }

  async function logout() {
    try {
      const token = await csrf();
      await fetch('public/api/auth/logout.php', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { Accept: 'application/json', 'X-CSRF-Token': token }
      });
    } catch (_) { /* The role check has already denied access. */ }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.hidden = true;
    button.disabled = true;
    try {
      const token = await csrf();
      const response = await fetch('public/api/auth/login.php', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': token },
        body: JSON.stringify({
          email: document.getElementById('cc-maintenance-email').value.trim(),
          password: document.getElementById('cc-maintenance-password').value
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(result.error?.message || 'Sign in failed.');
      if (!result.data?.user?.roles?.includes('super_admin')) {
        await logout();
        throw new Error('A Super Admin account is required.');
      }
      window.location.replace('super-admin-dashboard.html#module-maintenance');
    } catch (failure) {
      error.textContent = failure.message || 'Sign in failed. Please retry.';
      error.hidden = false;
      document.getElementById('cc-maintenance-password').value = '';
      button.disabled = false;
    }
  });
})();
